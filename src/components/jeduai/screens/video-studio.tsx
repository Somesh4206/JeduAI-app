"use client";
// JeduAI — Video/Audio project studio: player + synced transcript + AI tools
import React from "react";
import { motion } from "framer-motion";
import {
  PlayCircle,
  Music4,
  Subtitles,
  Search,
  Download,
  RefreshCcw,
  Trash2,
  Sparkles,
  ListTree,
  HelpCircle,
  Target,
  Layers,
  Copy,
  X,
  Timer,
  FileDown,
  Bookmark as BookmarkIcon,
} from "lucide-react";
import { api, getToken, useJedu, fmtClock } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, ProgressBar, Segmented, StatusPill, TopBar, toast, MarkdownBody } from "../ui";
import { printHTML, videoPrintView } from "../export";
import { cn } from "@/lib/utils";

type Seg = { id: string; idx: number; start: number; end: number; original: string; translated: string | null };
type VDetail = {
  video: {
    id: string;
    title: string;
    kind: "audio" | "video" | "transcript";
    fileName: string | null;
    hasFile: boolean;
    sizeKB: number;
    durationSec: number;
    sourceLang: string;
    targetLang: string;
    status: string;
    progress: number;
    summary: string | null;
    chapters: { title: string; start: number }[];
    error: string | null;
  };
  segments: Seg[];
  bookmarks: { id: string; label: string; note: string | null; sectionIdx: number | null }[];
};

