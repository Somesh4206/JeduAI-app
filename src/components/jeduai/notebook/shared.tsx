"use client";
// JeduAI Notebook Studio — shared helpers, hooks, citation UI, source viewer
import React from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Image as ImageIcon,
  Globe,
  Youtube,
  AudioLines,
  ClipboardList,
  BookOpen,
  Video,
  Headphones,
  Clapperboard,
  Network,
  Layers,
  ClipboardCheck,
  BarChart3,
  Presentation,
  Table2,
  RefreshCcw,
  Search,
  BookMarked,
  ArrowUpRight,
} from "lucide-react";
import { api, useJedu, getToken, timeAgo, type ApiError } from "../store";
import { Card, ErrorState, Loader, MarkdownBody, PillSpan, Sheet, toast } from "../ui";
import { cn } from "@/lib/utils";
import type {
  ArtifactDTO,
  ArtifactKind,
  ChunkDTO,
  Citation,
  SourceDTO,
  SourceKind,
} from "@/lib/jeduai/notebook/types";

// ---------- source kind meta ----------
export type KindMeta = { icon: React.ComponentType<{ className?: string }>; label: string; tint: string };

export function kindMeta(kind: SourceKind): KindMeta {
  switch (kind) {
    case "pdf":
      return { icon: FileText, label: "PDF", tint: "bg-primary/10 text-primary" };
    case "docx":
      return { icon: FileText, label: "Word doc", tint: "bg-j-cyan/10 text-j-cyan" };
    case "txt":
      return { icon: FileText, label: "Text file", tint: "bg-j-violet/10 text-j-violet" };
    case "md":
      return { icon: FileText, label: "Markdown", tint: "bg-j-cyan/10 text-j-cyan" };
    case "image":
      return { icon: ImageIcon, label: "Image (AI-OCR)", tint: "bg-j-warning/10 text-j-warning" };
    case "web":
      return { icon: Globe, label: "Web page", tint: "bg-j-cyan/10 text-j-cyan" };
    case "youtube":
      return { icon: Youtube, label: "YouTube", tint: "bg-j-error/10 text-j-error" };
    case "audio":
      return { icon: AudioLines, label: "Audio", tint: "bg-j-violet/10 text-j-violet" };
    case "pasted":
      return { icon: ClipboardList, label: "Pasted text", tint: "bg-primary/10 text-primary" };
    case "document":
      return { icon: BookOpen, label: "JeduAI doc", tint: "bg-j-success/10 text-j-success" };
    case "videoproject":
      return { icon: Video, label: "Media transcript", tint: "bg-j-warning/10 text-j-warning" };
    default:
      return { icon: FileText, label: "Source", tint: "bg-muted text-muted-foreground" };
  }
}

// ---------- artifact kind meta ----------
export type ArtifactMeta = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  blurb: string;
  tint: string;
};

export function artifactMeta(kind: ArtifactKind): ArtifactMeta {
  switch (kind) {
    case "audio-overview":
      return { icon: Headphones, label: "Audio overview", blurb: "Podcast-style audio discussion", tint: "bg-j-violet/10 text-j-violet" };
    case "video-overview":
      return { icon: Clapperboard, label: "Video overview", blurb: "Narrated video presentation", tint: "bg-j-warning/10 text-j-warning" };
    case "mindmap":
      return { icon: Network, label: "Mind map", blurb: "Interactive concept map", tint: "bg-j-cyan/10 text-j-cyan" };
    case "report":
      return { icon: FileText, label: "Report", blurb: "Study guides & reports", tint: "bg-primary/10 text-primary" };
    case "flashcards":
      return { icon: Layers, label: "Flashcards", blurb: "Spaced-repetition cards", tint: "bg-j-violet/10 text-j-violet" };
    case "quiz":
      return { icon: ClipboardCheck, label: "Quiz", blurb: "Practice questions", tint: "bg-j-success/10 text-j-success" };
    case "infographic":
      return { icon: BarChart3, label: "Infographic", blurb: "Visual summary poster", tint: "bg-j-warning/10 text-j-warning" };
    case "slides":
      return { icon: Presentation, label: "Slides", blurb: "Presentation deck", tint: "bg-primary/10 text-primary" };
    case "table":
      return { icon: Table2, label: "Table", blurb: "Comparison data table", tint: "bg-j-cyan/10 text-j-cyan" };
    default:
      return { icon: FileText, label: "Artifact", blurb: "", tint: "bg-muted text-muted-foreground" };
  }
}

