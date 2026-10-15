import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { extractVocabulary } from "@/lib/jeduai/ai";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { todayStr, shiftDay } from "@/lib/jeduai/constants";

// Leitner spaced repetition: box -> days until next practice
const BOX_DAYS = [1, 2, 4, 8, 16];

function nextDue(box: number) {
  const days = BOX_DAYS[Math.min(Math.max(box, 1), 5) - 1];
  return new Date(Date.now() + days * 86400_000);
}

// GET /api/jeduai/vocab[?q=filter]
// -> { words, stats: { total, learning, mastered, due }, week: { days, added, practiced, correct } }
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const all = await db.vocabWord.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    const now = new Date();
    const words = q
      ? all.filter((w) => w.term.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q))
      : all;
    const stats = {
      total: all.length,
      learning: all.filter((w) => !w.mastered).length,
      mastered: all.filter((w) => w.mastered).length,
      due: all.filter((w) => !w.mastered && w.dueAt <= now).length,
    };

    // weekly vocabulary report: words added + practice sessions + correct answers per day
    const week = Array.from({ length: 7 }, (_, i) => shiftDay(todayStr(), -6 + i));
    const acts = await db.activity.findMany({
      where: { userId: user.id, day: { in: week }, type: "vocab" },
      select: { day: true, points: true, meta: true },
    });
    const dayOf = (iso: Date) => todayStr(new Date(iso));
    const weekReport = {
      days: week,
      added: week.map((d) => all.filter((w) => dayOf(w.createdAt) === d).length),
      practiced: week.map((d) => acts.filter((a) => a.day === d).length),
      correct: week.map((d) =>
        acts
          .filter((a) => a.day === d)
          .reduce((s, a) => {
            try {
              return s + (Number(JSON.parse(a.meta).correct) || 0);
            } catch {
              return s;
            }
          }, 0)
      ),
    };

    return NextResponse.json({ words, stats, week: weekReport });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

// POST /api/jeduai/vocab
//   { action: "export-deck", scope: all|learning|due|mastered }         -> flashcard deck from words
//   { words: [{term, meaning, example?, lang?, meaningLang?}], source? }  -> bulk add (translation/manual)
//   { messageId }                                                        -> AI extraction from a tutor message
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`vocab:${user.id}`, 12, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
    const body = await req.json().catch(() => null);

    // ---- export vocabulary words as a flashcard deck ----
    if (body?.action === "export-deck") {
      const scope = ["all", "learning", "due", "mastered"].includes(body?.scope) ? body.scope : "all";
      const all = await db.vocabWord.findMany({ where: { userId: user.id } });
      const now = new Date();
      const pool =
        scope === "all"
          ? all
          : scope === "mastered"
            ? all.filter((w) => w.mastered)
            : scope === "due"
              ? all.filter((w) => !w.mastered && w.dueAt <= now)
              : all.filter((w) => !w.mastered);
      if (pool.length < 4)
        return NextResponse.json(
          { error: `Not enough words in this set (${pool.length}) — flashcard decks need at least 4.` },
          { status: 400 }
        );
      const capped = pool.slice(0, 60);
      // re-exporting the same set refreshes the previous deck
      await db.flashcard.deleteMany({ where: { userId: user.id, sourceType: "vocab", sourceId: scope } });
      const titles: Record<string, string> = {
        all: `My vocabulary — ${capped.length} words`,
        learning: `Learning words — ${capped.length}`,
        due: `Due words — ${capped.length}`,
        mastered: `Mastered words — ${capped.length}`,
      };
      const deckTitle = titles[scope];
      const lang = user.interfaceLang || "English";
      const created = await Promise.all(
        capped.map((w) =>
          db.flashcard.create({
            data: {
              userId: user.id,
              deckTitle: deckTitle.slice(0, 80),
              sourceType: "vocab",
              sourceId: scope,
              front: w.term.slice(0, 300),
              back: (w.example ? `${w.meaning}\n\nExample: ${w.example}` : w.meaning).slice(0, 800),
              lang,
              dueAt: new Date(),
            },
          })
        )
      );
      const gamified = await recordActivity(user.id, "flashcards");
      return NextResponse.json({ created: created.length, deck: deckTitle, gamified }, { status: 201 });
    }

    // ---- AI extraction from a tutor message ----
    if (typeof body?.messageId === "string") {
      const msg = await db.message.findFirst({
        where: { id: body.messageId, conversation: { userId: user.id } },
        include: { conversation: true },
      });
      if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });
      const conv = msg.conversation;
      const meaningLang = user.interfaceLang || "English";
      const extracted = await extractVocabulary({
        text: msg.content,
        lang: conv.lang || "English",
        meaningLang,
      });
      // de-duplicate against existing words (case-insensitive on term)
      const existing = new Set(
        (await db.vocabWord.findMany({ where: { userId: user.id }, select: { term: true } })).map((w) =>
          w.term.trim().toLowerCase()
        )
      );
      const fresh = extracted.filter((w) => !existing.has(w.term.toLowerCase()));
      const created = await Promise.all(
        fresh.map((w) =>
          db.vocabWord.create({
            data: {
              userId: user.id,
              term: w.term,
              meaning: w.meaning,
              example: w.example,
              lang: conv.lang || "English",
              meaningLang,
              source: "tutor",
              dueAt: new Date(),
            },
          })
        )
      );
      return NextResponse.json({ created: created.length, skipped: extracted.length - fresh.length }, { status: 201 });
    }

    // ---- manual / translation bulk add ----
    const incoming = Array.isArray(body?.words) ? body.words : [];
    const cleaned = incoming
      .filter(
        (w: { term?: unknown; meaning?: unknown }) =>
          typeof w?.term === "string" && typeof w?.meaning === "string" && w.term.trim() && w.meaning.trim()
      )
      .slice(0, 20)
      .map((w: { term: string; meaning: string; example?: string; lang?: string; meaningLang?: string }) => ({
        term: w.term.trim().slice(0, 120),
        meaning: w.meaning.trim().slice(0, 300),
        example: typeof w.example === "string" && w.example.trim() ? w.example.trim().slice(0, 300) : null,
        lang: typeof w.lang === "string" && w.lang.trim() ? w.lang.trim() : "English",
        meaningLang: typeof w.meaningLang === "string" && w.meaningLang.trim() ? w.meaningLang.trim() : "English",
      }));
    if (!cleaned.length) return NextResponse.json({ error: "No valid words provided" }, { status: 400 });

    const source = ["translation", "tutor", "manual"].includes(body?.source) ? body.source : "manual";
    const existing = new Set(
      (await db.vocabWord.findMany({ where: { userId: user.id }, select: { term: true } })).map((w) =>
        w.term.trim().toLowerCase()
      )
    );
    const fresh = cleaned.filter((w) => !existing.has(w.term.toLowerCase()));
    const created = await Promise.all(
      fresh.map((w) =>
        db.vocabWord.create({
          data: { userId: user.id, ...w, source, dueAt: new Date() },
        })
      )
    );
    return NextResponse.json({ created: created.length, skipped: cleaned.length - fresh.length }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Could not save vocabulary" }, { status: 500 });
  }
}