export default function VideoStudio({ id, jumpToSegment }: { id: string; jumpToSegment?: number }) {
  const pop = useJedu((s) => s.pop);
  const push = useJedu((s) => s.push);
  const [data, setData] = React.useState<VDetail | null>(null);
  const [err, setErr] = React.useState("");
  const [view, setView] = React.useState<"translated" | "original" | "both">("translated");
  const [q, setQ] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [toolBusy, setToolBusy] = React.useState<string | null>(null);
  const [askAnswer, setAskAnswer] = React.useState<string | null>(null);
  const [askQ, setAskQ] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(0);
  const mediaRef = React.useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const jumped = React.useRef(false);

  const load = React.useCallback(() => {
    return api<VDetail>(`/api/jeduai/video/${id}`)
      .then((r) => {
        setData(r);
        // one-time jump from a library bookmark to the bookmarked segment
        if (jumpToSegment !== undefined && !jumped.current && r.segments.length) {
          jumped.current = true;
          const seg = r.segments.find((s) => s.idx === jumpToSegment);
          if (seg) {
            setActiveIdx(seg.idx);
            setTimeout(() => {
              if (mediaRef.current && seg.start >= 0) {
                mediaRef.current.currentTime = Math.max(0, seg.start - 0.5);
                mediaRef.current.play().catch(() => {});
              }
            }, 300);
            toast.info(`Jumped to ${fmtClock(seg.start)} · from your bookmark`);
          }
        }
      })
      .catch((e) => setErr((e as Error).message));
  }, [id, jumpToSegment]);

  // Media src: append the session token when cookies are unavailable (iframe
  // preview) — the media element cannot send an Authorization header itself.
  const mediaSrc = React.useMemo(() => {
    const t = getToken();
    return `/api/jeduai/video/${id}/file${t ? `?t=${encodeURIComponent(t)}` : ""}`;
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (data && ["extracting", "transcribing", "translating"].includes(data.video.status)) {
      const t = setInterval(() => load(), 2300);
      return () => clearInterval(t);
    }
  }, [data?.video.status, load]);

  // keep active transcript segment in view during playback
  const onTimeUpdate = React.useCallback(() => {
    const m = mediaRef.current;
    if (!m || !data) return;
    const t = m.currentTime;
    const idx = data.segments.findIndex((s) => t >= s.start && t < s.end);
    if (idx >= 0 && idx !== activeIdx) {
      setActiveIdx(idx);
      listRef.current
        ?.querySelector(`[data-seg="${idx}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [data, activeIdx]);

  async function tool(action: string, extra?: Record<string, unknown>) {
    if (toolBusy) return;
    setToolBusy(action);
    setAskAnswer(null);
    try {
      const r = await api<Record<string, unknown>>(`/api/jeduai/video/${id}`, {
        method: "POST",
        json: { action, ...extra },
      });
      if (action === "summary") toast.success("Summary generated");
      if (action === "chapters") toast.success("Chapters generated");
      if (action === "quiz") {
        toast.success(`Quiz created with ${r.count} questions`);
        push({ name: "quiz-play", id: String(r.quizId) });
        return;
      }
      if (action === "ask") setAskAnswer(String(r.answer));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToolBusy(null);
    }
  }

  async function removeProject() {
    if (!data) return;
    if (!confirm(`Delete "${data.video.title}"? Upload and translation are removed.`)) return;
    try {
      await api(`/api/jeduai/video/${id}`, { method: "DELETE" });
      toast.success("Project deleted");
      pop();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function makeFlashcards() {
    if (!data || toolBusy) return;
    setToolBusy("flashcards");
    try {
      const r = await api<{ created: number; gamified?: { gained: number } }>("/api/jeduai/flashcards", {
        method: "POST",
        json: { sourceType: "video", sourceId: id, count: 10, lang: data.video.targetLang },
      });
      toast.success(`${r.created} flashcards created · +${r.gamified?.gained || 0} XP 🃏`);
      push({ name: "flashcards", deck: `video:${id}` });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToolBusy(null);
    }
  }

  async function toggleSegBookmark(s: Seg) {
    if (!data) return;
    try {
      const r = await api<{ bookmarked: boolean }>(`/api/jeduai/video/${id}`, {
        method: "POST",
        json: { action: "bookmark", sectionIdx: s.idx },
      });
      toast.success(r.bookmarked ? "Segment bookmarked 🔖" : "Bookmark removed");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function exportSrt(which: "translated" | "original") {
    if (!data) return;
    const srt = data.segments
      .map((s, i) => {
        const fmt = (sec: number) => {
          if (sec < 0) return "00:00:00,000";
          const h = String(Math.floor(sec / 3600)).padStart(2, "0");
          const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
          const ss = String(Math.floor(sec % 60)).padStart(2, "0");
          const ms = String(Math.round((sec % 1) * 1000)).padStart(3, "0");
          return `${h}:${m}:${ss},${ms}`;
        };
        const text = which === "translated" ? s.translated || "" : s.original;
        return `${i + 1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${text}\n`;
      })
      .join("\n");
    const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.video.title.slice(0, 50)} (${which === "translated" ? data.video.targetLang : data.video.sourceLang}).srt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported .srt (${which})`);
  }

  function exportPdf() {
    if (!data) return;
    const ok = printHTML(
      videoPrintView({
        title: data.video.title,
        sourceLang: data.video.sourceLang,
        targetLang: data.video.targetLang,
        kind: data.video.kind,
        durationSec: data.video.durationSec,
        segments: data.segments.map((s) => ({ start: s.start, end: s.end, original: s.original, translated: s.translated })),
        summary: data.video.summary,
        chapters: data.video.chapters,
      })
    );
    if (ok) toast.success("Opening print dialog — choose “Save as PDF”");
    else toast.error("Couldn't open the print dialog");
  }

  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Media project" />
        <div className="p-4">
          <ErrorState message={err} onRetry={load} />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Media project" />
        <Loader label="Opening project…" />
      </div>
    );
  }

  const v = data.video;
  const completed = v.status === "completed";
  const timed = data.segments.some((s) => s.start >= 0);
  const filtered = q.trim()
    ? data.segments.filter(
        (s) => s.original.toLowerCase().includes(q.toLowerCase()) || (s.translated || "").toLowerCase().includes(q.toLowerCase())
      )
    : data.segments;
  const doneCount = data.segments.filter((s) => s.translated).length;
  const withOriginal = data.segments.filter((s) => s.original);
  const transcriptText = withOriginal.map((s) => s.original).join("\n");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title={v.title}
        subtitle={`${v.sourceLang} → ${v.targetLang} · ${doneCount}/${data.segments.length} segments`}
        right={
          <>
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              aria-label="Search transcript"
              className="grid size-10 place-items-center rounded-full text-foreground/80 transition hover:bg-muted"
            >
              {searchOpen ? <X className="size-5" /> : <Search className="size-5" />}
            </button>
            <button
              onClick={removeProject}
              aria-label="Delete project"
              className="grid size-10 place-items-center rounded-full text-foreground/80 transition hover:bg-j-error/10 hover:text-j-error"
            >
              <Trash2 className="size-5" />
            </button>
          </>
        }
      />

      {/* status */}
      <div className="border-b border-border/70 bg-card/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <StatusPill status={v.status} />
          <span className="text-[11.5px] font-bold text-muted-foreground">{v.progress}%</span>
        </div>
        {v.status !== "completed" && v.status !== "failed" ? (
          <div className="mt-2.5">
            <ProgressBar value={v.progress} />
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Timer className="size-3.5" />
              {v.status === "extracting"
                ? "Extracting mono audio with ffmpeg…"
                : v.status === "transcribing"
                  ? `Transcribing speech chunk ${Math.min(doneCount + 1, data.segments.length || 1)}…`
                  : "Translating segments…"}
            </div>
          </div>
        ) : null}
        {v.status === "failed" ? (
          <div className="mt-2.5 flex items-start justify-between gap-2 rounded-2xl bg-j-error/10 p-3 text-[12.5px] leading-relaxed text-j-error">
            <span>⚠️ {v.error || "Processing failed."}</span>
            <button
              onClick={() => tool("resume")}
              disabled={toolBusy === "resume"}
              className="shrink-0 rounded-full bg-j-error/15 px-3 py-1.5 text-[12px] font-black"
            >
              {toolBusy === "resume" ? "…" : <RefreshCcw className="size-3.5" />}
            </button>
          </div>
        ) : null}
      </div>

      {searchOpen ? (
        <div className="border-b border-border/70 bg-card px-4 py-2.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search in transcript…"
            className="min-h-10 w-full rounded-xl border border-border bg-background px-3 text-[14px] outline-none focus:border-primary/50"
          />
        </div>
      ) : null}

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4">
        {/* media player */}
        {v.hasFile ? (
          <Card className="mb-4 overflow-hidden p-0">
            {v.kind === "video" ? (
              <video
                ref={mediaRef as React.RefObject<HTMLVideoElement>}
                controls
                playsInline
                onTimeUpdate={onTimeUpdate}
                className="max-h-64 w-full bg-black"
                src={mediaSrc}
              />
            ) : (
              <div className="flex items-center gap-3 p-4">
                <div className="j-grad-cyan grid size-12 shrink-0 place-items-center rounded-2xl text-white">
                  <Music4 className="size-6" />
                </div>
                <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} controls onTimeUpdate={onTimeUpdate} className="w-full" src={mediaSrc} />
              </div>
            )}
          </Card>
        ) : v.kind === "transcript" ? (
          <div className="mb-4 rounded-2xl border border-dashed border-border bg-muted/30 p-3 text-center text-[12px] text-muted-foreground">
            📝 Transcript-only project — no media file attached.
          </div>
        ) : null}

        {/* tools */}
        {completed ? (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <ToolButton icon={<Sparkles className="size-4" />} label="Summary" busy={toolBusy === "summary"} onClick={() => tool("summary")} />
              <ToolButton icon={<ListTree className="size-4" />} label="Chapters" busy={toolBusy === "chapters"} onClick={() => tool("chapters")} />
              <ToolButton icon={<Target className="size-4" />} label="Quiz from video" busy={toolBusy === "quiz"} onClick={() => tool("quiz", { count: 5 })} />
              <ToolButton icon={<Layers className="size-4" />} label="Flashcards" busy={toolBusy === "flashcards"} onClick={makeFlashcards} />
              <button
                onClick={() => exportSrt("translated")}
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-[13px] font-bold text-foreground transition hover:border-primary/50 active:scale-[0.98]"
              >
                <Download className="size-4" /> Export .srt
              </button>
              <button
                onClick={exportPdf}
                className="col-span-2 flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 text-[13px] font-bold text-primary transition hover:bg-primary/10 active:scale-[0.98]"
              >
                <FileDown className="size-4" /> Export transcript as PDF (summary · chapters · timestamps)
              </button>
            </div>

            {v.summary ? (
              <Card className="mb-4 p-4">
                <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-primary">💡 Video summary</div>
                <MarkdownBody text={v.summary} />
              </Card>
            ) : null}

            {v.chapters?.length ? (
              <Card className="mb-4 p-4">
                <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-primary">📑 Chapters</div>
                <div className="space-y-1">
                  {v.chapters.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const seg = data.segments.find((s) => s.start >= c.start);
                        if (mediaRef.current && seg && seg.start >= 0) {
                          mediaRef.current.currentTime = seg.start + 0.01;
                          mediaRef.current.play().catch(() => {});
                        } else toast.info("No media attached for jumping");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-primary/5"
                    >
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-black text-primary">
                        {fmtClock(c.start)}
                      </span>
                      <span className="text-[13px] font-semibold text-foreground">{c.title}</span>
                    </button>
                  ))}
                </div>
              </Card>
            ) : null}

            {/* ask about video */}
            <Card className="mb-4 p-4">
              <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-primary">❓ Ask about this video</div>
              <div className="flex gap-2">
                <input
                  value={askQ}
                  onChange={(e) => setAskQ(e.target.value)}
                  placeholder="e.g. What example does the teacher give at the start?"
                  className="min-h-11 flex-1 rounded-2xl border border-border bg-background px-4 text-[13.5px] outline-none focus:border-primary/50"
                />
                <button
                  onClick={() => askQ.trim() && tool("ask", { question: askQ.trim() })}
                  disabled={toolBusy === "ask"}
                  aria-label="Ask"
                  className="j-grad-primary grid size-11 shrink-0 place-items-center rounded-full text-white shadow-lg shadow-primary/25 disabled:opacity-50"
                >
                  {toolBusy === "ask" ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <HelpCircle className="size-5" />}
                </button>
              </div>
              {askAnswer ? (
                <div className="mt-3 rounded-2xl bg-lavender p-3.5">
                  <MarkdownBody text={askAnswer} />
                </div>
              ) : null}
            </Card>
          </>
        ) : null}

        {/* transcript */}
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-black text-foreground">Transcript</h2>
          {!timed ? <span className="text-[11px] text-muted-foreground">untimed</span> : null}
        </div>
        {completed ? (
          <div className="mb-2.5">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "translated", label: v.targetLang },
                { value: "original", label: v.sourceLang },
                { value: "both", label: "Both" },
              ]}
            />
          </div>
        ) : null}

        {!filtered.length && q ? (
          <EmptyState icon="🔍" title="No matches" body={`Nothing in the transcript for “${q}”.`} />
        ) : null}

        <div ref={listRef} className="space-y-1.5">
          {filtered.map((s) => {
            const isActive = s.start >= 0 && activeIdx === s.idx && !q;
            const main = view === "original" ? s.original : s.translated || "…";
            const segBookmarked = data.bookmarks?.some((b) => b.sectionIdx === s.idx) || false;
            return (
              <div
                key={s.id}
                data-seg={s.idx}
                className={cn(
                  "rounded-2xl border p-3 transition",
                  isActive ? "border-primary/50 bg-primary/5 shadow-md shadow-primary/10" : "border-border/70 bg-card"
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  {s.start >= 0 ? (
                    <button
                      onClick={() => {
                        if (mediaRef.current) {
                          mediaRef.current.currentTime = s.start + 0.01;
                          mediaRef.current.play().catch(() => {});
                          if (navigator.vibrate) navigator.vibrate(6);
                        } else toast.info("No media attached to this project");
                      }}
                      className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-black text-primary transition hover:bg-primary/20"
                      aria-label={`Jump to ${fmtClock(s.start)}`}
                    >
                      {fmtClock(s.start)}
                    </button>
                  ) : (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-black text-muted-foreground">#{s.idx + 1}</span>
                  )}
                  {completed ? (
                    <>
                      <button
                        onClick={() => toggleSegBookmark(s)}
                        className={cn(
                          "ml-auto grid size-7 place-items-center rounded-full transition hover:bg-j-warning/10 hover:text-j-warning",
                          segBookmarked ? "text-j-warning" : "text-muted-foreground"
                        )}
                        aria-label={segBookmarked ? "Remove segment bookmark" : "Bookmark this segment"}
                        title={segBookmarked ? "Remove bookmark" : "Bookmark segment"}
                      >
                        <BookmarkIcon className={cn("size-3.5", segBookmarked && "fill-current")} />
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(s.translated || s.original).then(() => toast.success("Copied"));
                        }}
                        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary"
                        aria-label="Copy segment"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </>
                  ) : null}
                </div>
                {view === "both" && completed ? (
                  <>
                    <p className="text-[13.5px] leading-relaxed text-foreground">{s.translated}</p>
                    <p className="mt-1.5 border-t border-dashed border-border/70 pt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                      {s.original}
                    </p>
                  </>
                ) : (
                  <p className="text-[13.5px] leading-relaxed text-foreground">
                    {view === "original" ? s.original : completed ? main : s.original ? s.original : <span className="italic text-muted-foreground">transcribing…</span>}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {completed && transcriptText ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip onClick={() => exportSrt("translated")} tone="primary">
              <Download className="size-3.5" /> {v.targetLang} .srt
            </Chip>
            <Chip onClick={() => exportSrt("original")}>
              <Download className="size-3.5" /> {v.sourceLang} .srt
            </Chip>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  busy,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-[13px] font-bold text-foreground transition hover:border-primary/50 active:scale-[0.98] disabled:opacity-60"
    >
      {busy ? <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : icon}
      {label}
    </button>
  );
}
