"use client";
// JeduAI — Staff portal: dashboard, students, class leaderboards, quick analytics
import React from "react";
import { motion } from "framer-motion";
import { Briefcase, Users, Video, ClipboardList, TrendingUp, Flame, Zap, ChevronRight, Trophy, Target, CalendarDays, Megaphone, Download } from "lucide-react";
import { api, useJedu } from "../store";
import { Avatar, Card, Chip, EmptyState, ErrorState, Loader, Segmented, Sheet, TopBar, toast } from "../ui";
import StudentSheet from "../student-sheet";
import { cn } from "@/lib/utils";

type AdminData = {
  analytics: {
    totalUsers: number;
    students: number;
    staff: number;
    admins: number;
    signupsWeek: number;
    platformPoints: number;
    activeToday: number;
    documents: { total: number; byStatus: Record<string, number> };
    videos: { total: number; byStatus: Record<string, number> };
    classes: { total: number; byStatus: Record<string, number> };
    assessments: { total: number };
    avgQuizPct: number;
  };
  users: {
    id: string;
    name: string;
    email: string;
    role: string;
    points: number;
    streak: number;
    avatarColor: string;
    educationLevel: string;
    isDemo: boolean;
    createdAt: string;
    isMe: boolean;
  }[];
};

type LbClass = { id: string; title: string; subject: string; status: string; scheduledAt: string; enrolled: number };
type LbRow = {
  rank: number;
  id: string;
  name: string;
  avatarColor: string;
  streak: number;
  points: number;
  weekPoints: number;
  quizAvgPct: number | null;
  quizCount: number;
  isDemo: boolean;
  educationLevel: string;
  lastActiveDay: string | null;
};
type LbData = { scope: "week" | "all"; classId: string | null; classes: LbClass[]; rows: LbRow[] };

const MEDALS = ["🥇", "🥈", "🥉"];

