"use client";
// JeduAI — Learning insights: XP chart, activity breakdown and library totals
import React from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Flame,
  TrendingUp,
  MessagesSquare,
  Languages,
  FileText,
  Clapperboard,
  ListChecks,
  CheckSquare,
  Video,
  ClipboardCheck,
  Layers,
  BookA,
  Timer,
  Sparkles,
  Trophy,
  CalendarCheck,
  GraduationCap,
  Target,
  BookMarked,
} from "lucide-react";
import { api, useJedu } from "../store";
import { Card, EmptyState, ErrorState, Loader, Segmented, TopBar } from "../ui";
import { cn } from "@/lib/utils";

type Stats = {
  range: "week" | "month" | "all";
  days: string[];
  xpByDay: number[];
  byType: Record<string, number>;
  heat: { days: string[]; cells: { xp: number; count: number }[] };
  subjects: {
    subject: string;
    chats: number;
    quizAttempts: number;
    quizAvgPct: number | null;
    tasksDone: number;
    studyMinutes: number;
  }[];
  totals: {
    xp: number;
    chats: number;
    translations: number;
    documents: number;
    videos: number;
    quizzes: number;
    tasks: number;
    classesJoined: number;
    assessments: number;
    flashcardSessions: number;
    vocabSessions: number;
    focusSessions: number;
    focusMinutes: number;
  };
  goal: {
    goalMin: number;
    xpTarget: number;
    days: number;
    hits: boolean[];
    hitDays: number;
    bestRun: number;
  };
  bestDay: { day: string; points: number } | null;
  library: {
    documents: number;
    documentsInRange: number;
    mediaProjects: number;
    mediaInRange: number;
    mediaMinutes: number;
    translations: number;
    translationsInRange: number;
    quizAttempts: number;
    quizInRange: number;
    quizAvgPct: number | null;
    vocabWords: number;
    vocabMastered: number;
    vocabInRange: number;
    flashcards: number;
    flashcardsMastered: number;
    flashcardsInRange: number;
    tasksDone: number;
    studyMinutesPlanned: number;
    assessments: number;
    classesJoined: number;
  };
};

const TYPE_META: { type: string; label: string; icon: React.ElementType; tone: string }[] = [
  { type: "chat", label: "Tutor chats", icon: MessagesSquare, tone: "text-primary" },
  { type: "translate", label: "Translations", icon: Languages, tone: "text-j-cyan" },
  { type: "document_done", label: "Documents translated", icon: FileText, tone: "text-j-success" },
  { type: "video_done", label: "Media projects", icon: Clapperboard, tone: "text-j-warning" },
  { type: "quiz_done", label: "Quizzes taken", icon: ListChecks, tone: "text-j-violet" },
  { type: "flashcards", label: "Flashcard sessions", icon: Layers, tone: "text-j-violet" },
  { type: "vocab", label: "Vocab practice", icon: BookA, tone: "text-j-success" },
  { type: "focus", label: "Focus sessions", icon: Timer, tone: "text-j-error" },
  { type: "task_done", label: "Study tasks", icon: CheckSquare, tone: "text-primary" },
  { type: "class_joined", label: "Classes joined", icon: Video, tone: "text-j-cyan" },
  { type: "assessment_done", label: "Assessments", icon: ClipboardCheck, tone: "text-j-warning" },
];

const RANGE_LABEL: Record<Stats["range"], string> = {
  week: "this week",
  month: "this month",
  all: "all time",
};

