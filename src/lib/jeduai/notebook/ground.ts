// JeduAI Notebook — citation-grounded chat engine.
// Answers are ALWAYS built from retrieved evidence chunks. When retrieval
// finds nothing, the LLM is never called (an honest no-evidence message is
// persisted instead) — which structurally guarantees zero fabrication.
import "server-only";
import { db } from "@/lib/db";
import { recordActivity } from "../gamify";
import { parseJsonSafe } from "../ai";
import { buildEvidenceBlocks, chunksToCitations, extractCitations, retrieveChunks } from "./retrieval";
import type { ChatStreamEvent, Citation } from "./types";

// ---------------- modes ----------------

export const CHAT_MODES = ["balanced", "beginner", "exam", "advanced"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export function isChatMode(v: unknown): v is ChatMode {
  return typeof v === "string" && (CHAT_MODES as readonly string[]).includes(v);
}

const MODE_INSTRUCTIONS: Record<ChatMode, string> = {
  balanced:
    "Clear, helpful tutoring: well-structured, easy to follow, with a brief example or comparison when it helps.",
  beginner:
    "Explain for a complete beginner: very simple words, short sentences, no jargon (define any must-have term in brackets), friendly analogies.",
  exam:
    "Answer like a top-scoring student writing in an exam: definition first, then key points as bullets, then a short model answer, ending with a one-line 'Exam tips'.",
  advanced:
    "Answer at expert depth: precise terminology, mechanisms and nuance. Assume the reader is comfortable with the field.",
};

// ---------------- grounded streaming chat ----------------

export type AskStreamOpts = {
  user: { id: string; explanationLang?: string };
  notebook: { id: string; title: string };
  conversationId: string;
  question: string;
  mode: ChatMode;
  lang: string;
  /** Optional subset of sources to scope retrieval to (null = all selected). */
  sourceIds?: string[] | null;
  /** Aborts the LLM read loop when the client disconnects (partial text is persisted). */
  signal?: AbortSignal;
  /** SSE sink — the route writes each event as one `data: {...}` frame. */
  emit: (ev: ChatStreamEvent) => void;
};

const NO_EVIDENCE_MESSAGE =
  "I couldn't find anything about that in your selected sources. Try selecting more sources in the Sources tab, add more material, or rephrase your question.";

const ABORT_SENTINEL = "__client_aborted__";

function stripCitationMarkers(text: string): string {
  return text.replace(/\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

function buildSystemPrompt(o: { mode: ChatMode; lang: string; blocks: string[] }): string {
  return [
    "You are JeduAI Notebook, a research assistant that answers ONLY from the user's notebook sources.",
    "",
    "EVIDENCE — numbered excerpts from the user's sources:",
    ...o.blocks,
    "",
    "RULES:",
    "- Cite evidence inline using [1], [2] style markers at the end of the sentences they support. Every factual claim must come from the evidence. You may use several citations.",
    "- If the evidence does not contain the answer, say explicitly that the notebook sources don't cover this — do not guess, do not invent citations.",
    `- Answer style (${o.mode}): ${MODE_INSTRUCTIONS[o.mode]}`,
    `- Write the answer in ${o.lang}.`,
    "- Use Markdown. Keep it focused and readable (usually under 250 words unless the question demands more).",
  ].join("\n");
}

/**
 * Consume an SDK chat completion. With stream:true the SDK returns a
 * ReadableStream of SSE frames ("data: {json}\n\n" lines, terminated by
 * "data: [DONE]"); if the provider fell back to a JSON completion object
 * instead, its content is emitted as a single delta.
 */
async function consumeChatStream(
  stream: unknown,
  signal: AbortSignal | undefined,
  onDelta: (text: string) => void
): Promise<void> {
  if (!stream || typeof (stream as ReadableStream).getReader !== "function") {
    // Non-streaming fallback (provider returned the completion object)
    const content = (stream as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]?.message
      ?.content;
    if (typeof content === "string" && content) onDelta(content);
    return;
  }

  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  let abortHandler: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new Error(ABORT_SENTINEL));
  });
  aborted.catch(() => {}); // never surfaces as an unhandled rejection
  if (signal) {
    if (signal.aborted) throw new Error(ABORT_SENTINEL);
    signal.addEventListener("abort", abortHandler!, { once: true });
  }

  try {
    while (!finished) {
      let read: Awaited<ReturnType<typeof reader.read>>;
      try {
        read = await Promise.race([reader.read(), aborted]);
      } catch (err) {
        if ((err as Error)?.message === ABORT_SENTINEL) {
          try {
            await reader.cancel();
          } catch {}
        }
        throw err;
      }
      if (read.done) break;
      if (read.value) buffer += decoder.decode(read.value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0 && !finished) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          if (payload === "[DONE]") finished = true;
          continue;
        }
        try {
          const obj = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = obj?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) onDelta(delta);
        } catch {
          // skip a malformed SSE line — never abort the whole answer for one bad frame
        }
      }
    }
  } finally {
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

export async function askNotebookStream(opts: AskStreamOpts): Promise<void> {
  const { emit } = opts;

  // 1. persist the user's question (its id travels in the meta event)
  const userMsg = await db.notebookMessage.create({
    data: {
      conversationId: opts.conversationId,
      userId: opts.user.id,
      role: "user",
      content: opts.question,
    },
  });
  await db.notebookConversation
    .update({ where: { id: opts.conversationId }, data: { updatedAt: new Date() } })
    .catch(() => {});

  // 2. retrieve evidence (BM25 + source diversity)
  const chunks = await retrieveChunks({
    notebookId: opts.notebook.id,
    userId: opts.user.id,
    sourceIds: opts.sourceIds ?? null,
    query: opts.question,
    k: 8,
    maxPerSource: 3,
  });

  // 3. no evidence → honest dead end. The LLM is never called here.
  if (!chunks.length) {
    const saved = await db.notebookMessage.create({
      data: {
        conversationId: opts.conversationId,
        userId: opts.user.id,
        role: "assistant",
        content: NO_EVIDENCE_MESSAGE,
        citations: "[]",
      },
    });
    emit({ type: "no-evidence", messageId: saved.id, content: NO_EVIDENCE_MESSAGE });
    return;
  }

  const citations: Citation[] = chunksToCitations(chunks);
  const { blocks } = buildEvidenceBlocks(chunks);
  emit({
    type: "meta",
    conversationId: opts.conversationId,
    userMessageId: userMsg.id,
    citations,
    evidenceCount: citations.length,
  });

  // 4. conversation history — last 12 turns, citation markers stripped
  const historyRows = await db.notebookMessage.findMany({
    where: { conversationId: opts.conversationId, id: { not: userMsg.id } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const history: { role: "user" | "assistant"; content: string }[] = historyRows
    .reverse()
    .map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: stripCitationMarkers(m.content).slice(0, 2000),
    }));

  const system = buildSystemPrompt({ mode: opts.mode, lang: opts.lang, blocks });

  // 5. stream the grounded answer
  let full = "";
  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    const stream: unknown = await zai.chat.completions.create({
      messages: [{ role: "assistant", content: system }, ...history, { role: "user", content: opts.question }],
      stream: true,
      thinking: { type: "disabled" },
    });
    await consumeChatStream(stream, opts.signal, (delta) => {
      full += delta;
      emit({ type: "delta", text: delta });
    });

    if (!full.trim()) {
      emit({ type: "error", error: "The AI returned an empty response. Please try again." });
      return;
    }
    const validated = extractCitations(full, citations);
    const saved = await db.notebookMessage.create({
      data: {
        conversationId: opts.conversationId,
        userId: opts.user.id,
        role: "assistant",
        content: full,
        citations: JSON.stringify(validated),
      },
    });
    await db.notebookConversation
      .update({ where: { id: opts.conversationId }, data: { updatedAt: new Date() } })
      .catch(() => {});
    emit({ type: "done", messageId: saved.id, content: full, citations: validated });
    await recordActivity(opts.user.id, "chat", undefined, { notebook: opts.notebook.id }).catch(() => {});
  } catch (err) {
    // Aborted (client disconnect) or provider failure: persist any partial
    // text with the citations already referenced, so the turn isn't lost.
    if (full.trim()) {
      const partialCitations = extractCitations(full, citations);
      await db
        .notebookMessage
        .create({
          data: {
            conversationId: opts.conversationId,
            userId: opts.user.id,
            role: "assistant",
            content: full,
            citations: JSON.stringify(partialCitations),
          },
        })
        .catch(() => {});
    }
    if (opts.signal?.aborted) return; // the client is gone — no point emitting
    const msg = (err as Error)?.message || "";
    emit({
      type: "error",
      error: /timeout|abort|network|fetch/i.test(msg)
        ? "The AI service was interrupted. Please try again."
        : "The AI service hit a problem answering that. Please try again.",
    });
  }
}

