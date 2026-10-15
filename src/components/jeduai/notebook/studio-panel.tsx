"use client";
// JeduAI Notebook Studio — studio panel (generate artifacts, active list)
import React from "react";
import { motion } from "framer-motion";
import { MoreVertical, Pencil, Trash2, X, RotateCcw, Sparkles } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, Chip, EmptyState, ErrorState, LangButton, PillSpan, Sheet, SkeletonList, toast } from "../ui";
import { cn } from "@/lib/utils";
import { SUBJECTS } from "@/lib/jeduai/constants";
import { artifactMeta, isBusyStatus, StripedProgress } from "./shared";
import type { ArtifactDTO, ArtifactKind, SourceDTO } from "@/lib/jeduai/notebook/types";

const REPORT_TYPES: { id: string; label: string }[] = [
  { id: "study-guide", label: "Study guide" },
  { id: "briefing", label: "Executive briefing" },
  { id: "summary", label: "Chapter summary" },
  { id: "faq", label: "FAQ" },
  { id: "glossary", label: "Glossary" },
  { id: "essay-questions", label: "Essay questions" },
  { id: "critical-analysis", label: "Critical analysis" },
  { id: "blog-post", label: "Blog post" },
  { id: "revision-sheet", label: "Revision sheet" },
  { id: "custom", label: "Custom" },
];

const KIND_ORDER: ArtifactKind[] = [
  "audio-overview",
  "video-overview",
  "mindmap",
  "report",
  "flashcards",
  "quiz",
  "infographic",
  "slides",
  "table",
];

