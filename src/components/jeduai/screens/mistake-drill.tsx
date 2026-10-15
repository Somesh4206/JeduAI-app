"use client";
// JeduAI — "Practice all" cross-quiz mistakes drill: one session that assembles
// every currently-missed question across all quizzes, then redeems them by
// submitting a mistakes-mode attempt back to each source quiz.
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, ArrowRight, CheckCircle2, XCircle, Home, Lightbulb, Shuffle, Zap, Layers } from "lucide-react";
import { api, useJedu } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, ProgressBar, TopBar, toast } from "../ui";
import { cn } from "@/lib/utils";

type Q = {
  idx: number;
  type: "mcq" | "truefalse" | "short";
  question: string;
  options: string[];
  correctIndex: number | null;
  answerText: string | null;
  explanation: string | null;
  keywords: string[];
};
type DrillData = {
  activeTotal: number;
  items: { quizId: string; title: string; subject: string; questions: Q[] }[];
};
type DrillItem = Q & { quizId: string; quizTitle: string; subject: string };
type GradedRow = {
  quizTitle: string;
  qIdx: number;
  type: string;
  question: string;
  yourAnswer: string;
  correctAnswer?: string;
  modelAnswer?: string;
  correct: boolean;
  explanation: string;
  keywordFeedback?: { hits: string[]; need: number; total: number };
};

