// JeduAI Notebook Studio — shared types (safe to import from client AND server).
// This file is the single source of truth for API request/response shapes.
// NOTE: no "server-only" import here — client components import these types too.

export type SourceKind =
  | "pdf"
  | "docx"
  | "txt"
  | "md"
  | "image"
  | "web"
  | "youtube"
  | "audio"
  | "pasted"
  | "document" // reference to an existing JeduAI Document (translated or original)
  | "videoproject"; // reference to an existing JeduAI VideoProject transcript

export type SourceStatus = "queued" | "processing" | "ready" | "failed";

export type ArtifactKind =
  | "audio-overview"
  | "video-overview"
  | "mindmap"
  | "report"
  | "flashcards"
  | "quiz"
  | "infographic"
  | "slides"
  | "table";

export type ArtifactStatus = "queued" | "processing" | "ready" | "failed" | "cancelled";

// ---------------- citations ----------------

export type Citation = {
  index: number; // 1-based, matches the [n] marker in text
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  kind: SourceKind;
  page?: number | null;
  startSec?: number | null;
  endSec?: number | null;
  heading?: string | null;
  snippet: string; // short evidence quote
};

// ---------------- API DTOs ----------------

export type NotebookDTO = {
  id: string;
  title: string;
  description: string | null;
  sourceCount: number;
  readySources: number;
  conversationCount: number;
  artifactCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SourceDTO = {
  id: string;
  notebookId: string;
  title: string;
  kind: SourceKind;
  status: SourceStatus;
  progress: number;
  error: string | null;
  originUrl: string | null;
  refId: string | null;
  refKind: "document" | "videoproject" | null;
  selected: boolean;
  chunkCount: number;
  wordCount: number;
  meta: {
    pages?: number;
    durationSec?: number;
    charCount?: number;
    lang?: string;
    siteName?: string;
    videoAuthor?: string;
    fileName?: string;
    sizeKB?: number;
    [k: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
};

export type ChunkDTO = {
  id: string;
  idx: number;
  page: number | null;
  heading: string | null;
  startSec: number | null;
  endSec: number | null;
  text: string;
};

export type MessageDTO = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  createdAt: string;
};

export type ConversationDTO = {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  messages?: MessageDTO[];
};

export type ArtifactDTO = {
  id: string;
  notebookId: string;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
  progress: number;
  error: string | null;
  config: Record<string, unknown>;
  content: unknown | null; // parsed JSON payload — shape depends on kind (see below)
  hasMedia: boolean;
  mediaType: "audio" | "video" | null;
  mediaDurationSec: number | null;
  refType: "quiz" | "deck" | null;
  refId: string | null;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
};

// ---------------- artifact content payloads ----------------

/** audio-overview */
export type AudioOverviewContent = {
  title: string;
  format: string; // deepdive | brief | critique | debate
  lang: string;
  hostA: string; // voice name
  hostB: string;
  turns: { host: "A" | "B"; text: string; startSec: number; endSec: number }[];
  durationSec: number;
  citations: Citation[];
};

/** video-overview */
export type VideoOverviewContent = {
  title: string;
  lang: string;
  scenes: {
    heading: string;
    bullets: string[];
    narration: string;
    quote?: string | null;
    notes?: string | null;
    startSec: number;
    endSec: number;
  }[];
  durationSec: number;
  citations: Citation[];
};

/** mindmap */
export type MindMapNode = {
  id: string;
  label: string;
  explanation?: string;
  citationIndex?: number; // 1-based -> citations[]
  children?: MindMapNode[];
};
export type MindMapContent = {
  topic: string;
  root: MindMapNode;
  citations: Citation[];
};

/** report */
export type ReportContent = {
  type: string; // study-guide | briefing | summary | faq | glossary | essay-questions | critical-analysis | blog-post | revision-sheet | custom
  markdown: string; // with [n] citation markers
  citations: Citation[];
};

/** flashcards */
export type FlashcardsContent = {
  deckKey: string; // "notebook:<artifactId>"
  cards: { front: string; back: string; citation?: Citation | null }[];
  lang: string;
};

/** quiz */
export type QuizContent = {
  quizId: string;
  title: string;
  questions: {
    type: "mcq" | "truefalse" | "short";
    question: string;
    options: string[];
    correctIndex: number | null;
    answerText: string | null;
    explanation: string;
    citation?: Citation | null;
  }[];
};

/** infographic */
export type InfographicBlock =
  | { type: "stat"; label: string; value: string; sub?: string; citationIndex?: number }
  | { type: "timeline"; title: string; steps: { label: string; text: string }[] }
  | { type: "compare"; title: string; columns: string[]; rows: { label: string; cells: string[] }[] }
  | { type: "facts"; title: string; items: string[]; citationIndexes?: number[] }
  | { type: "quote"; text: string; attribution?: string; citationIndex?: number }
  | { type: "flow"; title: string; steps: string[] };
export type InfographicContent = {
  title: string;
  subtitle?: string;
  aspect: "4:5" | "1:1" | "16:9";
  blocks: InfographicBlock[];
  citations: Citation[];
};

/** slides */
export type SlidesContent = {
  title: string;
  subtitle?: string;
  lang: string;
  slides: {
    title: string;
    bullets: string[];
    quote?: string | null;
    notes: string;
    citationIndexes?: number[];
  }[];
  citations: Citation[];
};

/** table */
export type TableContent = {
  title: string;
  columns: string[];
  rows: { cells: string[]; citationIndex?: number; flag?: "conflict" | "missing" | null }[];
  notes: string[]; // incl. conflict/missing explanations
  citations: Citation[];
};

// ---------------- chat SSE events ----------------

export type ChatStreamEvent =
  | { type: "meta"; conversationId: string; userMessageId: string; citations: Citation[]; evidenceCount: number }
  | { type: "delta"; text: string }
  | { type: "done"; messageId: string; content: string; citations: Citation[] }
  | { type: "no-evidence"; messageId: string; content: string }
  | { type: "error"; error: string };
