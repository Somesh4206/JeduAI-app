"use client";
// JeduAI Notebook Studio — artifact viewers (audio, video, mindmap, report,
// flashcards, quiz, infographic, slides, table)
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Download,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  Maximize2,
  AlertTriangle,
  Pencil,
  Check,
  Flag,
  Layers,
  ClipboardCheck,
  Sparkles,
  FileText,
} from "lucide-react";
import { api, useJedu, fmtClock, timeAgo } from "../store";
import { Card, EmptyState, ErrorState, Loader, PillSpan, Sheet, TopBar, toast } from "../ui";
import { cn } from "@/lib/utils";
import { escapeHtml, printHTML } from "@/components/jeduai/export";
import {
  artifactMeta,
  CitedText,
  CitationSheet,
  downloadBlob,
  exportArtifactFile,
  mediaUrl,
  StripedProgress,
  fmtDur,
  isBusyStatus,
} from "./shared";
import type {
  ArtifactDTO,
  ArtifactKind,
  AudioOverviewContent,
  Citation,
  FlashcardsContent,
  InfographicContent,
  MindMapContent,
  QuizContent,
  ReportContent,
  SlidesContent,
  SourceDTO,
  TableContent,
  VideoOverviewContent,
} from "@/lib/jeduai/notebook/types";
import { INFOGRAPHIC_SIZES, layoutMindMap, renderInfographicSVG, renderSlideSVG } from "@/lib/jeduai/studio/render";

type MMLayoutNode = ReturnType<typeof layoutMindMap>["nodes"][number];

// =====================================================================
// Viewer shell
// =====================================================================
export function ArtifactViewer({
  notebookId,
  artifactId,
  onClose,
  onChanged,
  onDeleted,
  sources,
  onOpenSource,
}: {
  notebookId: string;
  artifactId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  sources: SourceDTO[];
  onOpenSource: (c: Citation) => void;
}) {
  const [a, setA] = React.useState<ArtifactDTO | null>(null);
  const [err, setErr] = React.useState("");
  const [tick, setTick] = React.useState(0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    api<{ artifact: ArtifactDTO }>(`/api/jeduai/notebook/${notebookId}/artifacts/${artifactId}`)
      .then((r) => alive && setA(r.artifact))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [notebookId, artifactId, tick]);

  // live progress while generating inside the viewer
  React.useEffect(() => {
    if (!a || !isBusyStatus(a.status)) return;
    const t = setInterval(() => setTick((x) => x + 1), 2500);
    return () => clearInterval(t);
  }, [a]);

  async function refresh(notify = false) {
    setTick((x) => x + 1);
    if (notify) onChanged();
  }

  async function action(json: Record<string, unknown>, okMsg?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/artifacts/${artifactId}`, { method: "PATCH", json });
      if (okMsg) toast.success(okMsg);
      await refresh(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (busy) return;
    if (!confirm(`Delete "${a?.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/artifacts/${artifactId}`, { method: "DELETE" });
      toast.success("Deleted");
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const meta = a ? artifactMeta(a.kind) : null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background" role="dialog" aria-label={a?.title || "Artifact viewer"}>
      <TopBar
        onBack={onClose}
        title={a?.title || "Artifact"}
        subtitle={a ? `${meta?.label} · from ${a.sourceIds.length} source${a.sourceIds.length === 1 ? "" : "s"} · ${timeAgo(a.createdAt)}` : undefined}
        right={
          <button
            onClick={() => {
              setRenameVal(a?.title || "");
              setMenuOpen(true);
            }}
            aria-label="Artifact menu"
            className="grid size-10 place-items-center rounded-full text-foreground/80 transition hover:bg-muted active:scale-95"
          >
            <MoreVertical className="size-5" />
          </button>
        }
      />

      {!a && !err ? (
        <Loader label="Loading artifact…" />
      ) : err ? (
        <div className="px-4 pt-6">
          <ErrorState message={err} onRetry={() => setTick((x) => x + 1)} />
        </div>
      ) : a && a.status !== "ready" ? (
        <StatusView a={a} busy={busy} onCancel={() => action({ action: "cancel" }, "Cancelling…")} onRetry={() => action({ action: "retry" }, "Regenerating…")} />
      ) : a && a.content ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex min-h-0 flex-1 flex-col">
          {(() => {
            const p = { nb: notebookId, a, sources, onOpenSource, refresh: () => refresh(false) };
            switch (a.kind as ArtifactKind) {
              case "audio-overview":
                return <AudioView {...p} content={a.content as AudioOverviewContent} />;
              case "video-overview":
                return <VideoView {...p} content={a.content as VideoOverviewContent} />;
              case "mindmap":
                return <MindMapView {...p} content={a.content as MindMapContent} />;
              case "report":
                return <ReportView {...p} content={a.content as ReportContent} />;
              case "flashcards":
                return <FlashcardsView {...p} content={a.content as FlashcardsContent} />;
              case "quiz":
                return <QuizView {...p} content={a.content as QuizContent} />;
              case "infographic":
                return <InfographicView {...p} content={a.content as InfographicContent} />;
              case "slides":
                return <SlidesView {...p} content={a.content as SlidesContent} />;
              case "table":
                return <TableView {...p} content={a.content as TableContent} />;
              default:
                return (
                  <div className="px-4 pt-6">
                    <EmptyState title="Unknown artifact type" body={String(a.kind)} />
                  </div>
                );
            }
          })()}
        </motion.div>
      ) : (
        <div className="px-4 pt-6">
          <EmptyState icon="📦" title="No content yet" body="This artifact has no rendered content." />
        </div>
      )}

      {/* overflow menu */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Artifact">
        <div className="space-y-1.5 pb-2">
          <MenuRow
            icon={Pencil}
            label="Rename"
            onClick={() => {
              setMenuOpen(false);
              setRenameOpen(true);
            }}
          />
          <MenuRow
            icon={RotateCcw}
            label={a && isBusyStatus(a.status) ? "Restart generation" : "Regenerate"}
            onClick={() => {
              setMenuOpen(false);
              action({ action: "retry" }, "Regenerating…");
            }}
          />
          <MenuRow
            icon={AlertTriangle}
            label="Delete"
            danger
            onClick={() => {
              setMenuOpen(false);
              doDelete();
            }}
          />
        </div>
      </Sheet>

      <Sheet open={renameOpen} onOpenChange={setRenameOpen} title="Rename artifact">
        <div className="space-y-3 pb-2">
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            maxLength={90}
            aria-label="Artifact title"
            className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
          />
          <button
            onClick={async () => {
              if (!renameVal.trim()) return;
              setRenameOpen(false);
              await action({ action: "rename", title: renameVal.trim() }, "Renamed");
            }}
            className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25"
          >
            Save
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onClick,
  danger,
  hidden,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold transition active:scale-[0.99]",
        danger ? "text-j-error hover:bg-j-error/8" : "text-foreground hover:bg-muted"
      )}
    >
      <Icon className="size-4.5" /> {label}
    </button>
  );
}

