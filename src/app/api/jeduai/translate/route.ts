import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { detectLanguage, explainSimply, translateText } from "@/lib/jeduai/ai";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { LANG_NAMES } from "@/lib/jeduai/constants";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const saved = req.nextUrl.searchParams.get("saved") === "1";
    const items = await db.translationRecord.findMany({
      where: saved ? { userId: user.id, saved: true } : { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`translate:${user.id}`, 20, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many translations in a minute. Please wait a bit." }, { status: 429 });
    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 5000) : "";
    if (!text) return NextResponse.json({ error: "Enter some text to translate" }, { status: 400 });
    let from = LANG_NAMES.includes(body?.from) ? body.from : "English";
    const to = LANG_NAMES.includes(body?.to) ? body.to : user.explanationLang || "Hindi";
    const mode = body?.mode === "learning" ? "learning" : "direct";
    if (body?.autoDetect && from === "Auto-detect") from = await detectLanguage(text);

    // No-op guard: translating a language into itself wastes a call and clutters
    // history with identical text. Return a helpful hint + one alternative.
    if (from === to) {
      const preferred =
        user.interfaceLang !== to && LANG_NAMES.includes(user.interfaceLang)
          ? user.interfaceLang
          : "Hindi" !== to
            ? "Hindi"
            : LANG_NAMES.find((l) => l !== to) || "English";
      return NextResponse.json(
        {
          error: `This text is already in ${to}. Pick a different target language below.`,
          detected: from,
          suggestion: preferred,
        },
        { status: 422 }
      );
    }

    const result = await translateText({ text, from, to, mode });
    const rec = await db.translationRecord.create({
      data: {
        userId: user.id,
        sourceLang: from,
        targetLang: to,
        mode,
        sourceText: text,
        translatedText: result.translated,
        explanation: result.explanation || null,
      },
    });
    const gamified = await recordActivity(user.id, "translate");
    return NextResponse.json({ record: rec, vocabulary: (result as { vocabulary?: unknown[] }).vocabulary || [], gamified });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Translation failed. Please retry." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    if (body.id && body.action === "save") {
      const rec = await db.translationRecord.findFirst({ where: { id: String(body.id), userId: user.id } });
      if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const updated = await db.translationRecord.update({ where: { id: rec.id }, data: { saved: !rec.saved } });
      return NextResponse.json({ record: updated });
    }
    if (body.id && body.action === "simplify") {
      const rec = await db.translationRecord.findFirst({ where: { id: String(body.id), userId: user.id } });
      if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const simple = await explainSimply(rec.translatedText, rec.targetLang);
      const updated = await db.translationRecord.update({
        where: { id: rec.id },
        data: { explanation: simple },
      });
      return NextResponse.json({ record: updated });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const rec = await db.translationRecord.findFirst({ where: { id, userId: user.id } });
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.translationRecord.delete({ where: { id: rec.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