export function StudioPanel({
  notebookId,
  sources,
  artifacts,
  total,
  loading,
  err,
  onRetry,
  onChanged,
  onLoadMore,
  onOpenArtifact,
}: {
  notebookId: string;
  sources: SourceDTO[] | null;
  artifacts: ArtifactDTO[];
  total: number;
  loading: boolean;
  err: string;
  onRetry: () => void;
  onChanged: () => void;
  onLoadMore: () => void;
  onOpenArtifact: (a: ArtifactDTO) => void;
}) {
  const user = useJedu((s) => s.user)!;
  const [cfgKind, setCfgKind] = React.useState<ArtifactKind | null>(null);
  const [menuFor, setMenuFor] = React.useState<ArtifactDTO | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [generating, setGenerating] = React.useState(false);

  // config sheet state
  const [topic, setTopic] = React.useState("");
  const [lang, setLang] = React.useState(user.explanationLang || "English");
  const [format, setFormat] = React.useState("deepdive");
  const [audience, setAudience] = React.useState("");
  const [goals, setGoals] = React.useState("");
  const [scenes, setScenes] = React.useState(5);
  const [reportType, setReportType] = React.useState("study-guide");
  const [customInstr, setCustomInstr] = React.useState("");
  const [fcCount, setFcCount] = React.useState(10);
  const [qzCount, setQzCount] = React.useState(6);
  const [qzDifficulty, setQzDifficulty] = React.useState("Medium");
  const [qzSubject, setQzSubject] = React.useState(user.subjects?.[0] || SUBJECTS[0]);
  const [aspect, setAspect] = React.useState<"4:5" | "1:1" | "16:9">("4:5");
  const [slideCount, setSlideCount] = React.useState(6);

  const selectedReady = (sources || []).filter((s) => s.selected && s.status === "ready").length;
  const readyCount = (sources || []).filter((s) => s.status === "ready").length;

  function openConfig(kind: ArtifactKind) {
    setTopic("");
    setAudience("");
    setGoals("");
    setCustomInstr("");
    setCfgKind(kind);
  }

  async function generate() {
    if (!cfgKind || generating) return;
    let config: Record<string, unknown>;
    switch (cfgKind) {
      case "audio-overview":
        config = { topic, lang, format, audience, goals };
        break;
      case "video-overview":
        config = { topic, lang, scenes, audience };
        break;
      case "mindmap":
        config = { topic, lang };
        break;
      case "report":
        config = { topic, lang, type: reportType, ...(reportType === "custom" && customInstr.trim() ? { instructions: customInstr.trim() } : {}) };
        break;
      case "flashcards":
        config = { topic, lang, count: fcCount };
        break;
      case "quiz":
        config = { topic, lang, count: qzCount, difficulty: qzDifficulty, subject: qzSubject };
        break;
      case "infographic":
        config = { topic, lang, aspect };
        break;
      case "slides":
        config = { topic, lang, count: slideCount, audience };
        break;
      case "table":
        config = { topic, lang };
        break;
      default:
        config = { topic, lang };
    }
    setGenerating(true);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/artifacts`, { method: "POST", json: { kind: cfgKind, config } });
      toast.success("Generating…", { description: `${artifactMeta(cfgKind).label} is being created from your sources.` });
      setCfgKind(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function artifactAction(a: ArtifactDTO, json: Record<string, unknown>, okMsg?: string) {
    if (busyId) return;
    setBusyId(a.id);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/artifacts/${a.id}`, { method: "PATCH", json });
      if (okMsg) toast.success(okMsg);
      setMenuFor(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteArtifact(a: ArtifactDTO) {
    if (!confirm(`Delete "${a.title}"?`)) return;
    setBusyId(a.id);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/artifacts/${a.id}`, { method: "DELETE" });
      toast.success("Deleted");
      setMenuFor(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="j-app-scroll flex-1 overflow-y-auto px-3.5 py-3 pb-8">
        {/* generate */}
        <div className="mb-2 flex items-center gap-2 px-1">
          <Sparkles className="size-4 text-j-violet" />
          <h2 className="text-[15px] font-bold tracking-tight text-foreground">Generate</h2>
          <span className="ml-auto text-[11px] font-semibold text-muted-foreground">
            {selectedReady > 0 ? `${selectedReady} selected source${selectedReady === 1 ? "" : "s"}` : readyCount > 0 ? `${readyCount} ready source${readyCount === 1 ? "" : "s"}` : "add sources first"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {KIND_ORDER.map((kind, i) => {
            const m = artifactMeta(kind);
            return (
              <motion.button
                key={kind}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => openConfig(kind)}
                disabled={readyCount === 0}
                className="j-shadow-soft flex min-h-24 flex-col items-start gap-1 rounded-2xl border border-border/70 bg-card p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/40 active:scale-[0.97] disabled:opacity-45 disabled:hover:translate-y-0"
              >
                <span className={cn("grid size-9 place-items-center rounded-xl", m.tint)}>
                  <m.icon className="size-4.5" />
                </span>
                <span className="text-[12.5px] font-bold leading-tight text-foreground">{m.label}</span>
                <span className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">{m.blurb}</span>
              </motion.button>
            );
          })}
        </div>

        {/* active & recent */}
        <div className="mb-2 mt-5 flex items-center gap-2 px-1">
          <h2 className="text-[15px] font-bold tracking-tight text-foreground">Active & recent</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{total}</span>
        </div>
        {err && !artifacts.length ? (
          <ErrorState message={err} onRetry={onRetry} />
        ) : loading && !artifacts.length ? (
          <SkeletonList rows={3} />
        ) : !artifacts.length ? (
          <EmptyState
            icon="🎨"
            title="No artifacts yet"
            body="Generate an audio overview, mind map, report, quiz and more from your sources — they'll appear here."
          />
        ) : (
          <div className="space-y-2.5">
            {artifacts.map((a, i) => {
              const m = artifactMeta(a.kind);
              const busy = isBusyStatus(a.status);
              return (
                <motion.div key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.025, 0.3) }}>
                  <Card className="overflow-hidden p-0">
                    <div
                      role={a.status === "ready" ? "button" : undefined}
                      onClick={a.status === "ready" ? () => onOpenArtifact(a) : undefined}
                      className={cn("flex w-full items-start gap-3 p-3.5", a.status === "ready" && "cursor-pointer transition hover:bg-muted/30 active:scale-[0.99]")}
                    >
                      <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl", m.tint)}>
                        <m.icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-bold text-foreground">{a.title}</span>
                          <PillSpan
                            tone={a.status === "ready" ? "success" : a.status === "failed" ? "error" : a.status === "cancelled" ? "muted" : "primary"}
                            className="shrink-0 px-2 py-0.5 text-[10.5px]"
                          >
                            {a.status === "ready" ? "Ready" : a.status === "failed" ? "Failed" : a.status === "cancelled" ? "Cancelled" : a.status === "processing" ? "Generating" : "Queued"}
                          </PillSpan>
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                          {m.label} · from {a.sourceIds.length} source{a.sourceIds.length === 1 ? "" : "s"} · {timeAgo(a.createdAt)}
                        </span>
                        {busy ? (
                          <span className="mt-2 block">
                            <StripedProgress value={a.progress || 0} />
                            <span className="mt-1 block text-[10.5px] font-bold text-muted-foreground">{a.progress || 0}%</span>
                          </span>
                        ) : null}
                        {a.status === "failed" ? <span className="mt-1.5 block line-clamp-2 text-[11.5px] font-semibold leading-snug text-j-error">{a.error || "Generation failed"}</span> : null}
                      </span>
                      {busy ? (
                        <button
                          onClick={() => artifactAction(a, { action: "cancel" }, "Cancelling…")}
                          disabled={busyId === a.id}
                          aria-label={`Cancel ${a.title}`}
                          className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-j-error/10 hover:text-j-error active:scale-90 disabled:opacity-50"
                        >
                          {busyId === a.id ? <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : <X className="size-4.5" />}
                        </button>
                      ) : null}
                    </div>
                    {!busy ? (
                      <div className="flex border-t border-border/70">
                        {a.status === "failed" || a.status === "cancelled" ? (
                          <button
                            onClick={() => artifactAction(a, { action: "retry" }, "Retrying…")}
                            disabled={busyId === a.id}
                            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-primary transition hover:bg-primary/5 disabled:opacity-50"
                          >
                            <RotateCcw className="size-3.5" /> Retry
                          </button>
                        ) : null}
                        <button
                          onClick={() => {
                            setRenameVal(a.title);
                            setMenuFor(a);
                          }}
                          aria-label={`Options for ${a.title}`}
                          className={cn(
                            "grid min-h-10 w-12 place-items-center text-muted-foreground transition hover:text-foreground",
                            (a.status === "failed" || a.status === "cancelled") && "border-l border-border/70"
                          )}
                        >
                          <MoreVertical className="size-4" />
                        </button>
                      </div>
                    ) : null}
                  </Card>
                </motion.div>
              );
            })}
            {artifacts.length < total ? (
              <button
                onClick={onLoadMore}
                disabled={loading}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border text-[13px] font-bold text-primary transition hover:bg-primary/5 disabled:opacity-50"
              >
                {loading ? <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : null}
                Load more ({artifacts.length} of {total})
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* config sheet */}
      <Sheet open={!!cfgKind} onOpenChange={(v) => !v && setCfgKind(null)} title={cfgKind ? `New ${artifactMeta(cfgKind).label.toLowerCase()}` : ""}>
        {cfgKind ? (
          <div className="space-y-3.5 pb-2">
            <div>
              <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">
                Topic or focus <span className="font-normal">(optional — leave empty for the whole notebook)</span>
              </div>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={140}
                placeholder={cfgKind === "mindmap" ? "e.g. Photosynthesis" : "e.g. Main arguments of chapter 3"}
                aria-label="Topic"
                className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
              />
            </div>

            {cfgKind === "audio-overview" ? (
              <>
                <Field>
                  <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Format</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "deepdive", label: "Deep dive" },
                      { id: "brief", label: "Brief" },
                      { id: "critique", label: "Critique" },
                      { id: "debate", label: "Debate" },
                    ].map((f) => (
                      <Chip key={f.id} active={format === f.id} onClick={() => setFormat(f.id)}>
                        {f.label}
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-2 text-[11.5px] text-muted-foreground">≈2–4 min podcast · two AI hosts</p>
                </Field>
                <input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  maxLength={80}
                  placeholder="Audience (e.g. Class 10 student)"
                  aria-label="Audience"
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
                />
                <input
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                  maxLength={160}
                  placeholder="Learning goals (e.g. master the nitrogen cycle)"
                  aria-label="Learning goals"
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
                />
              </>
            ) : null}

            {cfgKind === "video-overview" ? (
              <>
                <Field>
                  <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Scenes</div>
                  <div className="flex flex-wrap gap-2">
                    {[3, 4, 5, 6, 7, 8].map((n) => (
                      <Chip key={n} active={scenes === n} onClick={() => setScenes(n)}>
                        {n}
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-2 text-[11.5px] text-muted-foreground">Narrated slideshow video (1–3 min)</p>
                </Field>
                <input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  maxLength={80}
                  placeholder="Audience (optional)"
                  aria-label="Audience"
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
                />
              </>
            ) : null}

            {cfgKind === "report" ? (
              <>
                <Field>
                  <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Report type</div>
                  <div className="flex flex-wrap gap-2">
                    {REPORT_TYPES.map((t) => (
                      <Chip key={t.id} active={reportType === t.id} onClick={() => setReportType(t.id)}>
                        {t.label}
                      </Chip>
                    ))}
                  </div>
                </Field>
                {reportType === "custom" ? (
                  <textarea
                    value={customInstr}
                    onChange={(e) => setCustomInstr(e.target.value)}
                    rows={4}
                    maxLength={600}
                    placeholder="What should the report cover? (e.g. compare all dates and events, end with practice questions)"
                    aria-label="Custom instructions"
                    className="j-app-scroll min-h-24 w-full resize-none rounded-2xl border border-border bg-background p-3 text-[13.5px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
                  />
                ) : null}
              </>
            ) : null}

            {cfgKind === "flashcards" ? (
              <Field>
                <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Number of cards</div>
                <div className="flex flex-wrap gap-2">
                  {[4, 6, 8, 10, 12, 16, 20].map((n) => (
                    <Chip key={n} active={fcCount === n} onClick={() => setFcCount(n)}>
                      {n}
                    </Chip>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-muted-foreground">Saves into your Flashcards with spaced repetition</p>
              </Field>
            ) : null}

            {cfgKind === "quiz" ? (
              <>
                <Field>
                  <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Questions</div>
                  <div className="flex flex-wrap gap-2">
                    {[3, 5, 6, 8, 10, 12].map((n) => (
                      <Chip key={n} active={qzCount === n} onClick={() => setQzCount(n)}>
                        {n}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field>
                  <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Difficulty</div>
                  <div className="flex flex-wrap gap-2">
                    {["Easy", "Medium", "Hard"].map((d) => (
                      <Chip key={d} active={qzDifficulty === d} onClick={() => setQzDifficulty(d)}>
                        {d}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field>
                  <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Subject</div>
                  <div className="j-app-scroll flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                    {SUBJECTS.map((s) => (
                      <Chip key={s} active={qzSubject === s} onClick={() => setQzSubject(s)} className="min-h-8 px-3 text-[12px]">
                        {s}
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-2 text-[11.5px] text-muted-foreground">Opens in Quizzes with mistakes tracking</p>
                </Field>
              </>
            ) : null}

            {cfgKind === "infographic" ? (
              <Field>
                <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Aspect ratio</div>
                <div className="flex flex-wrap gap-2">
                  <Chip active={aspect === "4:5"} onClick={() => setAspect("4:5")}>
                    Portrait 4:5
                  </Chip>
                  <Chip active={aspect === "1:1"} onClick={() => setAspect("1:1")}>
                    Square 1:1
                  </Chip>
                  <Chip active={aspect === "16:9"} onClick={() => setAspect("16:9")}>
                    Wide 16:9
                  </Chip>
                </div>
              </Field>
            ) : null}

            {cfgKind === "slides" ? (
              <>
                <Field>
                  <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Slides</div>
                  <div className="flex flex-wrap gap-2">
                    {[4, 5, 6, 8, 10, 12].map((n) => (
                      <Chip key={n} active={slideCount === n} onClick={() => setSlideCount(n)}>
                        {n}
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-2 text-[11.5px] text-muted-foreground">Export to PPTX & PDF</p>
                </Field>
                <input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  maxLength={80}
                  placeholder="Audience (optional)"
                  aria-label="Audience"
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-3.5 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
                />
              </>
            ) : null}

            {cfgKind === "table" ? (
              <p className="rounded-2xl border border-border/80 bg-muted/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
                Extracts comparable facts across your sources into one table — conflicting values are flagged so you can see where sources disagree.
              </p>
            ) : null}

            {/* language + sources note */}
            <div>
              <div className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">Language</div>
              <LangButton value={lang} onChange={setLang} />
            </div>
            <p className="text-[11.5px] font-semibold text-muted-foreground">
              {selectedReady > 0 ? `Uses ${selectedReady} selected source${selectedReady === 1 ? "" : "s"}` : `Uses all ${readyCount} ready source${readyCount === 1 ? "" : "s"}`}
            </p>
            <button
              onClick={generate}
              disabled={generating}
              className="j-grad-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-[0.99] disabled:opacity-50"
            >
              {generating ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Sparkles className="size-4" />}
              {generating ? "Starting…" : "Generate"}
            </button>
          </div>
        ) : null}
      </Sheet>

      {/* artifact menu */}
      <Sheet open={!!menuFor} onOpenChange={(v) => !v && setMenuFor(null)} title={menuFor?.title}>
        <div className="space-y-1.5 pb-2">
          {menuFor ? (
            <>
              <button
                onClick={() => {
                  setMenuFor(null);
                  onOpenArtifact(menuFor);
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold text-foreground transition hover:bg-muted"
              >
                <Sparkles className="size-4.5" /> Open
              </button>
              <button
                onClick={() => setRenameOpen(true)}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold text-foreground transition hover:bg-muted"
              >
                <Pencil className="size-4.5" /> Rename
              </button>
              <button
                onClick={() => deleteArtifact(menuFor)}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold text-j-error transition hover:bg-j-error/8"
              >
                <Trash2 className="size-4.5" /> Delete
              </button>
            </>
          ) : null}
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
            onClick={() => menuFor && artifactAction(menuFor, { action: "rename", title: renameVal.trim() }, "Renamed").then(() => setRenameOpen(false))}
            disabled={!renameVal.trim()}
            className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