function StatusView({
  a,
  busy,
  onCancel,
  onRetry,
}: {
  a: ArtifactDTO;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const meta = artifactMeta(a.kind);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className={cn("grid size-16 place-items-center rounded-3xl", meta.tint)}>
        <meta.icon className="size-7" />
      </div>
      {a.status === "failed" ? (
        <>
          <div className="text-[15px] font-black text-foreground">Generation failed</div>
          <p className="max-w-[300px] text-[13px] leading-relaxed text-j-error">{a.error || "Something went wrong while generating."}</p>
          <button
            onClick={onRetry}
            disabled={busy}
            className="flex min-h-11 items-center gap-2 rounded-full bg-primary/10 px-5 text-[13.5px] font-bold text-primary transition hover:bg-primary/15 active:scale-95 disabled:opacity-50"
          >
            <RotateCcw className={cn("size-4", busy && "animate-spin")} /> Retry
          </button>
        </>
      ) : a.status === "cancelled" ? (
        <>
          <div className="text-[15px] font-black text-foreground">Generation cancelled</div>
          <p className="text-[13px] text-muted-foreground">You stopped this generation. Retry if you still want it.</p>
          <button
            onClick={onRetry}
            disabled={busy}
            className="flex min-h-11 items-center gap-2 rounded-full bg-primary/10 px-5 text-[13.5px] font-bold text-primary transition hover:bg-primary/15 active:scale-95 disabled:opacity-50"
          >
            <RotateCcw className={cn("size-4", busy && "animate-spin")} /> Retry
          </button>
        </>
      ) : (
        <>
          <div className="text-[15px] font-black text-foreground">{a.status === "queued" ? "Queued…" : "Generating your artifact…"}</div>
          <div className="w-full max-w-[300px] space-y-2">
            <StripedProgress value={a.progress || 0} />
            <div className="text-[12px] font-bold text-muted-foreground">{a.progress || 0}% · {meta.label}</div>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex min-h-11 items-center gap-2 rounded-full border border-border px-5 text-[13.5px] font-bold text-muted-foreground transition hover:bg-muted active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

type ViewProps = {
  nb: string;
  a: ArtifactDTO;
  sources: SourceDTO[];
  onOpenSource: (c: Citation) => void;
  refresh: () => void;
};

// ---------- export helper ----------
function useExport(nb: string) {
  const [busyFmt, setBusyFmt] = React.useState("");
  const run = React.useCallback(
    async (a: ArtifactDTO, format: string) => {
      if (busyFmt) return;
      setBusyFmt(format);
      try {
        await exportArtifactFile(nb, a, format);
        toast.success(`${format.toUpperCase()} downloaded`);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusyFmt("");
      }
    },
    [nb, busyFmt]
  );
  return { busyFmt, run };
}

function ToolBtn({
  icon: Icon,
  label,
  onClick,
  busy,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      className="flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[12.5px] font-bold text-foreground/85 transition hover:border-primary/40 hover:text-primary active:scale-95 disabled:opacity-50"
    >
      {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : <Icon className="size-3.5" />}
      {label}
    </button>
  );
}

// =====================================================================
// Audio overview — custom player with transcript sync
// =====================================================================
const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 1.75, 2];

function AudioView({ nb, a, content, onOpenSource, sources }: ViewProps & { content: AudioOverviewContent }) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [cur, setCur] = React.useState(0);
  const [dur, setDur] = React.useState(a.mediaDurationSec || content.durationSec || 0);
  const [speed, setSpeed] = React.useState(1);
  const [citesOpen, setCitesOpen] = React.useState(false);
  React.useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);
  const turns = content.turns || [];
  const activeIdx = (() => {
    for (let i = 0; i < turns.length; i++) {
      if (cur >= turns[i].startSec && cur < Math.max(turns[i].endSec, turns[i].startSec + 0.6)) return i;
    }
    let last = -1;
    for (let i = 0; i < turns.length; i++) if (cur >= turns[i].startSec) last = i;
    return last;
  })();

  function seek(t: number) {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, t);
    setCur(Math.max(0, t));
  }
  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }

  return (
    <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4 pb-8">
      <audio
        ref={audioRef}
        preload="metadata"
        src={mediaUrl(nb, a.id)}
        onTimeUpdate={(e) => setCur((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration || dur)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      {/* player card */}
      <div className="j-grad-primary relative overflow-hidden rounded-3xl p-5 text-white shadow-xl shadow-primary/25">
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-white/10"
          animate={{ scale: playing ? [1, 1.15, 1] : 1 }}
          transition={{ repeat: playing ? Infinity : 0, duration: 3.4, ease: "easeInOut" }}
        />
        <div className="relative">
          <div className="flex items-center gap-2">
            <PillSpan tone="primary" className="border-white/25 bg-white/15 px-2.5 py-0.5 text-[10.5px] text-white">
              {content.format === "brief" ? "Brief" : content.format === "critique" ? "Critique" : content.format === "debate" ? "Debate" : "Deep dive"}
            </PillSpan>
            <span className="text-[11.5px] font-bold text-white/85">{fmtDur(dur || content.durationSec || 0)} · two AI hosts</span>
          </div>
          <div className="mt-1 line-clamp-2 text-[16px] font-black leading-tight">{content.title || a.title}</div>

          <div className="mt-4 flex items-center justify-center gap-5">
            <button onClick={() => seek(cur - 10)} aria-label="Back 10 seconds" className="grid size-11 place-items-center rounded-full bg-white/15 transition hover:bg-white/25 active:scale-90">
              <SkipBack className="size-5" />
            </button>
            <button
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="grid size-16 place-items-center rounded-full bg-white text-primary shadow-lg transition hover:scale-105 active:scale-95"
            >
              {playing ? <Pause className="size-7" /> : <Play className="ml-0.5 size-7" />}
            </button>
            <button onClick={() => seek(cur + 10)} aria-label="Forward 10 seconds" className="grid size-11 place-items-center rounded-full bg-white/15 transition hover:bg-white/25 active:scale-90">
              <SkipForward className="size-5" />
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(dur, 0.1)}
            step={0.1}
            value={Math.min(cur, dur || 0)}
            onChange={(e) => seek(parseFloat(e.target.value))}
            aria-label="Seek"
            className="mt-4 w-full accent-white"
          />
          <div className="flex items-center justify-between text-[11.5px] font-bold tabular-nums text-white/85">
            <span>{fmtClock(cur)}</span>
            <button
              onClick={() => setSpeed((s) => PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(s) + 1) % PLAYBACK_SPEEDS.length])}
              aria-label={`Playback speed, currently ${speed} times normal`}
              title="Playback speed"
              className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-black tabular-nums transition hover:bg-white/25 active:scale-95"
            >
              {speed}×
            </button>
            <span>{fmtClock(dur || content.durationSec || 0)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={mediaUrl(nb, a.id, true)}
          download
          className="flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[12.5px] font-bold text-foreground/85 transition hover:border-primary/40 hover:text-primary active:scale-95"
        >
          <Download className="size-3.5" /> Download audio
        </a>
        <ToolBtn icon={FileText} label="Evidence" onClick={() => setCitesOpen(true)} />
      </div>

      {/* transcript */}
      <h3 className="mb-2 mt-5 px-1 text-[15px] font-bold text-foreground">Transcript</h3>
      <div className="space-y-2">
        {turns.map((t, i) => {
          const active = i === activeIdx;
          const isA = t.host === "A";
          return (
            <button
              key={i}
              onClick={() => seek(t.startSec)}
              className={cn(
                "flex w-full gap-3 rounded-2xl border p-3.5 text-left transition active:scale-[0.99]",
                active ? "border-primary/50 bg-primary/8 ring-2 ring-primary/20" : "border-border/80 bg-card hover:bg-muted/40"
              )}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-black",
                  isA ? "bg-primary/15 text-primary" : "bg-j-violet/15 text-j-violet"
                )}
              >
                {t.host}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">{isA ? content.hostA : content.hostB}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">{fmtClock(t.startSec)}</span>
                </span>
                <span className={cn("mt-1 block text-[13px] leading-relaxed", active ? "text-foreground" : "text-foreground/85")}>{t.text}</span>
              </span>
            </button>
          );
        })}
      </div>

      <CitationSheet open={citesOpen} onOpenChange={setCitesOpen} citations={content.citations || []} sources={sources} onOpenSource={onOpenSource} />
    </div>
  );
}

