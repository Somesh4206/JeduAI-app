"use client";
// JeduAI — Quiz center: AI-generated practice quizzes + mistakes notebook
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Target, Trash2, PlayCircle, NotebookPen, ChevronDown, XCircle, RotateCcw, Trophy, Zap } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, Chip, EmptyState, ErrorState, LangButton, Loader, PillSpan, TopBar, toast } from "../ui";
import { SUBJECTS } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Quiz = {
  id: string;
  title: string;
  subject: string;
  difficulty: string;
  source: string;
  questions: number;
  lastAttempt: { score: number; total: number; mode?: string; at: string } | null;
  createdAt: string;
};

type MissRow = {
  qIdx: number;
  question: string;
  type: string;
  yourAnswer: string;
  correctAnswer: string;
  missedCount: number;
  lastWrongAt: string;
};
type MistakesView = {
  activeTotal: number;
  fixedTotal: number;
  quizzes: { quizId: string; title: string; subject: string; lastAttemptAt: string; active: MissRow[]; redeemedCount: number }[];
};

export default function QuizzesScreen() {
  const push = useJedu((s) => s.push);
  const user = useJedu((s) => s.user)!;
  const [quizzes, setQuizzes] = React.useState<Quiz[] | null>(null);
  const [mistakes, setMistakes] = React.useState<MistakesView | null>(null);
  const [err, setErr] = React.useState("");
  const [reload, setReload] = React.useState(0);
  const [openGroup, setOpenGroup] = React.useState<string | null>(null);

  const [topic, setTopic] = React.useState("");
  const [subject, setSubject] = React.useState<string>(user.subjects?.[0] || "Mathematics");
  const [difficulty, setDifficulty] = React.useState<"easy" | "medium" | "hard">("medium");
  const [count, setCount] = React.useState(5);
  const [lang, setLang] = React.useState(user.explanationLang || "English");
  const [timed, setTimed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    api<{ quizzes: Quiz[] }>("/api/jeduai/quizzes")
      .then((r) => setQuizzes(r.quizzes))
      .catch((e) => setErr((e as Error).message));
    api<MistakesView>("/api/jeduai/quizzes?view=mistakes")
      .then((r) => setMistakes(r))
      .catch(() => setMistakes({ activeTotal: 0, fixedTotal: 0, quizzes: [] }));
  }, []);

  React.useEffect(() => {
    load();
  }, [reload, load]);

  async function generate() {
    if (!topic.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api<{ quizId: string; count: number }>("/api/jeduai/quizzes", {
        method: "POST",
        json: {
          topic: topic.trim(),
          subject,
          difficulty,
          count,
          lang,
          timeLimit: timed ? count * 45 : undefined,
        },
      });
      toast.success(`Quiz ready — ${r.count} questions`);
      setTopic("");
      push({ name: "quiz-play", id: r.quizId });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(qz: Quiz) {
    if (!confirm(`Delete quiz "${qz.title}"?`)) return;
    try {
      await api(`/api/jeduai/quizzes/${qz.id}`, { method: "DELETE" });
      toast.success("Deleted");
      setQuizzes((cur) => (cur ? cur.filter((x) => x.id !== qz.id) : cur));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const inputCls =
    "min-h-12 w-full rounded-2xl border border-border bg-card px-4 text-[15px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-4 focus:ring-primary/10";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Quizzes" subtitle="AI-generated practice, scored instantly" />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {/* generator card */}
        <Card className="overflow-hidden p-0">
          <div className="j-grad-primary flex items-center gap-3 px-4 py-3 text-white">
            <Sparkles className="size-5" />
            <div className="leading-tight">
              <div className="text-[14.5px] font-black">Quiz me on…</div>
              <div className="text-[11.5px] text-white/85">Any topic, any language, three difficulty levels</div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <input
              className={inputCls}
              placeholder="Topic — e.g. Photosynthesis, French verbs, integrals…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
            />
            <div>
              <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Subject</div>
              <div className="flex flex-wrap gap-1.5">
                {SUBJECTS.slice(0, 8).map((s) => (
                  <Chip key={s} active={subject === s} onClick={() => setSubject(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Difficulty</div>
                <div className="flex gap-1.5">
                  {(["easy", "medium", "hard"] as const).map((d) => (
                    <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>
                      {d === "easy" ? "🌱 Easy" : d === "medium" ? "⚖️ Medium" : "🔥 Hard"}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Questions</div>
                <div className="flex gap-1.5">
                  {[3, 5, 8, 10].map((c) => (
                    <Chip key={c} active={count === c} onClick={() => setCount(c)}>
                      {c}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Language</div>
                <LangButton value={lang} onChange={setLang} />
              </div>
              <button
                onClick={() => setTimed(!timed)}
                aria-pressed={timed}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-2xl border px-4 text-[12.5px] font-bold transition",
                  timed ? "border-j-warning/40 bg-j-warning/10 text-j-warning" : "border-border text-muted-foreground"
                )}
              >
                ⏱ Timed {timed ? "on" : "off"}
              </button>
            </div>
            <button
              onClick={generate}
              disabled={busy || !topic.trim()}
              className="j-grad-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? (
                <>
                  <span className="size-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" /> Writing questions…
                </>
              ) : (
                <>
                  <Target className="size-4" /> Generate quiz
                </>
              )}
            </button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Mix of multiple-choice, true/false and short-answer questions. Short answers are graded by keyword
              matching — model answers are always shown. Every attempt earns XP.
            </p>
          </div>
        </Card>

        {/* mistakes notebook */}
        {mistakes ? (
          mistakes.activeTotal > 0 ? (
            <Card className="mt-4 overflow-hidden p-0">
              <div className="flex items-center gap-3 border-b border-border/70 bg-j-warning/5 px-4 py-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-j-warning/15 text-j-warning">
                  <NotebookPen className="size-5" />
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[14.5px] font-black text-foreground">Mistakes notebook</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {mistakes.activeTotal} question{mistakes.activeTotal === 1 ? "" : "s"} to fix across {mistakes.quizzes.length} quiz{mistakes.quizzes.length === 1 ? "" : "zes"}
                    {mistakes.fixedTotal > 0 ? ` · ${mistakes.fixedTotal} fixed 🎉` : ""}
                  </div>
                </div>
              </div>
              <div className="border-b border-border/70 px-4 py-3">
                <button
                  onClick={() => push({ name: "mistake-drill" })}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-j-warning text-[13.5px] font-black text-white shadow-lg shadow-j-warning/25 transition active:scale-[0.98]"
                >
                  <Zap className="size-4" /> Practice all {mistakes.activeTotal} question{mistakes.activeTotal === 1 ? "" : "s"} in one go
                </button>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                  {Object.entries(
                    mistakes.quizzes.reduce<Record<string, number>>((acc, g) => {
                      acc[g.subject] = (acc[g.subject] || 0) + g.active.length;
                      return acc;
                    }, {})
                  )
                    .slice(0, 4)
                    .map(([subject, n]) => (
                      <span key={subject} className="rounded-full bg-j-warning/10 px-2.5 py-0.5 text-[10.5px] font-bold text-j-warning">
                        {subject} ×{n}
                      </span>
                    ))}
                </div>
                <p className="mt-1.5 text-center text-[10.5px] font-semibold text-muted-foreground">
                  One mixed session across every quiz — fixes land straight in the notebook.
                </p>
              </div>
              <div className="divide-y divide-border/60">
                {mistakes.quizzes.map((g) => (
                  <div key={g.quizId}>
                    <button
                      onClick={() => setOpenGroup(openGroup === g.quizId ? null : g.quizId)}
                      aria-expanded={openGroup === g.quizId}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-muted/30"
                    >
                      <ChevronDown
                        className={cn("size-4 shrink-0 text-muted-foreground transition-transform", openGroup === g.quizId && "rotate-180")}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-[13px] font-bold leading-snug text-foreground">{g.title}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {g.subject} · missed {timeAgo(g.lastAttemptAt)}
                        </div>
                      </div>
                      <PillSpan tone="warning">{g.active.length} to fix</PillSpan>
                    </button>
                    <AnimatePresence initial={false}>
                      {openGroup === g.quizId ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-2 bg-muted/20 px-4 pb-3 pt-1">
                            {g.active.map((m) => (
                              <div key={m.qIdx} className="rounded-xl border border-border/70 bg-card p-3">
                                <div className="flex items-start gap-2">
                                  <XCircle className="mt-0.5 size-4 shrink-0 text-j-error" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[12.5px] font-bold leading-snug text-foreground">{m.question}</div>
                                    <div className="mt-1.5 space-y-0.5 text-[11.5px] leading-relaxed">
                                      {m.yourAnswer && m.yourAnswer !== "—" ? (
                                        <div className="text-muted-foreground">
                                          You said: <span className="line-clamp-2 font-semibold text-j-error">{m.yourAnswer}</span>
                                        </div>
                                      ) : null}
                                      <div className="text-muted-foreground">
                                        Answer: <span className="line-clamp-2 font-semibold text-j-success">{m.correctAnswer}</span>
                                      </div>
                                    </div>
                                  </div>
                                  {m.missedCount > 1 ? <PillSpan tone="error">missed ×{m.missedCount}</PillSpan> : null}
                                </div>
                              </div>
                            ))}
                            <button
                              onClick={() => push({ name: "quiz-play", id: g.quizId, mistakes: true })}
                              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-j-warning text-[13px] font-black text-white shadow-lg shadow-j-warning/25 transition active:scale-[0.98]"
                            >
                              <RotateCcw className="size-4" /> Retry these {g.active.length} question{g.active.length === 1 ? "" : "s"}
                            </button>
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </Card>
          ) : mistakes.fixedTotal > 0 ? (
            <Card className="mt-4 flex items-center gap-3 p-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-j-success/15 text-j-success">
                <Trophy className="size-5" />
              </div>
              <div className="leading-tight">
                <div className="text-[14px] font-black text-foreground">Mistakes notebook — all clear! 🎉</div>
                <div className="text-[11.5px] text-muted-foreground">
                  {mistakes.fixedTotal} question{mistakes.fixedTotal === 1 ? "" : "s"} redeemed — keep answering right and it stays empty.
                </div>
              </div>
            </Card>
          ) : null
        ) : null}

        {/* list */}
        <h2 className="mb-2.5 mt-5 px-1 text-[15px] font-bold text-foreground">Your quizzes</h2>
        {err ? <ErrorState message={err} onRetry={load} /> : null}
        {!quizzes && !err ? <Loader label="Loading quizzes…" /> : null}
        {quizzes && !quizzes.length ? (
          <EmptyState icon="🎯" title="No quizzes yet" body="Generate your first quiz above — or create one from any translated video." />
        ) : (
          <div className="space-y-2.5">
            {(quizzes || []).map((qz, i) => (
              <motion.div key={qz.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Card className="p-0 overflow-hidden">
                  <button
                    onClick={() => push({ name: "quiz-play", id: qz.id })}
                    className="w-full p-4 text-left transition hover:bg-muted/30 active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div
                          className={cn(
                            "grid size-11 shrink-0 place-items-center rounded-2xl text-white",
                            qz.lastAttempt ? "bg-j-success" : "j-grad-primary"
                          )}
                        >
                          <PlayCircle className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-bold text-foreground">{qz.title}</div>
                          <div className="text-[11.5px] text-muted-foreground">
                            {qz.subject} · {qz.difficulty} · {qz.questions} Qs
                            {qz.source === "video" ? " · from video" : qz.source === "notebook" ? " · from notebook" : ""}
                          </div>
                        </div>
                      </div>
                      {qz.lastAttempt ? (
                        <div className="shrink-0 text-right">
                          <div className={cn("text-[13px] font-black", qz.lastAttempt.score / Math.max(1, qz.lastAttempt.total) >= 0.6 ? "text-j-success" : "text-j-warning")}>
                            {qz.lastAttempt.mode === "mistakes" ? "↻ " : "✓ "}
                            {qz.lastAttempt.score}/{qz.lastAttempt.total}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {qz.lastAttempt.mode === "mistakes" ? "mistakes retry · " : ""}
                            {timeAgo(qz.lastAttempt.at)}
                          </div>
                        </div>
                      ) : (
                        <PillSpan tone="primary">New</PillSpan>
                      )}
                    </div>
                  </button>
                  <div className="flex border-t border-border/70">
                    <button
                      onClick={() => remove(qz)}
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
