"use client";
// JeduAI — per-student drill-down sheet for staff/admin portals: profile,
// 7-day XP sparkline, quiz history, active mistakes and recent activity.
import React from "react";
import { motion } from "framer-motion";
import { Zap, Flame, Target, CalendarDays, XCircle, GraduationCap, Clock, Activity, CheckCircle2 } from "lucide-react";
import { api, timeAgo } from "./store";
import { Avatar, Card, Chip, Loader, PillSpan, Sheet } from "./ui";
import { cn } from "@/lib/utils";

export type StudentSheetData = {
  student: {
    id: string;
    name: string;
    email: string;
    avatarColor: string;
    educationLevel: string;
    points: number;
    streak: number;
    lastActiveDay: string | null;
    createdAt: string;
    isDemo: boolean;
    subjects: string[];
    interfaceLang: string;
  };
  week: { days: string[]; xp: number[] };
  quiz: {
    attempts: number;
    avgPct: number | null;
    last: { id: string; title: string; subject: string; score: number; total: number; mode: string; at: string }[];
  };
  misses: {
    activeTotal: number;
    fixedTotal: number;
    top: { quizTitle: string; subject: string; question: string; yourAnswer: string; correctAnswer: string; missedCount: number }[];
  };
  activity: { type: string; points: number; day: string; at: string }[];
  classes: { title: string; subject: string; status: string; scheduledAt: string }[];
  assessments: { title: string; score: number; totalMarks: number; submittedAt: string }[];
};

const ACT_ICON: Record<string, string> = {
  chat: "💬",
  translate: "🌐",
  document_done: "📄",
  video_done: "🎬",
  quiz_done: "🎯",
  flashcards: "🗂️",
  vocab: "📖",
  focus: "⏱️",
  task_done: "✅",
  class_joined: "📹",
  assessment_done: "📝",
  zero: "🌱",
};