export default function InsightsScreen() {
  const pop = useJedu((s) => s.pop);
  const user = useJedu((s) => s.user)!;
  const [range, setRange] = React.useState<Stats["range"]>("week");
  const [data, setData] = React.useState<Stats | null>(null);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    let live = true;
    setData(null);
    setErr("");
    api<Stats>(`/api/jeduai/stats?range=${range}`)
      .then((r) => live && setData(r))
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [range]);

  const activeDays = data ? data.xpByDay.filter((x) => x > 0).length : 0;
  const maxXp = Math.max(10, ...(data?.xpByDay || [0]));
  const breakdown = data
    ? TYPE_META.filter((t) => (data.byType[t.type] || 0) > 0).sort((a, b) => (data.byType[b.type] || 0) - (data.byType[a.type] || 0))
    : [];
  const maxType = Math.max(1, ...breakdown.map((t) => data?.byType[t.type] || 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar onBack={pop} title="Learning insights" subtitle={`Your numbers, ${user.name.split(" ")[0]} 📊`} />

      <div className="border-b border-border/70 bg-card/60 px-4 py-3">
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: "week", label: "This week" },
            { value: "month", label: "This month" },
            { value: "all", label: "All time" },
          ]}
        />
      </div>

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {err ? (
          <ErrorState message={err} onRetry={() => setRange(range)} />
        ) : !data ? (
          <Loader label="Crunching your numbers…" />
        ) : (
          <>
            {/* hero */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="j-grad-primary j-shadow-soft rounded-[26px] p-5 text-white">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white/75">
                    <Zap className="size-3.5" /> XP earned {RANGE_LABEL[data.range]}
                  </div>
                  <div className="mt-1 text-4xl font-black">{data.totals.xp}</div>
                </div>
                <div className="rounded-2xl bg-white/15 px-3 py-2 text-center backdrop-blur-sm">
                  <div className="flex items-center gap-1 text-[15px] font-black">
                    <Flame className="size-4" /> {user.streak}
                  </div>
                  <div className="text-[9px] font-black uppercase tracking-wider text-white/75">day streak</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm">
                  <CalendarCheck className="mr-1 inline size-3" /> {activeDays} active {activeDays === 1 ? "day" : "days"}
                </span>
                {data.bestDay ? (
                  <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm">
                    <Trophy className="mr-1 inline size-3" /> Best day: {data.bestDay.points} XP
                  </span>
                ) : null}
                {data.totals.focusMinutes > 0 ? (
                  <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm">
                    <Timer className="mr-1 inline size-3" /> {data.totals.focusMinutes} focused min
                  </span>
                ) : null}
              </div>
            </motion.div>

            {/* daily-goal consistency */}
            <h2 className="mb-2.5 mt-6 px-1 text-[15px] font-bold text-foreground">Goal consistency</h2>
            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-black text-foreground">
                    {data.goal.hitDays} of {data.goal.days} {data.goal.days === 1 ? "day" : "days"} hit your goal
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    Target {data.goal.xpTarget} XP/day ({data.goal.goalMin} min goal) · best run {data.goal.bestRun}{" "}
                    {data.goal.bestRun === 1 ? "day" : "days"} 🔥
                  </div>
                </div>
                <div
                  className="grid size-14 shrink-0 place-items-center rounded-full"
                  style={{
                    background: `conic-gradient(var(--primary) ${Math.round(
                      (data.goal.hitDays / Math.max(1, data.goal.days)) * 360
                    )}deg, color-mix(in srgb, var(--muted) 70%, transparent) 0deg)`,
                  }}
                  role="img"
                  aria-label={`Goal hit rate ${Math.round((data.goal.hitDays / Math.max(1, data.goal.days)) * 100)} percent`}
                >
                  <div className="grid size-11 place-items-center rounded-full bg-card">
                    <span className="text-[13px] font-black text-primary">
                      {Math.round((data.goal.hitDays / Math.max(1, data.goal.days)) * 100)}%
                    </span>
                  </div>
                </div>
              </div>
              <div className={cn("mt-3.5 flex flex-wrap gap-1.5", data.goal.days > 7 && "gap-1")}>
                {data.goal.hits.map((hit, i) => {
                  const dayXp = data.xpByDay[i];
                  const isToday = i === data.goal.hits.length - 1;
                  const dotSize = data.goal.days > 7 ? "size-5" : "flex-1 min-w-0";
                  return (
                    <div key={i} className={cn("flex flex-col items-center gap-1", data.goal.days > 7 ? "w-[calc(50%/15)]" : dotSize)}>
                      <div
                        title={`${data.days[i]}: ${dayXp} XP${hit ? " · goal hit" : ""}`}
                        className={cn(
                          "grid place-items-center rounded-full text-[8.5px] font-black transition",
                          data.goal.days > 7 ? "size-5" : "size-8",
                          hit
                            ? "bg-j-success text-white"
                            : dayXp > 0
                              ? "bg-j-warning/25 text-j-warning ring-1 ring-j-warning/50"
                              : "bg-muted text-muted-foreground",
                          isToday && "ring-2 ring-primary ring-offset-1 ring-offset-card"
                        )}
                        aria-hidden
                      >
                        {data.goal.days > 7 ? "" : hit ? "✓" : dayXp > 0 ? "·" : ""}
                      </div>
                      {data.goal.days <= 7 ? (
                        <span className={cn("text-[9px] font-bold", isToday ? "text-primary" : "text-muted-foreground")}>
                          {["S", "M", "T", "W", "T", "F", "S"][new Date(data.days[i] + "T12:00").getDay()]}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-2.5 text-[10px] font-semibold text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-full bg-j-success" /> hit
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-full bg-j-warning/25 ring-1 ring-j-warning/50" /> active, below goal
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-full bg-muted" /> rest day
                </span>
              </div>
            </Card>

            {/* 13-week activity heatmap */}
            <h2 className="mb-2.5 mt-6 px-1 text-[15px] font-bold text-foreground">Consistency map</h2>
            <Card className="p-4">
              <Heatmap days={data.heat.days} cells={data.heat.cells} />
            </Card>

            {/* XP chart */}
            <h2 className="mb-2.5 mt-6 px-1 text-[15px] font-bold text-foreground">XP per day</h2>
            <Card className="p-4">
              <div className={cn("flex items-end gap-1", data.days.length > 10 ? "h-32" : "h-28")}>
                {data.xpByDay.map((p, i) => {
                  const h = Math.max(8, (p / maxXp) * (data.days.length > 10 ? 100 : 88));
                  const isToday = i === data.days.length - 1;
                  return (
                    <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      {p > 0 ? (
                        <span className={cn("text-[9px] font-black", isToday ? "text-primary" : "text-muted-foreground")}>
                          {data.days.length > 10 && i % 5 !== 0 && !isToday ? "" : p}
                        </span>
                      ) : null}
                      <motion.div
                        initial={{ height: 4 }}
                        animate={{ height: h }}
                        transition={{ delay: Math.min(i * 0.02, 0.4), type: "spring", stiffness: 200, damping: 22 }}
                        className={cn(
                          "w-full rounded-t-md ring-1 ring-inset",
                          p === 0 ? "bg-muted-foreground/15 ring-border" : isToday ? "j-grad-primary ring-transparent" : p >= maxXp * 0.66 ? "bg-primary/70 ring-primary/20" : "bg-primary/35 ring-primary/15"
                        )}
                        style={{ maxHeight: data.days.length > 10 ? 100 : 88 }}
                      />
                      <span className={cn("text-[9px] font-bold", isToday ? "text-primary" : "text-muted-foreground")}>
                        {data.days.length > 10
                          ? i % 5 === 0
                            ? data.days[i].slice(8)
                            : isToday
                              ? "Today"
                              : ""
                          : ["S", "M", "T", "W", "T", "F", "S"][new Date(data.days[i] + "T12:00").getDay()]}
                      </span>
                    </div>
                  );
                })}
              </div>
              {data.range !== "all" ? (
                <div className="mt-2 border-t border-border/60 pt-2 text-center text-[11px] font-semibold text-muted-foreground">
                  {RANGE_LABEL[data.range]}: <span className="font-black text-foreground">{data.totals.xp} XP</span> across {activeDays} active{" "}
                  {activeDays === 1 ? "day" : "days"}
                </div>
              ) : (
                <div className="mt-2 border-t border-border/60 pt-2 text-center text-[11px] font-semibold text-muted-foreground">
                  Chart shows the last 30 days · lifetime total{" "}
                  <span className="font-black text-foreground">{user.points} XP</span>
                </div>
              )}
            </Card>

            {/* activity breakdown */}
            <h2 className="mb-2.5 mt-6 px-1 text-[15px] font-bold text-foreground">What you did {RANGE_LABEL[data.range]}</h2>
            {breakdown.length ? (
              <Card className="divide-y divide-border/60 p-0">
                {breakdown.map((t, i) => {
                  const n = data.byType[t.type] || 0;
                  const Icon = t.icon;
                  return (
                    <div key={t.type} className="relative overflow-hidden px-4 py-3">
                      <div
                        className="absolute inset-y-0 left-0 rounded-r-md bg-primary/12"
                        style={{ width: `${Math.max(3, Math.round((n / maxType) * 100))}%` }}
                      />
                      <div className="relative flex items-center gap-3">
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl bg-muted/70", t.tone)}>
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-foreground">{t.label}</span>
                        <span className="shrink-0 text-[13.5px] font-black text-foreground">
                          {n}
                          <span className="ml-1 text-[10px] font-bold text-muted-foreground">
                            {t.type === "focus" && data.totals.focusMinutes > 0
                              ? `· ${data.totals.focusMinutes} min`
                              : n === 1
                                ? "time"
                                : "times"}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </Card>
            ) : (
              <EmptyState icon="🌱" title="Nothing logged yet" body="Chat with the tutor, translate something or take a quiz — it all shows up here." />
            )}

            {/* subject strength */}
            {data.subjects.length ? (
              <>
                <h2 className="mb-2.5 mt-6 px-1 text-[15px] font-bold text-foreground">By subject</h2>
                <Card className="divide-y divide-border/60 p-0">
                  {data.subjects.map((s) => {
                    const score = s.chats + s.quizAttempts * 2 + s.tasksDone;
                    const maxScore = Math.max(
                      1,
                      ...data.subjects.map((x) => x.chats + x.quizAttempts * 2 + x.tasksDone)
                    );
                    return (
                      <div key={s.subject} className="relative overflow-hidden px-4 py-3">
                        <div
                          className="absolute inset-y-0 left-0 rounded-r-md bg-j-violet/12"
                          style={{ width: `${Math.max(4, Math.round((score / maxScore) * 100))}%` }}
                        />
                        <div className="relative flex items-center gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-j-violet/10 text-j-violet">
                            <BookMarked className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-black text-foreground">{s.subject}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-semibold text-muted-foreground">
                              {s.chats > 0 ? (
                                <span className="flex items-center gap-1">
                                  <MessagesSquare className="size-3 text-primary" /> {s.chats} chat{s.chats === 1 ? "" : "s"}
                                </span>
                              ) : null}
                              {s.quizAttempts > 0 ? (
                                <span className="flex items-center gap-1">
                                  <Target className="size-3 text-primary" />
                                  {s.quizAvgPct != null ? `${s.quizAvgPct}% quiz avg` : `${s.quizAttempts} quizzes`}
                                </span>
                              ) : null}
                              {s.tasksDone > 0 ? (
                                <span className="flex items-center gap-1">
                                  <CheckSquare className="size-3 text-j-success" /> {s.tasksDone} task{s.tasksDone === 1 ? "" : "s"}
                                  {s.studyMinutes > 0 ? ` · ${s.studyMinutes}m` : ""}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </Card>
              </>
            ) : null}

            {/* library totals */}
            <h2 className="mb-2.5 mt-6 px-1 text-[15px] font-bold text-foreground">Your library, all time</h2>
            <div className="grid grid-cols-2 gap-3">
              <LibTile icon={<FileText className="size-4" />} label="Documents" value={data.library.documents} note={`${data.library.documentsInRange} ${RANGE_LABEL[data.range]}`} tone="bg-j-success/10 text-j-success" />
              <LibTile icon={<Clapperboard className="size-4" />} label="Media projects" value={data.library.mediaProjects} note={data.library.mediaMinutes > 0 ? `${data.library.mediaMinutes} min translated` : `${data.library.mediaInRange} ${RANGE_LABEL[data.range]}`} tone="bg-j-warning/10 text-j-warning" />
              <LibTile icon={<Languages className="size-4" />} label="Translations" value={data.library.translations} note={`${data.library.translationsInRange} ${RANGE_LABEL[data.range]}`} tone="bg-j-cyan/10 text-j-cyan" />
              <LibTile icon={<Target className="size-4" />} label="Quiz average" value={data.library.quizAvgPct != null ? `${data.library.quizAvgPct}%` : "—"} note={`${data.library.quizAttempts} attempts`} tone="bg-primary/10 text-primary" />
              <LibTile icon={<BookA className="size-4" />} label="Vocab words" value={data.library.vocabWords} note={`${data.library.vocabMastered} mastered`} tone="bg-j-success/10 text-j-success" />
              <LibTile icon={<Layers className="size-4" />} label="Flashcards" value={data.library.flashcards} note={`${data.library.flashcardsMastered} mastered`} tone="bg-j-violet/10 text-j-violet" />
              <LibTile icon={<Timer className="size-4" />} label="Focused minutes" value={data.totals.focusMinutes} note={`${data.totals.focusSessions} sessions ${RANGE_LABEL[data.range]}`} tone="bg-j-error/10 text-j-error" />
              <LibTile icon={<CheckSquare className="size-4" />} label="Tasks done" value={data.library.tasksDone} note={`${data.library.studyMinutesPlanned} planned min`} tone="bg-primary/10 text-primary" />
              <LibTile icon={<Video className="size-4" />} label="Enrolled classes" value={data.library.classesJoined} note="all time" tone="bg-j-cyan/10 text-j-cyan" />
              <LibTile icon={<ClipboardCheck className="size-4" />} label="Assessments" value={data.library.assessments} note="submitted" tone="bg-j-warning/10 text-j-warning" />
            </div>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
              <GraduationCap className="size-3.5" /> Keep going — consistency beats intensity.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// GitHub-style 13-week activity heatmap. Cells flow column-major (top→bottom =
// Sun→Sat), one column per week; month labels appear when the month changes and
// are tappable to zoom into that month's day-by-day detail.
function Heatmap({ days, cells }: { days: string[]; cells: { xp: number; count: number }[] }) {
  const [picked, setPicked] = React.useState<number | null>(null);
  const [zoom, setZoom] = React.useState<string | null>(null); // "YYYY-MM" of the zoomed month
  const maxXp = Math.max(1, ...cells.map((c) => c.xp));
  const activeDays = cells.filter((c) => c.xp > 0).length;
  const totalXp = cells.reduce((s, c) => s + c.xp, 0);

  // level 0..4 for color intensity
  const levelOf = (xp: number) => (xp === 0 ? 0 : xp <= maxXp / 4 ? 1 : xp <= maxXp / 2 ? 2 : xp <= (maxXp * 3) / 4 ? 3 : 4);
  const LEVEL_BG = [
    "bg-muted/60 ring-border/60",
    "bg-primary/25 ring-primary/15",
    "bg-primary/45 ring-primary/20",
    "bg-primary/70 ring-primary/25",
    "bg-primary ring-primary/40",
  ];

  // weekday offset of the first day so columns align to calendar weeks (Sun start)
  const firstDow = new Date(days[0] + "T12:00").getDay();
  const grid: (null | { i: number; day: string; xp: number; count: number })[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...days.map((d, i) => ({ i, day: d, xp: cells[i].xp, count: cells[i].count })),
  ];
  const weeks = Math.ceil(grid.length / 7);

  // month label + zoom key for each week column (label when the month changes vs previous column)
  const monthCols: { key: string; label: string | null }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const cell = grid.slice(w * 7, w * 7 + 7).find((c) => c);
    const m = cell ? new Date(cell.day + "T12:00").getMonth() : -1;
    if (cell && m !== lastMonth) {
      monthCols.push({
        key: cell.day.slice(0, 7),
        label: new Date(cell.day + "T12:00").toLocaleString("en", { month: "short" }),
      });
      lastMonth = m;
    } else monthCols.push({ key: "", label: null });
  }

  const fmtDay = (iso: string) =>
    new Date(iso + "T12:00").toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });

  // zoomed-month slices (day index + value) + summary
  const zoomedCells = zoom
    ? days
        .map((d, i) => ({ d, i, xp: cells[i].xp, count: cells[i].count }))
        .filter((x) => x.d.startsWith(zoom))
    : [];
  const zoomActive = zoomedCells.filter((c) => c.xp > 0).length;
  const zoomXp = zoomedCells.reduce((s, c) => s + c.xp, 0);
  const zoomBest = zoomedCells.reduce((b, c) => (c.xp > (b?.xp ?? 0) ? c : b), undefined as { d: string; xp: number } | undefined);
  const zoomTitle = zoom
    ? new Date(zoom + "-02T12:00").toLocaleDateString("en", { month: "long", year: "numeric" })
    : "";

  return (
    <div>
      {/* month labels — tappable to zoom into that month */}
      <div className="flex gap-[3px] pl-[18px] text-[9px] font-bold">
        {monthCols.map((m, w) =>
          m.label ? (
            <button
              key={w}
              onClick={() => setZoom(zoom === m.key ? null : m.key)}
              aria-pressed={zoom === m.key}
              aria-label={`Zoom into ${new Date(m.key + "-02T12:00").toLocaleDateString("en", { month: "long", year: "numeric" })}`}
              className={cn(
                "min-w-0 flex-1 truncate text-left uppercase tracking-wide underline decoration-dotted decoration-muted-foreground/50 underline-offset-[3px] transition",
                zoom === m.key ? "text-primary decoration-primary/60" : "text-muted-foreground hover:text-foreground hover:decoration-foreground/50"
              )}
            >
              {m.label}
            </button>
          ) : (
            <span key={w} className="min-w-0 flex-1" aria-hidden />
          )
        )}
      </div>
      <div className="mt-1 flex gap-1.5">
        {/* weekday markers */}
        <div className="flex w-[14px] shrink-0 flex-col gap-[3px] text-[9px] font-bold leading-none text-muted-foreground" aria-hidden>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, r) => (
            <span key={r} className="flex h-[calc((100%-18px)/7)] items-center">
              {r % 2 === 1 ? d : ""}
            </span>
          ))}
        </div>
        {/* grid */}
        <div
          className="grid flex-1 grid-flow-col gap-[3px]"
          style={{ gridTemplateRows: "repeat(7, 1fr)", gridTemplateColumns: `repeat(${weeks}, 1fr)` }}
          role="img"
          aria-label={`Activity heatmap of the last 13 weeks: ${activeDays} active days, ${totalXp} XP earned.`}
        >
          {Array.from({ length: weeks * 7 }, (_, k) => {
            const cell = grid[k];
            if (!cell) return <span key={k} aria-hidden />;
            const lvl = levelOf(cell.xp);
            const isToday = k === grid.length - 1;
            return (
              <button
                key={k}
                onClick={() => setPicked(picked === cell.i ? null : cell.i)}
                title={`${fmtDay(cell.day)} · ${cell.xp} XP${cell.count ? ` · ${cell.count} activities` : ""}`}
                aria-label={`${fmtDay(cell.day)}: ${cell.xp} XP${cell.count ? ` from ${cell.count} activities` : ""}`}
                className={cn(
                  "aspect-square rounded-[4px] ring-1 ring-inset transition-transform",
                  LEVEL_BG[lvl],
                  isToday && "ring-2 ring-primary/60",
                  picked === cell.i && "scale-110 ring-2 ring-primary"
                )}
              />
            );
          })}
        </div>
      </div>
      {/* legend + summary */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold text-muted-foreground">
          {activeDays} active {activeDays === 1 ? "day" : "days"} · {totalXp} XP in 13 weeks
        </span>
        <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
          Less
          {LEVEL_BG.map((bg, i) => (
            <span key={i} className={cn("size-2.5 rounded-[3px] ring-1 ring-inset", bg)} aria-hidden />
          ))}
          More
        </span>
      </div>
      {/* month zoom panel */}
      {zoom ? (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 rounded-2xl border border-primary/25 bg-primary/5 p-3.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-black text-foreground">{zoomTitle}</div>
              <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                {zoomActive} active {zoomActive === 1 ? "day" : "days"} · {zoomXp} XP
                {zoomBest && zoomBest.xp > 0 ? ` · best ${new Date(zoomBest.d + "T12:00").toLocaleDateString("en", { month: "short", day: "numeric" })} (${zoomBest.xp} XP)` : ""}
              </div>
            </div>
            <button
              onClick={() => setZoom(null)}
              aria-label="Close month view"
              className="-mt-0.5 -mr-0.5 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1">
            {zoomedCells.map((c) => {
              const lvl = levelOf(c.xp);
              const isToday = c.i === days.length - 1;
              return (
                <button
                  key={c.d}
                  onClick={() => setPicked(picked === c.i ? null : c.i)}
                  title={`${fmtDay(c.d)} · ${c.xp} XP${c.count ? ` · ${c.count} activities` : ""}`}
                  aria-label={`${fmtDay(c.d)}: ${c.xp} XP${c.count ? ` from ${c.count} activities` : ""}`}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center rounded-lg text-[11px] font-black leading-none ring-1 ring-inset transition-transform",
                    c.xp > 0 ? (lvl >= 2 ? "text-white" : "text-foreground") : "text-muted-foreground/60",
                    LEVEL_BG[lvl],
                    isToday && "ring-2 ring-primary/60",
                    picked === c.i && "scale-105 ring-2 ring-primary"
                  )}
                >
                  {Number(c.d.slice(8))}
                  <span className={cn("mt-0.5 text-[9px] font-bold", c.xp > 0 ? (lvl >= 2 ? "text-white/85" : "text-foreground/70") : "text-muted-foreground/40")}>
                    {c.xp > 0 ? `${c.xp}` : "·"}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>
      ) : null}
      {/* picked day detail */}
      {picked != null ? (
        <div className="mt-2.5 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-[11.5px]">
          <span className="font-bold text-foreground">{fmtDay(days[picked])}</span>
          <span className="font-black text-primary">
            {cells[picked].xp} XP{cells[picked].count ? ` · ${cells[picked].count} activities` : " · rest day"}
          </span>
        </div>
      ) : activeDays === 0 ? (
        <p className="mt-2.5 text-center text-[10.5px] leading-relaxed text-muted-foreground">
          Nothing lit yet — chat with the tutor or translate something today, and watch this map fill up. 🌱
        </p>
      ) : (
        <p className="mt-2.5 text-center text-[10.5px] text-muted-foreground">Tap a square for a day · a month name to zoom</p>
      )}
    </div>
  );
}

function LibTile({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  note: string;
  tone: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-[20px] border border-border/70 bg-card p-3.5">
      <div className={cn("grid size-8 place-items-center rounded-xl", tone)}>{icon}</div>
      <div className="mt-2 text-[19px] font-black leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[11.5px] font-bold text-foreground/80">{label}</div>
      <div className="mt-0.5 truncate text-[10px] font-semibold text-muted-foreground">{note}</div>
    </motion.div>
  );
}