// ---------- small formatters ----------
export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export function sourceMetaLine(s: SourceDTO): string {
  const bits: string[] = [];
  if (s.meta?.pages) bits.push(`${s.meta.pages} page${s.meta.pages === 1 ? "" : "s"}`);
  if (s.meta?.durationSec) bits.push(fmtDur(s.meta.durationSec));
  if (s.wordCount) bits.push(`${s.wordCount.toLocaleString()} words`);
  if (s.chunkCount) bits.push(`${s.chunkCount} chunk${s.chunkCount === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

export function citationWhere(c: Citation): string {
  if (c.page) return `Page ${c.page}`;
  if (typeof c.startSec === "number" && c.startSec >= 0) return fmtDur(c.startSec);
  if (c.heading) return c.heading;
  return "Passage";
}

// ---------- responsive helper ----------
export function useIsDesktop(min = 1024): boolean {
  const [is, setIs] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${min}px)`);
    const update = () => setIs(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [min]);
  return is;
}

// ---------- media / export helpers ----------
export function mediaUrl(notebookId: string, artifactId: string, download = false): string {
  const t = getToken() ?? "";
  return `/api/jeduai/notebook/${notebookId}/artifacts/${artifactId}/media?t=${encodeURIComponent(t)}${download ? "&download=1" : ""}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportArtifactFile(notebookId: string, artifact: ArtifactDTO, format: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/jeduai/notebook/${notebookId}/artifacts/${artifact.id}/export`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ format }),
  });
  if (!res.ok) {
    let msg = `Export failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string" && data.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  let filename = `${artifact.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "artifact"}.${format}`;
  try {
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename\*?="?([^";]+)"?/i.exec(cd);
    if (m && m[1]) filename = m[1];
  } catch {}
  downloadBlob(blob, filename);
}

// ---------- grounded chat SSE ----------
export type ChatSendOpts = {
  question: string;
  conversationId?: string | null;
  mode?: string;
  lang?: string;
  sourceIds?: string[];
  onConversationId?: (id: string) => void;
  onDone?: (final: { ok: boolean; conversationId: string | null }) => void;
};

export function useChatStream(notebookId: string) {
  const [streaming, setStreaming] = React.useState(false);
  const [streamText, setStreamText] = React.useState("");
  const [streamCitations, setStreamCitations] = React.useState<Citation[]>([]);
  const [error, setError] = React.useState("");
  const abortRef = React.useRef<AbortController | null>(null);
  const lastSendRef = React.useRef<ChatSendOpts | null>(null);
  const doneCbRef = React.useRef<ChatSendOpts["onDone"] | null>(null);

  const clearStream = React.useCallback(() => {
    setStreamText("");
    setStreamCitations([]);
  }, []);

  const send = React.useCallback(
    async (opts: ChatSendOpts) => {
      const q = opts.question.trim();
      if (!q || abortRef.current) return;
      lastSendRef.current = opts;
      doneCbRef.current = opts.onDone || null;
      const controller = new AbortController();
      abortRef.current = controller;
      setError("");
      setStreamText("");
      setStreamCitations([]);
      setStreaming(true);
      const finish = (ok: boolean, convId: string | null) => {
        setStreaming(false);
        abortRef.current = null;
        try {
          doneCbRef.current?.({ ok, conversationId: convId });
        } catch {}
      };
      try {
        const token = getToken();
        const res = await fetch(`/api/jeduai/notebook/${notebookId}/chat`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            question: q,
            ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
            ...(opts.mode ? { mode: opts.mode } : {}),
            ...(opts.lang ? { lang: opts.lang } : {}),
            ...(opts.sourceIds ? { sourceIds: opts.sourceIds } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          let msg = `Chat failed (${res.status})`;
          try {
            const data = await res.json();
            if (data && typeof data.error === "string" && data.error) msg = data.error;
          } catch {}
          setError(msg);
          toast.error(msg);
          finish(false, null);
          return;
        }
        let convId: string | null = opts.conversationId || null;
        const reader = res.body?.getReader();
        if (!reader) {
          setError("Streaming is not supported in this browser.");
          finish(false, null);
          return;
        }
        const decoder = new TextDecoder();
        let buf = "";
        const handle = (ev: unknown) => {
          const e = ev as { type?: string } & Record<string, unknown>;
          if (!e || typeof e.type !== "string") return;
          if (e.type === "meta") {
            convId = (e.conversationId as string) || convId;
            if (e.conversationId) opts.onConversationId?.(e.conversationId as string);
            setStreamCitations((e.citations as Citation[]) || []);
          } else if (e.type === "delta") {
            setStreamText((t) => t + ((e.text as string) || ""));
          } else if (e.type === "done" || e.type === "no-evidence") {
            setStreamText((e.content as string) || "");
            if (e.type === "done") setStreamCitations((e.citations as Citation[]) || []);
            finish(true, convId);
          } else if (e.type === "error") {
            const msg = (e.error as string) || "Chat failed";
            setError(msg);
            toast.error(msg);
            finish(false, convId);
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            try {
              handle(JSON.parse(line.slice(5).trim()));
            } catch {}
          }
        }
        // stream ended without a terminal event
        if (abortRef.current === controller) finish(true, convId);
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          finish(false, null);
        } else {
          const msg = (e as Error).message || "Chat failed";
          setError(msg);
          toast.error(msg);
          finish(false, null);
        }
      }
    },
    [notebookId]
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const regenerate = React.useCallback(() => {
    const last = lastSendRef.current;
    if (last) send({ ...last });
  }, [send]);

  return { send, stop, regenerate, clearStream, streaming, streamText, streamCitations, error, setError };
}

// ---------- markdown with inline citation chips ----------
export function CitedText({
  content,
  citations,
  onCitation,
  className,
}: {
  content: string;
  citations: Citation[];
  onCitation: (c: Citation) => void;
  className?: string;
}) {
  const parts = content.split(/(\[\d{1,2}(?:\s*,\s*\d{1,2})*\])/g);
  const byIndex = new Map<number, Citation>();
  for (const c of citations || []) byIndex.set(c.index, c);
  return (
    <div className={className}>
      {parts.map((p, i) => {
        const m = /^\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]$/.exec(p);
        if (m) {
          const nums = m[1].split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => n > 0);
          if (nums.length && nums.every((n) => byIndex.has(n))) {
            return (
              <span key={i} className="inline-flex gap-0.5 align-baseline">
                {nums.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onCitation(byIndex.get(n)!)}
                    aria-label={`Show source ${n}`}
                    className="mx-0.5 inline-flex h-5 min-w-5 translate-y-[-1px] items-center justify-center rounded-full border border-primary/25 bg-primary/10 px-1.5 text-[10.5px] font-black text-primary transition hover:bg-primary/20 active:scale-90"
                  >
                    {n}
                  </button>
                ))}
              </span>
            );
          }
        }
        if (!p) return null;
        return (
          <MarkdownBody
            key={i}
            text={p}
            className="[&_p]:inline [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1"
          />
        );
      })}
    </div>
  );
}

// ---------- citation sheet ----------
export function CitationSheet({
  open,
  onOpenChange,
  citations,
  sources,
  onOpenSource,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  citations: Citation[];
  sources: SourceDTO[];
  onOpenSource: (c: Citation) => void;
}) {
  const push = useJedu((s) => s.push);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Evidence · ${citations.length} citation${citations.length === 1 ? "" : "s"}`}>
      <div className="space-y-2.5 pb-2">
        {citations.map((c, i) => {
          const km = kindMeta(c.kind);
          const src = sources.find((s) => s.id === c.sourceId);
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className="p-0">
                <button onClick={() => onOpenSource(c)} className="flex w-full items-start gap-3 p-3.5 text-left transition hover:bg-muted/30 active:scale-[0.99]">
                  <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl", km.tint)}>
                    <km.icon className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-bold text-foreground">{c.sourceTitle}</span>
                      <PillSpan tone="primary" className="shrink-0 px-2 py-0.5 text-[10.5px]">
                        {citationWhere(c)}
                      </PillSpan>
                    </span>
                    <span className="mt-1 line-clamp-3 block text-[12px] leading-relaxed text-muted-foreground">“{c.snippet}”</span>
                  </span>
                </button>
                {src && src.refKind === "document" && src.refId ? (
                  <button
                    onClick={() => {
                      onOpenChange(false);
                      push({ name: "document-reader", id: src.refId! });
                    }}
                    className="flex min-h-10 w-full items-center justify-center gap-1.5 border-t border-border/70 text-[12px] font-bold text-primary transition hover:bg-primary/5"
                  >
                    <BookOpen className="size-3.5" /> Open in Reader
                  </button>
                ) : null}
                {src && src.refKind === "videoproject" && src.refId ? (
                  <button
                    onClick={() => {
                      onOpenChange(false);
                      push({ name: "video-studio", id: src.refId! });
                    }}
                    className="flex min-h-10 w-full items-center justify-center gap-1.5 border-t border-border/70 text-[12px] font-bold text-j-warning transition hover:bg-j-warning/5"
                  >
                    <Video className="size-3.5" /> Open in Media Studio
                  </button>
                ) : null}
              </Card>
            </motion.div>
          );
        })}
      </div>
    </Sheet>
  );
}