// ---------------- suggested questions ----------------

const suggestCache = new Map<string, { qs: string[]; at: number }>();
const SUGGEST_TTL_MS = 10 * 60_000;

export async function suggestQuestions(notebookId: string, userId: string): Promise<string[]> {
  const key = `${userId}:${notebookId}`;
  const cached = suggestCache.get(key);
  if (cached && Date.now() - cached.at < SUGGEST_TTL_MS) return cached.qs;

  const sources = await db.notebookSource.findMany({
    where: { notebookId, userId, status: "ready", selected: true },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true, title: true },
  });
  if (!sources.length) return [];

  // sample up to 6 chunks spread across sources: the first chunk of each
  // source plus one middle chunk where available
  const excerpts: string[] = [];
  for (const s of sources) {
    if (excerpts.length >= 6) break;
    const first = await db.sourceChunk.findFirst({
      where: { sourceId: s.id },
      orderBy: { idx: "asc" },
      select: { text: true },
    });
    if (first) excerpts.push(`("${s.title}")\n"""${first.text.slice(0, 600)}"""`);
    if (excerpts.length >= 6) break;
    const count = await db.sourceChunk.count({ where: { sourceId: s.id } });
    if (count >= 4) {
      const mid = await db.sourceChunk.findFirst({
        where: { sourceId: s.id, idx: Math.floor(count / 2) },
        select: { text: true },
      });
      if (mid) excerpts.push(`("${s.title}")\n"""${mid.text.slice(0, 600)}"""`);
    }
  }
  if (!excerpts.length) return [];

  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "assistant",
          content:
            'Based on these excerpts from the user\'s study notebook, suggest 3 specific, interesting questions the material can answer. Return STRICT JSON {"questions":["...","...","..."]} — each under 12 words, in English.',
        },
        { role: "user", content: excerpts.join("\n\n").slice(0, 6000) },
      ],
      thinking: { type: "disabled" },
    });
    const raw =
      (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonSafe<{ questions?: unknown[] }>(raw, {});
    const qs = (Array.isArray(parsed.questions) ? parsed.questions : [])
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim().slice(0, 120))
      .slice(0, 3);
    if (qs.length) {
      suggestCache.set(key, { qs, at: Date.now() });
      return qs;
    }
    return [];
  } catch {
    return []; // honest empty — no invented suggestions
  }
}
