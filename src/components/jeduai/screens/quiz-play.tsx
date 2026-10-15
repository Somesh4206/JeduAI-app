"use client";
// JeduAI — quiz player + results
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, ArrowRight, CheckCircle2, XCircle, RotateCcw, Home, Lightbulb, Timer } from "lucide-react";
import { api, useJedu } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, ProgressBar, TopBar, toast } from "../ui";
import { cn } from "@/lib/utils";

type Q = {
  id: string;
  idx: number;
  type: "mcq" | "truefalse" | "short";
  question: string;
  options: string[];
  correctIndex: number | null;
  answerText: string | null;
  explanation: string | null;
  keywords: string[];
};
type QDetail = {
  quiz: { id: string; title: string; subject: string; difficulty: string; timeLimit: number | null };
  questions: Q[];
  attempts: { id: string; score: number; total: number; at: string }[];
};
type Result = {
  score: number;
  total: number;
  mode?: string;
  results: {
    qIdx: number;
    type: string;
    yourAnswer: string;
    correctAnswer?: string;
    modelAnswer?: string;
    correct: boolean;
    explanation: string;
    keywordFeedback?: { hits: string[]; need: number; total: number };
  }[];
  gamified?: { points: number; gained: number };
};

export default function QuizPlay({ id, mistakes }: { id: string; mistakes?: boolean }) {
  const pop = useJedu((s) => s.pop);
  const popToRoot = useJedu((s) => s.popToRoot);
  const [data, setData] = React.useState<QDetail | null>(null);
  const [err, setErr] = React.useState("");
  const [phase, setPhase] = React.useState<"play" | "sending" | "result">("play");
  const [result, setResult] = React.useState<Result | null>(null);

  // answers state
  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<number, { choice?: number; text?: string }>>({});
  const [shortDraft, setShortDraft] = React.useState("");
  const [left, setLeft] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    api<QDetail>(`/api/jeduai/quizzes/${id}${mistakes ? "?mistakes=1" : ""}`)
      .then((r) => {
        setData(r);
        // no timer pressure on a mistakes retry — it's about learning, not speed
        setLeft(mistakes ? null : r.quiz.timeLimit || null);
      })
      .catch((e) => setErr((e as Error).message));
  }, [id, mistakes]);

  React.useEffect(() => {
    load();
  }, [load]);

  // timer
  const submit = React.useCallback(
    async () => {
      if (phase !== "play" || !data) return;
      const qs = data.questions;
      const cur = qs[step];
      const finalAnswers = { ...answers };
      if (cur?.type === "short" && shortDraft.trim() && !finalAnswers[cur.idx]?.text) {
        finalAnswers[cur.idx] = { ...finalAnswers[cur.idx], text: shortDraft };
      }
      setPhase("sending");
      try {
        const payload = qs.map((x) => {
          const a = finalAnswers[x.idx] || {};
          return { qIdx: x.idx, choice: typeof a.choice === "number" ? a.choice : null, text: a.text || "" };
        });
        const r = await api<Result>(`/api/jeduai/quizzes/${id}/attempt`, {
          method: "POST",
          json: { answers: payload, ...(mistakes ? { mode: "mistakes" } : {}) },
        });
        setResult(r);
        setPhase("result");
        if (r.gamified?.gained) toast.success(`+${r.gamified.gained} XP earned! ⚡`);
      } catch (e) {
        toast.error((e as Error).message);
        setPhase("play");
      }
    },
    [phase, data, step, answers, shortDraft, id, mistakes]
  );

  React.useEffect(() => {
    if (phase !== "play" || left === null) return;
    if (left <= 0) {
      submit();
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, phase, submit]);

  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Quiz" />
        <div className="p-4">
          <ErrorState message={err} onRetry={load} />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Quiz" />
        <Loader label="Loading quiz…" />
      </div>
    );
  }
  if (!data.questions.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title={data.quiz.title} />
        <div className="p-4">
          <EmptyState icon="🎉" title="Nothing left to fix!" body="You've already answered every question in this quiz correctly — the mistakes notebook is all caught up." />
        </div>
      </div>
    );
  }

  const qs = data.questions;
  const q = qs[step];
  const answeredCount = qs.filter((x) => answers[x.idx] && (answers[x.idx].choice !== undefined || (answers[x.idx].text || "").trim())).length;

  function setChoice(choice: number) {
    setAnswers((a) => ({ ...a, [q.idx]: { ...a[q.idx], choice } }));
    setShortDraft("");
  }
  function commitShort() {
    setAnswers((a) => ({ ...a, [q.idx]: { ...a[q.idx], text: shortDraft } }));
  }

  function next() {
    if (q.type === "short") commitShort();
    if (step < qs.length - 1) setStep(step + 1);
    else submit();
  }

  function retake() {
    setAnswers({});
    setShortDraft("");
    setStep(0);
    setResult(null);
    setPhase("play");
    setLeft(data?.quiz.timeLimit || null);
  }

  // ---------- RESULT ----------
  if (phase === "result" && result) {
    const pct = Math.round((result.score / Math.max(1, result.total)) * 100);
    const emoji = pct >= 90 ? "🏆" : pct >= 70 ? "🎉" : pct >= 50 ? "💪" : "🌱";
    const redeemed = result.results.filter((r) => r.correct).length;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title={data.quiz.title} subtitle={mistakes ? "Mistakes retry · Results" : "Results"} />
        <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="j-grad-primary j-shadow-soft rounded-[26px] p-6 text-center text-white">
            <div className="text-5xl">{emoji}</div>
            <div className="mt-2 text-4xl font-black">
              {result.score}
              <span className="text-xl font-bold text-white/70">/{result.total}</span>
            </div>
            <div className="mt-1 text-[13px] font-bold text-white/85">
              {mistakes
                ? `${redeemed} of ${result.total} fixed · ${pct}%`
                : `${pct}% · ${pct >= 70 ? "Excellent work!" : pct >= 50 ? "Good effort — review the misses below." : "Every attempt makes you stronger."}`}
            </div>
            {result.gamified?.gained ? (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[12px] font-black backdrop-blur">
                ⚡ +{result.gamified.gained} XP · {result.gamified.points} total
              </div>
            ) : null}
          </motion.div>

          <div className="mt-5 space-y-3">
            {result.results.map((r) => {
              const qq = qs.find((x) => x.idx === r.qIdx);
              if (!qq) return null;
              return (
                <Card key={r.qIdx} className={cn("p-4", r.correct ? "border-j-success/30" : "border-j-error/30")}>
                  <div className="flex items-start gap-2.5">
                    {r.correct ? (
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-j-success" />
                    ) : (
                      <XCircle className="mt-0.5 size-5 shrink-0 text-j-error" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold leading-snug text-foreground">{qq.question}</div>
                      <div className="mt-2 space-y-1 text-[12.5px]">
                        <div className="text-muted-foreground">
                          Your answer: <span className={cn("font-bold", r.correct ? "text-j-success" : "text-j-error")}>{r.yourAnswer || "—"}</span>
                        </div>
                        {!r.correct ? (
                          <div className="text-muted-foreground">
                            Correct: <span className="font-bold text-j-success">{r.correctAnswer || r.modelAnswer}</span>
                          </div>
                        ) : null}
                        {r.type === "short" && r.keywordFeedback ? (
                          <div className="text-muted-foreground">
                            Keywords matched: {r.keywordFeedback.hits.length}/{r.keywordFeedback.total} (need {r.keywordFeedback.need})
                          </div>
                        ) : null}
                      </div>
                      {r.explanation && r.explanation !== "—" ? (
                        <div className="mt-2.5 flex gap-2 rounded-xl bg-lavender p-3">
                          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
                          <div className="text-[12.5px] leading-relaxed text-foreground">{r.explanation}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={retake}
              className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-[14px] font-bold text-foreground active:scale-[0.98]"
            >
              <RotateCcw className="size-4" /> Retake
            </button>
            <button
              onClick={popToRoot}
              className="j-grad-primary flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30 active:scale-[0.98]"
            >
              <Home className="size-4" /> Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- PLAY ----------
  const hasAnswer = q.type === "short" ? !!shortDraft.trim() || !!answers[q.idx]?.text : typeof answers[q.idx]?.choice === "number";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title={data.quiz.title}
        subtitle={`${data.quiz.subject} · ${data.quiz.difficulty}`}
        right={
          mistakes ? (
            <div className="flex items-center gap-1.5 rounded-full bg-j-warning/10 px-3 py-1.5 text-[12px] font-black text-j-warning">
              <RotateCcw className="size-3.5" /> Mistakes
            </div>
          ) : left !== null ? (
            <div className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-black", left < 30 ? "bg-j-error/10 text-j-error" : "bg-primary/10 text-primary")}>
              <Timer className="size-4" /> {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </div>
          ) : undefined
        }
      />
      <div className="border-b border-border/70 bg-card/60 px-4 py-3">
        {mistakes ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-j-warning/10 px-3 py-2 text-[11.5px] font-bold text-j-warning">
            <Lightbulb className="size-3.5 shrink-0" />
            Mistakes retry — only the questions you missed last time. Fix them to clear them from your notebook.
          </div>
        ) : null}
        <div className="flex justify-between text-[11.5px] font-bold text-muted-foreground">
          <span>
            Question {step + 1} of {qs.length}
          </span>
          <span>{answeredCount} answered</span>
        </div>
        <div className="mt-2">
          <ProgressBar value={((step + 1) / qs.length) * 100} />
        </div>
      </div>

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={q.idx}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.16 }}
          >
            <div className="mb-1 flex items-center gap-2">
              <Chip tone={q.type === "mcq" ? "primary" : q.type === "truefalse" ? "muted" : "success"}>{q.type === "mcq" ? "Choose one" : q.type === "truefalse" ? "True or false" : "Short answer"}</Chip>
            </div>
            <h2 className="text-[19px] font-black leading-snug text-foreground">{q.question}</h2>

            {q.type !== "short" ? (
              <div className="mt-5 space-y-2.5">
                {q.options.map((o, i) => {
                  const selected = answers[q.idx]?.choice === i;
                  return (
                    <button
                      key={i}
                      onClick={() => setChoice(i)}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-4 text-left text-[15px] font-semibold transition active:scale-[0.98]",
                        selected
                          ? "j-grad-primary border-transparent text-white shadow-lg shadow-primary/25"
                          : "border-border bg-card text-foreground hover:border-primary/40"
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-black",
                          selected ? "bg-white/25 text-white" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {String.fromCharCode(65 + i)}
                      </span>
                      {o}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5">
                <textarea
                  value={shortDraft || answers[q.idx]?.text || ""}
                  onChange={(e) => setShortDraft(e.target.value)}
                  rows={4}
                  placeholder="Write your answer in your own words…"
                  className="j-app-scroll w-full resize-none rounded-2xl border-2 border-border bg-card p-4 text-[15px] leading-relaxed outline-none focus:border-primary/50"
                />
                <div className="mt-2 text-[11.5px] text-muted-foreground">
                  Graded by keyword matching — the model answer is shown after you submit.
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="border-t border-border/70 bg-card/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        <div className="flex gap-2">
          {step > 0 ? (
            <button
              onClick={() => {
                if (q.type === "short") commitShort();
                setStep(step - 1);
                setShortDraft("");
              }}
              className="min-h-12 rounded-2xl border border-border bg-card px-5 text-[14px] font-bold text-foreground active:scale-[0.98]"
            >
              Back
            </button>
          ) : null}
          <button
            onClick={next}
            disabled={phase === "sending"}
            className="j-grad-primary flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-[15px] font-black text-white shadow-lg shadow-primary/30 active:scale-[0.98] disabled:opacity-50"
          >
            {phase === "sending" ? (
              <span className="size-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
            ) : step < qs.length - 1 ? (
              <>
                Next <ArrowRight className="size-4" />
              </>
            ) : (
              <>
                <Target className="size-4" /> Submit quiz
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
