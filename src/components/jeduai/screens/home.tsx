"use client";
// JeduAI — Home dashboard
import React from "react";
import { motion } from "framer-motion";
import {
  Search,
  Bell,
  Flame,
  Sparkles,
  FileText,
  Clapperboard,
  Target,
  ListChecks,
  BookOpen,
  MessagesSquare,
  ArrowRight,
  Zap,
  ClipboardList,
  CalendarClock,
  TrendingUp,
  Layers,
  Brain,
  Timer,
  BookMarked,
  NotebookPen,
  ChevronRight,
} from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Avatar, Card, Chip, EmptyState, ErrorState, Loader, Section, StatusPill, UnreadBadge } from "../ui";
import { cn } from "@/lib/utils";

type Dash = {
  greeting: {
    name: string;
    streak: number;
    points: number;
    level: number;
    inLevel: number;
    toNext: number;
    todayPoints: number;
    goalMin: number;
  };
  weekDays: string[];
  weekPoints: number[];
  continueLearning: { kind: string; id: string; title: string; progress: number; subtitle: string }[];
  recent: {
    documents: { id: string; title: string; status: string; progress: number; at: string }[];
    videos: { id: string; title: string; status: string; progress: number; at: string }[];
    quizzes: { id: string; title: string; score: number; total: number; at: string }[];
    translations: { id: string; from: string; to: string; preview: string; at: string }[];
    conversations: { id: string; title: string; subject: string; at: string }[];
  };
  upcomingClasses: { id: string; title: string; subject: string; at: string; durationMin: number }[];
  openAssessments: { id: string; title: string; subject: string; dueAt: string | null; totalMarks: number }[];
  flashcardsDue: {
    total: number;
    top: { deck: string; title: string; due: number; sourceType: string } | null;
    decks: { deck: string; title: string; due: number; sourceType: string }[];
  } | null;
  counts: { documents: number; videos: number; quizzes: number; translations: number };
};

