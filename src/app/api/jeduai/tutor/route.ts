import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { tutorReply } from "@/lib/jeduai/ai";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { TUTOR_MODES, LANG_NAMES, SUBJECTS } from "@/lib/jeduai/constants";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const conv = await db.conversation.findFirst({
        where: { id, userId: user.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      return NextResponse.json({ conversation: conv });
    }
    const conversations = await db.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return NextResponse.json({ conversations });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`tutor:${user.id}`, 12, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "You're sending messages very fast. Take a short breather." }, { status: 429 });

    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 4000) : "";
    if (!question) return NextResponse.json({ error: "Type a question first" }, { status: 400 });

    const mode = TUTOR_MODES.some((m) => m.id === body?.mode) ? body.mode : "balanced";
    const subject = (SUBJECTS as readonly string[]).includes(body?.subject) ? body.subject : "General Knowledge";
    const lang = LANG_NAMES.includes(body?.lang) ? body.lang : user.explanationLang || "English";
    let conversationId: string | undefined = typeof body?.conversationId === "string" ? body.conversationId : undefined;

    let conv = conversationId
      ? await db.conversation.findFirst({ where: { id: conversationId, userId: user.id }, include: { messages: true } })
      : null;
    if (!conv) {
      const created = await db.conversation.create({
        data: { userId: user.id, title: question.slice(0, 42), subject, mode, lang },
      });
      conv = { ...created, messages: [] };
    } else if (conv.messages.length === 0) {
      await db.conversation.update({ where: { id: conv.id }, data: { title: question.slice(0, 42) } });
    }

    const history = conv.messages
      .slice(-12)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const [userMsg] = await Promise.all([
      db.message.create({ data: { conversationId: conv.id, role: "user", content: question } }),
    ]);

    try {
      const answer = await tutorReply({ mode, subject, lang, level: user.educationLevel, question, history });
      const aiMsg = await db.message.create({ data: { conversationId: conv.id, role: "assistant", content: answer } });
      await db.conversation.update({ where: { id: conv.id }, data: { subject, mode, lang, updatedAt: new Date() } });
      const gamified = await recordActivity(user.id, "chat");
      return NextResponse.json({ conversationId: conv.id, userMessage: userMsg, aiMessage: aiMsg, gamified });
    } catch (err) {
      await db.message.create({ data: { conversationId: conv.id, role: "assistant", content: "⚠️ I couldn't reach the AI service just now. Please tap retry in a moment." } });
      return NextResponse.json({ error: "AI service unavailable. Please retry.", retryable: true }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    if (body.conversationId && typeof body.title === "string") {
      const c = await db.conversation.findFirst({ where: { id: String(body.conversationId), userId: user.id } });
      if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await db.conversation.update({ where: { id: c.id }, data: { title: String(body.title).slice(0, 80) || c.title } });
      return NextResponse.json({ ok: true });
    }
    if (body.messageId && typeof body.rating === "number") {
      const m = await db.message.findFirst({
        where: { id: String(body.messageId), rating: undefined },
      });
      const msg = await db.message.findUnique({ where: { id: String(body.messageId) } });
      if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const conv = await db.conversation.findFirst({ where: { id: msg.conversationId, userId: user.id } });
      if (!conv) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
      await db.message.update({ where: { id: msg.id }, data: { rating: body.rating > 0 ? 1 : -1 } });
      return NextResponse.json({ ok: true, m: m ? undefined : undefined });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const conv = await db.conversation.findFirst({ where: { id, userId: user.id } });
    if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.conversation.delete({ where: { id: conv.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