// =====================================================================
// Video overview — player + chapters + per-scene transcript
// =====================================================================
function VideoView({ nb, a, content, sources, onOpenSource }: ViewProps & { content: VideoOverviewContent }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [cur, setCur] = React.useState(0);
  const [speed, setSpeed] = React.useState(1);
  const [openScene, setOpenScene] = React.useState<number | null>(null);
  const [citesOpen, setCitesOpen] = React.useState(false);
  React.useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);
  const scenes = content.scenes || [];
  const activeScene = (() => {
    let last = -1;
    for (let i = 0; i < scenes.length; i++) if (cur >= scenes[i].startSec) last = i;
    return last;
  })();

  return (
    <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4 pb-8">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        src={mediaUrl(nb, a.id)}
        onTimeUpdate={(e) => setCur((e.target as HTMLVideoElement).currentTime)}
        className="aspect-video w-full rounded-2xl bg-black shadow-lg"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold text-muted-foreground">
          {scenes.length} scene{scenes.length === 1 ? "" : "s"} · {fmtDur(a.mediaDurationSec || content.durationSec || 0)}
        </span>
        <button
          onClick={() => setSpeed((s) => PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(s) + 1) % PLAYBACK_SPEEDS.length])}
          aria-label={`Playback speed, currently ${speed} times normal`}
          title="Playback speed"
          className="flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-[12px] font-black tabular-nums text-foreground/85 transition hover:border-primary/40 hover:text-primary active:scale-95"
        >
          {speed}×
        </button>
        <a
          href={mediaUrl(nb, a.id, true)}
          download
          className="ml-auto flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[12.5px] font-bold text-foreground/85 transition hover:border-primary/40 hover:text-primary active:scale-95"
        >
          <Download className="size-3.5" /> Download video
        </a>
        <ToolBtn icon={FileText} label="Evidence" onClick={() => setCitesOpen(true)} />
      </div>

      <h3 className="mb-2 mt-5 px-1 text-[15px] font-bold text-foreground">Chapters</h3>
      <div className="space-y-2">
        {scenes.map((s, i) => {
          const active = i === activeScene;
          const open = openScene === i;
          return (
            <div key={i} className={cn("overflow-hidden rounded-2xl border transition", active ? "border-primary/50 bg-primary/5" : "border-border/80 bg-card")}>
              <button
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = Math.max(0, s.startSec);
                }}
                className="flex w-full items-center gap-3 p-3.5 text-left"
                aria-label={`Jump to ${s.heading}`}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-[11px] font-black tabular-nums", active ? "j-grad-primary text-white" : "bg-muted text-muted-foreground")}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold text-foreground">{s.heading}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {fmtClock(s.startSec)} – {fmtClock(s.endSec)}
                  </span>
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={open ? "Hide narration" : "Show narration"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenScene(open ? null : i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      setOpenScene(open ? null : i);
                    }
                  }}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted"
                >
                  <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                </span>
              </button>
              <AnimatePresence>
                {open ? (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="border-t border-border/70 px-4 py-3">
                      {s.bullets?.length ? (
                        <ul className="mb-2 list-disc space-y-1 pl-4 text-[12px] text-muted-foreground">
                          {s.bullets.map((b, bi) => (
                            <li key={bi}>{b}</li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="text-[12.5px] leading-relaxed text-foreground/85">{s.narration}</p>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <CitationSheet open={citesOpen} onOpenChange={setCitesOpen} citations={content.citations || []} sources={sources} onOpenSource={onOpenSource} />
    </div>
  );
}

// =====================================================================
// Mind map — pan/zoom SVG with collapsible nodes
// =====================================================================
function MindMapView({ nb, a, content, sources, onOpenSource }: ViewProps & { content: MindMapContent }) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const layout = React.useMemo(() => layoutMindMap(content.root, collapsed), [content.root, collapsed]);
  const nodesById = React.useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ s: 1, x: 0, y: 0 });
  const [selected, setSelected] = React.useState<MMLayoutNode | null>(null);
  const [cites, setCites] = React.useState<Citation[] | null>(null);
  const { busyFmt, run } = useExport(nb);
  const dragRef = React.useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  // multi-pointer tracking for touch pinch-zoom (2 pointers) + single-pointer pan
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = React.useRef<{ startDist: number; startScale: number; wx: number; wy: number } | null>(null);
  const viewRef = React.useRef(view);
  React.useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const bounds = React.useMemo(() => {
    const xs = layout.nodes.map((n) => n.x);
    const ys = layout.nodes.map((n) => n.y);
    const x2s = layout.nodes.map((n) => n.x + n.w);
    const y2s = layout.nodes.map((n) => n.y + n.h);
    const minX = Math.min(0, ...xs);
    const minY = Math.min(0, ...ys);
    const maxX = Math.max(0, ...x2s);
    const maxY = Math.max(0, ...y2s);
    return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }, [layout]);

  const fit = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const s = Math.min(el.clientWidth / (bounds.w + 70), el.clientHeight / (bounds.h + 70), 1.15);
    setView({ s, x: (el.clientWidth - bounds.w * s) / 2 - bounds.minX * s, y: (el.clientHeight - bounds.h * s) / 2 - bounds.minY * s });
  }, [bounds]);

  React.useEffect(() => {
    fit();
  }, [layout]);

  // non-passive wheel zoom
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setView((v) => {
        const next = Math.min(2.5, Math.max(0.15, v.s * (1 - e.deltaY * 0.0016)));
        return { s: next, x: sx - ((sx - v.x) / v.s) * next, y: sy - ((sy - v.y) / v.s) * next };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function toggleNode(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function nodeFill(n: MMLayoutNode): string {
    if (n.depth === 0) return "fill-primary";
    if (n.depth === 1) return "fill-primary/12";
    if (n.depth === 2) return "fill-j-violet/10";
    return "fill-muted";
  }
  function nodeStroke(n: MMLayoutNode): string {
    if (n.depth === 0) return "stroke-primary";
    if (n.depth === 1) return "stroke-primary/35";
    if (n.depth === 2) return "stroke-j-violet/30";
    return "stroke-border";
  }

  const wrapLabel = (label: string, w: number, fontSize: number): string[] => {
    const maxChars = Math.max(4, Math.floor((w - 14) / (fontSize * 0.58)));
    const words = (label || "").split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if ((line + " " + word).trim().length > maxChars) {
        if (line) lines.push(line);
        line = word;
        if (lines.length === 3) break;
      } else {
        line = (line + " " + word).trim();
      }
    }
    if (line && lines.length < 3) lines.push(line);
    if (lines.length === 3) {
      const consumed = lines.join(" ").length;
      if (consumed < label.trim().length - 2) lines[2] = lines[2].slice(0, Math.max(0, maxChars - 1)) + "…";
    }
    return lines.length ? lines : ["…"];
  };

  const citationByIndex = (idx?: number) => (idx ? (content.citations || []).find((c) => c.index === idx) : undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-2 border-b border-border/70 bg-card/80 px-4 py-2 backdrop-blur">
        <span className="mr-auto truncate text-[12px] font-bold text-muted-foreground">
          {content.topic ? `Topic: ${content.topic}` : "Whole notebook"} · {layout.nodes.length} nodes
        </span>
        <button onClick={() => setView((v) => ({ ...v, s: Math.max(0.15, v.s - 0.15) }))} aria-label="Zoom out" className="grid size-9 place-items-center rounded-full border border-border text-foreground/80 transition hover:bg-muted active:scale-95">
          <Minus className="size-4" />
        </button>
        <button onClick={fit} aria-label="Fit to screen" className="grid size-9 place-items-center rounded-full border border-border text-foreground/80 transition hover:bg-muted active:scale-95">
          <Maximize2 className="size-4" />
        </button>
        <button onClick={() => setView((v) => ({ ...v, s: Math.min(2.5, v.s + 0.15) }))} aria-label="Zoom in" className="grid size-9 place-items-center rounded-full border border-border text-foreground/80 transition hover:bg-muted active:scale-95">
          <Plus className="size-4" />
        </button>
      </div>

      {/* canvas */}
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-muted/25"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointersRef.current.size === 2) {
            // pinch begins: cancel any pan and remember the world point under the midpoint
            dragRef.current = null;
            setDragging(false);
            const rect = wrapRef.current?.getBoundingClientRect();
            const [a, b] = [...pointersRef.current.values()];
            const v0 = viewRef.current;
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const midX = rect ? (a.x + b.x) / 2 - rect.left : 0;
            const midY = rect ? (a.y + b.y) / 2 - rect.top : 0;
            pinchRef.current = { startDist: dist, startScale: v0.s, wx: (midX - v0.x) / v0.s, wy: (midY - v0.y) / v0.s };
          } else if (pointersRef.current.size === 1) {
            dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
            setDragging(true);
          }
        }}
        onPointerMove={(e) => {
          const p = pointersRef.current.get(e.pointerId);
          if (p) {
            p.x = e.clientX;
            p.y = e.clientY;
          }
          if (pinchRef.current && pointersRef.current.size >= 2) {
            // two-finger pinch: scale around the current midpoint, keeping the
            // original world point anchored under it
            const rect = wrapRef.current?.getBoundingClientRect();
            const [a, b] = [...pointersRef.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const midX = rect ? (a.x + b.x) / 2 - rect.left : 0;
            const midY = rect ? (a.y + b.y) / 2 - rect.top : 0;
            const pinch = pinchRef.current;
            const next = Math.min(2.5, Math.max(0.15, pinch.startScale * (dist / pinch.startDist)));
            setView({ s: next, x: midX - pinch.wx * next, y: midY - pinch.wy * next });
          } else {
            const d = dragRef.current;
            if (!d) return;
            setView((v) => ({ ...v, x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) }));
          }
        }}
        onPointerUp={(e) => {
          pointersRef.current.delete(e.pointerId);
          if (pointersRef.current.size < 2) pinchRef.current = null;
          if (pointersRef.current.size === 0) {
            dragRef.current = null;
            setDragging(false);
          }
        }}
        onPointerCancel={() => {
          pointersRef.current.clear();
          pinchRef.current = null;
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerLeave={(e) => {
          pointersRef.current.delete(e.pointerId);
          pinchRef.current = null;
          dragRef.current = null;
          setDragging(false);
        }}
      >
        <svg className="h-full w-full" style={{ cursor: dragging ? "grabbing" : "grab" }}>
          <g transform={`translate(${view.x},${view.y}) scale(${view.s})`}>
            {/* edges */}
            {layout.edges.map((e, i) => {
              const p1 = nodesById.get(e.from);
              const p2 = nodesById.get(e.to);
              if (!p1 || !p2) return null;
              let d: string;
              if (p2.x >= p1.x + p1.w) {
                const sx = p1.x + p1.w;
                const sy = p1.y + p1.h / 2;
                const ex = p2.x;
                const ey = p2.y + p2.h / 2;
                const dx = Math.max(18, (ex - sx) / 2);
                d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`;
              } else {
                const sx = p1.x + p1.w / 2;
                const sy = p1.y + p1.h;
                const ex = p2.x + p2.w / 2;
                const ey = p2.y;
                const dy = Math.max(16, Math.abs(ey - sy) / 2);
                d = `M ${sx} ${sy} C ${sx} ${sy + dy}, ${ex} ${ey - dy}, ${ex} ${ey}`;
              }
              return <path key={i} d={d} fill="none" strokeWidth={1.6} className="stroke-border" />;
            })}
            {/* nodes */}
            {layout.nodes.map((n) => {
              const fontSize = n.depth === 0 ? 12 : 11;
              const lines = wrapLabel(n.label, n.w, fontSize);
              const startY = n.h / 2 - ((lines.length - 1) * (fontSize + 2)) / 2 + fontSize * 0.36;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  style={{ cursor: "pointer" }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setSelected(n);
                    if (n.hasChildren) toggleNode(n.id);
                  }}
                >
                  <rect width={n.w} height={n.h} rx={10} strokeWidth={n.depth === 0 ? 0 : 1.4} className={cn(nodeFill(n), nodeStroke(n))} />
                  {lines.map((ln, li) => (
                    <text
                      key={li}
                      x={n.w / 2}
                      y={startY + li * (fontSize + 2)}
                      textAnchor="middle"
                      fontSize={fontSize}
                      className={cn(n.depth === 0 ? "fill-white font-bold" : "fill-foreground", n.depth >= 1 && "font-semibold")}
                    >
                      {ln}
                    </text>
                  ))}
                  {n.citationIndex ? (
                    <g
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        const c = citationByIndex(n.citationIndex);
                        if (c) setCites([c]);
                      }}
                    >
                      <circle cx={n.w - 7} cy={7} r={8} className="fill-primary" />
                      <text x={n.w - 7} y={10.5} textAnchor="middle" fontSize={10} className="fill-white font-black">
                        {n.citationIndex}
                      </text>
                    </g>
                  ) : null}
                  {n.collapsed && n.hasChildren ? (
                    <>
                      <circle cx={n.w / 2} cy={n.h + 2} r={9} className="fill-primary stroke-background" strokeWidth={2} />
                      <text x={n.w / 2} y={n.h + 6} textAnchor="middle" fontSize={12} className="fill-white font-black">
                        +
                      </text>
                    </>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        {/* hint */}
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="rounded-full bg-foreground/6 px-3 py-1 text-[10.5px] font-bold text-muted-foreground backdrop-blur">
            Drag to pan · scroll to zoom · tap a node
          </span>
        </div>

        {/* selected node detail */}
        <AnimatePresence>
          {selected ? (
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              className="absolute inset-x-3 bottom-3 z-10 rounded-3xl border border-border bg-card p-4 shadow-2xl"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-black leading-tight text-foreground">{selected.label}</div>
                  {selected.explanation ? <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{selected.explanation}</p> : null}
                  {(() => {
                    const c = citationByIndex(selected.citationIndex);
                    if (!c) return null;
                    return (
                      <button
                        onClick={() => setCites([c])}
                        className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[11.5px] font-bold text-primary transition hover:bg-primary/15 active:scale-95"
                      >
                        <FileText className="size-3.5" /> {c.sourceTitle}
                      </button>
                    );
                  })()}
                </div>
                <button onClick={() => setSelected(null)} aria-label="Close details" className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted">
                  <ChevronDown className="size-4" />
                </button>
              </div>
              {selected.hasChildren ? (
                <button
                  onClick={() => toggleNode(selected.id)}
                  className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-2xl bg-muted text-[13px] font-bold text-foreground transition hover:bg-muted/70 active:scale-[0.99]"
                >
                  {selected.collapsed ? <Plus className="size-4" /> : <Minus className="size-4" />}
                  {selected.collapsed ? "Expand branch" : "Collapse branch"}
                </button>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* exports */}
      <div className="flex flex-wrap gap-2 border-t border-border/70 bg-card/80 px-4 py-2.5 backdrop-blur">
        <ToolBtn icon={Download} label="PNG" busy={busyFmt === "png"} onClick={() => run(a, "png")} />
        <ToolBtn icon={Download} label="SVG" busy={busyFmt === "svg"} onClick={() => run(a, "svg")} />
        <ToolBtn icon={Download} label="JSON" busy={busyFmt === "json"} onClick={() => run(a, "json")} />
      </div>

      <CitationSheet
        open={!!cites}
        onOpenChange={(v) => {
          if (!v) setCites(null);
        }}
        citations={cites || []}
        sources={sources}
        onOpenSource={onOpenSource}
      />
    </div>
  );
}

// =====================================================================
// Report — markdown with citations, edit + print + download
// =====================================================================
function ReportView({ nb, a, content, sources, onOpenSource, refresh }: ViewProps & { content: ReportContent }) {
  const [citesOpen, setCitesOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [md, setMd] = React.useState(content.markdown || "");
  const [busy, setBusy] = React.useState(false);
  const { busyFmt, run } = useExport(nb);
  const typeLabels: Record<string, string> = {
    "study-guide": "Study guide",
    briefing: "Executive briefing",
    summary: "Chapter summary",
    faq: "FAQ",
    glossary: "Glossary",
    "essay-questions": "Essay questions",
    "critical-analysis": "Critical analysis",
    "blog-post": "Blog post",
    "revision-sheet": "Revision sheet",
    custom: "Custom report",
  };

  async function saveEdit() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/jeduai/notebook/${nb}/artifacts/${a.id}`, { method: "PATCH", json: { action: "edit-report", markdown: md } });
      toast.success("Report updated");
      setEditOpen(false);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function exportPdf() {
    const html = reportPrintHtml(a, content);
    if (!printHTML(html)) toast.error("Couldn't open the print dialog");
  }

  return (
    <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4 pb-8">
      <div className="mb-3 flex flex-wrap gap-2">
        <PillSpan tone="primary">{typeLabels[content.type] || content.type}</PillSpan>
        <button
          onClick={() => setCitesOpen(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-muted/70 px-3.5 text-[12.5px] font-semibold text-foreground/80 transition hover:bg-muted"
        >
          <FileText className="size-3.5" /> {content.citations?.length || 0} citations
        </button>
      </div>
      <Card className="p-4">
        <CitedText content={content.markdown || ""} citations={content.citations || []} onCitation={() => setCitesOpen(true)} />
      </Card>

      <div className="mt-3 flex flex-wrap gap-2">
        <ToolBtn
          icon={Pencil}
          label="Edit"
          onClick={() => {
            setMd(content.markdown || "");
            setEditOpen(true);
          }}
        />
        <ToolBtn icon={Download} label="PDF" onClick={exportPdf} />
        <ToolBtn
          icon={Download}
          label=".md"
          busy={busyFmt === "md"}
          onClick={() => {
            downloadBlob(new Blob([content.markdown || ""], { type: "text/markdown;charset=utf-8" }), `${a.title.slice(0, 50) || "report"}.md`);
            toast.success("Markdown downloaded");
          }}
        />
      </div>

      <Sheet open={editOpen} onOpenChange={setEditOpen} title="Edit report">
        <div className="space-y-3 pb-2">
          <p className="text-[12px] text-muted-foreground">Markdown supported. Keep [n] markers to preserve citations.</p>
          <textarea
            value={md}
            onChange={(e) => setMd(e.target.value)}
            rows={14}
            aria-label="Report markdown"
            className="j-app-scroll min-h-48 w-full resize-none rounded-2xl border border-border bg-background p-3.5 font-mono text-[12.5px] leading-relaxed outline-none focus:border-primary/50"
          />
          <button onClick={saveEdit} disabled={busy} className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </Sheet>

      <CitationSheet open={citesOpen} onOpenChange={setCitesOpen} citations={content.citations || []} sources={sources} onOpenSource={onOpenSource} />
    </div>
  );
}

function reportPrintHtml(a: ArtifactDTO, c: ReportContent): string {
  const lines = (c.markdown || "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inList = false;
  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    const inline = escapeHtml(line)
      .replace(/\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, (m) => `<sup style="color:#5B5FEF;font-weight:800;">${m}</sup>`)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.+?)\*/g, "<i>$1</i>");
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      out.push(`<h3 class="jh">${escapeHtml(h[2])}</h3>`);
    } else if (/^[-*•]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul class="jul">');
        inList = true;
      }
      out.push(`<li>${inline.replace(/^[-*•]\s+/, "")}</li>`);
    } else {
      flushList();
      out.push(`<p>${inline}</p>`);
    }
  }
  flushList();
  const cites = (c.citations || [])
    .map((x) => `<li><b>[${x.index}]</b> ${escapeHtml(x.sourceTitle)}${x.page ? ` — page ${x.page}` : ""}</li>`)
    .join("");
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(a.title)}</title><style>
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#fff; color:#202343; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari","Noto Sans Tamil","Noto Sans Arabic","Noto Sans SC",sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { padding: 14mm 13mm 18mm; }
  .brand { display:flex; align-items:center; gap:10px; border-bottom:2.5px solid #5B5FEF; padding-bottom:10px; margin-bottom:14px; }
  .logo { width:34px; height:34px; border-radius:9px; background:linear-gradient(135deg,#5B5FEF,#773DE8); color:#fff; font-weight:900; font-size:20px; display:flex; align-items:center; justify-content:center; }
  .brand h1 { font-size:17px; margin:0; letter-spacing:-0.02em; }
  .brand .sub { font-size:10.5px; color:#6E7091; margin-top:2px; font-weight:600; }
  .pill { display:inline-block; border:1px solid #E4E6F1; background:#F6F7FF; color:#3C3F66; border-radius:999px; padding:3px 11px; font-size:10.5px; font-weight:800; margin:0 6px 6px 0; }
  .jh { font-size:13px; color:#5B5FEF; margin:12px 0 4px; }
  p { font-size:11.5px; line-height:1.62; margin:0 0 7px; }
  .jul { margin:2px 0 8px; padding-left:16px; }
  .jul li { font-size:11.5px; line-height:1.6; margin-bottom:3px; }
  h2.sec { font-size:13.5px; color:#5B5FEF; margin:16px 0 6px; }
  .foot { margin-top:18px; padding-top:8px; border-top:1px solid #E4E6F1; color:#9B9DB8; font-size:9.5px; display:flex; justify-content:space-between; }
  @page { size:A4; margin:0; }
  @media print { .page { padding:12mm 12mm 14mm; } }
  </style></head><body><div class="page">
  <div class="brand"><div class="logo">J</div><div><h1>${escapeHtml(a.title)}</h1><div class="sub">JeduAI Notebook Studio · grounded report</div></div></div>
  <div>${out.join("\n")}</div>
  ${cites ? `<h2 class="sec">Sources</h2><ul class="jul">${cites}</ul>` : ""}
  <div class="foot"><span>Exported from JeduAI · answers grounded in your notebook sources</span><span>${escapeHtml(date)}</span></div>
  </div></body></html>`;
}

// =====================================================================
// Flashcards — flip cards + deep link
// =====================================================================
function FlashcardsView({ a, content, onOpenSource }: ViewProps & { content: FlashcardsContent }) {
  const push = useJedu((s) => s.push);
  const [flipped, setFlipped] = React.useState<Set<number>>(new Set());
  const cards = content.cards || [];
  return (
    <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4 pb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-j-violet/25 bg-j-violet/12 px-3 py-1 text-[12.5px] font-bold text-j-violet">
          {cards.length} cards
        </span>
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-[12.5px] font-bold text-muted-foreground">
          {content.lang || "English"}
        </span>
      </div>
      <button
        onClick={() => push({ name: "flashcards", deck: content.deckKey || `notebook:${a.id}` })}
        className="j-grad-violet mb-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-j-violet/25 transition active:scale-[0.98]"
      >
        <Layers className="size-4.5" /> Open in Flashcards
      </button>
      <p className="mb-3 px-1 text-[11.5px] text-muted-foreground">Saved to your Flashcards decks with spaced repetition · tap a card to flip</p>
      <div className="space-y-2.5">
        {cards.map((c, i) => {
          const isFlipped = flipped.has(i);
          return (
            <button
              key={i}
              onClick={() =>
                setFlipped((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
              className="block w-full text-left"
              aria-label={isFlipped ? "Show question" : "Show answer"}
            >
              <Card className={cn("p-4 transition", isFlipped && "border-j-violet/40 bg-j-violet/5")}>
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10.5px] font-black text-muted-foreground">{i + 1}</span>
                  <span className="text-[10.5px] font-black uppercase tracking-wide text-muted-foreground">{isFlipped ? "Answer" : "Question"}</span>
                  {c.citation ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenSource(c.citation!);
                      }}
                      className="ml-auto inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10.5px] font-bold text-primary"
                    >
                      [{c.citation.index}]
                    </span>
                  ) : null}
                </div>
                <div className={cn("mt-2 text-[14px] font-bold leading-relaxed", isFlipped ? "text-j-violet" : "text-foreground")}>
                  {isFlipped ? c.back : c.front}
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// Quiz — question preview + deep link
// =====================================================================
function QuizView({ a, content, onOpenSource }: ViewProps & { content: QuizContent }) {
  const push = useJedu((s) => s.push);
  const questions = content.questions || [];
  return (
    <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4 pb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PillSpan tone="success">{questions.length} questions</PillSpan>
        <span className="truncate text-[12px] font-bold text-muted-foreground">{content.title || a.title}</span>
      </div>
      <button
        onClick={() => push({ name: "quiz-play", id: content.quizId || a.refId || "" })}
        disabled={!content.quizId && !a.refId}
        className="j-grad-primary mb-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-50"
      >
        <ClipboardCheck className="size-4.5" /> Open in Quizzes
      </button>
      <div className="space-y-2.5">
        {questions.map((q, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-start gap-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[10.5px] font-black text-primary">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold leading-snug text-foreground">{q.question}</div>
                {q.type === "mcq" || q.type === "truefalse" ? (
                  <div className="mt-2 space-y-1.5">
                    {q.options.map((o, oi) => {
                      const correct = oi === q.correctIndex;
                      return (
                        <div
                          key={oi}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px]",
                            correct ? "border-j-success/40 bg-j-success/10 font-bold text-j-success" : "border-border bg-muted/40 text-foreground/80"
                          )}
                        >
                          {correct ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
                          <span className="min-w-0 flex-1">{o}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 rounded-xl border border-j-success/40 bg-j-success/10 px-3 py-2 text-[12.5px] font-bold text-j-success">{q.answerText}</div>
                )}
                {q.explanation ? <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{q.explanation}</p> : null}
                {q.citation ? (
                  <button
                    onClick={() => onOpenSource(q.citation!)}
                    className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[11.5px] font-bold text-primary transition hover:bg-primary/15"
                  >
                    <FileText className="size-3.5" /> Source [{q.citation.index}]
                  </button>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// Infographic — SVG poster + exports + text editing
// =====================================================================
function InfographicView({ nb, a, content, sources, onOpenSource, refresh }: ViewProps & { content: InfographicContent }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [copy, setCopy] = React.useState<InfographicContent | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [citesOpen, setCitesOpen] = React.useState(false);
  const { busyFmt, run } = useExport(nb);
  const svg = React.useMemo(() => {
    try {
      return renderInfographicSVG(content);
    } catch {
      return "";
    }
  }, [content]);
  const sz = (INFOGRAPHIC_SIZES as Record<string, { width?: number; height?: number } | undefined> | undefined)?.[content.aspect];
  const ratio = sz?.width && sz?.height ? sz.width / sz.height : 0.8;
  const aspectLabel = content.aspect === "16:9" ? "Wide 16:9" : content.aspect === "1:1" ? "Square 1:1" : "Portrait 4:5";

  function setBlock(i: number, patch: Record<string, unknown>) {
    setCopy((c) => {
      if (!c) return c;
      const blocks = c.blocks.map((b, bi) => (bi === i ? ({ ...b, ...patch } as typeof b) : b));
      return { ...c, blocks };
    });
  }

  async function saveEdit() {
    if (!copy || busy) return;
    setBusy(true);
    try {
      await api(`/api/jeduai/notebook/${nb}/artifacts/${a.id}`, { method: "PATCH", json: { action: "edit", content: copy } });
      toast.success("Infographic updated");
      setEditOpen(false);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4 pb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PillSpan tone="warning">{aspectLabel}</PillSpan>
        <button
          onClick={() => setCitesOpen(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-muted/70 px-3.5 text-[12.5px] font-semibold text-foreground/80 transition hover:bg-muted"
        >
          <FileText className="size-3.5" /> {content.citations?.length || 0} citations
        </button>
      </div>
      <div className="j-app-scroll overflow-x-auto rounded-2xl border border-border/80 bg-card p-2 shadow-sm">
        <div
          className="mx-auto w-full [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
          style={{ aspectRatio: String(ratio), maxWidth: 720 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ToolBtn icon={Download} label="PNG" busy={busyFmt === "png"} onClick={() => run(a, "png")} />
        <ToolBtn icon={Download} label="PDF" busy={busyFmt === "pdf"} onClick={() => run(a, "pdf")} />
        <ToolBtn icon={Download} label="SVG" busy={busyFmt === "svg"} onClick={() => run(a, "svg")} />
        <ToolBtn
          icon={Pencil}
          label="Edit text"
          onClick={() => {
            setCopy(JSON.parse(JSON.stringify(content)));
            setEditOpen(true);
          }}
        />
      </div>

      <Sheet open={editOpen} onOpenChange={setEditOpen} title="Edit infographic text">
        {!copy ? null : (
          <div className="space-y-3 pb-2">
            <FieldLabel>Title</FieldLabel>
            <input value={copy.title} onChange={(e) => setCopy({ ...copy, title: e.target.value })} className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none focus:border-primary/50" />
            {copy.subtitle !== undefined ? (
              <>
                <FieldLabel>Subtitle</FieldLabel>
                <input value={copy.subtitle || ""} onChange={(e) => setCopy({ ...copy, subtitle: e.target.value })} className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none focus:border-primary/50" />
              </>
            ) : null}
            {copy.blocks.map((b, i) => {
              if (b.type === "stat") {
                return (
                  <div key={i} className="space-y-2 rounded-2xl border border-border/80 p-3">
                    <FieldLabel>Stat {i + 1}</FieldLabel>
                    <input value={b.value} onChange={(e) => setBlock(i, { value: e.target.value })} className="min-h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-primary/50" />
                    <input value={b.label} onChange={(e) => setBlock(i, { label: e.target.value })} className="min-h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-primary/50" />
                    {b.sub !== undefined ? (
                      <input value={b.sub || ""} onChange={(e) => setBlock(i, { sub: e.target.value })} placeholder="Sub-text" className="min-h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-primary/50" />
                    ) : null}
                  </div>
                );
              }
              if (b.type === "facts") {
                return (
                  <div key={i} className="space-y-2 rounded-2xl border border-border/80 p-3">
                    <FieldLabel>{b.title || "Facts"} · one per line</FieldLabel>
                    <textarea
                      value={b.items.join("\n")}
                      onChange={(e) => setBlock(i, { items: e.target.value.split("\n") })}
                      rows={5}
                      className="j-app-scroll min-h-24 w-full resize-none rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-primary/50"
                    />
                  </div>
                );
              }
              if (b.type === "quote") {
                return (
                  <div key={i} className="space-y-2 rounded-2xl border border-border/80 p-3">
                    <FieldLabel>Quote</FieldLabel>
                    <textarea value={b.text} onChange={(e) => setBlock(i, { text: e.target.value })} rows={3} className="j-app-scroll min-h-16 w-full resize-none rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-primary/50" />
                    <input value={b.attribution || ""} onChange={(e) => setBlock(i, { attribution: e.target.value })} placeholder="Attribution" className="min-h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-primary/50" />
                  </div>
                );
              }
              return (
                <div key={i} className="space-y-2 rounded-2xl border border-border/80 p-3">
                  <FieldLabel>{b.type === "timeline" || b.type === "flow" ? "Steps · one per line" : b.title || b.type}</FieldLabel>
                  {b.type === "timeline" ? (
                    <textarea
                      value={b.steps.map((s) => `${s.label}: ${s.text}`).join("\n")}
                      onChange={(e) =>
                        setBlock(i, {
                          steps: e.target.value.split("\n").map((l) => {
                            const [label, ...rest] = l.split(":");
                            return { label: (label || "").trim(), text: rest.join(":").trim() };
                          }),
                        })
                      }
                      rows={4}
                      className="j-app-scroll min-h-20 w-full resize-none rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-primary/50"
                    />
                  ) : b.type === "flow" ? (
                    <textarea
                      value={b.steps.join("\n")}
                      onChange={(e) => setBlock(i, { steps: e.target.value.split("\n") })}
                      rows={4}
                      className="j-app-scroll min-h-20 w-full resize-none rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-primary/50"
                    />
                  ) : (
                    <input value={b.title} onChange={(e) => setBlock(i, { title: e.target.value })} className="min-h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:border-primary/50" />
                  )}
                </div>
              );
            })}
            <button onClick={saveEdit} disabled={busy} className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50">
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </Sheet>

      <CitationSheet open={citesOpen} onOpenChange={setCitesOpen} citations={content.citations || []} sources={sources} onOpenSource={onOpenSource} />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-bold text-muted-foreground">{children}</div>;
}

// =====================================================================
// Slides — navigator + per-slide edit / regenerate + exports
// =====================================================================
function SlidesView({ nb, a, content, sources, onOpenSource, refresh }: ViewProps & { content: SlidesContent }) {
  const [idx, setIdx] = React.useState(0);
  const [editOpen, setEditOpen] = React.useState(false);
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [citesOpen, setCitesOpen] = React.useState(false);
  const { busyFmt, run } = useExport(nb);
  const slides = content.slides || [];
  const cur = slides[Math.min(idx, slides.length - 1)];
  const [edit, setEdit] = React.useState({ title: "", bullets: "", quote: "", notes: "" });

  const svg = React.useMemo(() => {
    if (!cur) return "";
    try {
      return renderSlideSVG({
        title: cur.title,
        bullets: cur.bullets || [],
        quote: cur.quote || undefined,
        index: Math.min(idx, slides.length - 1),
        total: slides.length,
        deckTitle: content.title,
      });
    } catch {
      return "";
    }
  }, [cur, idx, slides.length, content.title]);

  async function saveEdit() {
    if (busy) return;
    setBusy(true);
    try {
      const newSlides = slides.map((s, i) =>
        i === idx
          ? {
              ...s,
              title: edit.title.trim() || s.title,
              bullets: edit.bullets.split("\n").map((x) => x.trim()).filter(Boolean),
              quote: edit.quote.trim() || null,
              notes: edit.notes,
            }
          : s
      );
      await api(`/api/jeduai/notebook/${nb}/artifacts/${a.id}`, { method: "PATCH", json: { action: "edit", content: { ...content, slides: newSlides } } });
      toast.success("Slide updated");
      setEditOpen(false);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function regenSlide() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/jeduai/notebook/${nb}/artifacts/${a.id}`, {
        method: "PATCH",
        json: { action: "regenerate-slide", slideIndex: idx, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) },
      });
      toast.success("Regenerating slide…");
      setRegenOpen(false);
      setInstruction("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!cur) {
    return (
      <div className="px-4 pt-6">
        <EmptyState icon="🖼️" title="No slides" body="This deck is empty." />
      </div>
    );
  }

  return (
    <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4 pb-8">
      <div className="mb-2 flex items-center gap-2">
        <span className="truncate text-[13px] font-bold text-muted-foreground">{content.title || a.title}</span>
        <span className="ml-auto shrink-0 text-[12px] font-bold text-muted-foreground">
          {idx + 1} / {slides.length}
        </span>
      </div>

      {/* slide */}
      <motion.div key={idx} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <div className="aspect-video w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      </motion.div>

      {/* nav */}
      <div className="mt-3 flex items-center justify-center gap-3">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Previous slide" className="grid size-11 place-items-center rounded-full border border-border bg-card text-foreground transition hover:bg-muted active:scale-95 disabled:opacity-40">
          <ChevronLeft className="size-5" />
        </button>
        <div className="flex items-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={cn("h-1.5 rounded-full transition-all", i === idx ? "w-5 j-grad-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50")}
            />
          ))}
        </div>
        <button onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))} disabled={idx >= slides.length - 1} aria-label="Next slide" className="grid size-11 place-items-center rounded-full border border-border bg-card text-foreground transition hover:bg-muted active:scale-95 disabled:opacity-40">
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* speaker notes */}
      <Card className="mt-4 p-4">
        <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wide text-muted-foreground">
          <Sparkles className="size-3.5 text-j-warning" /> Speaker notes
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{cur.notes || "—"}</p>
        {cur.citationIndexes?.length ? (
          <button onClick={() => setCitesOpen(true)} className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[11.5px] font-bold text-primary">
            <FileText className="size-3.5" /> {cur.citationIndexes.length} citations
          </button>
        ) : null}
      </Card>

      {/* actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <ToolBtn
          icon={Pencil}
          label="Edit slide"
          onClick={() => {
            setEdit({ title: cur.title, bullets: (cur.bullets || []).join("\n"), quote: cur.quote || "", notes: cur.notes || "" });
            setEditOpen(true);
          }}
        />
        <ToolBtn icon={RotateCcw} label="Regenerate slide" onClick={() => setRegenOpen(true)} />
        <ToolBtn icon={Download} label="PPTX" busy={busyFmt === "pptx"} onClick={() => run(a, "pptx")} />
        <ToolBtn icon={Download} label="PDF" busy={busyFmt === "pdf"} onClick={() => run(a, "pdf")} />
      </div>

      <Sheet open={editOpen} onOpenChange={setEditOpen} title={`Edit slide ${idx + 1}`}>
        <div className="space-y-3 pb-2">
          <FieldLabel>Title</FieldLabel>
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none focus:border-primary/50" />
          <FieldLabel>Bullets · one per line</FieldLabel>
          <textarea value={edit.bullets} onChange={(e) => setEdit({ ...edit, bullets: e.target.value })} rows={6} className="j-app-scroll min-h-28 w-full resize-none rounded-2xl border border-border bg-background p-3 text-[13px] outline-none focus:border-primary/50" />
          <FieldLabel>Quote (optional)</FieldLabel>
          <input value={edit.quote} onChange={(e) => setEdit({ ...edit, quote: e.target.value })} className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none focus:border-primary/50" />
          <FieldLabel>Speaker notes</FieldLabel>
          <textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} rows={4} className="j-app-scroll min-h-20 w-full resize-none rounded-2xl border border-border bg-background p-3 text-[13px] outline-none focus:border-primary/50" />
          <button onClick={saveEdit} disabled={busy} className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50">
            {busy ? "Saving…" : "Save slide"}
          </button>
        </div>
      </Sheet>

      <Sheet open={regenOpen} onOpenChange={setRegenOpen} title={`Regenerate slide ${idx + 1}`}>
        <div className="space-y-3 pb-2">
          <p className="text-[12.5px] text-muted-foreground">Optional instruction for the AI, e.g. “make it about X with a short quote”.</p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={4}
            placeholder="What should change on this slide?"
            aria-label="Regeneration instruction"
            className="j-app-scroll min-h-20 w-full resize-none rounded-2xl border border-border bg-background p-3 text-[13.5px] outline-none focus:border-primary/50"
          />
          <button onClick={regenSlide} disabled={busy} className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50">
            {busy ? "Regenerating…" : "Regenerate slide"}
          </button>
        </div>
      </Sheet>

      <CitationSheet open={citesOpen} onOpenChange={setCitesOpen} citations={content.citations || []} sources={sources} onOpenSource={onOpenSource} />
    </div>
  );
}

// =====================================================================
// Table — comparison grid with flags, inline edit, CSV export
// =====================================================================
function TableView({ nb, a, content, onOpenSource, refresh }: ViewProps & { content: TableContent }) {
  const [tContent, setTContent] = React.useState(content);
  const [editing, setEditing] = React.useState<{ r: number; c: number } | null>(null);
  const [cellVal, setCellVal] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setTContent(content), [content]);

  async function saveCell(r: number, c: number, val: string) {
    setEditing(null);
    if (!tContent || val === tContent.rows[r].cells[c]) return;
    const rows = tContent.rows.map((row, ri) => (ri === r ? { ...row, cells: row.cells.map((cell, ci) => (ci === c ? val : cell)) } : row));
    setTContent({ ...tContent, rows });
    setBusy(true);
    try {
      await api(`/api/jeduai/notebook/${nb}/artifacts/${a.id}`, { method: "PATCH", json: { action: "edit", content: { ...tContent, rows } } });
      toast.success("Saved");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setTContent(content);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [tContent.columns.map(esc).concat(esc("Source")).join(",")];
    for (const r of tContent.rows) {
      const cite = r.citationIndex ? (tContent.citations || []).find((c) => c.index === r.citationIndex) : undefined;
      lines.push(r.cells.map(esc).concat(esc(cite ? cite.sourceTitle : "")).join(","));
    }
    downloadBlob(new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), `${a.title.slice(0, 50) || "table"}.csv`);
    toast.success("CSV downloaded");
  }

  return (
    <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4 pb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-j-cyan/25 bg-j-cyan/12 px-3 py-1 text-[12.5px] font-bold text-j-cyan">
          {tContent.rows.length} rows × {tContent.columns.length} cols
        </span>
        <span className="text-[11.5px] text-muted-foreground">tap any cell to edit</span>
        {busy ? <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : null}
      </div>
      <div className="j-app-scroll overflow-x-auto rounded-2xl border border-border/80 bg-card">
        <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-muted/60">
              {tContent.columns.map((col, i) => (
                <th key={i} className={cn("px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-wide text-muted-foreground", i === 0 && "sticky left-0 z-10 bg-muted/60 backdrop-blur")}>
                  {col}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right text-[11px] font-black uppercase tracking-wide text-muted-foreground">Src</th>
            </tr>
          </thead>
          <tbody>
            {tContent.rows.map((r, ri) => {
              const cite = r.citationIndex ? (tContent.citations || []).find((c) => c.index === r.citationIndex) : undefined;
              return (
                <tr
                  key={ri}
                  className={cn(
                    "border-t border-border/60",
                    r.flag === "conflict" && "bg-j-warning/8",
                    r.flag === "missing" && "opacity-65"
                  )}
                >
                  {r.cells.map((cell, ci) => (
                    <td key={ci} className={cn("px-3 py-2.5 align-top", ci === 0 && "sticky left-0 z-10 bg-card font-bold text-foreground backdrop-blur", r.flag === "conflict" && ci === 0 && "bg-j-warning/10")}>
                      {editing && editing.r === ri && editing.c === ci ? (
                        <input
                          autoFocus
                          value={cellVal}
                          onChange={(e) => setCellVal(e.target.value)}
                          onBlur={() => saveCell(ri, ci, cellVal)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveCell(ri, ci, cellVal);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="min-h-9 w-full min-w-24 rounded-lg border border-primary/50 bg-background px-2 text-[12.5px] outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setCellVal(cell);
                            setEditing({ r: ri, c: ci });
                          }}
                          className="w-full text-left leading-snug transition hover:text-primary"
                        >
                          {ci === 0 && r.flag ? (
                            <span className="mr-1 inline-flex align-[-2px]">
                              <Flag className={cn("size-3", r.flag === "conflict" ? "text-j-warning" : "text-muted-foreground")} />
                            </span>
                          ) : null}
                          {cell}
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2.5 text-right">
                    {cite ? (
                      <button
                        onClick={() => onOpenSource(cite)}
                        aria-label={`Source ${cite.index}`}
                        className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-primary/25 bg-primary/10 px-1.5 text-[10.5px] font-black text-primary transition hover:bg-primary/20"
                      >
                        {cite.index}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {tContent.notes?.length ? (
        <div className="mt-4 space-y-1.5">
          <h3 className="px-1 text-[13px] font-bold text-foreground">Notes</h3>
          {tContent.notes.map((n, i) => (
            <div key={i} className="flex gap-2 rounded-2xl border border-border/70 bg-muted/30 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-j-warning" />
              <span>{n}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        <ToolBtn icon={Download} label="Export CSV" onClick={exportCsv} />
      </div>
    </div>
  );
}
