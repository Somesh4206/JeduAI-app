"use client";
// JeduAI — Focus timer: Pomodoro-style study sessions with XP + planner logging
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play, RotateCcw, Plus, Coffee, Zap, Minus } from "lucide-react";
import { api, useJedu, fmtClock } from "../store";
import { getFocus, subscribeFocus, startFocus, pauseFocus, resumeFocus, resetFocus, startBreak, addMinutes } from "../focus-engine";
import { Card, Loader, TopBar, toast } from "../ui";
import { cn } from "@/lib/utils";

type Stats = {
  today: string;
  minutesToday: number;
  sessionsToday: number;
  goalMin: number;
  weekDays: string[];
  weekMinutes: number[];
};

const PRESETS = [15, 25, 50];

export default function FocusScreen() {
  const user = useJedu((s) => s.user)!;
  const [minutes, setMinutes] = React.useState(25);
  const [subject, setSubject] = React.useState<string>("");
  const [fs, setFs] = React.useState(getFocus());
  const [stats, setStats] = React.useState<Stats | null>(null);

  React.useEffect(() => subscribeFocus(() => setFs({ ...getFocus() })), []);

  React.useEffect(() => {
    api<Stats>("/api/jeduai/focus")
      .then(setStats)
      .catch(() => {});
  }, [fs.phase]);

  const subjects = React.useMemo(() => {
    const list = [...(user.subjects || [])];
    return list.length ? list.slice(0, 6) : ["General"];
  }, [user.subjects]);

  const phase = fs.phase;
  const running = phase === "focus";
  const ring = 2 * Math.PI * 118;
  const pct = fs.total > 0 ? Math.max(0, Math.min(100, (fs.left / fs.total) * 100)) : 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Focus timer" subtitle="Pomodoro sessions that count toward your goal" />
      <div className="j-app-scroll flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {/* stats header */}
        {stats ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 grid grid-cols-3 gap-3">
            <Card className="p-3 text-center">
              <div className="text-xl font-black text-foreground">{stats.minutesToday}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">min today</div>
            </Card>
            <Card className="p-3 text-center">
              <div className="text-xl font-black text-foreground">{stats.sessionsToday}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">sessions</div>
            </Card>
            <Card className="p-3 text-center">
              <div className="text-xl font-black text-foreground">{stats.goalMin}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">min goal</div>
            </Card>
          </motion.div>
        ) : null}

        {/* timer ring */}
        <div className="relative mx-auto grid aspect-square w-full max-w-[300px] place-items-center">
          <svg width="100%" height="100%" viewBox="0 0 280 280" className="absolute inset-0 -rotate-90">
            <circle cx="140" cy="140" r="118" fill="none" stroke="currentColor" strokeWidth="14" className="text-muted" />
            <motion.circle
              cx="140"
              cy="140"
              r="118"
              fill="none"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={ring}
              animate={{ strokeDashoffset: ring - (pct / 100) * ring }}
              transition={{ duration: 0.4, ease: "linear" }}
              className={cn(
                phase === "break" ? "stroke-j-success" : "stroke-primary",
                running && "drop-shadow-[0_0_10px_rgba(91,95,239,0.35)]"
              )}
            />
          </svg>
          <div className="relative z-10 flex flex-col items-center">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              {phase === "idle" ? "ready" : phase === "paused" ? "paused" : phase === "break" ? "break time" : phase === "celebrate" ? "done!" : "stay focused"}
            </div>
            <div className="mt-1 text-[56px] font-black leading-none tabular-nums text-foreground">
              {phase === "celebrate" ? "✓" : fmtClock(phase === "idle" ? minutes * 60 : fs.left)}
            </div>
            {phase === "focus" || phase === "paused" ? (
              <div className="mt-1 max-w-[180px] truncate text-center text-[12.5px] font-bold text-muted-foreground">
                {fs.subject || "Study session"}
              </div>
            ) : phase === "idle" ? (
              <div className="mt-1 text-[12.5px] font-bold text-muted-foreground">{minutes} minutes · you choose the subject</div>
            ) : null}
            {running ? (
              <div className="mt-2 flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                <span className="text-[10.5px] font-black uppercase tracking-wider text-primary">focusing</span>
              </div>
            ) : null}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {phase === "celebrate" ? (
            <motion.div key="celebrate" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mt-5">
              <Card className="j-grad-primary j-shadow-soft p-5 text-center text-white">
                <div className="text-4xl">🎉</div>
                <div className="mt-1 text-lg font-black">
                  {fs.minutes} minutes focused{fs.subject ? ` — ${fs.subject}` : ""}!
                </div>
                <div className="mt-0.5 text-[12.5px] font-bold text-white/85">
                  {fs.lastXp !== null ? `+${fs.lastXp} XP earned · logged to your planner` : "Session saved to your planner"}
                </div>
              </Card>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  onClick={() => startBreak(5)}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-j-success/30 bg-j-success/10 text-[13.5px] font-black text-j-success transition active:scale-[0.97]"
                >
                  <Coffee className="size-4" /> 5-min break
                </button>
                <button
                  onClick={() => resetFocus()}
                  className="j-grad-primary flex min-h-12 items-center justify-center gap-2 rounded-2xl text-[13.5px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.97]"
                >
                  <Play className="size-4" /> New session
                </button>
              </div>
            </motion.div>
          ) : phase === "idle" ? (
            <motion.div key="setup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5">
              {/* duration presets */}
              <div className="mb-1.5 px-1 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Session length</div>
              <div className="grid grid-cols-3 gap-2.5">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setMinutes(p)}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-1 rounded-2xl border-2 text-[14px] font-black transition active:scale-[0.97]",
                      minutes === p
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {p === 50 ? "Long" : p === 25 ? "Classic" : "Short"}
                    <span className="text-[11px] font-bold opacity-70">{p}m</span>
                  </button>
                ))}
              </div>
              {/* fine tune */}
              <div className="mt-2.5 flex items-center justify-center gap-4">
                <button
                  onClick={() => setMinutes((m) => Math.max(5, m - 5))}
                  aria-label="5 minutes less"
                  className="grid size-9 place-items-center rounded-full border border-border text-muted-foreground transition hover:text-primary active:scale-95"
                >
                  <Minus className="size-4" />
                </button>
                <span className="text-[13px] font-bold text-foreground">
                  {minutes} min <span className="text-muted-foreground">≈ {Math.min(minutes, 30)} XP</span>
                </span>
                <button
                  onClick={() => setMinutes((m) => Math.min(90, m + 5))}
                  aria-label="5 minutes more"
                  className="grid size-9 place-items-center rounded-full border border-border text-muted-foreground transition hover:text-primary active:scale-95"
                >
                  <Plus className="size-4" />
                </button>
              </div>

              {/* subject */}
              <div className="mb-1.5 mt-5 px-1 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Subject</div>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSubject(subject === s ? "" : s)}
                    className={cn(
                      "min-h-9 rounded-full px-3.5 text-[12.5px] font-bold transition active:scale-95",
                      subject === s ? "bg-primary text-white shadow-md shadow-primary/30" : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <button
                onClick={() => startFocus(minutes, subject || subjects[0])}
                className="j-grad-primary mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15.5px] font-black text-white shadow-xl shadow-primary/30 transition active:scale-[0.98]"
              >
                <Play className="size-5" /> Start focusing
              </button>
              <p className="mt-3 text-center text-[11.5px] leading-relaxed text-muted-foreground">
                Completed sessions earn XP and appear in your study planner — minutes count toward your daily goal.
              </p>
            </motion.div>
          ) : phase === "break" ? (
            <motion.div key="break" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
              <Card className="border-j-success/25 bg-j-success/5 p-4 text-center">
                <Coffee className="mx-auto size-6 text-j-success" />
                <div className="mt-1 text-[14px] font-black text-foreground">Recharge — you earned it</div>
                <div className="text-[12px] text-muted-foreground">Stretch, water, look away from the screen. The timer ends on its own.</div>
              </Card>
              <button
                onClick={() => resetFocus()}
                className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card text-[13.5px] font-bold text-foreground transition active:scale-[0.98]"
              >
                <RotateCcw className="size-4" /> Skip break
              </button>
            </motion.div>
          ) : (
            <motion.div key="controls" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={running ? pauseFocus : resumeFocus}
                  className={cn(
                    "flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 py-4 text-[15px] font-black transition active:scale-[0.97]",
                    running ? "border-j-warning/30 bg-j-warning/10 text-j-warning" : "border-j-success/30 bg-j-success/10 text-j-success"
                  )}
                >
                  {running ? <Pause className="size-5" /> : <Play className="size-5" />}
                  {running ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => {
                    resetFocus();
                    toast.info("Session discarded — no XP logged");
                  }}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card py-4 text-[15px] font-black text-foreground transition active:scale-[0.97]"
                >
                  <RotateCcw className="size-5" /> Reset
                </button>
              </div>
              {running ? (
                <button
                  onClick={() => addMinutes(5)}
                  className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-muted text-[13px] font-bold text-foreground transition active:scale-[0.98]"
                >
                  <Plus className="size-4" /> Add 5 minutes
                </button>
              ) : null}
              <p className="mt-3 text-center text-[11.5px] text-muted-foreground">
                Keep this screen or navigate away — the timer keeps running inside the app.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* week minutes */}
        {stats ? (
          <div className="mt-7">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">Focus minutes · 7 days</span>
              <span className="text-[11px] font-bold text-primary">{stats.weekMinutes.reduce((a, b) => a + b, 0)} min total</span>
            </div>
            <Card className="p-4">
              <div className="flex h-20 items-end gap-1.5">
                {stats.weekMinutes.map((m, i) => {
                  const max = Math.max(...stats.weekMinutes, 30);
                  const h = Math.max(4, (m / max) * 72);
                  const isToday = i === 6;
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      {m > 0 ? <span className="text-[9.5px] font-black text-muted-foreground">{m}</span> : null}
                      <motion.div
                        initial={{ height: 3 }}
                        animate={{ height: h }}
                        transition={{ delay: i * 0.05, type: "spring", stiffness: 200, damping: 22 }}
                        className={cn("w-full rounded-t-lg", isToday ? "bg-j-success" : "bg-j-success/25")}
                        style={{ maxHeight: 72 }}
                      />
                      <span className={cn("text-[10px] font-bold", isToday ? "text-j-success" : "text-muted-foreground")}>
                        {["S", "M", "T", "W", "T", "F", "S"][new Date(stats.weekDays[i] + "T12:00").getDay()]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        ) : !stats ? (
          <div className="mt-6">
            <Loader label="Loading your focus stats…" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