// PATCH /api/jeduai/vocab
//   { id, result: "known" | "again" } -> Leitner box update from practice
//   { id, action: "master" }          -> toggle mastered
//   { action: "practice-done", correct } -> award XP for a finished practice session
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);

    if (body?.action === "practice-done") {
      const correct = Math.min(Math.max(parseInt(body?.correct, 10) || 0, 0), 40);
      if (correct <= 0) return NextResponse.json({ xp: 0 });
      const points = correct * 2;
      const gamified = await recordActivity(user.id, "vocab", points, { correct });
      return NextResponse.json({ xp: points, gamified });
    }

    if (body?.action === "master" && typeof body?.id === "string") {
      const word = await db.vocabWord.findFirst({ where: { id: body.id, userId: user.id } });
      if (!word) return NextResponse.json({ error: "Word not found" }, { status: 404 });
      const updated = await db.vocabWord.update({
        where: { id: word.id },
        data: { mastered: !word.mastered, box: !word.mastered ? 5 : Math.min(word.box, 2) },
      });
      return NextResponse.json({ word: updated });
    }

    if (typeof body?.id === "string" && (body?.result === "known" || body?.result === "again")) {
      const word = await db.vocabWord.findFirst({ where: { id: body.id, userId: user.id } });
      if (!word) return NextResponse.json({ error: "Word not found" }, { status: 404 });
      const known = body.result === "known";
      const box = known ? Math.min(word.box + 1, 5) : 1;
      const dueAt = known ? nextDue(box) : new Date(Date.now() + 10 * 60_000);
      // a miss always un-masters the word (mastery is earned, not kept) — a hit on box 5 earns it back
      const mastered = known ? (box >= 5 ? true : word.mastered) : false;
      const updated = await db.vocabWord.update({
        where: { id: word.id },
        data: { box, lastResult: body.result, dueAt, mastered },
      });
      return NextResponse.json({ word: updated });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// DELETE /api/jeduai/vocab?id=<wordId>
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const word = await db.vocabWord.findFirst({ where: { id, userId: user.id } });
    if (!word) return NextResponse.json({ error: "Word not found" }, { status: 404 });
    await db.vocabWord.delete({ where: { id: word.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