export default function HomeScreen() {
  const user = useJedu((s) => s.user)!;
  const push = useJedu((s) => s.push);
  const unread = useJedu((s) => s.unread);
  const [data, setData] = React.useState<Dash | null>(null);
  const [err, setErr] = React.useState("");
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setData(null);
    setErr("");
    api<Dash>("/api/jeduai/dashboard")
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [reload]);

  const hour = new Date().getHours();
  const greet = hour < 5 ? "Burning the midnight oil" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <header className="j-grad-hero sticky top-0 z-30 border-b border-border/60 px-5 pb-4 pt-[max(env(safe-area-inset-top),14px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => push({ name: "profile" })} aria-label="Profile" className="shrink-0 transition active:scale-95">
            <Avatar name={user.name} color={user.avatarColor} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-black leading-tight text-foreground">
              {greet}, {user.name.split(" ")[0]} 👋
            </div>
            <div className="text-xs text-muted-foreground">
              {user.educationLevel} · {user.explanationLang} · Lv {data?.greeting.level ?? 1}
            </div>
          </div>
          <button
            onClick={() => push({ name: "search" })}
            aria-label="Search learning content"
            className="grid size-10 place-items-center rounded-full bg-card text-foreground/80 shadow-sm ring-1 ring-border transition hover:text-primary active:scale-95"
          >
            <Search className="size-5" />
          </button>
          <button
            onClick={() => push({ name: "notifications" })}
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            className="relative grid size-10 place-items-center rounded-full bg-card text-foreground/80 shadow-sm ring-1 ring-border transition hover:text-primary active:scale-95"
          >
            <Bell className="size-5" />
            <UnreadBadge />
          </button>
        </div>

        {/* streak + points */}
        <div className="mt-3 flex gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-j-warning/12 px-3 py-2 ring-1 ring-j-warning/25">
            <Flame className="size-5 text-j-warning" />
            <div className="leading-tight">
              <div className="text-[15px] font-black text-foreground">{data?.greeting.streak ?? user.streak}</div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">day streak</div>
            </div>
          </div>
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-primary/10 px-3 py-2 ring-1 ring-primary/25">
            <Zap className="size-5 text-primary" />
            <div className="leading-tight">
              <div className="text-[15px] font-black text-foreground">{data?.greeting.points ?? user.points}</div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">XP · Lv {data?.greeting.level ?? 1}</div>
            </div>
          </div>
          <button
            onClick={() => push({ name: "quizzes" })}
            className="flex items-center gap-2 rounded-2xl bg-j-success/12 px-3 py-2 ring-1 ring-j-success/25 transition active:scale-95"
          >
            <Target className="size-5 text-j-success" />
            <div className="text-left leading-tight">
              <div className="text-[15px] font-black text-foreground">{data?.greeting.todayPoints ?? 0}</div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">today</div>
            </div>
          </button>
        </div>
      </header>

      <div className="j-app-scroll flex-1 overflow-y-auto px-5 pb-6">
        {err ? (
          <div className="mt-4">
            <ErrorState message={err} onRetry={() => setReload(reload + 1)} />
          </div>
        ) : !data ? (
          <div className="mt-6 space-y-4">
            <div className="j-shadow-soft h-40 animate-pulse rounded-3xl bg-muted" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* daily goal hero */}
            <GoalHero data={data} />

            {/* flashcards due reminder */}
            {data.flashcardsDue && data.flashcardsDue.total > 0 ? <DueBanner data={data} /> : null}

            {/* quick actions */}
            <Section title="Quick actions">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Sparkles, label: "AI Tutor", grad: "from-[#5B5FEF] to-[#773DE8]", go: () => push({ name: "tutor" }) },
                  { icon: FileText, label: "Translate doc", grad: "from-[#20B486] to-[#39C6F4]", go: () => push({ name: "documents" }) },
                  { icon: Clapperboard, label: "Media studio", grad: "from-[#F5A623] to-[#E85D75]", go: () => push({ name: "video" }) },
                  { icon: Target, label: "Quiz me", grad: "from-[#773DE8] to-[#5B5FEF]", go: () => push({ name: "quizzes" }) },
                  { icon: Layers, label: "Flashcards", grad: "from-[#E85D75] to-[#F5A623]", go: () => push({ name: "flashcards" }) },
                  { icon: Timer, label: "Focus", grad: "from-[#20B486] to-[#39C6F4]", go: () => push({ name: "focus" }) },
                  { icon: ListChecks, label: "Planner", grad: "from-[#39C6F4] to-[#5B5FEF]", go: () => push({ name: "planner" }) },
                  { icon: BookMarked, label: "Words", grad: "from-[#39C6F4] to-[#20B486]", go: () => push({ name: "vocab" }) },
                  { icon: CalendarClock, label: "Classes", grad: "from-[#E85D75] to-[#773DE8]", go: () => push({ name: "classes" }) },
                ].map((a, i) => (
                  <motion.button
                    key={a.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={a.go}
                    className="j-shadow-soft flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border/70 bg-card p-2 transition active:scale-[0.96]"
                  >
                    <span className={cn("grid size-11 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-md", a.grad)}>
                      <a.icon className="size-5" />
                    </span>
                    <span className="text-[11.5px] font-bold text-foreground">{a.label}</span>
                  </motion.button>
                ))}
              </div>
            </Section>

            {/* AI Notebook Studio banner */}
            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              onClick={() => push({ name: "notebook-studio" })}
              className="j-shadow-soft relative mt-3 flex w-full items-center gap-3.5 overflow-hidden rounded-3xl bg-gradient-to-r from-j-violet to-j-violet/80 p-4 text-left text-white transition active:scale-[0.98]"
            >
              <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 size-32 rounded-full bg-white/12" />
              <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-white/18 backdrop-blur">
                <NotebookPen className="size-6" />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="block text-[15px] font-black leading-tight">AI Notebook Studio</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-white/85">
                  Upload sources · ask with citations · generate audio, video, mind maps & more
                </span>
              </span>
              <ChevronRight className="relative size-5 shrink-0 text-white/90" />
            </motion.button>

            {/* continue learning */}
            {data.continueLearning.length ? (
              <Section
                title="Continue learning"
                action={
                  <button onClick={() => useJedu.getState().setTab("library")} className="text-[13px] font-bold text-primary">
                    My library →
                  </button>
                }
              >
                <div className="j-app-scroll -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
                  {data.continueLearning.map((c) => {
                    const done = c.progress >= 100;
                    return (
                      <Card
                        key={c.kind + c.id}
                        onClick={() =>
                          push(c.kind === "document" ? { name: "document-reader", id: c.id } : { name: "video-studio", id: c.id })
                        }
                        className="w-56 shrink-0 p-4"
                      >
                        <div className="flex items-center gap-2">
                          {c.kind === "document" ? (
                            <BookOpen className="size-4 text-primary" />
                          ) : (
                            <Clapperboard className="size-4 text-j-warning" />
                          )}
                          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.kind}</span>
                        </div>
                        <div className="mt-1.5 line-clamp-2 min-h-10 text-[13.5px] font-bold leading-tight text-foreground">
                          {c.title}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{c.subtitle}</div>
                        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full", done ? "bg-j-success" : "j-grad-primary")}
                            style={{ width: `${Math.max(6, c.progress)}%` }}
                          />
                        </div>
                        <div className="mt-1.5 text-[11px] font-bold text-muted-foreground">
                          {done ? "✓ Ready to read" : `${c.progress}% translated`}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </Section>
            ) : null}

            {/* weekly activity */}
            <Section
              title="This week"
              action={
                <button onClick={() => push({ name: "insights" })} className="text-[13px] font-bold text-primary">
                  Insights →
                </button>
              }
            >
              <Card className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[13px] font-bold text-foreground">
                    <TrendingUp className="size-4 shrink-0 text-primary" /> XP earned
                  </div>
                  <div className="whitespace-nowrap text-[12px] font-bold text-muted-foreground">
                    {data.weekPoints.reduce((a, b) => a + b, 0)} XP this week
                  </div>
                </div>
                <div className="mt-3 flex h-24 items-end gap-1.5">
                  {data.weekPoints.map((p, i) => {
                    const max = Math.max(...data.weekPoints, 10);
                    const h = Math.max(6, (p / max) * 88);
                    const isToday = i === 6;
                    return (
                      <div key={i} className="flex flex-1 flex-col items-center gap-1">
                        {p > 0 ? (
                          <span className={cn("text-[9.5px] font-black", isToday ? "text-primary" : "text-muted-foreground")}>{p}</span>
                        ) : null}
                        <motion.div
                          initial={{ height: 4 }}
                          animate={{ height: h }}
                          transition={{ delay: i * 0.05, type: "spring", stiffness: 200, damping: 22 }}
                          className={cn("w-full rounded-t-lg", isToday ? "j-grad-primary" : "bg-primary/25")}
                          style={{ maxHeight: 88 }}
                        />
                        <span className={cn("text-[10px] font-bold", isToday ? "text-primary" : "text-muted-foreground")}>
                          {["S", "M", "T", "W", "T", "F", "S"][new Date(data.weekDays[i] + "T12:00").getDay()]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </Section>

            {/* upcoming classes */}
            {data.upcomingClasses.length ? (
              <Section
                title="Upcoming classes"
                action={
                  <button onClick={() => push({ name: "classes" })} className="text-[13px] font-bold text-primary">
                    All classes →
                  </button>
                }
              >
                <div className="space-y-2.5">
                  {data.upcomingClasses.map((c) => (
                    <Card key={c.id} onClick={() => push({ name: "classes" })} className="flex items-center gap-3 p-3.5">
                      <div className="j-grad-cyan grid size-11 shrink-0 place-items-center rounded-2xl text-white">
                        <CalendarClock className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-bold text-foreground">{c.title}</div>
                        <div className="text-[12px] text-muted-foreground">
                          {c.subject} · {new Date(c.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                        </div>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Card>
                  ))}
                </div>
              </Section>
            ) : null}

            {/* open assessments */}
            {data.openAssessments.length ? (
              <Section
                title="Pending assessments"
                action={
                  <button onClick={() => push({ name: "assessments" })} className="text-[13px] font-bold text-primary">
                    View all →
                  </button>
                }
              >
                <div className="space-y-2.5">
                  {data.openAssessments.slice(0, 3).map((a) => (
                    <Card key={a.id} onClick={() => push({ name: "assessment-take", id: a.id })} className="flex items-center gap-3 p-3.5">
                      <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-j-error/12 text-j-error">
                        <ClipboardList className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-bold text-foreground">{a.title}</div>
                        <div className="text-[12px] text-muted-foreground">
                          {a.subject}
                          {a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleDateString()}` : ""}
                        </div>
                      </div>
                      <Chip tone="warning">Take</Chip>
                    </Card>
                  ))}
                </div>
              </Section>
            ) : null}

            {/* recent activity mix */}
            <Section title="Recent activity">
              <div className="space-y-2.5">
                {[
                  ...data.recent.conversations.slice(0, 2).map((c) => ({
                    icon: <MessagesSquare className="size-4" />,
                    tint: "bg-primary/10 text-primary",
                    title: c.title,
                    sub: `AI Tutor · ${c.subject}`,
                    at: c.at,
                    go: () => push({ name: "tutor-chat", conversationId: c.id }),
                  })),
                  ...data.recent.quizzes.slice(0, 2).map((q) => ({
                    icon: <Target className="size-4" />,
                    tint: "bg-j-success/10 text-j-success",
                    title: q.title,
                    sub: `Quiz · scored ${q.score}/${q.total}`,
                    at: q.at,
                    go: () => push({ name: "quizzes" }),
                  })),
                  ...data.recent.translations.slice(0, 2).map((t) => ({
                    icon: <Sparkles className="size-4" />,
                    tint: "bg-j-violet/10 text-j-violet",
                    title: t.preview || "Translation",
                    sub: `Translated ${t.from} → ${t.to}`,
                    at: t.at,
                    go: () => useJedu.getState().setTab("translate"),
                  })),
                ]
                  .sort((a, b) => +new Date(b.at) - +new Date(a.at))
                  .slice(0, 5)
                  .map((r, i) => (
                    <Card key={i} onClick={r.go} className="flex items-center gap-3 p-3.5">
                      <div className={cn("grid size-10 shrink-0 place-items-center rounded-2xl", r.tint)}>{r.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold text-foreground">{r.title}</div>
                        <div className="text-[11.5px] text-muted-foreground">{r.sub}</div>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(r.at)}</span>
                    </Card>
                  ))}
                {!data.recent.conversations.length &&
                !data.recent.quizzes.length &&
                !data.recent.translations.length ? (
                  <EmptyState
                    icon="🚀"
                    title="Start your first activity"
                    body="Ask the AI tutor a question, translate something, or take a quiz — it all shows up here."
                  />
                ) : null}
              </div>
            </Section>

            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
              JeduAI · Learn in Your Language. Grow Without Limits. 🌍
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function DueBanner({ data }: { data: Dash }) {
  const push = useJedu((s) => s.push);
  const d = data.flashcardsDue!;
  const top = d.top!;
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      onClick={() => push({ name: "flashcards", deck: top.deck })}
      className="j-shadow-soft mt-3 flex w-full items-center gap-3.5 overflow-hidden rounded-3xl border-2 border-j-violet/30 bg-gradient-to-r from-j-violet/12 to-j-violet/5 p-4 text-left transition active:scale-[0.98]"
    >
      <div className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-j-violet/15 text-j-violet">
        <Brain className="size-6" />
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-j-violet px-1 text-[10px] font-black text-white">
          {d.total}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-black text-foreground">
          {d.total} flashcard{d.total === 1 ? "" : "s"} ready for review
        </div>
        <div className="truncate text-[11.5px] text-muted-foreground">
          {top.title} · spacing repeats what you almost forgot
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-j-violet px-3 py-1.5 text-[11.5px] font-black text-white shadow-md shadow-j-violet/30">
        Review now <ArrowRight className="size-3.5" />
      </span>
    </motion.button>
  );
}

function GoalHero({ data }: { data: Dash }) {
  const push = useJedu((s) => s.push);
  const g = data.greeting;
  const goalPct = Math.min(100, Math.round((g.todayPoints / Math.max(1, Math.round(g.goalMin / 2))) * 100));
  const ring = 2 * Math.PI * 34;
  const shown = Math.min(100, Math.max(4, goalPct));
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="j-grad-primary relative mt-4 overflow-hidden rounded-[26px] p-5 text-white shadow-xl shadow-primary/30"
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 size-36 rounded-full bg-white/10"
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ repeat: Infinity, duration: 7, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-14 -left-6 size-32 rounded-full bg-white/10"
        animate={{ scale: [1, 0.9, 1] }}
        transition={{ repeat: Infinity, duration: 9, ease: "easeInOut" }}
      />
      <div className="relative flex items-center gap-4">
        <div className="relative grid size-[76px] shrink-0 place-items-center">
          <svg width="76" height="76" className="absolute inset-0 -rotate-90">
            <circle cx="38" cy="38" r="34" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="7" />
            <motion.circle
              cx="38"
              cy="38"
              r="34"
              fill="none"
              stroke="white"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={ring}
              initial={{ strokeDashoffset: ring }}
              animate={{ strokeDashoffset: ring - (shown / 100) * ring }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          </svg>
          <div className="text-center leading-none">
            <div className="text-lg font-black">{shown}%</div>
            <div className="text-[9px] font-bold uppercase tracking-wider opacity-80">goal</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15.5px] font-black leading-tight">
            {goalPct >= 100 ? "Daily goal complete — amazing! 🎉" : "Daily goal — keep it up!"}
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-white/85">
            {g.todayPoints} XP today · {g.toNext} XP to Level {g.level + 1}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold backdrop-blur">
              🔥 {g.streak}-day streak
            </span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold backdrop-blur">
              🎯 {g.goalMin} min/day
            </span>
          </div>
        </div>
      </div>
      <button
        onClick={() => push({ name: "tutor" })}
        className="relative mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white/95 text-[13.5px] font-black text-primary shadow-lg transition active:scale-[0.98]"
      >
        <Sparkles className="size-4" /> Ask your AI tutor something
      </button>
    </motion.div>
  );
}
