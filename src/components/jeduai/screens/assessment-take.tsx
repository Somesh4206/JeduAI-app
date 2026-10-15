"use client";
// JeduAI — take an assessment (student)
import React from "react";
import { motion } from "framer-motion";
import { ClipboardList, ArrowRight, CheckCircle2, XCircle, Lightbulb, Home } from "lucide-react";
import { api, useJedu } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, ProgressBar, TopBar, toast } from "../ui";
import { cn } from "@/lib/utils";

type Q = { idx: number; question: string; options: string[]; correctIndex: number | null; explanation: string | null };
type ADetail = {
  assessment: {
    id: string;
    title: string;
    subject: string;
    description: string | null;
    dueAt: string | null;
    totalMarks: number;
    author: string;
    alreadySubmitted: boolean;
    myScore: number | null;
  };
  questions: Q[];
};
type Res = {
  score: number;
  total: number;
  results: { qIdx: number; yourAnswer: string; correctAnswer: string; correct: boolean; explanation: string }[];
  gamified?: { gained: number };
};

export default function AssessmentTake({ id }: { id: string }) {
  const pop = useJedu((s) => s.pop);
  const popToRoot = useJedu((s) => s.popToRoot);
  const [data, setData] = React.useState<ADetail | null>(null);
  const [err, setErr] = React.useState("");
  const [phase, setPhase] = React.useState<"view" | "sending" | "result">("view");
  const [result, setResult] = React.useState<Res | null>(null);
  const [answers, setAnswers] = React.useState<Record<number, number>>({});
  const [step, setStep] = React.useState(0);

  const load = React.useCallback(() => {
    api<ADetail>(`/api/jeduai/assessments/${id}`)
      .then((r) => setData(r))
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (phase !== "view") return;
    const unanswered = data?.questions.filter((q) => answers[q.idx] === undefined).length || 0;
    if (unanswered && !confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;
    setPhase("sending");
    try {
      const payload = (data?.questions || []).map((q) => ({ qIdx: q.idx, choice: answers[q.idx] ?? null }));
      const r = await api<Res>(`/api/jeduai/assessments/${id}`, { method: "POST", json: { answers: payload } });
      setResult(r);
      setPhase("result");
      if (r.gamified?.gained) toast.success(`Submitted! +${r.gamified.gained} XP ⚡`);
    } catch (e) {
      toast.error((e as Error).message);
      setPhase("view");
    }
  }

  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Assessment" />
        <div className="p-4">
          <ErrorState message={err} onRetry={load} />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Assessment" />
        <Loader label="Loading…" />
      </div>
    );
  }

  const a = data.assessment;

  // ------- result view (also serves already-submitted) -------
  if (phase === "result" && result) {
    const pct = Math.round((result.score / Math.max(1, result.total)) * 100);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title={a.title} subtitle="Your submission" />
        <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="j-grad-primary rounded-[26px] p-6 text-center text-white shadow-xl shadow-primary/25">
            <div className="text-4xl">{pct >= 70 ? "🎉" : pct >= 50 ? "💪" : "🌱"}</div>
            <div className="mt-2 text-4xl font-black">
              {result.score}
              <span className="text-xl text-white/70">/{result.total}</span>
            </div>
            <div className="mt-1 text-[13px] font-bold text-white/85">{pct}% — {pct >= 70 ? "well done!" : "review the explanations below."}</div>
          </motion.div>
          <div className="mt-5 space-y-3">
            {result.results.map((r) => {
              const qq = data.questions.find((x) => x.idx === r.qIdx);
              if (!qq) return null;
              return (
                <Card key={r.qIdx} className={cn("p-4", r.correct ? "border-j-success/30" : "border-j-error/30")}>
                  <div className="flex items-start gap-2.5">
                    {r.correct ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-j-success" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-j-error" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold leading-snug text-foreground">{qq.question}</div>
                      <div className="mt-2 space-y-1 text-[12.5px]">
                        <div className="text-muted-foreground">
                          Your answer: <span className={cn("font-bold", r.correct ? "text-j-success" : "text-j-error")}>{r.yourAnswer}</span>
                        </div>
                        {!r.correct ? (
                          <div className="text-muted-foreground">
                            Correct: <span className="font-bold text-j-success">{r.correctAnswer}</span>
                          </div>
                        ) : null}
                      </div>
                      {r.explanation && r.explanation !== "—" ? (
                        <div className="mt-2.5 flex gap-2 rounded-xl bg-lavender p-3">
                          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
                          <div className="text-[12.5px] leading-relaxed">{r.explanation}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <button onClick={popToRoot} className="j-grad-primary mt-6 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30">
            <Home className="size-4" /> Done
          </button>
        </div>
      </div>
    );
  }

  // ------- already submitted (fetching previous result not stored client-side) -------
  if (a.alreadySubmitted) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title={a.title} />
        <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          <EmptyState
            icon="✅"
            title="Already submitted"
            body={`You scored ${a.myScore ?? "—"}/${a.totalMarks}. Answers and explanations below.`}
          />
          <div className="mt-4 space-y-3">
            {data.questions.map((q) => (
              <Card key={q.idx} className="p-4">
                <div className="text-[14px] font-bold leading-snug text-foreground">{q.question}</div>
                {q.options.map((o, j) => (
                  <div key={j} className={cn("mt-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-semibold", j === q.correctIndex ? "bg-j-success/15 text-j-success" : "text-muted-foreground")}>
                    {j === q.correctIndex ? "✓ " : "• "}
                    {o}
                  </div>
                ))}
                {q.explanation && q.explanation !== "—" ? (
                  <div className="mt-2 rounded-xl bg-lavender px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">💡 {q.explanation}</div>
                ) : null}
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ------- taking -------
  const q = data.questions[step];
  const answeredAll = data.questions.every((x) => answers[x.idx] !== undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title={a.title}
        subtitle={`${a.subject} · by ${a.author}${a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleDateString()}` : ""}`}
      />
      <div className="border-b border-border/70 bg-card/60 px-4 py-3">
        <div className="flex justify-between text-[11.5px] font-bold text-muted-foreground">
          <span>
            Question {step + 1} of {data.questions.length}
          </span>
          <span>{Object.keys(answers).length} answered</span>
        </div>
        <div className="mt-2">
          <ProgressBar value={((step + 1) / data.questions.length) * 100} />
        </div>
      </div>

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-5">
        {a.description ? <p className="mb-3 rounded-2xl bg-muted/50 p-3 text-[12.5px] leading-relaxed text-muted-foreground">{a.description}</p> : null}
        <motion.div key={q.idx} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.16 }}>
          <h2 className="text-[19px] font-black leading-snug text-foreground">{q.question}</h2>
          <div className="mt-5 space-y-2.5">
            {q.options.map((o, i) => {
              const selected = answers[q.idx] === i;
              return (
                <button
                  key={i}
                  onClick={() => setAnswers((a1) => ({ ...a1, [q.idx]: i }))}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-4 text-left text-[15px] font-semibold transition active:scale-[0.98]",
                    selected ? "j-grad-primary border-transparent text-white shadow-lg shadow-primary/25" : "border-border bg-card text-foreground hover:border-primary/40"
                  )}
                >
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-black", selected ? "bg-white/25 text-white" : "bg-muted text-muted-foreground")}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  {o}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            Answers are hidden until you submit — no spoilers while you work. 🤫
          </p>
        </motion.div>
      </div>

      <div className="border-t border-border/70 bg-card/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        <div className="flex gap-2">
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} className="min-h-12 rounded-2xl border border-border bg-card px-5 text-[14px] font-bold text-foreground active:scale-[0.98]">
              Back
            </button>
          ) : null}
          <button
            onClick={() => (step < data.questions.length - 1 ? setStep(step + 1) : submit())}
            disabled={phase === "sending"}
            className="j-grad-primary flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-[15px] font-black text-white shadow-lg shadow-primary/30 active:scale-[0.98] disabled:opacity-50"
          >
            {phase === "sending" ? (
              <span className="size-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
            ) : step < data.questions.length - 1 ? (
              <>
                Next <ArrowRight className="size-4" />
              </>
            ) : answeredAll ? (
              <>
                <ClipboardList className="size-4" /> Submit
              </>
            ) : (
              <>
                Submit <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