export default function StaffScreen() {
  const pop = useJedu((s) => s.pop);
  const push = useJedu((s) => s.push);
  const user = useJedu((s) => s.user)!;
  const [data, setData] = React.useState<AdminData | null>(null);
  const [err, setErr] = React.useState("");

  // class leaderboard state
  const [lb, setLb] = React.useState<LbData | null>(null);
  const [lbErr, setLbErr] = React.useState("");
  const [lbScope, setLbScope] = React.useState<"week" | "all">("week");
  const [lbClass, setLbClass] = React.useState<string>(""); // "" = all students
  const [sheetId, setSheetId] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<AdminData>("/api/jeduai/admin")
      .then((r) => setData(r))
      .catch((e) => setErr((e as Error).message));
  }, []);

  const loadLb = React.useCallback((scope: "week" | "all", classId: string) => {
    setLbErr("");
    api<LbData>(`/api/jeduai/classes/leaderboard?scope=${scope}${classId ? `&classId=${classId}` : ""}`)
      .then((r) => setLb(r))
      .catch((e) => setLbErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    loadLb(lbScope, lbClass);
  }, [lbScope, lbClass, loadLb]);

  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Staff Portal" />
        <div className="p-4">
          <ErrorState message={err} onRetry={() => location.reload()} />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Staff Portal" />
        <Loader label="Loading portal…" />
      </div>
    );
  }

  const students = data.users.filter((u) => u.role === "Student").sort((a, b) => b.points - a.points);
  const a = data.analytics;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar onBack={pop} title="Staff Portal" subtitle={`Welcome, ${user.name}`} />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {/* quick stats */}
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={<Users className="size-5" />} label="Students" value={a.students} grad="from-[#5B5FEF] to-[#773DE8]" />
          <Stat icon={<Video className="size-5" />} label="Classes total" value={a.classes.total} grad="from-[#39C6F4] to-[#5B5FEF]" />
          <Stat icon={<ClipboardList className="size-5" />} label="Assessments" value={a.assessments.total} grad="from-[#F5A623] to-[#E85D75]" />
          <Stat icon={<TrendingUp className="size-5" />} label="Avg quiz score" value={`${a.avgQuizPct}%`} grad="from-[#20B486] to-[#39C6F4]" />
        </div>

        {/* quick actions */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Card onClick={() => push({ name: "classes" })} className="flex items-center gap-3 p-4 transition active:scale-[0.98]">
            <div className="j-grad-cyan grid size-10 place-items-center rounded-2xl text-white">
              <Video className="size-5" />
            </div>
            <div className="text-[13px] font-black leading-tight text-foreground">
              Schedule a class
            </div>
          </Card>
          <Card onClick={() => push({ name: "assessments" })} className="flex items-center gap-3 p-4 transition active:scale-[0.98]">
            <div className="j-grad-primary grid size-10 place-items-center rounded-2xl text-white">
              <ClipboardList className="size-5" />
            </div>
            <div className="text-[13px] font-black leading-tight text-foreground">
              Create assessment
            </div>
          </Card>
        </div>

        {/* students */}
        <h2 className="mb-2.5 mt-6 px-1 text-[15px] font-bold text-foreground">
          Students ({students.length})
        </h2>
        {!students.length ? (
          <EmptyState icon="👥" title="No students yet" body="When students sign up they'll appear here with their progress." />
        ) : (
          <div className="space-y-2.5">
            {students.map((s, i) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
                <Card
                  onClick={() => setSheetId(s.id)}
                  aria-label={`Open profile for ${s.name}`}
                  className="flex cursor-pointer items-center gap-3 p-3.5 transition hover:bg-muted/40 active:scale-[0.99]"
                >
                  <Avatar name={s.name} color={s.avatarColor} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-bold text-foreground">{s.name}</span>
                      {s.isDemo ? <Chip tone="muted">demo</Chip> : null}
                    </div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      {s.email} · {s.educationLevel}
                    </div>
                    <div className="mt-1 flex items-center gap-2.5 text-[11.5px]">
                      <span className="flex items-center gap-1 font-bold text-j-warning">
                        <Flame className="size-3.5" /> {s.streak}d
                      </span>
                      <span className="flex items-center gap-1 font-bold text-primary">
                        <Zap className="size-3.5" /> {s.points} XP
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {/* class leaderboard */}
        <ClassLeaderboard
          lb={lb}
          lbErr={lbErr}
          scope={lbScope}
          onScope={setLbScope}
          classId={lbClass}
          onClass={setLbClass}
        />

        <StudentSheet studentId={sheetId} open={!!sheetId} onOpenChange={(v) => !v && setSheetId(null)} />

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Tip: use Assessments → New to generate a quiz with AI, review it, then publish.
        </p>
      </div>
    </div>
  );
}

function ClassLeaderboard({
  lb,
  lbErr,
  scope,
  onScope,
  classId,
  onClass,
}: {
  lb: LbData | null;
  lbErr: string;
  scope: "week" | "all";
  onScope: (v: "week" | "all") => void;
  classId: string;
  onClass: (v: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [msgOpen, setMsgOpen] = React.useState(false);
  const [msgTitle, setMsgTitle] = React.useState("");
  const [msgBody, setMsgBody] = React.useState("");
  const [msgBusy, setMsgBusy] = React.useState(false);
  const rows = lb?.rows || [];
  const maxVal = Math.max(1, ...rows.map((r) => (scope === "week" ? r.weekPoints : r.points)));
  const activeClass = lb?.classes.find((c) => c.id === classId) || null;

  async function sendMessage() {
    setMsgBusy(true);
    try {
      const r = await api<{ sent: number; audience: string }>("/api/jeduai/classes/leaderboard", {
        method: "POST",
        json: { classId, title: msgTitle, body: msgBody },
      });
      toast.success(`Sent to ${r.sent} student${r.sent === 1 ? "" : "s"} · ${r.audience}`);
      setMsgOpen(false);
      setMsgTitle("");
      setMsgBody("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMsgBusy(false);
    }
  }

  // export the current ranking as CSV (grades record / spreadsheet import)
  function exportCsv() {
    if (!rows.length) {
      toast.info("Nothing to export yet — this cohort has no learners.");
      return;
    }
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, "\"\"").replace(/\r?\n/g, " ")}"`;
    const cohort = activeClass ? activeClass.title : "All students";
    const lines = [
      `JeduAI leaderboard — ${cohort} (${scope === "week" ? "this week" : "all-time"})`,
      `Exported,${new Date().toISOString().slice(0, 10)}`,
      "",
      "Rank,Student,Education,Streak (days),Quiz avg %,Quiz attempts,Week XP,All-time XP,Last active day",
      ...rows.map((r) =>
        [
          r.rank,
          esc(r.name),
          esc(r.educationLevel),
          r.streak,
          r.quizAvgPct ?? "—",
          r.quizCount,
          r.weekPoints,
          r.points,
          r.lastActiveDay || "—",
        ].join(",")
      ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cohort.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50) || "leaderboard"} — ${scope === "week" ? "week" : "all-time"} leaderboard.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${rows.length} learners as CSV`);
  }

  return (
    <>
      <div className="mb-2.5 mt-7 flex flex-wrap items-center gap-x-2 gap-y-2 px-1">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-foreground">
          <Trophy className="size-4.5 text-j-warning" /> Class leaderboard
        </h2>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setMsgOpen(true)}
            disabled={!rows.length}
            className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-[11.5px] font-black text-primary transition active:scale-95 disabled:opacity-50"
          >
            <Megaphone className="size-3.5" /> Message
          </button>
          <button
            onClick={exportCsv}
            disabled={!rows.length}
            title="Download this ranking as CSV"
            aria-label="Download this ranking as CSV"
            className="flex items-center gap-1 rounded-full bg-j-success/10 px-3 py-1.5 text-[11.5px] font-black text-j-success transition active:scale-95 disabled:opacity-50"
          >
            <Download className="size-3.5" /> CSV
          </button>
          <button
            onClick={() => setOpen(true)}
            className="rounded-full bg-j-warning/10 px-3 py-1.5 text-[11.5px] font-black text-j-warning transition active:scale-95"
          >
            {activeClass ? "Switch class" : rows.length ? `${rows.length} learners` : "—"}
          </button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-black text-foreground">
              {activeClass ? activeClass.title : "All students"}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {activeClass
                ? `${activeClass.subject} · ${activeClass.enrolled} enrolled · ${activeClass.status}`
                : "Every learner on the platform"}
            </div>
          </div>
          <div className="w-[132px] shrink-0">
            <Segmented
              value={scope}
              onChange={onScope}
              options={[
                { value: "week", label: "Week" },
                { value: "all", label: "All-time" },
              ]}
            />
          </div>
        </div>

        <div className="mt-4">
          {lbErr ? (
            <ErrorState message={lbErr} onRetry={() => onScope(scope)} />
          ) : !lb ? (
            <div className="grid h-28 place-items-center text-[12px] text-muted-foreground">Loading ranking…</div>
          ) : !rows.length ? (
            <EmptyState
              icon="🎓"
              title="No learners in this cohort"
              body={activeClass ? "Share the class code so students can enroll, then their weekly XP will rank here." : "No students yet."}
            />
          ) : (
            <div className="space-y-1.5">
              {rows.map((r, i) => {
                const val = scope === "week" ? r.weekPoints : r.points;
                const pct = Math.round((val / maxVal) * 100);
                const podium = r.rank <= 3;
                return (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    className={cn(
                      "relative overflow-hidden rounded-2xl px-3 py-2.5",
                      podium ? "bg-gradient-to-r from-j-warning/12 to-transparent" : "bg-muted/40"
                    )}
                  >
                    {/* relative XP bar as row background */}
                    <div
                      className={cn("absolute inset-y-0 left-0 rounded-2xl", podium ? "bg-j-warning/15" : "bg-primary/8")}
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                    <div className="relative flex items-center gap-3">
                      <span className={cn("grid w-8 shrink-0 place-items-center text-[15px] font-black leading-none", podium ? "" : "text-muted-foreground")}>
                        {r.rank <= 3 ? MEDALS[r.rank - 1] : r.rank}
                      </span>
                      <Avatar name={r.name} color={r.avatarColor} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-bold text-foreground">{r.name}</span>
                          {r.isDemo ? <Chip tone="muted" className="shrink-0">demo</Chip> : null}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            <Flame className="size-3 text-j-warning" /> {r.streak}d
                          </span>
                          {r.quizAvgPct != null ? (
                            <span className="flex items-center gap-0.5">
                              <Target className="size-3 text-primary" /> {r.quizAvgPct}% quiz
                            </span>
                          ) : null}
                          {scope === "week" ? (
                            <span className="flex items-center gap-0.5">
                              <Zap className="size-3 text-j-violet" /> {r.points} all-time
                            </span>
                          ) : r.weekPoints > 0 ? (
                            <span className="flex items-center gap-0.5">
                              <TrendingUp className="size-3 text-j-violet" /> {r.weekPoints} this week
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={cn("text-[15px] font-black", podium ? "text-j-warning" : "text-foreground")}>{val}</div>
                        <div className="text-[9.5px] font-black uppercase tracking-wide text-muted-foreground">XP</div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* class picker sheet */}
      {open ? (
        <div className="absolute inset-0 z-50">
          <button aria-label="Close" className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <motion.div
            role="dialog"
            aria-label="Pick a class"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="absolute inset-x-0 bottom-0 max-h-[70%] overflow-hidden rounded-t-[28px] border-t border-border bg-card shadow-2xl"
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
            <h3 className="px-5 pb-1 pt-3 text-base font-bold text-foreground">Rank which class?</h3>
            <div className="j-app-scroll max-h-[52vh] overflow-y-auto px-4 pb-5 pt-2">
              <button
                onClick={() => {
                  onClass("");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition active:scale-[0.99]",
                  !classId ? "border-primary/50 bg-primary/5" : "border-border/70 hover:bg-muted/40"
                )}
              >
                <div className="j-grad-primary grid size-10 shrink-0 place-items-center rounded-2xl text-white">
                  <Users className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-black text-foreground">All students</div>
                  <div className="text-[11px] text-muted-foreground">Every learner on the platform</div>
                </div>
                {!classId ? <span className="text-[11px] font-black text-primary">Selected</span> : null}
              </button>
              {(lb?.classes || []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onClass(c.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "mt-2.5 flex w-full items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition active:scale-[0.99]",
                    classId === c.id ? "border-primary/50 bg-primary/5" : "border-border/70 hover:bg-muted/40"
                  )}
                >
                  <div className="j-grad-cyan grid size-10 shrink-0 place-items-center rounded-2xl text-white">
                    <CalendarDays className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-black text-foreground">{c.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {c.subject} · {c.enrolled} enrolled · {c.status}
                    </div>
                  </div>
                  {classId === c.id ? <span className="shrink-0 text-[11px] font-black text-primary">Selected</span> : null}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      ) : null}

      {/* message the cohort sheet */}
      <Sheet open={msgOpen} onOpenChange={setMsgOpen} title="Message the class">
        <div>
          <div className="flex items-center gap-2.5 rounded-2xl bg-primary/8 px-3.5 py-3">
            <Megaphone className="size-4.5 shrink-0 text-primary" />
            <div className="min-w-0 text-[12px] leading-snug">
              <span className="font-black text-foreground">To: </span>
              <span className="font-semibold text-muted-foreground">
                {activeClass ? activeClass.title : "All students"} · {rows.length} learner{rows.length === 1 ? "" : "s"}
              </span>
              <div className="text-[11px] text-muted-foreground">They&apos;ll get it as an in-app notification instantly.</div>
            </div>
          </div>

          <label className="mt-4 block text-[11px] font-black uppercase tracking-wider text-muted-foreground" htmlFor="msg-title">
            Title
          </label>
          <input
            id="msg-title"
            value={msgTitle}
            onChange={(e) => setMsgTitle(e.target.value.slice(0, 90))}
            placeholder="e.g. Revision quiz on Friday"
            className="mt-1.5 min-h-12 w-full rounded-2xl border-2 border-border bg-card px-4 text-[14px] font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />

          <label className="mt-3.5 block text-[11px] font-black uppercase tracking-wider text-muted-foreground" htmlFor="msg-body">
            Message
          </label>
          <textarea
            id="msg-body"
            value={msgBody}
            onChange={(e) => setMsgBody(e.target.value.slice(0, 400))}
            placeholder="Write your announcement — homework, reminders, encouragement…"
            rows={4}
            className="mt-1.5 w-full resize-none rounded-2xl border-2 border-border bg-card px-4 py-3 text-[14px] leading-relaxed text-foreground placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
          <div className="mt-1 text-right text-[10.5px] font-bold text-muted-foreground">{msgBody.length}/400</div>

          <button
            onClick={sendMessage}
            disabled={msgBusy || msgTitle.trim().length < 3 || msgBody.trim().length < 3}
            className="j-grad-primary mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-50"
          >
            <Megaphone className="size-4.5" /> {msgBusy ? "Sending…" : "Send to class"}
          </button>
        </div>
      </Sheet>
    </>
  );
}

function Stat({ icon, label, value, grad }: { icon: React.ReactNode; label: string; value: React.ReactNode; grad: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("rounded-[22px] bg-gradient-to-br p-4 text-white shadow-lg", grad)}>
      <div className="flex items-center justify-between">
        <span className="text-2xl font-black">{value}</span>
        {icon}
      </div>
      <div className="mt-1 text-[11.5px] font-bold text-white/85">{label}</div>
    </motion.div>
  );
}
