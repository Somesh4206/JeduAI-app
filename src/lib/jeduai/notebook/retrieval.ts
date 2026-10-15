// JeduAI Notebook Studio — retrieval engine (server-side).
// Lexical BM25 retrieval over SourceChunk rows + a pluggable embedding
// interface. IMPORTANT (honest capability note): the configured AI provider
// (z-ai-web-dev-sdk) does NOT expose an embeddings endpoint, so in this
// environment retrieval is purely lexical (BM25 + heading boost + phrase
// boost + source diversity). If an embedding provider becomes available,
// register it with setEmbeddingProvider() — chunks with stored vectors then
// get a hybrid (0.6·cosine + 0.4·bm25) score. No code anywhere else changes.
import "server-only";
import { db } from "@/lib/db";
import type { Citation, SourceKind } from "./types";

// ---------------- tokenization ----------------

const STOPWORDS = new Set(
  ("a an the and or but if then than that this these those of in on at to for from with without by as is are was were be been being " +
    "it its it's do does did doing have has had having i you he she we they them his her their our your my me us not no so what " +
    "which who whom how when where why all any both each few more most other some such only own same too very can will just " +
    "about into over under again further once here there also would could should may might must shall").split(" ")
);

// Light English stemmer (suffix stripping only — never touches non-Latin scripts
// like Devanagari/Tamil, where naive stemming would corrupt the tokens).
function stemLatin(t: string) {
  if (t.length <= 4) return t;
  if (t.endsWith("ies") && t.length >= 5) return t.slice(0, -3) + "y";
  if (t.endsWith("sses")) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) return t.slice(0, -1);
  if (t.endsWith("ing") && t.length >= 6) return t.slice(0, -3);
  if (t.endsWith("ed") && t.length >= 5) return t.slice(0, -2);
  return t;
}

export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0 && t.length <= 40);
  const out: string[] = [];
  for (const t of raw) {
    if (STOPWORDS.has(t)) continue;
    // Latin-script tokens get a light stem; everything else stays as-is.
    out.push(/^[a-z0-9]+$/.test(t) ? stemLatin(t) : t);
  }
  return out;
}

/** Storage form for the SourceChunk.tokens column (space-joined). */
export function tokensKey(text: string): string {
  return tokenize(text).join(" ");
}

// ---------------- chunking (overlapping, paragraph-aware) ----------------

export type RawChunk = {
  text: string;
  page?: number | null;
  heading?: string | null;
  startSec?: number | null;
  endSec?: number | null;
};

export const CHUNK_LIMITS = { target: 900, max: 1300, overlap: 160, maxChunks: 240 };

/**
 * Split text into overlapping chunks. `pageHints` maps character offsets ->
 * page numbers for paged sources (PDFs): pass the per-page text pieces.
 * For timed sources pass paragraphs with their own start/end already set.
 */