// ---------- source viewer sheet (paginated chunks + search) ----------
export function SourceViewerSheet({
  notebookId,
  source,
  open,
  onOpenChange,
  onChanged,
}: {
  notebookId: string;
  source: SourceDTO | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const [chunks, setChunks] = React.useState<ChunkDTO[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState("");
  const [qInput, setQInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [retrying, setRetrying] = React.useState(false);

  const pageSize = 8;
  const load = React.useCallback(
    (p: number, query: string, append: boolean) => {
      if (!source) return;
      setLoading(true);
      setErr("");
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (query.trim()) params.set("q", query.trim());
      api<{ source: SourceDTO; chunks: ChunkDTO[]; total: number; page: number }>(
        `/api/jeduai/notebook/${notebookId}/sources/${source.id}?${params}`
      )
        .then((r) => {
          setChunks((prev) => (append ? [...prev, ...(r.chunks || [])] : r.chunks || []));
          setTotal(r.total || 0);
          setPage(p);
        })
        .catch((e) => setErr((e as Error).message))
        .finally(() => setLoading(false));
    },
    [notebookId, source]
  );

  React.useEffect(() => {
    if (open && source) {
      setQ("");
      setQInput("");
      setChunks([]);
      setTotal(0);
      load(1, "", false);
    }
  }, [open, source, load]);

  async function retrySource() {
    if (!source || retrying) return;
    setRetrying(true);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/sources/${source.id}`, { method: "PATCH", json: { action: "retry" } });
      toast.success("Re-processing source…");
      onOpenChange(false);
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  if (!source) return null;
  const km = kindMeta(source.kind);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={source.title}>
      <div className="space-y-3 pb-2">
        {/* meta */}
        <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-muted/40 p-3">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", km.tint)}>
            <km.icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] font-bold text-foreground">{km.label}</span>
              <PillSpan
                tone={source.status === "ready" ? "success" : source.status === "failed" ? "error" : "primary"}
                className="px-2 py-0.5 text-[10.5px]"
              >
                {source.status === "ready" ? "Ready" : source.status === "failed" ? "Failed" : source.status === "processing" ? "Processing" : "Queued"}
              </PillSpan>
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {sourceMetaLine(source) || "No text extracted yet"} · added {timeAgo(source.createdAt)}
            </div>
          </div>
        </div>
        {source.originUrl ? (
          <a
            href={source.originUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-10 items-center gap-1.5 rounded-2xl border border-border/80 px-3 text-[12.5px] font-bold text-primary transition hover:bg-primary/5"
          >
            <ArrowUpRight className="size-4" /> Open original link
          </a>
        ) : null}
        {source.status === "failed" ? (
          <div className="rounded-2xl border border-j-error/25 bg-j-error/5 p-3">
            <div className="text-[12.5px] font-bold text-j-error">{source.error || "Processing failed"}</div>
            <button
              onClick={retrySource}
              disabled={retrying}
              className="mt-2 flex min-h-10 items-center gap-2 rounded-xl bg-j-error/10 px-4 text-[13px] font-bold text-j-error transition hover:bg-j-error/15 active:scale-95 disabled:opacity-50"
            >
              <RefreshCcw className={cn("size-4", retrying && "animate-spin")} /> Retry processing
            </button>
          </div>
        ) : null}

        {/* search */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qInput);
            load(1, qInput, false);
          }}
          className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search inside this source…"
            aria-label="Search inside source"
            className="min-h-11 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="submit"
            aria-label="Search"
            className="grid size-9 shrink-0 place-items-center rounded-full text-primary transition hover:bg-primary/10 active:scale-95"
          >
            <Search className="size-4" />
          </button>
        </form>

        {/* chunks */}
        {err ? <ErrorState message={err} onRetry={() => load(page, q, false)} /> : loading && !chunks.length ? (
          <Loader label="Loading passages…" />
        ) : !chunks.length ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-center text-[13px] text-muted-foreground">
            {q ? `No passages match “${q}”.` : "No extracted passages yet — the source may still be processing."}
          </div>
        ) : (
          <div className="space-y-2">
            {chunks.map((c) => (
              <div key={c.id} className="rounded-2xl border border-border/80 bg-card p-3.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <PillSpan tone="primary" className="px-2 py-0.5 text-[10.5px]">
                    {c.page ? `Page ${c.page}` : typeof c.startSec === "number" && c.startSec >= 0 ? fmtDur(c.startSec) : `Chunk ${c.idx + 1}`}
                  </PillSpan>
                  {c.heading ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-j-cyan/10 border border-j-cyan/25 px-2 py-0.5 text-[10.5px] font-bold text-j-cyan">
                      <BookMarked className="size-3" /> {c.heading.slice(0, 40)}
                    </span>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">{c.text}</p>
              </div>
            ))}
            {chunks.length < total ? (
              <button
                onClick={() => load(page + 1, q, true)}
                disabled={loading}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border text-[13px] font-bold text-primary transition hover:bg-primary/5 disabled:opacity-50"
              >
                {loading ? <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : null}
                Load more ({chunks.length} of {total})
              </button>
            ) : null}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------- shared small pieces ----------
export function StripedProgress({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct}>
      <motion.div className="h-full rounded-full j-grad-primary" animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 90, damping: 20 }} />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "repeating-linear-gradient(115deg, rgba(255,255,255,0.28) 0 8px, transparent 8px 18px)",
        }}
        animate={{ backgroundPosition: ["0px 0px", "36px 0px"] }}
        transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
      />
    </div>
  );
}

export function isBusyStatus(status: string): boolean {
  return status === "queued" || status === "processing";
}

export function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "status" in e && (e as ApiError).status === 409) return "__exists__";
  return (e as Error).message || "Something went wrong";
}