export default function MistakeDrill() {
  const pop = useJedu((s) => s.pop);
  const popToRoot = useJedu((s) => s.popToRoot);
  const [data, setData] = React.useState<DrillData | null>(null);
  const [err, setErr] = React.useState("");
  const [phase, setPhase] = React.useState<"play" | "sending" | "result">("play");

  // interleaved question order (round-robin across quizzes so subjects mix)
  const [items, setItems] = React.useState<DrillItem[] | null>(null);
  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, { choice?: number; text?: string }>>({});
  const [shortDraft, setShortDraft] = React.useState("");
  const [xpGained, setXpGained] = React.useState(0);
  const [graded, setGraded] = React.useState<GradedRow[] | null>(null);

  const load = React.useCallback(() => {
    setData(null);
    setItems(null);
    setErr("");
    api<DrillData>("/api/jeduai/quizzes?view=mistakes_drill")
      .then((r) => {
        setData(r);
        // round-robin interleave: quiz A q1, quiz B q1, quiz A q2, …
        const pools = r.items.map((it) => it.questions.map((q) => ({ ...q, quizId: it.quizId, quizTitle: it.title, subject: it.subject })));
        const mixed: DrillItem[] = [];
        let more = true;
        while (more) {
          more = false;
          for (const p of pools) {
            if (p.length) {
              mixed.push(p.shift()!);
              more = true;
            }
          }
        }
        setItems(mixed);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const submit = React.useCallback(async () => {
    if (phase !== "play" || !items || !data) return;
    const final = { ...answers };
    const cur = items[step];
    if (cur?.type === "short" && shortDraft.trim() && !final[`${cur.quizId}:${cur.idx}`]?.text) {
      final[`${cur.quizId}:${cur.idx}`] = { ...final[`${cur.quizId}:${cur.idx}`], text: shortDraft };
    }
    setPhase("sending");
    try {
      // group answers per source quiz, POST one mistakes-mode attempt each
      const perQuiz = new Map<string, { qIdx: number; choice: number | null; text: string }[]>();
      for (const it of items) {
        const a = final[`${it.quizId}:${it.idx}`] || {};
        const arr = perQuiz.get(it.quizId) || [];
        arr.push({ qIdx: it.idx, choice: typeof a.choice === "number" ? a.choice : null, text: a.text || "" });
        perQuiz.set(it.quizId, arr);
      }
      const titleById = new Map(data.items.map((x) => [x.quizId, x.title]));
      const settles = await Promise.allSettled(
        [...perQuiz.entries()].map(([quizId, ans]) =>
          api<{ score: number; total: number; results: Omit<GradedRow, "quizTitle" | "question">[]; gamified?: { gained: number } }>(
            `/api/jeduai/quizzes/${quizId}/attempt`,
            { method: "POST", json: { answers: ans, mode: "mistakes" } }
          ).then((r) => ({ quizId, r }))
        )
      );
      const rows: GradedRow[] = [];
      let gained = 0;
      let failed = 0;
      for (const s of settles) {
        if (s.status !== "fulfilled") {
          failed++;
          continue;
        }
        gained += s.value.r.gamified?.gained || 0;
        for (const res of s.value.r.results) {
          const src = items.find((it) => it.quizId === s.value.quizId && it.idx === res.qIdx);
          rows.push({ ...res, quizTitle: titleById.get(s.value.quizId) || "Quiz", question: src?.question || "" });
        }
      }
      // keep the interleaved question order for the review list
      const order = new Map(items.map((it, i) => [`${it.quizId}:${it.idx}`, i]));
      rows.sort((a, b) => {
        const q = items.find((it) => it.quizId && it.idx === a.qIdx && it.quizTitle === a.quizTitle);
        const w = items.find((it) => it.quizId && it.idx === b.qIdx && it.quizTitle === b.quizTitle);
        return (q ? order.get(`${q.quizId}:${q.idx}`) ?? 0 : 0) - (w ? order.get(`${w.quizId}:${w.idx}`) ?? 0 : 0);
      });
      setGraded(rows);
      setXpGained(gained);
      setPhase("result");
      if (failed) toast.error(`${failed} quiz${failed === 1 ? "" : "zes"} couldn't be saved — the rest were graded.`);
      if (gained) toast.success(`+${gained} XP earned! ⚡`);
    } catch (e) {
      toast.error((e as Error).message);
      setPhase("play");
    }
  }, [phase, items, data, answers, step, shortDraft]);

  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Practice all" />
        <div className="p-4">
          <ErrorState message={err} onRetry={load} />
        </div>
      </div>
    );
  }
  if (!items) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Practice all" />
        <Loader label="Assembling your misses…" />
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Practice all" />
        <div className="p-4">
          <EmptyState icon="🎉" title="Nothing left to fix!" body="Your mistakes notebook is all caught up — every missed question has been answered right." />
        </div>
      </div>
    );
  }

  const cur = items[step];
  const list = items;
  const answeredCount = items.filter((it) => {
    const a = answers[`${it.quizId}:${it.idx}`];
    return a && (a.choice !== undefined || (a.text || "").trim());
  }).length;
  const key = `${cur.quizId}:${cur.idx}`;

  function setChoice(choice: number) {
    setAnswers((a) => ({ ...a, [key]: { ...a[key], choice } }));
    setShortDraft("");
  }
  function commitShort() {
    setAnswers((a) => ({ ...a, [key]: { ...a[key], text: shortDraft } }));
  }
  function next() {
    if (cur.type === "short") commitShort();
    if (step < list.length - 1) setStep(step + 1);
    else submit();
  }

  // ---------- RESULT ----------
  if (phase === "result" && graded) {
    const score = graded.filter((r) => r.correct).length;
    const total = graded.length;
    const pct = Math.round((score / Math.max(1, total)) * 100);
    const emoji = pct >= 90 ? "🏆" : pct >= 70 ? "🎉" : pct >= 50 ? "💪" : "🌱";
    const quizCount = new Set(graded.map((r) => r.quizTitle)).size;
    const stillMissed = graded.filter((r) => !r.correct).length;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Practice all" subtitle="Combined drill · Results" />
        <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="j-grad-primary j-shadow-soft rounded-[26px] p-6 text-center text-white">
            <div className="text-5xl">{emoji}</div>
            <div className="mt-2 text-4xl font-black">
              {score}
              <span className="text-xl font-bold text-white/70">/{total}</span>
            </div>
            <div className="mt-1 text-[13px] font-bold text-white/85">
              {score} of {total} fixed · {pct}%
            </div>
            <div className="mt-1.5 text-[11.5px] font-semibold text-white/70">
              across {quizCount} quiz{quizCount === 1 ? "" : "zes"} · {stillMissed} still need{stillMissed === 1 ? "s" : ""} another try
            </div>
            {xpGained > 0 ? (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[12px] font-black backdrop-blur">
                <Zap className="size-3.5" /> +{xpGained} XP
              </div>
            ) : null}
          </motion.div>

          <div className="mt-5 space-y-3">
            {graded.map((r, i) => (
              <motion.div key={`${r.quizTitle}-${r.qIdx}-${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.06, 0.5) }}>
                <Card className={cn("p-4", r.correct ? "border-j-success/30" : "border-j-error/30")}>
                <div className="flex items-start gap-2.5">
                  {r.correct ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-j-success" />
                  ) : (
                    <XCircle className="mt-0.5 size-5 shrink-0 text-j-error" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{r.quizTitle}</span>
                    </div>
                    <div className="text-[14px] font-bold leading-snug text-foreground">{r.question}</div>
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
              </motion.div>
            ))}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={pop}
              className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-[14px] font-bold text-foreground active:scale-[0.98]"
            >
              Back to notebook
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
  const quizCount = new Set(items.map((i) => i.quizId)).size;
  const hasAnswer = cur.type === "short" ? !!shortDraft.trim() || !!answers[key]?.text : typeof answers[key]?.choice === "number";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title="Practice all"
        subtitle={`${items.length} missed question${items.length === 1 ? "" : "s"} · ${quizCount} ${quizCount === 1 ? "quiz" : "quizzes"}`}
        right={
          <div className="flex items-center gap-1.5 rounded-full bg-j-warning/10 px-3 py-1.5 text-[12px] font-black text-j-warning">
            <Shuffle className="size-3.5" /> Mixed drill
          </div>
        }
      />
      <div className="border-b border-border/70 bg-card/60 px-4 py-3">
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-j-warning/10 px-3 py-2 text-[11.5px] font-bold text-j-warning">
          <Lightbulb className="size-3.5 shrink-0" />
          One combined session from your mistakes notebook — fix them all and it stays empty.
        </div>
        <div className="flex justify-between text-[11.5px] font-bold text-muted-foreground">
          <span>
            Question {step + 1} of {items.length}
          </span>
          <span>{answeredCount} answered</span>
        </div>
        <div className="mt-2">
          <ProgressBar value={((step + 1) / items.length) * 100} />
        </div>
      </div>

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={key}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.16 }}
          >
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Chip tone="warning">
                <Layers className="mr-1 inline size-3" />
                <span className="max-w-[240px] truncate align-bottom">{cur.quizTitle}</span>
              </Chip>
              <Chip tone="muted">{cur.subject}</Chip>
            </div>
            <div className="mb-1 flex items-center gap-2">
              <Chip tone={cur.type === "mcq" ? "primary" : cur.type === "truefalse" ? "muted" : "success"}>
                {cur.type === "mcq" ? "Choose one" : cur.type === "truefalse" ? "True or false" : "Short answer"}
              </Chip>
            </div>
            <h2 className="text-[19px] font-black leading-snug text-foreground">{cur.question}</h2>

            {cur.type !== "short" ? (
              <div className="mt-5 space-y-2.5">
                {cur.options.map((o, i) => {
                  const selected = answers[key]?.choice === i;
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
                  value={shortDraft || answers[key]?.text || ""}
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
                if (cur.type === "short") commitShort();
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
            ) : step < items.length - 1 ? (
              <>
                Next <ArrowRight className="size-4" />
              </>
            ) : (
              <>
                <Target className="size-4" /> Submit drill ({items.length})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
