"use client";
// JeduAI — Study planner: tasks, goal, AI tips
import React from "react";
import { motion } from "framer-motion";
import { Plus, CheckCircle2, Circle, Trash2, Sparkles, Flame, Target, X, Lightbulb, Timer } from "lucide-react";
import { api, useJedu } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, ProgressBar, TopBar, toast } from "../ui";
import { SUBJECTS } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Task = { id: string; title: string; subject: string; date: string; minutes: number; done: boolean };
type PData = {
  today: string;
  tasks: Task[];
  weak: string[];
  tips: string[];
  streak: number;
  goalMin: number;
  doneToday: number;
  minutesDoneToday: number;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PlannerScreen() {
  const pop = useJedu((s) => s.pop);
  const push = useJedu((s) => s.push);
  const user = useJedu((s) => s.user)!;
  const [data, setData] = React.useState<PData | null>(null);
  const [err, setErr] = React.useState("");
  const [selDay, setSelDay] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [subject, setSubject] = React.useState<string>(user.subjects?.[0] || "Mathematics");
  const [minutes, setMinutes] = React.useState(30);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    api<PData>("/api/jeduai/planner")
      .then((r) => setData(r))
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const days = React.useMemo(() => {
    if (!data) return [];
    const out: { date: string; label: string; dow: string; count: number; done: number }[] = [];
    const base = new Date(data.today + "T12:00:00");
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dayTasks = data.tasks.filter((t) => t.date === ds);
      out.push({
        date: ds,
        label: String(d.getDate()),
        dow: DOW[d.getDay()],
        count: dayTasks.length,
        done: dayTasks.filter((t) => t.done).length,
      });
    }
    return out;
  }, [data]);

  const activeDay = selDay || data?.today || "";
  const dayTasks = data?.tasks.filter((t) => t.date === activeDay) || [];

  async function addTask() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await api("/api/jeduai/planner", { method: "POST", json: { title: title.trim(), subject, date: activeDay, minutes } });
      toast.success("Task added to your plan");
      setTitle("");
      setAddOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Task) {
    try {
      const r = await api<{ done: boolean; gamified?: { gained: number } }>("/api/jeduai/planner", {
        method: "PATCH",
        json: { id: t.id, action: "toggle" },
      });
      if (r.gamified?.gained) toast.success(`Task done — +${r.gamified.gained} XP ⚡`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeTask(t: Task) {
    try {
      await api(`/api/jeduai/planner?id=${t.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Study Planner" />
        <div className="p-4">
          <ErrorState message={err} onRetry={load} />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Study Planner" />
        <Loader label="Loading planner…" />
      </div>
    );
  }

  const goalPct = Math.min(100, Math.round((data.minutesDoneToday / Math.max(1, data.goalMin)) * 100));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title="Study Planner"
        subtitle="Your week at a glance"
        right={
          <button
            onClick={() => setAddOpen(true)}
            className="j-grad-primary ml-auto flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-black text-white shadow-lg shadow-primary/30 active:scale-95"
          >
            <Plus className="size-4" /> Add task
          </button>
        }
      />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {/* today hero */}
        <div className="j-grad-cyan j-shadow-soft relative overflow-hidden rounded-[26px] p-5 text-white">
          <div className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-4">
            <div className="flex-1">
              <div className="text-[13px] font-bold text-white/85">Today's goal</div>
              <div className="mt-0.5 text-3xl font-black leading-none">
                {data.minutesDoneToday}
                <span className="text-lg font-bold text-white/80"> / {data.goalMin} min</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-black backdrop-blur">
                  <Flame className="mr-1 inline size-3" /> {data.streak}-day streak
                </span>
                <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-black backdrop-blur">
                  ✓ {data.doneToday} tasks done today
                </span>
              </div>
            </div>
            <div className="grid size-[74px] shrink-0 place-items-center rounded-full bg-white/15 backdrop-blur">
              <div className="text-center leading-none">
                <div className="text-lg font-black">{goalPct}%</div>
                <div className="text-[9px] font-bold uppercase tracking-wider opacity-80">goal</div>
              </div>
            </div>
          </div>
          <div className="relative mt-4">
            <ProgressBar value={goalPct} className="bg-white/25" />
          </div>
          <button
            onClick={() => push({ name: "focus" })}
            className="relative mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white/95 text-[13px] font-black text-j-cyan shadow-lg transition active:scale-[0.98]"
          >
            <Timer className="size-4" /> Start a focus session — minutes count here
          </button>
        </div>

        {/* week strip */}
        <div className="j-app-scroll mt-4 flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => {
            const isToday = d.date === data.today;
            const active = d.date === activeDay;
            return (
              <button
                key={d.date}
                onClick={() => setSelDay(d.date === activeDay && selDay ? null : d.date)}
                className={cn(
                  "flex min-w-[62px] shrink-0 flex-col items-center gap-1 rounded-2xl border-2 px-3 py-2.5 transition active:scale-95",
                  active ? "j-grad-primary border-transparent text-white shadow-lg shadow-primary/25" : "border-border bg-card text-foreground hover:border-primary/40"
                )}
              >
                <span className={cn("text-[10px] font-black uppercase tracking-wider", active ? "text-white/85" : "text-muted-foreground")}>
                  {isToday ? "Today" : d.dow}
                </span>
                <span className="text-lg font-black leading-none">{d.label}</span>
                {d.count ? (
                  <span className={cn("rounded-full px-1.5 text-[10px] font-black", active ? "bg-white/25 text-white" : "bg-primary/10 text-primary")}>
                    {d.done}/{d.count}
                  </span>
                ) : (
                  <span className={cn("text-[10px]", active ? "text-white/70" : "text-muted-foreground")}>—</span>
                )}
              </button>
            );
          })}
        </div>

        {/* tasks for day */}
        <h2 className="mb-2.5 mt-5 px-1 text-[15px] font-bold text-foreground">
          {activeDay === data.today ? "Today" : new Date(activeDay + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </h2>
        {!dayTasks.length ? (
          <EmptyState
            icon="🗓"
            title="Nothing planned"
            body="Add a study task, or generate a quiz on a weak subject instead."
            action={
              <button onClick={() => setAddOpen(true)} className="j-grad-primary mt-1 rounded-full px-5 py-2.5 text-[13px] font-black text-white shadow-lg shadow-primary/25">
                <Plus className="mr-1 inline size-4" /> Add a task
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {dayTasks.map((t) => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <Card className={cn("flex items-center gap-3 p-3.5", t.done && "opacity-70")}>
                  <button onClick={() => toggle(t)} aria-label={t.done ? "Mark undone" : "Mark done"} className="shrink-0">
                    {t.done ? (
                      <CheckCircle2 className="size-7 text-j-success" />
                    ) : (
                      <Circle className="size-7 text-muted-foreground transition hover:text-primary" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={cn("truncate text-[14px] font-bold text-foreground", t.done && "line-through")}>{t.title}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {t.subject} · {t.minutes} min
                    </div>
                  </div>
                  <button
                    onClick={() => removeTask(t)}
                    aria-label="Delete task"
                    className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-j-error/10 hover:text-j-error"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {/* weak subjects */}
        {data.weak.length ? (
          <div className="mt-6">
            <h2 className="mb-2.5 px-1 text-[15px] font-bold text-foreground">Focus areas</h2>
            <div className="flex flex-wrap gap-2">
              {data.weak.map((w) => (
                <Chip key={w} tone="warning">
                  📌 {w}
                </Chip>
              ))}
            </div>
            <p className="mt-2 px-1 text-[11.5px] text-muted-foreground">
              Based on your recent quiz scores — these could use a revision session.
            </p>
          </div>
        ) : null}

        {/* AI tips */}
        {data.tips?.length ? (
          <div className="mt-6">
            <h2 className="mb-2.5 flex items-center gap-2 px-1 text-[15px] font-bold text-foreground">
              <Sparkles className="size-4 text-primary" /> AI study tips for your week
            </h2>
            <div className="space-y-2.5">
              {data.tips.map((tip, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card className="flex gap-3 p-4">
                    <div className="j-grad-primary grid size-9 shrink-0 place-items-center rounded-xl text-white">
                      <Lightbulb className="size-4" />
                    </div>
                    <p className="text-[13.5px] leading-relaxed text-foreground">{tip}</p>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* add sheet */}
      {addOpen ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-50 flex items-end">
          <button className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={() => setAddOpen(false)} />
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} className="relative w-full rounded-t-[28px] border-t border-border bg-card p-5 pb-[max(env(safe-area-inset-bottom),20px)]">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
            <h3 className="text-base font-black text-foreground">New study task</h3>
            <p className="text-[12px] text-muted-foreground">
              for {new Date(activeDay + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </p>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What will you study?"
              className="mt-3 min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
            />
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Subject</div>
              <div className="flex flex-wrap gap-1.5">
                {SUBJECTS.slice(0, 8).map((s) => (
                  <Chip key={s} active={subject === s} onClick={() => setSubject(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Minutes</div>
              <div className="flex flex-wrap gap-1.5">
                {[15, 30, 45, 60, 90].map((m) => (
                  <Chip key={m} active={minutes === m} onClick={() => setMinutes(m)}>
                    {m} min
                  </Chip>
                ))}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setAddOpen(false)} className="min-h-12 flex-1 rounded-2xl border border-border text-[14px] font-bold text-foreground">
                Cancel
              </button>
              <button onClick={addTask} disabled={busy || !title.trim()} className="j-grad-primary min-h-12 flex-1 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50">
                {busy ? "…" : "Add task"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </div>
  );
}
