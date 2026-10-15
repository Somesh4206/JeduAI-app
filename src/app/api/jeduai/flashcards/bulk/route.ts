import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { LANG_NAMES } from "@/lib/jeduai/constants";
import { randomBytes } from "crypto";

// POST /api/jeduai/flashcards/bulk — create a deck from pasted/CSV cards
//   { title, lang?, cards: [{front, back}] }
// Builds a "manual:<id>" deck (unique key) for the user, +XP on success.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`deckbulk:${user.id}`, 6, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
    const payload = await req.json().catch(() => null);
    const title = String(payload?.title || "").trim().slice(0, 80);
    const lang = LANG_NAMES.includes(payload?.lang) ? payload.lang : user.explanationLang || "English";
    const raw = Array.isArray(payload?.cards) ? payload.cards : [];
    if (title.length < 3) return NextResponse.json({ error: "Give the deck a name (3+ characters)." }, { status: 400 });

    const cards = raw
      .map((c: unknown) => ({
        front: String((c as { front?: unknown })?.front || "").trim().slice(0, 300),
        back: String((c as { back?: unknown })?.back || "").trim().slice(0, 800),
      }))
      .filter((c: { front: string; back: string }) => c.front.length >= 1 && c.back.length >= 1)
      .slice(0, 60);
    if (cards.length < 2) return NextResponse.json({ error: "Add at least 2 valid cards (front and back on each line)." }, { status: 400 });
    if (raw.length > 60) return NextResponse.json({ error: "A deck can hold at most 60 cards — split longer sets." }, { status: 400 });

    const sourceId = randomBytes(5).toString("hex");
    await db.flashcard.createMany({
      data: cards.map((c: { front: string; back: string }) => ({
        userId: user.id,
        deckTitle: title,
        sourceType: "manual",
        sourceId,
        front: c.front,
        back: c.back,
        lang,
        dueAt: new Date(),
      })),
    });
    const gamified = await recordActivity(user.id, "flashcards");
    return NextResponse.json({ deck: `manual:${sourceId}`, title, count: cards.length, gamified }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
