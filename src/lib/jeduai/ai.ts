// JeduAI — server AI service (LLM via z-ai-web-dev-sdk).
// All AI features route through here so provider config stays in one place.
import "server-only";
import ZAI from "z-ai-web-dev-sdk";

async function zai() {
  return ZAI.create();
}

export function parseJsonSafe<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  let s = raw.trim();
  // strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = Math.min(...[s.indexOf("{"), s.indexOf("[")].filter((i) => i >= 0), Infinity as unknown as number) as number;
  if (Number.isFinite(start) && start > 0) s = s.slice(start);
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

async function chat(system: string, user: string, opts?: { history?: { role: "user" | "assistant"; content: string }[]; maxTokensHint?: "long" }) {
  const client = await zai();
  const messages: { role: "assistant" | "user"; content: string }[] = [{ role: "assistant", content: system }];
  for (const h of opts?.history || []) messages.push(h);
  messages.push({ role: "user", content: user });
  const completion = await client.chat.completions.create({
    messages,
    thinking: { type: "disabled" },
  });
  const out = completion.choices[0]?.message?.content;
  if (!out || !out.trim()) throw new Error("Empty response from AI");
  return out;
}

// ---------------- OCR (vision) ----------------

// Extract text from a page image using the vision model (scanned docs & photos).
// Returns plain text; empty string when nothing readable is found.
export async function ocrImage(opts: { base64: string; mime: string; page?: number; totalPages?: number | string }) {
  const client = await zai();
  const label =
    typeof opts.totalPages === "string"
      ? ` (page ${opts.page} of ${opts.totalPages})`
      : opts.totalPages && opts.totalPages > 1
        ? ` (page ${opts.page} of ${opts.totalPages})`
        : "";
  const completion = await client.chat.completions.createVision({
    model: "glm-4.6v",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This image is a scanned page${label} from a study document. Transcribe ALL readable text exactly as written, in the original language.
Rules:
- Preserve reading order, paragraph breaks and headings (headings on their own line).
- Plain text only — no markdown, no commentary, no page numbers you invent.
- For tables, transcribe row by row, cells separated by " | ".
- For formulas, write them in simple linear notation.
- If the image contains no readable text (blank page, drawing, photo), return exactly: [EMPTY]
Output ONLY the transcription.`,
          },
          { type: "image_url", image_url: { url: `data:${opts.mime};base64,${opts.base64}` } },
        ],
      },
    ],
    thinking: { type: "disabled" },
  });
  const out = (completion.choices[0]?.message?.content || "").trim();
  if (!out || out === "[EMPTY]") return "";
  // strip a potential markdown fence the model might add despite instructions
  return out.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
}

// ---------------- AI Tutor ----------------

const MODE_PROMPTS: Record<string, string> = {
  balanced: "You are JeduAI Tutor, a warm, encouraging tutor. Explain clearly with one simple example. Keep structure with short paragraphs or bullets.",
  beginner: "You are JeduAI Tutor in 'Explain Like I'm a Beginner' mode. Use only very simple words and short sentences. No jargon; if a technical term is needed, explain it in brackets. Use friendly analogies.",
  exam: "You are JeduAI Tutor in 'Exam Preparation' mode. Answer the way a top-scoring student would write in an exam: definition, key points, formula/diagram description, and a model answer. End with a 3-line 'Exam tips' box.",
  steps: "You are JeduAI Tutor in 'Step-by-Step Problem Solving' mode. Always break the solution into numbered steps. For each step state what we do, why we do it, and the result. End with the final answer highlighted.",
  revision: "You are JeduAI Tutor in 'Quick Revision' mode. Be crisp: bullet points, formulas, and mnemonics. Max ~120 words unless asked otherwise.",
  language: "You are JeduAI Tutor in 'Language Learning' mode. Help bilingual learners: answer in the student's requested language, add key vocabulary with meanings, and correct any language mistakes gently.",
};

export async function tutorReply(opts: {
  mode: string;
  subject: string;
  lang: string;
  level: string;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
}) {
  const sys = `${MODE_PROMPTS[opts.mode] || MODE_PROMPTS.balanced}
Subject focus: ${opts.subject}. Student level: ${opts.level}.
ALWAYS write your answer in ${opts.lang} (the student's preferred learning language), regardless of the language of the question.
Use Markdown. Use $...$ or $$...$$ for math when helpful. Encourage understanding; if the student asks for homework answers, guide them to the method.
If code is involved, use fenced code blocks.`;
  return chat(sys, opts.question, { history: opts.history.slice(-12) });
}

// ---------------- Translation ----------------

export async function translateText(opts: {
  text: string;
  from: string;
  to: string;
  mode: "direct" | "learning";
}) {
  if (opts.mode === "learning") {
    const sys = `You are a professional bilingual education translator translating from ${opts.from} to ${opts.to}.
Return STRICT JSON only: {"translated": "<faithful translation>", "explanation": "<in ${opts.to === "English" ? "simple English" : opts.to}>: 3-6 bullet notes explaining difficult words, idioms, and grammar in this passage for a student>", "vocabulary": [{"word":"<original word>","meaning":"<short meaning in ${opts.to}>"}]}.
Translation must preserve meaning, tone and technical terms (keep standard technical terms with a short gloss).`;
    const raw = await chat(sys, opts.text);
    const parsed = parseJsonSafe<{ translated?: string; explanation?: string; vocabulary?: { word: string; meaning: string }[] }>(raw, {});
    if (!parsed.translated) throw new Error("Translation provider returned an unusable response");
    return {
      translated: parsed.translated,
      explanation: parsed.explanation || "",
      vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary.slice(0, 8) : [],
    };
  }
  const sys = `You are a professional translator. Translate the user's text from ${opts.from} to ${opts.to}.
Rules: faithful meaning, natural phrasing, keep formatting/line breaks, keep standard technical terms (add a brief gloss in brackets only if the term has no common equivalent). Output ONLY the translation, nothing else.`;
  const out = await chat(sys, opts.text);
  return { translated: out.trim(), explanation: "", vocabulary: [] };
}

// Translate an array of strings; keeps index alignment. Batches to stay reliable.
export async function translateArray(items: string[], from: string, to: string): Promise<string[]> {
  const out: string[] = new Array(items.length).fill("");
  const BATCH = 6;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH).map((t, j) => ({ idx: i + j, text: t }));
    const sys = `You are a professional subtitle/segment translator from ${from} to ${to}.
Input: JSON array of {"idx":n,"text":"..."} objects.
Return STRICT JSON: {"items":[{"idx":n,"translated":"..."}]} covering EVERY input idx exactly once. Translation must be natural and concise (subtitle style). Never merge or drop items.`;
    try {
      const raw = await chat(sys, JSON.stringify(slice));
      const parsed = parseJsonSafe<{ items?: { idx: number; translated: string }[] }>(raw, {});
      for (const it of parsed.items || []) {
        if (typeof it.idx === "number" && it.idx >= 0 && it.idx < out.length && it.translated) out[it.idx] = String(it.translated).trim();
      }
    } catch {
      // fallback: one-by-one
      for (const s of slice) {
        try {
          const r = await translateText({ text: s.text, from, to, mode: "direct" });
          out[s.idx] = r.translated;
        } catch {}
      }
    }
  }
  return out;
}

// ---------------- Quizzes ----------------

export type GenQuestion = {
  type: "mcq" | "truefalse" | "short";
  question: string;
  options: string[];
  correctIndex: number | null;
  answerText: string | null;
  explanation: string;
  keywords?: string[];
};

export async function generateQuiz(opts: {
  topic: string;
  subject: string;
  difficulty: string;
  count: number;
  lang: string;
  sourceText?: string; // optional grounding (video transcript / doc excerpt)
}) {
  const grounding = opts.sourceText
    ? `\nBase the questions ONLY on this material:\n"""${opts.sourceText.slice(0, 6000)}"""\n`
    : "";
  const sys = `You are JeduAI's assessment generator. Create a practice quiz in ${opts.lang}.
Topic: ${opts.topic}. Subject: ${opts.subject}. Difficulty: ${opts.difficulty}. Questions: ${opts.count}.${grounding}
Mix types: mostly mcq (4 options), 1-2 truefalse, optionally 1 short.
Return STRICT JSON only:
{"title":"<short quiz title in ${opts.lang}>","questions":[{"type":"mcq","question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"why, in ${opts.lang}","keywords":[]},{"type":"truefalse","options":["True","False"],"correctIndex":0,...},{"type":"short","options":[],"correctIndex":null,"answerText":"model answer","keywords":["k1","k2"],...}]}
Every question needs a helpful explanation. For short questions give 2-5 keywords for grading.`;
  const raw = await chat(sys, `Generate the quiz now. Vary question angles; keep language at ${opts.difficulty} difficulty.`);
  const parsed = parseJsonSafe<{ title?: string; questions?: GenQuestion[] }>(raw, {});
  const questions = (parsed.questions || []).filter((q) => q && q.question);
  if (!questions.length) throw new Error("AI quiz generation returned no usable questions");
  return { title: parsed.title || `${opts.topic} — Practice Quiz`, questions };
}

// ---------------- Video helpers ----------------

export async function summarizeTranscript(text: string, lang: string) {
  const sys = `You are JeduAI's video summarizer. Summarize the lecture transcript in ${lang}. Structure: 2-3 sentence overview, then "Key takeaways" as 4-6 bullets, then "Worth remembering" line. Max ~180 words.`;
  return chat(sys, text.slice(0, 8000));
}

export async function makeChapters(segments: { start: number; text: string }[], lang: string) {
  const input = segments.map((s) => `${s.start.toFixed(1)}s ${s.text}`).join("\n");
  const sys = `You are JeduAI's chapter generator. Given timestamped transcript lines "<seconds>s <text>", group them into 4-8 chapters.
Return STRICT JSON: {"chapters":[{"title":"<chapter title in ${lang}>","start":<seconds number>}]} sorted by start.`;
  const raw = await chat(sys, input.slice(0, 9000));
  const parsed = parseJsonSafe<{ chapters?: { title: string; start: number }[] }>(raw, {});
  const chapters = (parsed.chapters || []).filter((c) => typeof c.start === "number").sort((a, b) => a.start - b.start);
  if (!chapters.length) throw new Error("Could not generate chapters");
  return chapters;
}

export async function answerAboutTranscript(question: string, transcript: string, lang: string) {
  const sys = `You are JeduAI's video Q&A tutor. Answer the student's question using ONLY the provided transcript. Write in ${lang}. If the transcript does not contain the answer, say so honestly and suggest what part of the video might help. Quote the approximate timestamp when the topic appears, if identifiable.`;
  return chat(sys, `Transcript:\n${transcript.slice(0, 8000)}\n\nQuestion: ${question}`);
}

export async function answerAboutDocument(
  question: string,
  sections: { idx: number; heading: string | null; text: string }[],
  lang: string
) {
  const context = sections
    .map((s) => `[Section ${s.idx + 1}${s.heading ? ` — ${s.heading}` : ""}]\n${s.text}`)
    .join("\n\n");
  const sys = `You are JeduAI's document Q&A tutor. Answer the student's question using ONLY the provided document sections (already translated). Write in ${lang}. Cite the section number(s) you used, like "(Section 3)". If the document does not contain the answer, say so honestly and suggest which section to re-read. Keep answers under 180 words unless more detail is genuinely needed.`;
  return chat(sys, `Document sections:\n${context.slice(0, 9000)}\n\nQuestion: ${question}`);
}

// ---------------- Planner ----------------

export async function plannerRecommendations(stats: {
  subjects: string[];
  weak: string[];
  pendingTasks: number;
  goalMin: number;
  lang: string;
}) {
  const sys = `You are JeduAI's study coach. Given a student's profile, output 4 practical study recommendations for the coming week in ${stats.lang}.
Return STRICT JSON: {"tips":["<tip 1>","<tip 2>","<tip 3>","<tip 4>"]} — each under 20 words, actionable, encouraging.`;
  const raw = await chat(sys, JSON.stringify(stats));
  const parsed = parseJsonSafe<{ tips?: string[] }>(raw, {});
  return (parsed.tips || []).slice(0, 5);
}

// ---------------- Simple-language explain ----------------

export async function explainSimply(text: string, lang: string) {
  const sys = `You are JeduAI's plain-language explainer. Rewrite the passage in ${lang} using very simple sentences a 12-year-old understands. Keep all facts. Max 150 words.`;
  return chat(sys, text.slice(0, 4000));
}

export async function detectLanguage(text: string) {
  const sys = `You are a language detector. Reply with ONLY the language name in English from this list: English, Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu, Odia, Assamese, Spanish, French, German, Chinese, Japanese, Korean, Arabic, Portuguese, Russian, Italian. One word only.`;
  const out = await chat(sys, text.slice(0, 500));
  return out.trim().split("\n")[0].replace(/[^A-Za-z ]/g, "").trim() || "English";
}

// ---------------- Vocabulary ----------------

// Extract key vocabulary from a tutor explanation (for the Vocabulary Builder)
export async function extractVocabulary(opts: { text: string; lang: string; meaningLang: string }) {
  const sys = `You are JeduAI's vocabulary curator. From the study explanation below, pick the 3-8 most useful terms, words or phrases worth memorizing.
Rules:
- "term" must appear in (or be directly taken from) the explanation, written in its original language (${opts.lang}).
- "meaning" is a short, clear definition of the term in ${opts.meaningLang} (max ~10 words).
- "example": one short natural sentence using the term, in the term's language. Max ~15 words.
Return STRICT JSON only: {"words":[{"term":"...","meaning":"...","example":"..."}]}`;
  const raw = await chat(sys, `Explanation:\n"""${opts.text.slice(0, 6000)}"""\n\nPick the vocabulary now.`);
  const parsed = parseJsonSafe<{ words?: { term?: string; meaning?: string; example?: string }[] }>(raw, {});
  const words = (parsed.words || [])
    .filter((w) => typeof w.term === "string" && typeof w.meaning === "string" && w.term!.trim() && w.meaning!.trim())
    .map((w) => ({
      term: w.term!.trim().slice(0, 120),
      meaning: w.meaning!.trim().slice(0, 200),
      example: typeof w.example === "string" ? w.example.trim().slice(0, 200) : null,
    }));
  if (!words.length) throw new Error("AI vocabulary extraction returned no usable words");
  return words.slice(0, 8);
}

// ---------------- Flashcards ----------------

export async function generateFlashcards(opts: {
  sourceText: string;
  lang: string;
  count: number;
  sourceTitle?: string;
}) {
  const sys = `You are JeduAI's flashcard maker. From the study material, create ${opts.count} flashcards for spaced-repetition review, written in ${opts.lang}.
Rules:
- Front: one crisp question or term (max ~12 words). Back: one clear answer (max ~40 words).
- Cover the most important facts, definitions, formulas or concepts — spread across the material, not one paragraph.
- No card may duplicate another. Plain text only (no markdown).
Return STRICT JSON only:
{"cards":[{"front":"...","back":"..."}]}`;
  const raw = await chat(
    sys,
    `Material${opts.sourceTitle ? ` (${opts.sourceTitle})` : ""}:\n"""${opts.sourceText.slice(0, 9000)}"""\n\nCreate the ${opts.count} flashcards now.`
  );
  const parsed = parseJsonSafe<{ cards?: { front?: string; back?: string }[] }>(raw, {});
  const cards = (parsed.cards || [])
    .filter((c) => typeof c.front === "string" && typeof c.back === "string" && c.front.trim() && c.back.trim())
    .map((c) => ({ front: c.front!.trim().slice(0, 300), back: c.back!.trim().slice(0, 800) }));
  if (!cards.length) throw new Error("AI flashcard generation returned no usable cards");
  return cards;
}
