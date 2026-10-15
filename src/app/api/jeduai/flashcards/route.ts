import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { generateFlashcards } from "@/lib/jeduai/ai";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { LANG_NAMES } from "@/lib/jeduai/constants";

// Leitner spaced repetition: box -> days until next review
const BOX_DAYS = [1, 2, 4, 8, 16];

function nextDue(box: number) {
  const days = BOX_DAYS[Math.min(Math.max(box, 1), 5) - 1];
  return new Date(Date.now() + days * 86400_000);
}

// GET /api/jeduai/flashcards
//   ?deck=<sourceType>:<sourceId>  -> all cards of a deck
//   ?due=1                         -> due cards across all decks
//   default                        -> deck summaries
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const deck = req.nextUrl.searchParams.get("deck") || "";
    const due = req.nextUrl.searchParams.get("due") === "1";

    if (deck) {
      const [sourceType, sourceId] = deck.split(":");
      const cards = await db.flashcard.findMany({
        where: { userId: user.id, sourceType, sourceId },
        orderBy: { createdAt: "asc" },
      });
      return NextResponse.json({ cards });
    }

    if (due) {
      const cards = await db.flashcard.findMany({
        where: { userId: user.id, dueAt: { lte: new Date() } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        take: 60,
      });
      return NextResponse.json({ cards });
    }

    // deck summaries
    const cards = await db.flashcard.findMany({ where: { userId: user.id } });
    const now = new Date();
    const decks = new Map<
      string,
      {
        key: string;
        deckTitle: string;
        sourceType: string;
        sourceId: string | null;
        total: number;
        due: number;
        learned: number;
        nextDue: string | null;
      }
    >();
    for (const c of cards) {
      const key = `${c.sourceType}:${c.sourceId || ""}`;
      let d = decks.get(key);
      if (!d) {
        d = { key, deckTitle: c.deckTitle, sourceType: c.sourceType, sourceId: c.sourceId, total: 0, due: 0, learned: 0, nextDue: null };
        decks.set(key, d);
      }
      d.total++;
      if (c.dueAt <= now) d.due++;
      else if (!d.nextDue || c.dueAt < new Date(d.nextDue)) d.nextDue = c.dueAt.toISOString();
      if (c.box >= 4) d.learned++;
    }
    return NextResponse.json({ decks: Array.from(decks.values()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

// POST /api/jeduai/flashcards — generate a deck from a document or video project
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`flashcards:${user.id}`, 6, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
    const body = await req.json().catch(() => null);
    const sourceType =
      body?.sourceType === "video" ? "video" : body?.sourceType === "doc" ? "doc" : body?.sourceType === "message" ? "message" : null;
    const sourceId = typeof body?.sourceId === "string" ? body.sourceId : null;
    const count = Math.min(Math.max(parseInt(body?.count, 10) || 10, 4), 20);
    const lang = LANG_NAMES.includes(body?.lang) ? body.lang : user.explanationLang || "English";
    if (!sourceType || !sourceId) return NextResponse.json({ error: "Missing source" }, { status: 400 });

    // Gather source text (prefer translated content — that is what the user reads)
    let sourceText = "";
    let deckTitle = "";
    if (sourceType === "doc") {
      const doc = await db.document.findFirst({ where: { id: sourceId, userId: user.id } });
      if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
      const sections = await db.documentSection.findMany({ where: { documentId: doc.id }, orderBy: { idx: "asc" } });
      sourceText = sections
        .map((s) => (s.translated || s.original).slice(0, 1500))
        .join("\n\n")
        .slice(0, 9000);
      deckTitle = doc.title;
      if (doc.status !== "completed") return NextResponse.json({ error: "Document translation is still in progress." }, { status: 400 });
    } else if (sourceType === "message") {
      // tutor chat message -> flashcards straight from the explanation
      const msg = await db.message.findFirst({
        where: { id: sourceId, conversation: { userId: user.id } },
        include: { conversation: true },
      });
      if (!msg || msg.role !== "assistant") return NextResponse.json({ error: "Message not found" }, { status: 404 });
      sourceText = msg.content.slice(0, 9000);
      deckTitle = msg.conversation.title?.slice(0, 60) || "Tutor explanation";
      return finishMessageDeck(lang, count, sourceId, deckTitle, sourceText, user);
    } else {
      const v = await db.videoProject.findFirst({ where: { id: sourceId, userId: user.id } });
      if (!v) return NextResponse.json({ error: "Media project not found" }, { status: 404 });
      const segments = await db.videoSegment.findMany({ where: { videoId: v.id }, orderBy: { idx: "asc" } });
      sourceText = segments
        .map((s) => (s.translated || s.original).slice(0, 800))
        .join("\n")
        .slice(0, 9000);
      deckTitle = v.title;
      if (!["completed", "translated"].includes(v.status)) return NextResponse.json({ error: "Media translation is still in progress." }, { status: 400 });
    }
    if (sourceText.trim().length < 200)
      return NextResponse.json({ error: "Not enough translated content to build flashcards yet." }, { status: 400 });
    return finishDeck(sourceType, sourceId, sourceText, deckTitle, lang, count, user);

  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Flashcard generation failed" }, { status: 500 });
  }
}

// shared deck builder — replaces any previous deck from the same source, generates, persists
type DeckUser = { id: string };
async function finishDeck(
  sourceType: string,
  sourceId: string,
  sourceText: string,
  deckTitle: string,
  lang: string,
  count: number,
  user: DeckUser
) {
  // Replace any previous deck from the same source (regeneration)
  await db.flashcard.deleteMany({ where: { userId: user.id, sourceType, sourceId } });

  const cards = await generateFlashcards({ sourceText, lang, count, sourceTitle: deckTitle });
  const created = await Promise.all(
    cards.map((c) =>
      db.flashcard.create({
        data: {
          userId: user.id,
          deckTitle: deckTitle.slice(0, 80),
          sourceType,
          sourceId,
          front: c.front,
          back: c.back,
          lang,
          dueAt: new Date(),
        },
      })
    )
  );
  const gamified = await recordActivity(user.id, "flashcards");
  return NextResponse.json({ created: created.length, cards: created, gamified }, { status: 201 });
}

// tutor-message decks: shorter minimum content (explanations are compact)
async function finishMessageDeck(
  lang: string,
  count: number,
  messageId: string,
  deckTitle: string,
  sourceText: string,
  user: DeckUser
) {
  if (sourceText.trim().length < 120)
    return NextResponse.json(
      { error: "This explanation is a bit short for flashcards — ask the tutor for more detail first." },
      { status: 400 }
    );
  return finishDeck("message", messageId, sourceText, deckTitle, lang, count, user);
}

// PATCH /api/jeduai/flashcards — review a card (Leitner box update)
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : null;
    const result = body?.result === "known" ? "known" : body?.result === "again" ? "again" : null;
    if (!id || !result) return NextResponse.json({ error: "Invalid review" }, { status: 400 });

    const card = await db.flashcard.findFirst({ where: { id, userId: user.id } });
    if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

    // Known: promote a box (cap 5) and extend the interval. Again: demote to box 1, due now+10min.
    const box = result === "known" ? Math.min(card.box + 1, 5) : 1;
    const streak = result === "known" ? card.streak + 1 : 0;
    const dueAt = result === "known" ? nextDue(box) : new Date(Date.now() + 10 * 60_000);
    const updated = await db.flashcard.update({
      where: { id: card.id },
      data: { box, streak, lastResult: result, dueAt },
    });
    return NextResponse.json({ card: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// DELETE /api/jeduai/flashcards?id=<cardId>  or  ?deck=<sourceType>:<sourceId>
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = req.nextUrl.searchParams.get("id");
    const deck = req.nextUrl.searchParams.get("deck");
    if (id) {
      const card = await db.flashcard.findFirst({ where: { id, userId: user.id } });
      if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
      await db.flashcard.delete({ where: { id: card.id } });
      return NextResponse.json({ ok: true });
    }
    if (deck) {
      const [sourceType, sourceId] = deck.split(":");
      const r = await db.flashcard.deleteMany({ where: { userId: user.id, sourceType, sourceId } });
      return NextResponse.json({ ok: true, deleted: r.count });
    }
    return NextResponse.json({ error: "Missing id or deck" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
