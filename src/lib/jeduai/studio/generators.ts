// JeduAI Notebook Studio — LLM generators for the 9 artifact kinds.
// All generators are grounded in retrieved notebook evidence, return typed
// payloads and throw honest errors when the model output is unusable.
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { parseJsonSafe } from "@/lib/jeduai/ai";
import {
  buildEvidenceBlocks,
  chunksToCitations,
  extractCitations,
  retrieveChunks,
  type RetrievedChunk,
} from "@/lib/jeduai/notebook/retrieval";
import type {
  Citation,
  InfographicBlock,
  InfographicContent,
  MindMapContent,
  MindMapNode,
  ReportContent,
  SlidesContent,
  TableContent,
} from "@/lib/jeduai/notebook/types";

export type InfographicAspect = "4:5" | "1:1" | "16:9";

type ReportTypeLocal =
  | "study-guide"
  | "briefing"
  | "summary"
  | "faq"
  | "glossary"
  | "essay-questions"
  | "critical-analysis"
  | "blog-post"
  | "revision-sheet"
  | "custom";

export const UNUSABLE = "AI generation returned an unusable response — please retry.";
export const NO_SOURCES = "Add at least one processed source, then try again.";

const REPORT_TYPES = [
  "study-guide",
  "briefing",
  "summary",
  "faq",
  "glossary",
  "essay-questions",
  "critical-analysis",
  "blog-post",
  "revision-sheet",
  "custom",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

// ---------------- LLM plumbing ----------------

// Serialize LLM calls: creating several artifacts at once otherwise fires
// concurrent requests that trip the provider's rate limit (429). Sequential
// execution with a short backoff retry keeps bursts reliable.
let chatQueue: Promise<void> = Promise.resolve();

async function chatLLMOnce(system: string, user: string): Promise<string> {
  const client = await ZAI.create();
  const completion = await client.chat.completions.create({
    messages: [
      { role: "assistant", content: system },
      { role: "user", content: user },
    ],
    thinking: { type: "disabled" },
  });
  const out = completion.choices[0]?.message?.content;
  if (!out || !out.trim()) throw new Error("Empty response from AI");
  return out;
}

async function chatLLM(system: string, user: string): Promise<string> {
  const exec = async (): Promise<string> => {
    try {
      return await chatLLMOnce(system, user);
    } catch (e) {
      const msg = String((e as Error)?.message || "");
      if (msg.includes("429")) {
        await new Promise((r) => setTimeout(r, 2500));
        return chatLLMOnce(system, user);
      }
      throw e;
    }
  };
  const result = chatQueue.then(exec, exec);
  chatQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function str(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
}

function evidenceHeader(evidenceText: string, lang: string): string {
  return `You are generating a Notebook Studio artifact for JeduAI, grounded ONLY in the user's study notes.
Write ALL content in ${lang}.
STUDY MATERIAL — numbered evidence blocks from the user's notebook ([n] refers to these numbers):
${evidenceText}

RULES:
- Ground EVERY claim in the evidence above. Never invent facts, numbers or quotes.
- If the evidence lacks something, phrase around it honestly instead of guessing.
- Return STRICT JSON only — no markdown fences, no commentary.`;
}

// ---------------- evidence gathering ----------------

export async function gatherEvidence(opts: {
  notebookId: string;
  userId: string;
  sourceIds: string[];
  topic?: string;
}): Promise<{ chunks: RetrievedChunk[]; citations: Citation[]; evidenceText: string }> {
  const topic = opts.topic?.trim() || undefined;
  let chunks: RetrievedChunk[] = [];

  if (topic) {
    chunks = await retrieveChunks({
      notebookId: opts.notebookId,
      userId: opts.userId,
      sourceIds: opts.sourceIds?.length ? opts.sourceIds : null,
      query: topic,
      k: 10,
      maxPerSource: 3,
    });
  } else {
    // no topic: sample up to 3 chunks per source (first / middle / last)
    const sources = await db.notebookSource.findMany({
      where: {
        notebookId: opts.notebookId,
        userId: opts.userId,
        status: "ready",
        selected: true,
        ...(opts.sourceIds?.length ? { id: { in: opts.sourceIds } } : {}),
      },
      select: { id: true, title: true, kind: true },
      orderBy: { createdAt: "asc" },
      take: 8,
    });
    for (const s of sources) {
      const rows = await db.sourceChunk.findMany({
        where: { sourceId: s.id },
        orderBy: { idx: "asc" },
        select: { id: true, sourceId: true, page: true, heading: true, startSec: true, endSec: true, text: true },
        take: 400,
      });
      if (!rows.length) continue;
      const picks = rows.length <= 3 ? rows : [rows[0], rows[Math.floor((rows.length - 1) / 2)], rows[rows.length - 1]];
      for (const r of picks) {
        chunks.push({
          id: r.id,
          sourceId: s.id,
          sourceTitle: s.title,
          kind: s.kind,
          page: r.page,
          heading: r.heading,
          startSec: r.startSec,
          endSec: r.endSec,
          text: r.text,
          chunkId: r.id,
          score: 0,
        });
      }
    }
  }

  if (!chunks.length) throw new Error(NO_SOURCES);

  // keep only chunks whose evidence blocks fit the 12k-char prompt budget
  const blocks = buildEvidenceBlocks(chunks).blocks;
  const kept: RetrievedChunk[] = [];
  let used = 0;
  for (let i = 0; i < chunks.length; i++) {
    const b = blocks[i] ?? "";
    if (used + b.length > 12000 && kept.length >= 4) break;
    kept.push(chunks[i]);
    used += b.length;
  }
  const evidenceText = buildEvidenceBlocks(kept).blocks.join("\n\n").slice(0, 12000);
  const citations = chunksToCitations(kept);
  return { chunks: kept, citations, evidenceText };
}

// ---------------- audio overview script ----------------

const AUDIO_FORMATS: Record<string, { min: number; max: number; desc: string }> = {
  deepdive: { min: 12, max: 16, desc: "a deep-dive discussion that explores the material thoroughly, section by section" },
  brief: { min: 6, max: 8, desc: "a quick brief — the essentials and key takeaways only" },
  critique: { min: 8, max: 12, desc: "a friendly critique — strengths, weaknesses, gaps and what to double-check in the notes" },
  debate: { min: 10, max: 14, desc: "a lively debate where the hosts argue different interpretations, then reconcile" },
};

export async function generateAudioScript(opts: {
  format: string;
  topic?: string;
  audience?: string;
  goals?: string;
  lang: string;
  evidenceText: string;
  citations: Citation[];
}): Promise<{ title: string; turns: { host: "A" | "B"; text: string }[] }> {
  const f = AUDIO_FORMATS[opts.format] ? opts.format : "deepdive";
  const spec = AUDIO_FORMATS[f];
  const sys = `${evidenceHeader(opts.evidenceText, opts.lang)}

TASK: Write a two-host conversational study-podcast script (${f} format: ${spec.desc}).
${opts.topic ? `Focus topic: ${opts.topic}.` : "Cover the material broadly, following its structure."}
${opts.audience ? `Audience: ${opts.audience}.` : ""}
${opts.goals ? `Listener goals: ${opts.goals}.` : ""}

SCRIPT RULES:
- ${spec.min}-${spec.max} turns, strictly alternating hosts, host A speaks first.
- Host A is a calm, clear guide; host B is a curious, energetic co-host who asks the questions the listener would ask.
- Each turn is 120-480 characters of natural spoken sentences — contractions, reactions, short questions ("Right?", "Wait, really?").
- Ground EVERY claim in the evidence and occasionally refer to it aloud ("as your notes say…", "the notes mention…").
- Plain spoken text only: NO markdown, NO stage directions, NO speaker labels inside "text", NO lists.
- Finish with a 1-2 turn wrap-up of the key takeaways.

Return STRICT JSON only:
{"title":"<short catchy episode title in ${opts.lang}, max 80 chars>","turns":[{"host":"A","text":"..."},{"host":"B","text":"..."}]}`;
  const raw = await chatLLM(sys, "Write the podcast script now.");
  const parsed = parseJsonSafe<{ title?: string; turns?: { host?: string; text?: string }[] }>(raw, {});
  let turns: { host: "A" | "B"; text: string }[] = (Array.isArray(parsed.turns) ? parsed.turns : [])
    .map((t) => ({ host: t?.host === "B" ? ("B" as const) : ("A" as const), text: str(t?.text, 600) }))
    .filter((t) => t.text.length >= 30)
    .slice(0, spec.max);
  if (turns.length < 4) throw new Error(UNUSABLE);
  // enforce alternating hosts (A opens)
  turns = turns.map((t, i) => ({ host: i % 2 === 0 ? ("A" as const) : ("B" as const), text: t.text }));
  // total length budget: trim from the end but keep ≥4 turns
  while (turns.reduce((a, t) => a + t.text.length, 0) > 12000 && turns.length > 4) turns.pop();
  return { title: str(parsed.title, 80, "Audio overview"), turns };
}

// ---------------- video storyboard ----------------

export async function generateStoryboard(opts: {
  topic?: string;
  audience?: string;
  lang: string;
  evidenceText: string;
  citations: Citation[];
  sceneCount: number;
}): Promise<{ title: string; scenes: { heading: string; bullets: string[]; narration: string; quote?: string | null }[] }> {
  const sceneCount = Math.min(Math.max(Math.round(opts.sceneCount) || 5, 3), 8);
  const sys = `${evidenceHeader(opts.evidenceText, opts.lang)}

TASK: Storyboard a narrated video overview with exactly ${sceneCount} scenes.
${opts.topic ? `Focus topic: ${opts.topic}.` : "Cover the material broadly."}
${opts.audience ? `Audience: ${opts.audience}.` : ""}

SCENE RULES:
- "heading": scene title, max 60 chars, in ${opts.lang}.
- "bullets": 3-5 bullets shown on screen, each max 90 chars, crisp study points.
- "narration": 200-600 characters of what the narrator reads aloud — plain TTS-friendly sentences in ${opts.lang} (no markdown, no abbreviations read oddly, spell out symbols). It must expand the bullets using the evidence.
- "quote": OPTIONAL short exact quotation from the evidence for this scene, or null.
- Total narration across all scenes must stay under 3600 characters.

Return STRICT JSON only:
{"title":"<video title in ${opts.lang}, max 80 chars>","scenes":[{"heading":"...","bullets":["...","...","..."],"narration":"...","quote":"... or null"}]}`;
  const raw = await chatLLM(sys, "Write the storyboard now.");
  const parsed = parseJsonSafe<{ title?: string; scenes?: { heading?: string; bullets?: string[]; narration?: string; quote?: string | null }[] }>(raw, {});
  let scenes = (Array.isArray(parsed.scenes) ? parsed.scenes : [])
    .map((s) => ({
      heading: str(s?.heading, 60, "Scene"),
      bullets: (Array.isArray(s?.bullets) ? s?.bullets : []).map((b) => str(b, 110)).filter(Boolean).slice(0, 5),
      narration: str(s?.narration, 800),
      quote: s?.quote && typeof s.quote === "string" ? str(s.quote, 240) : null,
    }))
    .filter((s) => s.narration.length >= 80 && s.bullets.length >= 2)
    .slice(0, sceneCount);
  if (scenes.length < 3) throw new Error(UNUSABLE);
  // narration budget: drop trailing scenes (keep ≥3)
  const totalNarr = () => scenes.reduce((a, s) => a + s.narration.length, 0);
  while (totalNarr() > 3600 && scenes.length > 3) scenes.pop();
  return { title: str(parsed.title, 80, "Video overview"), scenes };
}

// ---------------- mind map ----------------

export async function generateMindMap(opts: {
  topic?: string;
  lang: string;
  evidenceText: string;
  citations: Citation[];
}): Promise<MindMapContent> {
  const topic = opts.topic?.trim() || "";
  const sys = `${evidenceHeader(opts.evidenceText, opts.lang)}

TASK: Design a study mind map of the material.
${topic ? `Central topic: ${topic}.` : "Use the material's overall subject as the central topic."}

MIND MAP RULES:
- Root node (the topic) with 3-5 main branches; each branch has 2-4 child nodes.
- Node labels: max 40 characters, keyword-style (no full sentences).
- "explanation": one short sentence (max 120 chars) per node — a memory hook or definition. Optional but encouraged.
- "citationIndex": the 1-based evidence number that clearly supports the node — ONLY where the evidence clearly supports it, otherwise omit.
- Do NOT include an "id" — ids are assigned automatically.

Return STRICT JSON only:
{"topic":"<topic in ${opts.lang}, max 60 chars>","root":{"label":"...","children":[{"label":"...","explanation":"...","citationIndex":1,"children":[{"label":"...","explanation":"..."}]}]}}`;
  const raw = await chatLLM(sys, "Design the mind map now.");
  const parsed = parseJsonSafe<{ topic?: string; root?: { label?: string; children?: unknown[] } }>(raw, {});
  const validIdx = (n: unknown): number | undefined => (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= opts.citations.length ? n : undefined);

  let idc = 0;
  const convert = (raw2: unknown, depth: number): MindMapNode | null => {
    if (!raw2 || typeof raw2 !== "object" || idc > 60) return null;
    const r = raw2 as { label?: unknown; explanation?: unknown; citationIndex?: unknown; children?: unknown };
    const label = str(r.label, 48);
    if (!label) return null;
    idc++;
    const node: MindMapNode = { id: `n${idc - 1}`, label };
    const expl = str(r.explanation, 200);
    if (expl) node.explanation = expl;
    const ci = validIdx(r.citationIndex);
    if (ci) node.citationIndex = ci;
    if (depth < 2 && Array.isArray(r.children)) {
      const kids = r.children.map((c) => convert(c, depth + 1)).filter((x): x is MindMapNode => !!x).slice(0, 5);
      if (kids.length) node.children = kids;
    }
    return node;
  };
  const root = convert(parsed.root, 0);
  if (!root || !root.children?.length) throw new Error(UNUSABLE);
  root.id = "n0";
  return { topic: str(parsed.topic, 60, topic || root.label), root, citations: opts.citations };
}

// ---------------- report ----------------

const REPORT_SHAPE: Record<string, string> = {
  "study-guide": "A structured study guide: brief overview, then ## sections per key concept, a '## Key terms' definition list, and '## Review questions' with 4-6 questions.",
  briefing: "An executive briefing: '## Bottom line' first (3-4 sentences), then '## Background', '## Key points' (bullets), '## Implications'.",
  summary: "A clean summary: '## Overview' (1 paragraph), '## Key takeaways' (5-7 bullets), '## Worth remembering' (short).",
  faq: "An FAQ: 6-10 '## <question>?' headings, each followed by a 2-5 sentence answer.",
  glossary: "A glossary: '## <Term>' headings, each with a clear definition (1-2 sentences) plus one line 'Why it matters: …'. Cover 8-14 terms.",
  "essay-questions": "Essay practice: 5-7 '## Question N: <question>' sections, each with '**What to cover:**' followed by a 3-5 point answer outline.",
  "critical-analysis": "A critical analysis: '## Central claim', '## Strengths of the material', '## Weaknesses & gaps', '## Assumptions', '## Verdict'.",
  "blog-post": "An engaging blog post: '# <catchy title>', hook intro, 3-4 '##' sections, '## Conclusion' with a takeaway.",
  "revision-sheet": "An ultra-compact revision sheet: grouped '##' sections of short bullet lists — facts, formulas, dates, definitions. No long paragraphs.",
  custom: "Follow the user's custom instructions for structure, keeping it a well-organized study document.",
};

export async function generateReport(opts: {
  type: string;
  customInstructions?: string;
  lang: string;
  evidenceText: string;
  citations: Citation[];
}): Promise<ReportContent> {
  const type = (REPORT_TYPES as readonly string[]).includes(opts.type) ? (opts.type as ReportTypeLocal) : "study-guide";
  const custom =
    type === "custom" && opts.customInstructions?.trim()
      ? `\nCUSTOM INSTRUCTIONS from the user (highest priority): ${opts.customInstructions.trim().slice(0, 500)}`
      : "";
  const sys = `${evidenceHeader(opts.evidenceText, opts.lang)}

TASK: Write a ${type.replace("-", " ")} in Markdown based on the evidence.${custom}
STRUCTURE: ${REPORT_SHAPE[type]}

REPORT RULES:
- Use Markdown with ## section headings (a # title only if the format calls for one).
- Include a '## Key takeaways' section with 3-6 bullets (unless the format clearly replaces it).
- Cite inline with [n] markers referencing the evidence numbers wherever a claim needs support.
- Max 2000 words. Write in ${opts.lang}.
- Escape the markdown correctly inside the JSON string (\\n for newlines).

Return STRICT JSON only: {"markdown":"<the full markdown report>"}`;
  const raw = await chatLLM(sys, "Write the report now.");
  const parsed = parseJsonSafe<{ markdown?: string }>(raw, {});
  const markdown = str(parsed.markdown, 20000);
  if (markdown.length < 200) throw new Error(UNUSABLE);
  const citations = extractCitations(markdown, opts.citations);
  return { type, markdown, citations };
}

// ---------------- quiz ----------------

export type QuizArtifactQuestion = {
  type: "mcq" | "truefalse" | "short";
  question: string;
  options: string[];
  correctIndex: number | null;
  answerText: string | null;
  explanation: string;
  keywords?: string[];
  evidenceIndex?: number;
};

export async function generateQuizArtifact(opts: {
  topic?: string;
  subject?: string;
  difficulty: string;
  count: number;
  lang: string;
  evidenceText: string;
  citations: Citation[];
}): Promise<{ title: string; questions: QuizArtifactQuestion[] }> {
  const count = Math.min(Math.max(Math.round(opts.count) || 5, 3), 12);
  const difficulty = ["easy", "medium", "hard"].includes(opts.difficulty) ? opts.difficulty : "medium";
  const sys = `${evidenceHeader(opts.evidenceText, opts.lang)}

TASK: Create a practice quiz with exactly ${count} questions based on the evidence.
${opts.topic ? `Topic focus: ${opts.topic}.` : ""}${opts.subject ? ` Subject: ${opts.subject}.` : ""} Difficulty: ${difficulty}.

QUIZ RULES:
- Mix: mostly mcq (exactly 4 options), 1-2 truefalse, and 1 short-answer question (only if count >= 5).
- "explanation" (in ${opts.lang}): why the correct answer is correct AND for mcq why the tempting wrong answers are wrong.
- "evidenceIndex": the 1-based evidence number the question comes from (required on every question).
- Short questions: "answerText" = model answer (max 30 words), "keywords" = 2-5 keywords needed for grading (in ${opts.lang}).
- No trick questions without a basis in the evidence.

Return STRICT JSON only:
{"title":"<quiz title in ${opts.lang}, max 80 chars>","questions":[{"type":"mcq","question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"...","evidenceIndex":1},{"type":"truefalse","question":"...","options":["True","False"],"correctIndex":1,"explanation":"...","evidenceIndex":2},{"type":"short","question":"...","options":[],"correctIndex":null,"answerText":"...","keywords":["k1","k2"],"explanation":"...","evidenceIndex":3}]}`;
  const raw = await chatLLM(sys, "Create the quiz now.");
  const parsed = parseJsonSafe<{ title?: string; questions?: Record<string, unknown>[] }>(raw, {});
  const questions: QuizArtifactQuestion[] = [];
  for (const q of Array.isArray(parsed.questions) ? parsed.questions : []) {
    const type = q?.type === "truefalse" ? "truefalse" : q?.type === "short" ? "short" : "mcq";
    const question = str(q?.question, 400);
    if (!question) continue;
    const explanation = str(q?.explanation, 900);
    const evidenceIndex = typeof q?.evidenceIndex === "number" && Number.isInteger(q.evidenceIndex) && q.evidenceIndex >= 1 && q.evidenceIndex <= opts.citations.length ? q.evidenceIndex : undefined;
    if (type === "mcq") {
      const options = (Array.isArray(q?.options) ? q.options : []).map((o) => str(o, 200)).filter(Boolean).slice(0, 4);
      const ci = typeof q?.correctIndex === "number" ? q.correctIndex : -1;
      if (options.length < 3 || ci < 0 || ci >= options.length) continue;
      questions.push({ type, question, options, correctIndex: ci, answerText: null, explanation: explanation || "Based on the notebook sources.", evidenceIndex });
    } else if (type === "truefalse") {
      const ci = q?.correctIndex === 1 || q?.correctIndex === "1" ? 1 : 0;
      questions.push({ type, question, options: ["True", "False"], correctIndex: ci, answerText: null, explanation: explanation || "Based on the notebook sources.", evidenceIndex });
    } else {
      const answerText = str(q?.answerText, 400);
      if (!answerText) continue;
      const keywords = (Array.isArray(q?.keywords) ? q.keywords : []).map((k) => str(k, 40)).filter(Boolean).slice(0, 6);
      if (!keywords.length) continue;
      questions.push({ type, question, options: [], correctIndex: null, answerText, explanation: explanation || answerText, keywords, evidenceIndex });
    }
    if (questions.length >= count) break;
  }
  if (questions.length < 3) throw new Error(UNUSABLE);
  return { title: str(parsed.title, 80, "Notebook quiz"), questions };
}

// ---------------- flashcards ----------------

export async function generateFlashcardCards(opts: {
  topic?: string;
  count: number;
  lang: string;
  evidenceText: string;
  citations: Citation[];
}): Promise<{ cards: { front: string; back: string; evidenceIndex?: number }[] }> {
  const count = Math.min(Math.max(Math.round(opts.count) || 10, 4), 20);
  const sys = `${evidenceHeader(opts.evidenceText, opts.lang)}

TASK: Create ${count} spaced-repetition flashcards from the evidence.
${opts.topic ? `Topic focus: ${opts.topic}.` : "Spread cards across the whole material."}

CARD RULES:
- "front": one crisp question or term — max 12 words, plain text.
- "back": one clear answer — max 40 words, plain text.
- No two cards may duplicate each other. Cover the most exam-relevant facts, definitions and relationships.
- "evidenceIndex": the 1-based evidence number the card comes from (include when clear).

Return STRICT JSON only: {"cards":[{"front":"...","back":"...","evidenceIndex":1}]}`;
  const raw = await chatLLM(sys, "Create the flashcards now.");
  const parsed = parseJsonSafe<{ cards?: { front?: string; back?: string; evidenceIndex?: number }[] }>(raw, {});
  const seen = new Set<string>();
  const cards = (Array.isArray(parsed.cards) ? parsed.cards : [])
    .map((c) => ({
      front: str(c?.front, 160),
      back: str(c?.back, 360),
      evidenceIndex:
        typeof c?.evidenceIndex === "number" && Number.isInteger(c.evidenceIndex) && c.evidenceIndex >= 1 && c.evidenceIndex <= opts.citations.length ? c.evidenceIndex : undefined,
    }))
    .filter((c) => {
      if (!c.front || !c.back) return false;
      const k = c.front.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, count);
  if (cards.length < 3) throw new Error(UNUSABLE);
  return { cards };
}

// ---------------- infographic ----------------

const IG_ASPECTS: InfographicAspect[] = ["4:5", "1:1", "16:9"];

export async function generateInfographic(opts: {
  topic?: string;
  lang: string;
  aspect: string;
  evidenceText: string;
  citations: Citation[];
}): Promise<InfographicContent> {
  const aspect = (IG_ASPECTS as string[]).includes(opts.aspect) ? (opts.aspect as InfographicAspect) : "4:5";
  const sys = `${evidenceHeader(opts.evidenceText, opts.lang)}

TASK: Design a vertical study infographic poster from the evidence.
${opts.topic ? `Topic: ${opts.topic}.` : "Summarize the material visually."}

BLOCK TYPES (use a healthy mix — do NOT repeat the same type more than twice):
- {"type":"stat","label":"...","value":"≤12 chars (number/short)","sub":"optional context","citationIndex":1} — a big-number highlight.
- {"type":"timeline","title":"...","steps":[{"label":"...","text":"one short sentence"}]} — 3-6 ordered steps.
- {"type":"compare","title":"...","columns":["A","B"],"rows":[{"label":"...","cells":["...","..."]}]} — mini comparison table, 2-3 columns × 2-4 rows.
- {"type":"facts","title":"...","items":["...","..."],"citationIndexes":[1,2]} — 3-6 punchy facts, each ≤100 chars.
- {"type":"quote","text":"exact quotation from the evidence","attribution":"source title","citationIndex":1}.
- {"type":"flow","title":"...","steps":["Step 1","Step 2","Step 3"]} — 3-6 step process chain.

POSTER RULES:
- 4-6 blocks total. Title (max 60 chars) + optional subtitle (max 100 chars), both in ${opts.lang}.
- All content in ${opts.lang}. Keep every text short and poster-worthy.

Return STRICT JSON only:
{"title":"...","subtitle":"...","blocks":[{"type":"stat",...},{"type":"timeline",...},{"type":"facts",...}]}`;
  const raw = await chatLLM(sys, "Design the infographic now.");
  const parsed = parseJsonSafe<{ title?: string; subtitle?: string; blocks?: Record<string, unknown>[] }>(raw, {});
  const validIdx = (n: unknown): number | undefined => (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= opts.citations.length ? n : undefined);
  const blocks: InfographicBlock[] = [];
  for (const b of Array.isArray(parsed.blocks) ? parsed.blocks : []) {
    const type = b?.type;
    if (type === "stat") {
      const label = str(b.label, 60);
      const value = str(b.value, 14);
      if (!label || !value) continue;
      const block: InfographicBlock = { type: "stat", label, value };
      const sub = str(b.sub, 80);
      if (sub) block.sub = sub;
      const ci = validIdx(b.citationIndex);
      if (ci) block.citationIndex = ci;
      blocks.push(block);
    } else if (type === "timeline") {
      const title = str(b.title, 60);
      const steps = (Array.isArray(b.steps) ? b.steps : [])
        .map((s) => ({ label: str((s as { label?: string })?.label, 60), text: str((s as { text?: string })?.text, 220) }))
        .filter((s) => s.label)
        .slice(0, 6);
      if (!title || steps.length < 2) continue;
      blocks.push({ type: "timeline", title, steps });
    } else if (type === "compare") {
      const title = str(b.title, 60);
      const columns = (Array.isArray(b.columns) ? b.columns : []).map((c) => str(c, 24)).filter(Boolean).slice(0, 3);
      if (!title || columns.length < 2) continue;
      const rows = (Array.isArray(b.rows) ? b.rows : [])
        .slice(0, 4)
        .map((r) => {
          const rawCells = Array.isArray((r as { cells?: unknown })?.cells) ? ((r as { cells?: unknown[] }).cells ?? []) : [];
          const cells = rawCells.map((c) => str(c, 60));
          while (cells.length < columns.length) cells.push("");
          return { label: str((r as { label?: string })?.label, 40), cells: cells.slice(0, columns.length) };
        })
        .filter((r) => r.label || r.cells.some((c) => c));
      if (!rows.length) continue;
      blocks.push({ type: "compare", title, columns, rows });
    } else if (type === "facts") {
      const title = str(b.title, 60);
      const items = (Array.isArray(b.items) ? b.items : []).map((i) => str(i, 110)).filter(Boolean).slice(0, 6);
      if (!title || items.length < 2) continue;
      const block: InfographicBlock = { type: "facts", title, items };
      const cis = (Array.isArray(b.citationIndexes) ? b.citationIndexes : []).map(validIdx).filter((x): x is number => !!x).slice(0, 6);
      if (cis.length) block.citationIndexes = cis;
      blocks.push(block);
    } else if (type === "quote") {
      const text = str(b.text, 320);
      if (!text) continue;
      const block: InfographicBlock = { type: "quote", text };
      const attribution = str(b.attribution, 80);
      if (attribution) block.attribution = attribution;
      const ci = validIdx(b.citationIndex);
      if (ci) block.citationIndex = ci;
      blocks.push(block);
    } else if (type === "flow") {
      const title = str(b.title, 60);
      const steps = (Array.isArray(b.steps) ? b.steps : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 6);
      if (!title || steps.length < 2) continue;
      blocks.push({ type: "flow", title, steps });
    }
    if (blocks.length >= 6) break;
  }
  if (blocks.length < 2) throw new Error(UNUSABLE);
  const content: InfographicContent = {
    title: str(parsed.title, 60, opts.topic || "Infographic"),
    aspect,
    blocks,
    citations: opts.citations,
  };
  const subtitle = str(parsed.subtitle, 100);
  if (subtitle) content.subtitle = subtitle;
  return content;
}

// ---------------- slides ----------------

export type RegenerateSlideOpts = {
  existingSlides: { title: string; bullets: string[]; notes: string; quote?: string | null }[];
  slideIndex: number;
  instruction?: string;
};

export async function generateSlides(opts: {
  topic?: string;
  audience?: string;
  lang: string;
  slideCount: number;
  evidenceText: string;
  citations: Citation[];
  regenerate?: RegenerateSlideOpts;
}): Promise<SlidesContent> {
  const lang = opts.lang;
  if (opts.regenerate) {
    const { existingSlides, slideIndex, instruction } = opts.regenerate;
    const outline = existingSlides.map((s, i) => `Slide ${i + 1}: ${s.title} (${s.bullets.slice(0, 3).join("; ")})`).join("\n");
    const cur = existingSlides[slideIndex];
    const sys = `${evidenceHeader(opts.evidenceText, lang)}

TASK: Rewrite ONE slide of an existing deck. The deck outline is:
${outline}

The slide to replace is slide ${slideIndex + 1}:
Title: ${cur?.title ?? ""}
Bullets: ${(cur?.bullets ?? []).join(" | ")}
${cur?.quote ? `Quote: ${cur.quote}` : ""}

${instruction ? `USER INSTRUCTION for the rewrite (highest priority): ${instruction.slice(0, 400)}` : "Improve clarity and grounding in the evidence while keeping the slide's role in the deck."}

Keep it consistent with the surrounding deck (no duplicated content with other slides). Same JSON shape as the other generators:
{"slides":[{"title":"max 60 chars","bullets":["3-5 bullets, max 90 chars each"],"notes":"1-2 sentence speaker notes","quote":"optional exact quote or null","citationIndexes":[1]}]}
Return STRICT JSON only with EXACTLY ONE slide.`;
    const raw = await chatLLM(sys, "Rewrite the slide now.");
    const parsed = parseJsonSafe<{ slides?: Record<string, unknown>[] }>(raw, {});
    const slides = validateSlides(parsed.slides, opts.citations, 1);
    if (!slides.length) throw new Error(UNUSABLE);
    return { title: "", lang, slides, citations: opts.citations };
  }

  const slideCount = Math.min(Math.max(Math.round(opts.slideCount) || 6, 4), 12);
  const sys = `${evidenceHeader(opts.evidenceText, lang)}

TASK: Create a ${slideCount}-slide study deck from the evidence.
${opts.topic ? `Deck topic: ${opts.topic}.` : "Cover the material broadly."}
${opts.audience ? `Audience: ${opts.audience}.` : ""}

SLIDE RULES:
- Slide 1 is the opener (title + what's ahead); the last slide is a takeaways slide; the rest each cover one concept.
- "title": max 60 chars. "bullets": 3-5 per slide, max 90 chars each — crisp study points, not paragraphs.
- "notes": 1-2 sentence speaker notes in ${lang}.
- "quote": optional exact quotation from the evidence, or null.
- "citationIndexes": 1-based evidence numbers used by this slide (optional).

Return STRICT JSON only:
{"title":"<deck title in ${lang}, max 80 chars>","subtitle":"optional subtitle","slides":[{"title":"...","bullets":["...","...","..."],"notes":"...","quote":null,"citationIndexes":[1]}]}`;
  const raw = await chatLLM(sys, "Create the slide deck now.");
  const parsed = parseJsonSafe<{ title?: string; subtitle?: string; slides?: Record<string, unknown>[] }>(raw, {});
  const slides = validateSlides(parsed.slides, opts.citations, 12);
  if (slides.length < 3) throw new Error(UNUSABLE);
  const content: SlidesContent = {
    title: str(parsed.title, 80, opts.topic || "Slides"),
    lang,
    slides,
    citations: opts.citations,
  };
  const subtitle = str(parsed.subtitle, 100);
  if (subtitle) content.subtitle = subtitle;
  return content;
}

function validateSlides(raw: unknown, citations: Citation[], max: number): SlidesContent["slides"] {
  const valid = (arr: unknown) =>
    (Array.isArray(arr) ? arr : []).map((x) => x).filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= citations.length).slice(0, 5);
  return (Array.isArray(raw) ? raw : [])
    .map((s) => {
      const r = s as Record<string, unknown>;
      const title = str(r.title, 70);
      const bullets = (Array.isArray(r.bullets) ? r.bullets : []).map((b) => str(b, 100)).filter(Boolean).slice(0, 5);
      return {
        title,
        bullets,
        notes: str(r.notes, 400),
        quote: typeof r.quote === "string" && r.quote.trim() ? str(r.quote, 240) : null,
        citationIndexes: valid(r.citationIndexes),
      };
    })
    .filter((s) => s.title && s.bullets.length >= 2)
    .slice(0, max);
}

// ---------------- table ----------------

export async function generateTable(opts: {
  topic?: string;
  lang: string;
  evidenceText: string;
  citations: Citation[];
}): Promise<TableContent> {
  const sys = `${evidenceHeader(opts.evidenceText, opts.lang)}

TASK: Build a study comparison table from the evidence.
${opts.topic ? `Table topic: ${opts.topic}.` : "Choose the most useful comparison in the material."}

TABLE RULES:
- 3-6 columns (first column = row label), max 15 rows.
- Cells: max 60 characters, concise facts only.
- "citationIndex" per row: the 1-based evidence number supporting that row.
- "flag": "conflict" when the evidence disagrees for that row, "missing" when the evidence lacks the data, null otherwise. Use flags honestly — do not invent data to fill gaps.
- "notes": short explanations for every flagged row (why the conflict / what's missing).

Return STRICT JSON only:
{"title":"<table title in ${opts.lang}, max 80 chars>","columns":["...","...","..."],"rows":[{"cells":["...","...","..."],"citationIndex":1,"flag":null}],"notes":["..."]}`;
  const raw = await chatLLM(sys, "Build the table now.");
  const parsed = parseJsonSafe<{ title?: string; columns?: string[]; rows?: { cells?: string[]; citationIndex?: number; flag?: string }[]; notes?: string[] }>(raw, {});
  const columns = (Array.isArray(parsed.columns) ? parsed.columns : []).map((c) => str(c, 60)).filter(Boolean).slice(0, 6);
  if (columns.length < 2) throw new Error(UNUSABLE);
  const rows = (Array.isArray(parsed.rows) ? parsed.rows : [])
    .slice(0, 15)
    .map((r) => {
      const cells = (Array.isArray(r.cells) ? r.cells : []).map((c) => str(c, 60));
      while (cells.length < columns.length) cells.push("");
      return {
        cells: cells.slice(0, columns.length),
        citationIndex:
          typeof r.citationIndex === "number" && Number.isInteger(r.citationIndex) && r.citationIndex >= 1 && r.citationIndex <= opts.citations.length ? r.citationIndex : undefined,
        flag: r.flag === "conflict" ? ("conflict" as const) : r.flag === "missing" ? ("missing" as const) : null,
      };
    })
    .filter((r) => r.cells.some((c) => c));
  if (rows.length < 2) throw new Error(UNUSABLE);
  const notes = (Array.isArray(parsed.notes) ? parsed.notes : []).map((n) => str(n, 240)).filter(Boolean).slice(0, 10);
  return { title: str(parsed.title, 80, opts.topic || "Comparison table"), columns, rows, notes, citations: opts.citations };
}

// ---------------- title helper ----------------

const KIND_LABELS: Record<string, string> = {
  "audio-overview": "Audio overview",
  "video-overview": "Video overview",
  mindmap: "Mind map",
  report: "Report",
  flashcards: "Flashcards",
  quiz: "Quiz",
  infographic: "Infographic",
  slides: "Slides",
  table: "Table",
};

export function suggestTitle(kind: string, topic?: string): string {
  const label = KIND_LABELS[kind] || "Artifact";
  return `${label} — ${(topic || "").trim() || "notebook"}`.slice(0, 90);
}
