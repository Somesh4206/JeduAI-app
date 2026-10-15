import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";

// unambiguous share code alphabet (no 0/O/1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_CARDS = 60;
const TTL_DAYS = 30; // share codes expire 30 days after publish/refresh
const MAX_IMPORTS = 25; // then the code retires to avoid endless public distribution

function newCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// opportunistically remove expired / exhausted share codes (imported copies are
// independent Flashcard rows, so nothing the learner owns is ever touched)
async function cleanupSharedDecks() {
  try {
    await db.sharedDeck.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { imports: { gte: MAX_IMPORTS } }] },
    });
  } catch {}
}

function isExpired(sd: { expiresAt: Date | null; imports: number }) {
  return (!!sd.expiresAt && sd.expiresAt < new Date()) || sd.imports >= MAX_IMPORTS;
}

// POST /api/jeduai/flashcards/share { deck: "sourceType:sourceId" }
// Publishes (or refreshes) a share code for one of the user's decks.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`deckshare:${user.id}`, 10, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
    const body = await req.json().catch(() => null);
    const deckKey = typeof body?.deck === "string" ? body.deck : "";
    if (!deckKey.includes(":")) return NextResponse.json({ error: "Missing deck" }, { status: 400 });
    const [sourceType, sourceId = ""] = deckKey.split(":");

    await cleanupSharedDecks();

    const cards = await db.flashcard.findMany({
      where: { userId: user.id, sourceType, sourceId },
      orderBy: { createdAt: "asc" },
      take: MAX_CARDS,
    });
    if (cards.length < 4) return NextResponse.json({ error: "This deck is too small to share (min 4 cards)." }, { status: 400 });

    const payload = JSON.stringify(cards.map((c) => ({ front: c.front, back: c.back })));
    const title = cards[0].deckTitle.slice(0, 80);
    const lang = cards[0].lang;
    const expiresAt = new Date(Date.now() + TTL_DAYS * 86400_000);

    // refresh an existing share for the same deck, keeping the same code
    const existing = await db.sharedDeck.findFirst({ where: { userId: user.id, deckKey } });
    if (existing) {
      await db.sharedDeck.update({
        where: { id: existing.id },
        data: { title, lang, cards: payload, expiresAt },
      });
      return NextResponse.json({ code: existing.code, count: cards.length, title, expiresAt });
    }

    // generate a unique code (retry on the rare collision)
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const clash = await db.sharedDeck.findUnique({ where: { code }, select: { id: true } });
      if (clash) continue;
      const created = await db.sharedDeck.create({
        data: { code, userId: user.id, deckKey, title, lang, cards: payload, expiresAt },
      });
      return NextResponse.json({ code, count: cards.length, title, expiresAt: created.expiresAt });
    }
    return NextResponse.json({ error: "Could not allocate a share code — try again." }, { status: 500 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// GET /api/jeduai/flashcards/share?code=XXXXXX — preview a shared deck
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const code = (req.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return NextResponse.json({ error: "Enter a 6-character code." }, { status: 400 });
    const sd = await db.sharedDeck.findUnique({
      where: { code },
      include: { user: { select: { name: true } } },
    });
    if (!sd) return NextResponse.json({ error: "No deck found for this code — check it and try again." }, { status: 404 });
    if (isExpired(sd) && sd.userId !== user.id)
      return NextResponse.json(
        {
          error:
            sd.imports >= MAX_IMPORTS
              ? "This deck reached its import limit — ask the creator to share a fresh code."
              : `This share code expired${sd.expiresAt ? ` on ${new Date(sd.expiresAt).toLocaleDateString("en", { month: "short", day: "numeric" })}` : ""} — ask for a fresh one.`,
        },
        { status: 410 }
      );
    let cards: { front: string; back: string }[] = [];
    try {
      cards = JSON.parse(sd.cards) as { front: string; back: string }[];
    } catch {}
    const mine = sd.userId === user.id;
    const alreadyImported =
      !mine && (await db.flashcard.count({ where: { userId: user.id, sourceType: "shared", sourceId: sd.id } })) > 0;
    return NextResponse.json({
      code: sd.code,
      title: sd.title,
      lang: sd.lang,
      count: cards.length,
      creator: mine ? `${sd.user.name} (you)` : sd.user.name,
      createdAt: sd.createdAt,
      imports: sd.imports,
      expiresAt: sd.expiresAt,
      mine,
      alreadyImported,
      sample: cards.slice(0, 3).map((c) => ({ front: c.front.slice(0, 90), back: c.back.slice(0, 90) })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

// PUT /api/jeduai/flashcards/share { code } — import a shared deck into my decks
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`deckimport:${user.id}`, 10, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
    const body = await req.json().catch(() => null);
    const code = String(body?.code || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return NextResponse.json({ error: "Enter a 6-character code." }, { status: 400 });

    const sd = await db.sharedDeck.findUnique({ where: { code } });
    if (!sd) return NextResponse.json({ error: "No deck found for this code." }, { status: 404 });
    if (sd.userId === user.id) return NextResponse.json({ error: "This is your own deck — it's already in your library." }, { status: 400 });
    if (sd.imports >= MAX_IMPORTS)
      return NextResponse.json({ error: "This deck reached its import limit — ask the creator to share a fresh code." }, { status: 410 });
    if (sd.expiresAt && sd.expiresAt < new Date())
      return NextResponse.json(
        { error: `This share code expired on ${new Date(sd.expiresAt).toLocaleDateString("en", { month: "short", day: "numeric" })} — ask for a fresh one.` },
        { status: 410 }
      );

    const existing = await db.flashcard.count({ where: { userId: user.id, sourceType: "shared", sourceId: sd.id } });
    if (existing > 0) return NextResponse.json({ error: "You already imported this deck." }, { status: 400 });

    let cards: { front: string; back: string }[] = [];
    try {
      cards = JSON.parse(sd.cards) as { front: string; back: string }[];
    } catch {}
    if (!cards.length) return NextResponse.json({ error: "This shared deck is empty." }, { status: 400 });

    const title = `${sd.title}`.slice(0, 80) || "Shared deck";
    await db.flashcard.createMany({
      data: cards.map((c) => ({
        userId: user.id,
        deckTitle: title,
        sourceType: "shared",
        sourceId: sd.id,
        front: String(c.front || "").slice(0, 500),
        back: String(c.back || "").slice(0, 1000),
        lang: sd.lang,
        dueAt: new Date(),
      })),
    });
    await db.sharedDeck.update({ where: { id: sd.id }, data: { imports: { increment: 1 } } });
    const gamified = await recordActivity(user.id, "flashcards");
    return NextResponse.json({ imported: cards.length, title, gamified }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