export function chunkText(
  pieces: { text: string; page?: number | null; heading?: string | null; startSec?: number | null; endSec?: number | null }[]
): RawChunk[] {
  // Flatten into paragraphs, carrying metadata
  type Para = { text: string; page: number | null; heading: string | null; startSec: number | null; endSec: number | null };
  const paras: Para[] = [];
  for (const p of pieces) {
    const clean = p.text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
    if (!clean) continue;
    for (const block of clean.split(/\n{2,}/)) {
      const b = block.trim();
      if (!b) continue;
      paras.push({
        text: b,
        page: p.page ?? null,
        heading: p.heading ?? null,
        startSec: p.startSec ?? null,
        endSec: p.endSec ?? null,
      });
    }
  }
  if (!paras.length) return [];

  const chunks: RawChunk[] = [];
  let current = "";
  let meta: Para | null = null;
  let prevTail = "";

  const flush = () => {
    const text = current.trim();
    if (text.replace(/\s/g, "").length < 20) {
      current = "";
      meta = null;
      return;
    }
    const body = prevTail && text.startsWith(prevTail) ? text : text; // overlap is prepended below
    chunks.push({
      text: body.slice(0, CHUNK_LIMITS.max),
      page: meta?.page ?? null,
      heading: meta?.heading ?? null,
      startSec: meta?.startSec ?? null,
      endSec: meta?.endSec ?? null,
    });
    prevTail = body.slice(Math.max(0, body.length - CHUNK_LIMITS.overlap));
    current = "";
    meta = null;
  };

  for (const para of paras) {
    // paragraph larger than max -> hard-split with overlap
    if (para.text.length > CHUNK_LIMITS.max) {
      if (current.trim()) flush();
      const words = para.text.split(" ");
      let buf = "";
      for (const w of words) {
        if ((buf + " " + w).length > CHUNK_LIMITS.target && buf.length > 200) {
          chunks.push({ text: buf.trim(), page: para.page, heading: para.heading, startSec: para.startSec, endSec: para.endSec });
          prevTail = buf.slice(Math.max(0, buf.length - CHUNK_LIMITS.overlap));
          buf = prevTail + " " + w;
        } else {
          buf = buf ? buf + " " + w : w;
        }
      }
      if (buf.trim().length > 40) chunks.push({ text: buf.trim(), page: para.page, heading: para.heading, startSec: para.startSec, endSec: para.endSec });
      continue;
    }
    if (!meta) meta = para;
    else if (para.heading && !meta.heading) meta.heading = para.heading;
    // keep chunk's earliest timestamp
    if (para.startSec != null && meta.startSec == null) meta.startSec = para.startSec;
    if (para.endSec != null && meta.endSec == null) meta.endSec = para.endSec;
    if (meta.page == null && para.page != null) meta.page = para.page;
    if (current.length + para.text.length > CHUNK_LIMITS.target && current.length > CHUNK_LIMITS.target * 0.4) {
      const keepMeta = meta;
      const keep = current;
      chunks.push({
        text: keep.trim(),
        page: keepMeta.page,
        heading: keepMeta.heading,
        startSec: keepMeta.startSec,
        endSec: keepMeta.endSec,
      });
      prevTail = keep.slice(Math.max(0, keep.length - CHUNK_LIMITS.overlap));
      current = prevTail + "\n" + para.text;
      meta = { ...para };
    } else {
      current += (current ? "\n" : "") + para.text;
    }
  }
  if (current.trim()) {
    chunks.push({
      text: current.trim().slice(0, CHUNK_LIMITS.max),
      page: meta?.page ?? null,
      heading: meta?.heading ?? null,
      startSec: meta?.startSec ?? null,
      endSec: meta?.endSec ?? null,
    });
  }
  return chunks.slice(0, CHUNK_LIMITS.maxChunks);
}

// ---------------- BM25 ----------------

type IndexedChunk = {
  chunk: { id: string; sourceId: string; sourceTitle: string; kind: string; page: number | null; heading: string | null; startSec: number | null; endSec: number | null; text: string };
  tf: Map<string, number>;
  len: number;
  headingTf: Map<string, number>;
  vec: number[] | null;
};

export type RetrievedChunk = IndexedChunk["chunk"] & { chunkId: string; score: number };

// ---------------- embeddings (pluggable, NOT configured by default) ----------------

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

