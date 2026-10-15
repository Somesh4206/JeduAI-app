"use client";
// JeduAI — Media translation: list + create
import React from "react";
import { motion } from "framer-motion";
import { Clapperboard, FileText, Loader2, Music4, Subtitles, Trash2, PlayCircle } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, EmptyState, ErrorState, LangButton, ProgressBar, StatusPillSpan, TopBar, toast, Segmented } from "../ui";
import { MEDIA_LIMITS } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Vid = {
  id: string;
  title: string;
  kind: "audio" | "video" | "transcript";
  sourceLang: string;
  targetLang: string;
  status: string;
  progress: number;
  durationSec: number;
  hasFile: boolean;
  segments: number;
  segmentsTranslated: number;
  error: string | null;
  updatedAt: string;
};

export default function VideoScreen() {
  const push = useJedu((s) => s.push);
  const pop = useJedu((s) => s.pop);
  const user = useJedu((s) => s.user)!;
  const [vids, setVids] = React.useState<Vid[] | null>(null);
  const [err, setErr] = React.useState("");
  const [reload, setReload] = React.useState(0);

  const [tab, setTab] = React.useState<"media" | "transcript">("media");
  const [from, setFrom] = React.useState("English");
  const [to, setTo] = React.useState(user.explanationLang || "Hindi");
  const [file, setFile] = React.useState<File | null>(null);
  const [transcript, setTranscript] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    api<{ videos: Vid[] }>("/api/jeduai/video")
      .then((r) => setVids(r.videos))
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(() => {
      setVids((cur) => {
        if (cur?.some((v) => ["extracting", "transcribing", "translating"].includes(v.status))) load();
        return cur;
      });
    }, 2500);
    return () => clearInterval(t);
  }, [reload, load]);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("sourceLang", from);
      fd.set("targetLang", to);
      if (title.trim()) fd.set("title", title.trim());
      if (tab === "media") {
        if (!file) {
          toast.error("Choose an audio or video file first");
          return;
        }
        if (file.size > MEDIA_LIMITS.maxMB * 1024 * 1024) {
          toast.error(`Too large — max ${MEDIA_LIMITS.maxMB} MB`);
          return;
        }
        fd.set("file", file);
      } else {
        if (!transcript.trim()) {
          toast.error("Paste a transcript or subtitle file first");
          return;
        }
        fd.set("transcript", transcript.slice(0, 200000));
      }
      const r = await api<{ video: { id: string; status: string; untimed?: boolean } }>("/api/jeduai/video", {
        method: "POST",
        body: fd,
      });
      if (r.video.untimed) toast.info("No timestamps found — treating as an untimed transcript.");
      else toast.success(tab === "media" ? "Upload started — extracting audio…" : "Transcript accepted — translating…");
      setFile(null);
      setTranscript("");
      setTitle("");
      setReload(reload + 1);
      push({ name: "video-studio", id: r.video.id });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: Vid) {
    if (!confirm(`Delete "${v.title}"? The upload and translation are removed too.`)) return;
    try {
      await api(`/api/jeduai/video/${v.id}`, { method: "DELETE" });
      toast.success("Deleted");
      setVids((cur) => (cur ? cur.filter((x) => x.id !== v.id) : cur));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const inputCls =
    "min-h-11 w-full rounded-2xl border border-border bg-card px-4 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-4 focus:ring-primary/10";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title="Media Studio"
        subtitle={`Audio & video translation — up to ${MEDIA_LIMITS.maxMB} MB`}
      />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <Card className="overflow-hidden p-0">
          <div
            className="flex items-center gap-3 px-4 py-3 text-white"
            style={{ background: "linear-gradient(135deg,#F5A623,#E85D75)" }}
          >
            <Clapperboard className="size-5" />
            <div className="leading-tight">
              <div className="text-[14.5px] font-black">Translate a lecture or recording</div>
              <div className="text-[11.5px] text-white/85">
                Real pipeline: ffmpeg audio extraction → AI speech-to-text → translation
              </div>
            </div>
          </div>

          <div className="p-4">
            <Segmented
              value={tab}
              onChange={setTab}
              className="mb-3"
              options={[
                { value: "media", label: "🎬 Media file" },
                { value: "transcript", label: "📝 Transcript / Subtitles" },
              ]}
            />

            {tab === "media" ? (
              <>
                <label>
                  <input
                    type="file"
                    accept="audio/*,video/*,.mp4,.webm,.mov,.mkv,.avi,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                    className="hidden"
                    id="media-file"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  <div
                    onClick={() => document.getElementById("media-file")?.click()}
                    className={cn(
                      "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-4 text-center transition",
                      file ? "border-j-success/50 bg-j-success/5" : "border-border hover:border-primary/50 hover:bg-primary/5"
                    )}
                  >
                    {file ? (
                      <>
                        {file.type.startsWith("video") ? (
                          <PlayCircle className="size-7 text-j-success" />
                        ) : (
                          <Music4 className="size-7 text-j-success" />
                        )}
                        <span className="text-[13px] font-bold text-foreground">{file.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {Math.round(file.size / 1024 / 1024 * 10) / 10} MB · tap to change
                        </span>
                      </>
                    ) : (
                      <>
                        <Clapperboard className="size-7 text-muted-foreground" />
                        <span className="text-[13px] font-bold text-foreground">Choose an audio or video file</span>
                        <span className="text-[11px] text-muted-foreground">
                          Lecture recordings, explainer videos, podcasts — {MEDIA_LIMITS.maxMB} MB max
                        </span>
                      </>
                    )}
                  </div>
                </label>
              </>
            ) : (
              <>
                <label className="mb-2 block">
                  <input
                    type="file"
                    accept=".srt,.vtt,.txt"
                    className="hidden"
                    id="sub-file"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 1024 * 1024) {
                        toast.error("Subtitle file too large (1 MB max)");
                        return;
                      }
                      const text = await f.text();
                      setTranscript(text.slice(0, 200000));
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => document.getElementById("sub-file")?.click()}
                      className="flex min-h-11 items-center gap-2 rounded-2xl border border-border bg-card px-4 text-[13px] font-bold text-foreground transition hover:border-primary/50"
                    >
                      <Subtitles className="size-4 text-primary" /> Upload .srt / .vtt / .txt
                    </button>
                  </div>
                </label>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value.slice(0, 200000))}
                  rows={4}
                  placeholder={"Paste a transcript or subtitles here.\nTimestamped formats (SRT/VTT) keep timing — plain text is treated as untimed."}
                  className="j-app-scroll min-h-28 w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-[13.5px] leading-relaxed outline-none focus:border-primary/50"
                />
                <div className="mt-1 text-right text-[11px] text-muted-foreground">{transcript.length}/200000</div>
              </>
            )}

            <input
              className={cn(inputCls, "mt-3")}
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={90}
            />

            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Spoken language</div>
                <LangButton value={from} onChange={setFrom} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-right text-[11px] font-black uppercase tracking-wider text-muted-foreground">Translate to</div>
                <div className="flex justify-end">
                  <LangButton value={to} onChange={setTo} />
                </div>
              </div>
            </div>

            <button
              onClick={create}
              disabled={busy}
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14.5px] font-black text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#F5A623,#E85D75)" }}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Starting…
                </>
              ) : tab === "media" ? (
                <>
                  <Clapperboard className="size-4" /> Upload & translate
                </>
              ) : (
                <>
                  <FileText className="size-4" /> Translate transcript
                </>
              )}
            </button>
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
              How it works: we extract the audio track, split it on natural speech pauses, transcribe each chunk with
              AI speech recognition, then translate. Timestamps come from real audio timings. Only upload content you
              have the right to use.
            </p>
          </div>
        </Card>

        <h2 className="mb-2.5 mt-5 px-1 text-[15px] font-bold text-foreground">Your projects</h2>
        {err ? <ErrorState message={err} onRetry={load} /> : null}
        {!vids && !err ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : !vids?.length ? (
          <EmptyState
            icon="🎬"
            title="No media projects yet"
            body="Upload a lecture recording, or paste subtitles/transcripts to translate them with timestamps."
          />
        ) : (
          <div className="space-y-2.5">
            {vids.map((v, i) => (
              <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Card className="p-0 overflow-hidden">
                  <button
                    onClick={() => push({ name: "video-studio", id: v.id })}
                    className="w-full p-4 text-left transition hover:bg-muted/30 active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div
                          className={cn(
                            "grid size-11 shrink-0 place-items-center rounded-2xl text-white",
                            v.status === "completed" ? "bg-j-success" : v.status === "failed" ? "bg-j-error" : "j-grad-primary"
                          )}
                        >
                          {v.kind === "transcript" ? <Subtitles className="size-5" /> : v.kind === "audio" ? <Music4 className="size-5" /> : <PlayCircle className="size-5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-bold text-foreground">{v.title}</div>
                          <div className="text-[11.5px] text-muted-foreground">
                            {v.sourceLang} → {v.targetLang} · {v.kind}
                            {v.durationSec ? ` · ${Math.floor(v.durationSec / 60)}:${String(Math.floor(v.durationSec % 60)).padStart(2, "0")}` : ""}
                          </div>
                        </div>
                      </div>
                      <StatusPillSpan status={v.status} />
                    </div>
                    {["extracting", "transcribing", "translating"].includes(v.status) ? (
                      <div className="mt-2.5">
                        <ProgressBar value={v.progress} />
                        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                          <span>{v.status}</span>
                          <span className="font-bold text-primary">{v.progress}%</span>
                        </div>
                      </div>
                    ) : null}
                    {v.status === "completed" ? (
                      <div className="mt-2 text-[11.5px] font-bold text-j-success">
                        ✓ {v.segmentsTranslated} segments · {timeAgo(v.updatedAt)}
                      </div>
                    ) : null}
                    {v.status === "failed" ? (
                      <div className="mt-2 line-clamp-2 rounded-xl bg-j-error/10 px-3 py-2 text-[11.5px] leading-snug text-j-error">
                        ⚠️ {v.error || "Processing failed — open to retry."}
                      </div>
                    ) : null}
                  </button>
                  <div className="flex border-t border-border/70">
                    <button
                      onClick={() => remove(v)}
                      className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-j-error"
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