export default function StudentSheet({ studentId, open, onOpenChange }: { studentId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [data, setData] = React.useState<StudentSheetData | null>(null);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    if (!open || !studentId) return;
    setData(null);
    setErr("");
    api<StudentSheetData>(`/api/jeduai/admin/student?id=${studentId}`)
      .then((r) => setData(r))
      .catch((e) => setErr((e as Error).message));
  }, [open, studentId]);

  const maxXp = Math.max(10, ...(data?.week.xp || [0]));
  const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.05 } },
  };
  const rise = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Student profile">
      {err ? (
        <div className="rounded-2xl border border-j-error/30 bg-j-error/10 p-4 text-[13px] font-semibold text-j-error">{err}</div>
      ) : !data ? (
        <Loader label="Loading student…" />
      ) : (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
          {/* header */}
          <motion.div variants={rise} className="flex items-center gap-3">
            <Avatar name={data.student.name} color={data.student.avatarColor} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[16px] font-black text-foreground">{data.student.name}</span>
                {data.student.isDemo ? <Chip tone="muted">demo</Chip> : null}
              </div>
              <div className="truncate text-[11.5px] text-muted-foreground">{data.student.email}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <GraduationCap className="size-3" /> {data.student.educationLevel}
                </span>
                <span className="flex items-center gap-1">
                  <CalendarDays className="size-3" /> joined {timeAgo(data.student.createdAt)}
                </span>
              </div>
            </div>
          </motion.div>

          {/* stat chips */}
          <motion.div variants={rise} className="grid grid-cols-4 gap-2">
            <MiniStat icon={<Zap className="size-3.5" />} label="XP" value={data.student.points} tone="text-primary" />
            <MiniStat icon={<Flame className="size-3.5" />} label="Streak" value={`${data.student.streak}d`} tone="text-j-warning" />
            <MiniStat icon={<Target className="size-3.5" />} label="Quiz avg" value={data.quiz.avgPct !== null ? `${data.quiz.avgPct}%` : "—"} tone="text-j-success" />
            <MiniStat icon={<Activity className="size-3.5" />} label="Quizzes" value={data.quiz.attempts} tone="text-j-cyan" />
          </motion.div>

          {/* 7-day XP sparkline */}
          <motion.div variants={rise}>
          <Card className="p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">XP this week</span>
              <span className="text-[12px] font-black text-primary">
                {data.week.xp.reduce((s, x) => s + x, 0)} XP
              </span>
            </div>
            <div className="flex h-16 items-end gap-1.5">
              {data.week.xp.map((x, i) => {
                const h = Math.max(6, (x / maxXp) * 52);
                const isToday = i === data.week.xp.length - 1;
                return (
                  <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <motion.div
                      initial={{ height: 4 }}
                      animate={{ height: h }}
                      transition={{ delay: i * 0.04, type: "spring", stiffness: 220, damping: 22 }}
                      className={cn(
                        "w-full rounded-t-md",
                        x === 0 ? "bg-muted-foreground/15" : isToday ? "j-grad-primary" : x >= maxXp * 0.66 ? "bg-primary/70" : "bg-primary/35"
                      )}
                    />
                    <span className={cn("text-[9px] font-bold", isToday ? "text-primary" : "text-muted-foreground")}>
                      {["S", "M", "T", "W", "T", "F", "S"][new Date(data.week.days[i] + "T12:00").getDay()]}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
          </motion.div>

          {/* needs help */}
          {data.misses.activeTotal > 0 ? (
            <motion.div variants={rise}>
              <div className="mb-2 flex items-center justify-between px-1">
                <h4 className="text-[13px] font-black text-foreground">Needs help with</h4>
                <PillSpan tone="warning">
                  {data.misses.activeTotal} open miss{data.misses.activeTotal === 1 ? "" : "es"}
                </PillSpan>
              </div>
              <div className="space-y-2">
                {data.misses.top.slice(0, 3).map((m, i) => (
                  <Card key={i} className="border-j-warning/25 p-3">
                    <div className="flex items-start gap-2">
                      <XCircle className="mt-0.5 size-4 shrink-0 text-j-warning" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className="max-w-[150px] truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{m.quizTitle}</span>
                          {m.missedCount > 1 ? <span className="text-[10px] font-black text-j-warning">×{m.missedCount}</span> : null}
                        </div>
                        <div className="line-clamp-2 text-[12.5px] font-bold leading-snug text-foreground">{m.question}</div>
                        <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                          Answer: <span className="font-semibold text-j-success">{m.correctAnswer}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
                {data.misses.activeTotal > 3 ? (
                  <p className="px-1 text-[11px] font-semibold text-muted-foreground">+{data.misses.activeTotal - 3} more in their mistakes notebook</p>
                ) : null}
              </div>
            </motion.div>
          ) : (
            <motion.div variants={rise}>
            <Card className="flex items-center gap-3 p-3.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-j-success/15 text-j-success">
                <CheckCircle2 className="size-4.5" />
              </div>
              <div className="leading-tight">
                <div className="text-[13px] font-black text-foreground">Notebook all clear 🎉</div>
                <div className="text-[11px] text-muted-foreground">{data.misses.fixedTotal} earlier miss{data.misses.fixedTotal === 1 ? "" : "es"} redeemed</div>
              </div>
            </Card>
            </motion.div>
          )}

          {/* recent quiz attempts */}
          {data.quiz.last.length ? (
            <motion.div variants={rise}>
              <h4 className="mb-2 px-1 text-[13px] font-black text-foreground">Recent quizzes</h4>
              <Card className="divide-y divide-border/60 p-0">
                {data.quiz.last.slice(0, 4).map((a) => {
                  const pct = a.total ? a.score / a.total : 0;
                  return (
                    <div key={a.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <div
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-xl text-[11px] font-black",
                          pct >= 0.6 ? "bg-j-success/15 text-j-success" : pct > 0 ? "bg-j-warning/15 text-j-warning" : "bg-j-error/15 text-j-error"
                        )}
                      >
                        {a.total ? Math.round(pct * 100) : "—"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-bold text-foreground">{a.title}</div>
                        <div className="text-[10.5px] text-muted-foreground">
                          {a.mode === "mistakes" ? "mistakes retry · " : ""}
                          {timeAgo(a.at)}
                        </div>
                      </div>
                      <span className="shrink-0 text-[12px] font-black text-foreground">
                        {a.score}/{a.total}
                      </span>
                    </div>
                  );
                })}
              </Card>
            </motion.div>
          ) : null}

          {/* recent activity */}
          {data.activity.length ? (
            <motion.div variants={rise}>
              <h4 className="mb-2 px-1 text-[13px] font-black text-foreground">Recent activity</h4>
              <Card className="divide-y divide-border/60 p-0">
                {data.activity.slice(0, 6).map((a, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3.5 py-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-[14px]" aria-hidden>
                      {ACT_ICON[a.type] || "✨"}
                    </span>
                    <div className="min-w-0 flex-1 text-[12px] font-bold capitalize text-foreground">{a.type.replace(/_/g, " ")}</div>
                    {a.points > 0 ? <span className="shrink-0 text-[11px] font-black text-primary">+{a.points}</span> : null}
                    <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground">
                      <Clock className="size-3" /> {timeAgo(a.at)}
                    </span>
                  </div>
                ))}
              </Card>
            </motion.div>
          ) : null}

          {/* classes + assessments summary */}
          {(data.classes.length || data.assessments.length) > 0 ? (
            <motion.div variants={rise} className="flex flex-wrap gap-1.5 px-1">
              {data.classes.length ? <Chip tone="muted">📹 {data.classes.length} class{data.classes.length === 1 ? "" : "es"} joined</Chip> : null}
              {data.assessments.length ? <Chip tone="muted">📝 {data.assessments.length} assessment{data.assessments.length === 1 ? "" : "s"} submitted</Chip> : null}
              {data.student.subjects.slice(0, 3).map((s) => (
                <Chip key={s} tone="muted">{s}</Chip>
              ))}
            </motion.div>
          ) : null}
        </motion.div>
      )}
    </Sheet>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-2.5 text-center">
      <div className={cn("flex items-center justify-center gap-1", tone)}>
        {icon}
        <span className="text-[14px] font-black">{value}</span>
      </div>
      <div className="mt-0.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