let embeddingProvider: EmbeddingProvider | null = null;
export function setEmbeddingProvider(p: EmbeddingProvider | null) {
  embeddingProvider = p;
}
export function hasEmbeddingProvider() {
  return embeddingProvider !== null;
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------- retrieval ----------------

export type RetrieveOpts = {
  notebookId: string;
  userId: string;
  sourceIds?: string[] | null; // null = all selected+ready sources
  query: string;
  k?: number;
  maxPerSource?: number;
};

export async function retrieveChunks(opts: RetrieveOpts): Promise<RetrievedChunk[]> {
  const k = Math.min(Math.max(opts.k ?? 8, 1), 16);
  const maxPerSource = opts.maxPerSource ?? 3;

  const sources = await db.notebookSource.findMany({
    where: {
      notebookId: opts.notebookId,
      userId: opts.userId,
      status: "ready",
      ...(opts.sourceIds ? { id: { in: opts.sourceIds }, selected: true } : { selected: true }),
    },
    select: { id: true, title: true, kind: true },
  });
  if (!sources.length) return [];
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const rows = await db.sourceChunk.findMany({
    where: { notebookId: opts.notebookId, userId: opts.userId, sourceId: { in: Array.from(sourceById.keys()) } },
    select: {
      id: true, sourceId: true, idx: true, page: true, heading: true, startSec: true, endSec: true, text: true, tokens: true, embedVec: true,
    },
    take: 1600,
  });
  if (!rows.length) return [];

  // build index
  const indexed: IndexedChunk[] = [];
  let totalLen = 0;
  const df = new Map<string, number>();
  for (const r of rows) {
    const src = sourceById.get(r.sourceId)!;
    const toks = r.tokens ? r.tokens.split(" ").filter(Boolean) : tokenize(r.text);
    if (!toks.length) continue;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const headingTf = new Map<string, number>();
    if (r.heading) for (const t of tokenize(r.heading)) headingTf.set(t, (headingTf.get(t) || 0) + 1);
    let vec: number[] | null = null;
    if (r.embedVec && embeddingProvider) {
      try {
        vec = JSON.parse(r.embedVec);
      } catch {
        vec = null;
      }
    }
    indexed.push({
      chunk: {
        id: r.id,
        sourceId: r.sourceId,
        sourceTitle: src.title,
        kind: src.kind,
        page: r.page,
        heading: r.heading,
        startSec: r.startSec,
        endSec: r.endSec,
        text: r.text,
      },
      tf, len: toks.length, headingTf, vec,
    });
    totalLen += toks.length;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  if (!indexed.length) return [];
  const avgLen = totalLen / indexed.length;
  const N = indexed.length;

  // query terms
  const qTokens = tokenize(opts.query);
  if (!qTokens.length) return [];
  const qPhrase = opts.query.toLowerCase().trim();
  const phraseLen = qPhrase.replace(/\s+/g, " ").length;

  const k1 = 1.4;
  const b = 0.72;
  const scored = indexed.map((ic) => {
    let score = 0;
    for (const t of new Set(qTokens)) {
      const f = ic.tf.get(t) || 0;
      if (!f) continue;
      const n = df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * ic.len) / avgLen));
      if (ic.headingTf.has(t)) score += 0.35 * idf; // heading boost
    }
    // exact phrase boost
    if (phraseLen >= 10 && ic.chunk.text.toLowerCase().includes(qPhrase)) score += 2.5;
    return { ic, score };
  });

  // optional hybrid re-rank with embeddings (only when vectors exist)
  if (embeddingProvider) {
    try {
      const withVec = scored.filter((s) => s.ic.vec);
      if (withVec.length) {
        const [qv] = await embeddingProvider.embed([opts.query]);
        if (qv) {
          for (const s of withVec) {
            const cos = cosine(qv, s.ic.vec!);
            s.score = 0.4 * s.score + 6 * 0.6 * cos; // scale cosine into bm25-ish range
          }
        }
      }
    } catch {
      // embedding failure must never break retrieval
    }
  }

  // source diversity: round-robin by sourceId
  scored.sort((a, b2) => b2.score - a.score);
  const perSource = new Map<string, number>();
  const picked: typeof scored = [];
  const rest: typeof scored = [];
  for (const s of scored) {
    if (s.score <= 0) continue;
    const used = perSource.get(s.ic.chunk.sourceId) || 0;
    if (used < maxPerSource && picked.length < k) {
      perSource.set(s.ic.chunk.sourceId, used + 1);
      picked.push(s);
    } else {
      rest.push(s);
    }
  }
  for (const s of rest) {
    if (picked.length >= k) break;
    picked.push(s);
  }

  return picked
    .sort((a, b2) => b2.score - a.score)
    .map((s) => ({ ...s.ic.chunk, chunkId: s.ic.chunk.id, score: s.score }));
}

// ---------------- evidence + citations ----------------

export function snippetOf(text: string, max = 220) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

/** Numbered evidence blocks for the LLM prompt. Order defines citation indexes. */
export function buildEvidenceBlocks(chunks: RetrievedChunk[]): { blocks: string[] } {
  const blocks = chunks.map((c, i) => {
    const loc =
      c.page != null
        ? `page ${c.page}`
        : c.startSec != null
          ? `at ${Math.floor(c.startSec / 60)}:${String(Math.floor(c.startSec % 60)).padStart(2, "0")}`
          : c.heading
            ? `section "${c.heading}"`
            : "passage";
    return `[${i + 1}] (Source: "${c.sourceTitle}", ${loc})\n"""${c.text.slice(0, 1100)}"""`;
  });
  return { blocks };
}

export function chunksToCitations(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((c, i) => ({
    index: i + 1,
    chunkId: c.chunkId,
    sourceId: c.sourceId,
    sourceTitle: c.sourceTitle,
    kind: c.kind as SourceKind,
    page: c.page ?? null,
    startSec: c.startSec ?? null,
    endSec: c.endSec ?? null,
    heading: c.heading ?? null,
    snippet: snippetOf(c.text),
  }));
}

/**
 * Validate [n] / [n,m] citation markers in generated text against the
 * evidence set. Returns deduped, evidence-backed citations (indexes re-mapped
 * to their evidence position). Invalid/unknown markers are simply ignored —
 * they can never point at a non-existent source.
 */
export function extractCitations(text: string, valid: Citation[]): Citation[] {
  const found = new Map<number, Citation>();
  const re = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const part of m[1].split(",")) {
      const n = parseInt(part.trim(), 10);
      const c = valid.find((v) => v.index === n);
      if (c) found.set(n, c);
    }
  }
  return Array.from(found.values()).sort((a, b) => a.index - b.index);
}
