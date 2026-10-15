"use client";
// JeduAI — Assessments: student list + staff creation (manual & AI)
import React from "react";
import { motion } from "framer-motion";
import { ClipboardList, Plus, Trash2, Sparkles, Users, TrendingUp, X, CheckCircle2, Loader2 } from "lucide-react";
import { api, useJedu } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, Segmented, PillSpan, TopBar, toast } from "../ui";
import { SUBJECTS } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Assess = {
  id: string;
  title: string;
  subject: string;
  description: string | null;
  dueAt: string | null;
  totalMarks: number;
  questionCount: number;
  status: string;
  author: string;
  isAuthor: boolean;
  submitted: boolean;
  myScore: number | null;
  submissions?: number;
  avgScore?: number;
  createdAt: string;
};
type DraftQ = { question: string; options: string[]; correctIndex: number; explanation: string };

export default function AssessmentsScreen() {
  const pop = useJedu((s) => s.pop);
  const push = useJedu((s) => s.push);
  const user = useJedu((s) => s.user)!;
  const isStaff = user.role === "Staff" || user.role === "Admin";
  const [items, setItems] = React.useState<Assess[] | null>(null);
  const [err, setErr] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);

  const load = React.useCallback(() => {
    api<{ assessments: Assess[] }>("/api/jeduai/assessments")
      .then((r) => setItems(r.assessments))
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function remove(a: Assess) {
    if (!confirm(`Delete assessment "${a.title}"?`)) return;
    try {
      await api(`/api/jeduai/assessments/${a.id}`, { method: "DELETE" });
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const pending = (items || []).filter((a) => !a.submitted && !a.isAuthor);
  const done = (items || []).filter((a) => a.submitted);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title="Assessments"
        subtitle={isStaff ? "Create and monitor assessments" : "Assigned by your teachers"}
        right={
          isStaff ? (
            <button
              onClick={() => setCreateOpen(true)}
              className="j-grad-primary ml-auto flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-black text-white shadow-lg shadow-primary/30 active:scale-95"
            >
              <Plus className="size-4" /> New
            </button>
          ) : undefined
        }
      />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {err ? <ErrorState message={err} onRetry={load} /> : null}
        {!items && !err ? <Loader label="Loading assessments…" /> : null}

        {items ? (
          <>
            {!isStaff ? (
              <div className="mb-5 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-[15px] font-bold text-foreground">To do</h2>
                  <Chip tone="warning">{pending.length} pending</Chip>
                </div>
                {!pending.length ? (
                  <EmptyState icon="✅" title="All caught up!" body="No pending assessments right now." />
                ) : (
                  <div className="space-y-2.5">
                    {pending.map((a) => (
                      <AssessRow key={a.id} a={a} onClick={() => push({ name: "assessment-take", id: a.id })} onDelete={isStaff && a.isAuthor ? remove : undefined} />
                    ))}
                  </div>
                )}
                {done.length ? (
                  <>
                    <h2 className="mt-4 px-1 text-[15px] font-bold text-foreground">Completed</h2>
                    <div className="space-y-2.5">
                      {done.map((a) => (
                        <AssessRow key={a.id} a={a} onClick={() => push({ name: "assessment-take", id: a.id })} onDelete={isStaff && a.isAuthor ? remove : undefined} />
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2.5">
                {items.map((a) => (
                  <AssessRow key={a.id} a={a} onClick={() => push({ name: "assessment-take", id: a.id })} onDelete={a.isAuthor || user.role === "Admin" ? remove : undefined} />
                ))}
                {!items.length ? <EmptyState icon="📝" title="No assessments yet" body="Create one — manually or generate with AI." /> : null}
              </div>
            )}
          </>
        ) : null}
      </div>

      {createOpen ? <CreateSheet onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} /> : null}
    </div>
  );
}

function AssessRow({ a, onClick, onDelete }: { a: Assess; onClick: () => void; onDelete?: (a: Assess) => void }) {
  const isStaffView = a.submissions !== undefined;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-0 overflow-hidden">
        <button onClick={onClick} className="w-full p-4 text-left transition hover:bg-muted/30 active:scale-[0.99]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-2xl text-white",
                  a.submitted ? "bg-j-success" : a.status === "draft" ? "bg-muted-foreground" : "j-grad-primary"
                )}
              >
                <ClipboardList className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-bold text-foreground">{a.title}</div>
                <div className="text-[11.5px] text-muted-foreground">
                  {a.subject} · {a.questionCount} questions · {a.totalMarks} marks
                  {a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleDateString()}` : ""}
                </div>
                {!isStaffView && a.submitted && a.myScore !== null ? (
                  <div className="mt-1 text-[12px] font-black text-j-success">Your score: {a.myScore}/{a.totalMarks || a.questionCount}</div>
                ) : null}
                {isStaffView ? (
                  <div className="mt-1 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <Users className="size-3.5" /> {a.submissions ?? 0} submissions
                    {a.avgScore !== undefined ? <><TrendingUp className="ml-1 size-3.5" /> avg {a.avgScore}</> : null}
                  </div>
                ) : null}
              </div>
            </div>
            {a.submitted ? (
              <PillSpan tone="success">Done</PillSpan>
            ) : isStaffView ? (
              <PillSpan tone={a.status === "published" ? "success" : "muted"}>{a.status}</PillSpan>
            ) : (
              <PillSpan tone="primary">Take</PillSpan>
            )}
          </div>
        </button>
        {onDelete ? (
          <div className="flex border-t border-border/70">
            <button
              onClick={() => onDelete(a)}
              className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-j-error"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
          </div>
        ) : null}
      </Card>
    </motion.div>
  );
}

function CreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [tab, setTab] = React.useState<"ai" | "manual">("ai");
  const [busy, setBusy] = React.useState(false);
  const [step, setStep] = React.useState<"form" | "review" | "publishing">("form");

  const [topic, setTopic] = React.useState("");
  const [subject, setSubject] = React.useState("Mathematics");
  const [difficulty, setDifficulty] = React.useState<"easy" | "medium" | "hard">("medium");
  const [count, setCount] = React.useState(5);
  const [title, setTitle] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [draft, setDraft] = React.useState<DraftQ[]>([]);

  async function generate() {
    if (!topic.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api<{ draft: { title: string; questions: DraftQ[] } }>("/api/jeduai/assessments", {
        method: "POST",
        json: { ai: true, topic: topic.trim(), subject, difficulty, count, lang: "English" },
      });
      setDraft(r.draft.questions);
      setTitle(r.draft.title);
      setStep("review");
      toast.success(`Generated ${r.draft.questions.length} questions — review, then publish`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/jeduai/assessments", {
        method: "POST",
        json: {
          title: title.trim(),
          subject,
          dueAt: dueAt ? new Date(dueAt + "T23:59").toISOString() : undefined,
          questions: draft,
        },
      });
      toast.success("Assessment published — students notified 📝");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-50 flex items-end">
      <button className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        className="j-app-scroll max-h-[90%] w-full overflow-y-auto rounded-t-[28px] border-t border-border bg-card p-5 pb-[max(env(safe-area-inset-bottom),20px)]"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
        <h3 className="text-lg font-black text-foreground">New assessment</h3>

        {step === "form" ? (
          <>
            <div className="mt-4">
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: "ai", label: "✨ Generate with AI" },
                  { value: "manual", label: "✍️ Build manually" },
                ]}
              />
            </div>

            {tab === "ai" ? (
              <div className="mt-4 space-y-3">
                <input className={inputCls} placeholder="Topic — e.g. Chapter 3: Motion" value={topic} onChange={(e) => setTopic(e.target.value)} />
                <div className="flex flex-wrap gap-1.5">
                  {SUBJECTS.slice(0, 8).map((s) => (
                    <Chip key={s} active={subject === s} onClick={() => setSubject(s)}>
                      {s}
                    </Chip>
                  ))}
                </div>
                <div className="flex gap-3">
                  <div>
                    <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Difficulty</div>
                    <div className="flex gap-1.5">
                      {(["easy", "medium", "hard"] as const).map((d) => (
                        <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>
                          {d}
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
                <button
                  onClick={generate}
                  disabled={busy || !topic.trim()}
                  className="j-grad-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14.5px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Generating…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" /> Generate draft
                    </>
                  )}
                </button>
                <p className="px-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  AI drafts are always reviewed by you before publishing — edit any question in the review step.
                </p>
              </div>
            ) : (
              <ManualBuilder
                subject={subject}
                setSubject={setSubject}
                title={title}
                setTitle={setTitle}
                dueAt={dueAt}
                setDueAt={setDueAt}
                draft={draft}
                setDraft={setDraft}
                onPublish={publish}
                busy={busy}
              />
            )}
          </>
        ) : null}

        {step === "review" ? (
          <div className="mt-4">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Assessment title" />
            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-muted-foreground">Due date (optional)</span>
              <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={cn(inputCls, "min-h-11")} />
            </label>
            <div className="mt-3 space-y-2.5">
              {draft.map((q, i) => (
                <Card key={i} className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13.5px] font-bold leading-snug text-foreground">
                      {i + 1}. {q.question}
                    </div>
                    <button
                      onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                      aria-label="Remove question"
                      className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-j-error"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  {q.options.map((o, j) => (
                    <div
                      key={j}
                      className={cn(
                        "mt-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-semibold",
                        j === q.correctIndex ? "bg-j-success/15 text-j-success" : "text-muted-foreground"
                      )}
                    >
                      {j === q.correctIndex ? "✓ " : "• "}
                      {o}
                    </div>
                  ))}
                  {q.explanation ? (
                    <div className="mt-2 rounded-xl bg-lavender px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
                      💡 {q.explanation}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setStep("form")} className="min-h-12 flex-1 rounded-2xl border border-border text-[14px] font-bold text-foreground">
                Back
              </button>
              <button
                onClick={publish}
                disabled={busy || !draft.length || !title.trim()}
                className="j-grad-primary flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="size-4" /> Publish ({draft.length} Qs)
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  );
}

function ManualBuilder({
  subject,
  setSubject,
  title,
  setTitle,
  dueAt,
  setDueAt,
  draft,
  setDraft,
  onPublish,
  busy,
}: {
  subject: string;
  setSubject: (s: string) => void;
  title: string;
  setTitle: (s: string) => void;
  dueAt: string;
  setDueAt: (s: string) => void;
  draft: DraftQ[];
  setDraft: (d: DraftQ[]) => void;
  onPublish: () => void;
  busy: boolean;
}) {
  const [q, setQ] = React.useState({ question: "", a: "", b: "", c: "", d: "", correct: 0, explanation: "" });

  function add() {
    if (!q.question.trim() || !q.a.trim() || !q.b.trim()) {
      toast.error("Question and at least options A & B are required");
      return;
    }
    setDraft([
      ...draft,
      {
        question: q.question.trim(),
        options: [q.a, q.b, q.c, q.d].filter((x) => x.trim()).map((x) => x.trim()),
        correctIndex: Math.min(q.correct, [q.a, q.b, q.c, q.d].filter((x) => x.trim()).length - 1),
        explanation: q.explanation.trim() || "—",
      },
    ]);
    setQ({ question: "", a: "", b: "", c: "", d: "", correct: 0, explanation: "" });
  }

  const inp = "min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-[14px] outline-none focus:border-primary/50";

  return (
    <div className="mt-4 space-y-3">
      <input className={inp} placeholder="Assessment title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex flex-wrap gap-1.5">
        {SUBJECTS.slice(0, 8).map((s) => (
          <Chip key={s} active={subject === s} onClick={() => setSubject(s)}>
            {s}
          </Chip>
        ))}
      </div>
      <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inp} />

      <div className="rounded-3xl border border-dashed border-border p-4">
        <div className="text-[12px] font-black uppercase tracking-wider text-muted-foreground">Add question {draft.length + 1}</div>
        <input className={cn(inp, "mt-2")} placeholder="The question…" value={q.question} onChange={(e) => setQ({ ...q, question: e.target.value })} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["a", "b", "c", "d"] as const).map((k, i) => (
            <input
              key={k}
              className={cn(inp, i >= 2 && "optional")}
              placeholder={`Option ${k.toUpperCase()}`}
              value={q[k]}
              onChange={(e) => setQ({ ...q, [k]: e.target.value })}
            />
          ))}
        </div>
        <div className="mt-2">
          <div className="mb-1 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Correct answer</div>
          <div className="flex gap-1.5">
            {["A", "B", "C", "D"].map((L, i) => (
              <Chip key={L} active={q.correct === i} onClick={() => setQ({ ...q, correct: i })}>
                {L}
              </Chip>
            ))}
          </div>
        </div>
        <input
          className={cn(inp, "mt-2")}
          placeholder="Explanation shown after submission (optional)"
          value={q.explanation}
          onChange={(e) => setQ({ ...q, explanation: e.target.value })}
        />
        <button onClick={add} className="j-grad-primary mt-3 w-full rounded-2xl py-3 text-[13.5px] font-black text-white shadow-lg shadow-primary/25">
          + Add question
        </button>
      </div>

      {draft.length ? (
        <>
          <div className="px-1 text-[12.5px] font-bold text-muted-foreground">{draft.length} questions ready</div>
          <button
            onClick={onPublish}
            disabled={busy || !title.trim()}
            className="j-grad-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14.5px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50"
          >
            <CheckCircle2 className="size-4" /> Publish assessment
          </button>
        </>
      ) : null}
    </div>
  );
}
