// /api/jeduai/notebook/[id]/chat — grounded chat over notebook sources.
// GET  ?suggest=1            → starter questions
// GET  ?conversationId=X     → one conversation + messages
// GET                          → conversation list
// POST (SSE)                  → meta → delta* → done | no-evidence | error
// PATCH {conversationId,title} → rename · DELETE ?conversationId= → remove
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/jeduai/auth";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { LANG_NAMES } from "@/lib/jeduai/constants";
import { askNotebookStream, isChatMode, suggestQuestions, type ChatMode } from "@/lib/jeduai/notebook/ground";
import type { ChatStreamEvent, Citation, ConversationDTO, MessageDTO } from "@/lib/jeduai/notebook/types";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function toMessageDTO(m: {
  id: string;
  role: string;
  content: string;
  citations: string;
  createdAt: Date;
}): MessageDTO {
  let citations: Citation[] = [];
  try {
    const v = JSON.parse(m.citations || "[]");
    if (Array.isArray(v)) citations = v as Citation[];
  } catch {
    citations = [];
  }
  return {
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    citations,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const nb = await db.notebook.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!nb) return bad("Notebook not found.", 404);

    const sp = req.nextUrl.searchParams;

    // starter questions from sampled chunks
    if (sp.get("suggest") === "1") {
      const questions = await suggestQuestions(nb.id, user.id);
      return NextResponse.json({ questions });
    }

    const convId = sp.get("conversationId");
    if (convId) {
      const conv = await db.notebookConversation.findFirst({
        where: { id: convId, notebookId: nb.id, userId: user.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!conv) return bad("Conversation not found.", 404);
      const dto: ConversationDTO = {
        id: conv.id,
        title: conv.title,
        messageCount: conv.messages.length,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
        messages: conv.messages.map(toMessageDTO),
      };
      return NextResponse.json({ conversation: dto });
    }

    const conversations = await db.notebookConversation.findMany({
      where: { notebookId: nb.id, userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { _count: { select: { messages: true } } },
    });
    const dtos: ConversationDTO[] = conversations.map((c) => ({
      id: c.id,
      title: c.title,
      messageCount: c._count.messages,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
    return NextResponse.json({ conversations: dtos });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Failed to load chat", 500);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const rl = rateLimit(`nbchat:${user.id}`, 15, 60_000);
    if (!rl.ok) return bad("You're chatting very fast. Give it a few seconds.", 429);

    const nb = await db.notebook.findFirst({
      where: { id, userId: user.id },
      select: { id: true, title: true },
    });
    if (!nb) return bad("Notebook not found.", 404);

    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 4000) : "";
    if (!question) return bad("Type a question first.");

    let mode: ChatMode = "balanced";
    if (body?.mode != null) {
      if (!isChatMode(body.mode)) return bad("Unknown chat mode.");
      mode = body.mode;
    }
    let lang =
      user.explanationLang && LANG_NAMES.includes(user.explanationLang) ? user.explanationLang : "English";
    if (body?.lang != null) {
      if (typeof body.lang !== "string" || !LANG_NAMES.includes(body.lang)) {
        return bad("Pick a valid answer language.");
      }
      lang = body.lang;
    }

    // optional subset of sources (validated owned + in this notebook)
    let sourceIds: string[] | null = null;
    if (body?.sourceIds != null) {
      if (
        !Array.isArray(body.sourceIds) ||
        body.sourceIds.length > 20 ||
        body.sourceIds.some((s: unknown) => typeof s !== "string")
      ) {
        return bad("sourceIds must be a list of at most 20 source ids.");
      }
      const ids = Array.from(new Set(body.sourceIds as string[])).filter(Boolean);
      if (ids.length) {
        const owned = await db.notebookSource.findMany({
          where: { id: { in: ids }, notebookId: nb.id, userId: user.id },
          select: { id: true },
        });
        if (owned.length !== ids.length) return bad("One or more sources are not part of this notebook.");
        sourceIds = ids;
      }
    }

    // conversation: reuse (owner-checked) or create titled from the question
    let conversation: { id: string } | null = null;
    if (typeof body?.conversationId === "string" && body.conversationId) {
      conversation = await db.notebookConversation.findFirst({
        where: { id: body.conversationId, notebookId: nb.id, userId: user.id },
        select: { id: true },
      });
      if (!conversation) return bad("Conversation not found.", 404);
    } else {
      conversation = await db.notebookConversation.create({
        data: { notebookId: nb.id, userId: user.id, title: question.slice(0, 60) },
      });
    }
    const conversationId = conversation.id;

    // One abort source for both the request signal and stream cancellation.
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.signal.addEventListener("abort", onAbort, { once: true });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (ev: ChatStreamEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          } catch {
            closed = true; // client vanished mid-frame
          }
        };
        try {
          await askNotebookStream({
            user: { id: user.id, explanationLang: user.explanationLang },
            notebook: { id: nb.id, title: nb.title },
            conversationId,
            question,
            mode,
            lang,
            sourceIds,
            signal: ac.signal,
            emit: send,
          });
        } catch (e) {
          send({ type: "error", error: (e as Error)?.message || "Something went wrong." });
        } finally {
          req.signal.removeEventListener("abort", onAbort);
          closed = true;
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        ac.abort(); // partial answer is persisted by askNotebookStream's abort path
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Chat failed", 500);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const nb = await db.notebook.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!nb) return bad("Notebook not found.", 404);

    const body = await req.json().catch(() => null);
    const convId = typeof body?.conversationId === "string" ? body.conversationId : "";
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 60) : "";
    if (!convId) return bad("Missing conversationId.");
    if (!title) return bad("Title must be 1–60 characters.");

    const conv = await db.notebookConversation.findFirst({
      where: { id: convId, notebookId: nb.id, userId: user.id },
    });
    if (!conv) return bad("Conversation not found.", 404);
    await db.notebookConversation.update({ where: { id: conv.id }, data: { title } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Could not rename the conversation", 500);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const nb = await db.notebook.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!nb) return bad("Notebook not found.", 404);

    const convId = req.nextUrl.searchParams.get("conversationId");
    if (!convId) return bad("Missing conversationId.");
    const conv = await db.notebookConversation.findFirst({
      where: { id: convId, notebookId: nb.id, userId: user.id },
    });
    if (!conv) return bad("Conversation not found.", 404);
    await db.notebookConversation.delete({ where: { id: conv.id } }); // messages cascade
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Could not delete the conversation", 500);
  }
}
