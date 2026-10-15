"use client";
// JeduAI — Profile & settings (incl. gamification: badges, leaderboard, weekly)
import React from "react";
import { motion } from "framer-motion";
import {
  Moon,
  Sun,
  LogOut,
  Trash2,
  Pencil,
  Trophy,
  Flame,
  Zap,
  Languages,
  GraduationCap,
  Target,
  Bell,
  Palette,
  Shield,
  Sparkles,
  Briefcase,
  Users,
  ChevronRight,
  Type,
  BarChart3,
} from "lucide-react";
import { api, saveToken, useJedu, type JUser } from "../store";
import GetAppSection from "../get-app";
import { Avatar, Card, Chip, EmptyState, LangButton, Loader, Section, Segmented, Sheet, TopBar, toast } from "../ui";
import { AVATAR_COLORS, SUBJECTS, levelOf } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Gamify = {
  points: number;
  streak: number;
  level: number;
  toNext: number;
  weekDays: string[];
  weekPoints: number[];
  badges: { name: string; icon: string; points: number; earned: boolean }[];
  leaderboard: { rank: number; id: string; name: string; points: number; streak: number; avatarColor: string; isMe: boolean }[];
  tasksCompleted: number;
};

export default function ProfileScreen() {
  const user = useJedu((s) => s.user)!;
  const setUser = useJedu((s) => s.setUser);
  const setTheme = useJedu((s) => s.setTheme);
  const push = useJedu((s) => s.push);
  const [gam, setGam] = React.useState<Gamify | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [subjects, setSubjects] = React.useState<string[]>(user.subjects || []);
  const [goal, setGoal] = React.useState(user.dailyGoalMin);
  const [fontScale, setFontScale] = React.useState(user.fontScale || 1);
  const [name, setName] = React.useState(user.name);
  const [avatarColor, setAvatarColor] = React.useState(user.avatarColor);

  React.useEffect(() => {
    api<Gamify>("/api/jeduai/gamify").then(setGam).catch(() => setGam(null));
  }, []);

  async function patch(json: Record<string, unknown>) {
    try {
      const r = await api<{ user: JUser }>("/api/jeduai/account", { method: "PATCH", json });
      setUser(r.user);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  async function logout() {
    if (!confirm("Sign out of JeduAI?")) return;
    try {
      await api("/api/jeduai/auth", { method: "POST", json: { action: "logout" } });
    } catch (e) {
      toast.error((e as Error).message);
    }
    saveToken(null);
    setUser(null);
  }

  async function deleteAccount() {
    if (!confirm("This permanently deletes your account, translations, documents and all learning data. Continue?")) return;
    setConfirmDelete(false);
    try {
      await api("/api/jeduai/account", { method: "DELETE" });
      saveToken(null);
      toast.success("Account deleted. Take care! 👋");
      setUser(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const lv = gam ? { level: gam.level, toNext: gam.toNext } : levelOf(user.points);
  const isStaff = user.role === "Staff";
  const isAdmin = user.role === "Admin";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Profile" subtitle="You & your preferences" />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {/* identity card */}
        <Card className="j-shadow-soft relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-10 -top-14 size-40 rounded-full bg-primary/10" />
          <div className="relative flex items-center gap-4">
            <Avatar name={user.name} color={user.avatarColor} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[18px] font-black leading-tight text-foreground">{user.name}</span>
                <button onClick={() => setEditOpen(true)} aria-label="Edit profile" className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary">
                  <Pencil className="size-4" />
                </button>
              </div>
              <div className="truncate text-[12.5px] text-muted-foreground">{user.email}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Chip tone={isAdmin ? "error" : isStaff ? "warning" : "primary"}>{user.role}</Chip>
                <Chip tone="muted">{user.educationLevel}</Chip>
              </div>
            </div>
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-j-warning/10 py-2.5">
              <div className="text-lg font-black leading-none text-foreground">🔥 {user.streak}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">streak</div>
            </div>
            <div className="rounded-2xl bg-primary/10 py-2.5">
              <div className="text-lg font-black leading-none text-foreground">⚡ {user.points}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">xp · lv {lv.level}</div>
            </div>
            <div className="rounded-2xl bg-j-success/10 py-2.5">
              <div className="text-lg font-black leading-none text-foreground">🎯 {lv.toNext}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">to lv {lv.level + 1}</div>
            </div>
          </div>
        </Card>

        {/* portal links */}
        {isStaff || isAdmin ? (
          <Section title="Portals">
            <div className="space-y-2.5">
              {isStaff || isAdmin ? (
                <Card onClick={() => push({ name: "staff" })} className="flex items-center gap-3 p-4 transition active:scale-[0.99]">
                  <div className="j-grad-cyan grid size-11 place-items-center rounded-2xl text-white">
                    <Briefcase className="size-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[14.5px] font-bold text-foreground">Staff Portal</div>
                    <div className="text-[11.5px] text-muted-foreground">Students, classes, assessments, analytics</div>
                  </div>
                  <ChevronRight className="size-5 text-muted-foreground" />
                </Card>
              ) : null}
              {isAdmin ? (
                <Card onClick={() => push({ name: "admin" })} className="flex items-center gap-3 p-4 transition active:scale-[0.99]">
                  <div className="j-grad-primary grid size-11 place-items-center rounded-2xl text-white">
                    <Shield className="size-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[14.5px] font-bold text-foreground">Admin Portal</div>
                    <div className="text-[11.5px] text-muted-foreground">Users, platform analytics, system monitor</div>
                  </div>
                  <ChevronRight className="size-5 text-muted-foreground" />
                </Card>
              ) : null}
            </div>
          </Section>
        ) : null}

        {/* badges */}
        <Section title="Achievements">
          {gam ? (
            <div className="j-app-scroll -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
              {gam.badges.map((b, i) => (
                <motion.div
                  key={b.name}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className={cn(
                    "flex w-[105px] shrink-0 flex-col items-center gap-1 rounded-2xl border p-3 text-center",
                    b.earned ? "border-j-warning/40 bg-j-warning/5" : "border-border bg-muted/40 opacity-60"
                  )}
                >
                  <span className={cn("text-3xl", !b.earned && "grayscale")}>{b.icon}</span>
                  <span className="text-[11px] font-black leading-tight text-foreground">{b.name}</span>
                  <span className="text-[10px] text-muted-foreground">{b.earned ? "earned ✓" : `${b.points} XP`}</span>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="h-24 animate-pulse rounded-2xl bg-muted" />
          )}
        </Section>

        {/* weekly + leaderboard */}
        <Section
          title="This week & leaderboard"
          action={
            <button
              onClick={() => push({ name: "insights" })}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-[11.5px] font-black text-primary transition active:scale-95"
            >
              <BarChart3 className="size-3.5" /> Insights
            </button>
          }
        >
          {gam ? (
            <div className="space-y-3">
              <Card className="p-4">
                <div className="flex h-20 items-end gap-1.5">
                  {gam.weekPoints.map((p, i) => {
                    const max = Math.max(...gam.weekPoints, 10);
                    return (
                      <div key={i} className="flex flex-1 flex-col items-center gap-1">
                        <motion.div
                          initial={{ height: 4 }}
                          animate={{ height: Math.max(6, (p / max) * 72) }}
                          className={cn("w-full rounded-t-lg", i === 6 ? "j-grad-primary" : "bg-primary/25")}
                        />
                        <span className="text-[10px] font-bold text-muted-foreground">
                          {["S", "M", "T", "W", "T", "F", "S"][new Date(gam.weekDays[i] + "T12:00").getDay()]}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-center text-[11.5px] text-muted-foreground">
                  {gam.weekPoints.reduce((a, b) => a + b, 0)} XP this week · {gam.tasksCompleted} tasks completed all-time
                </div>
              </Card>
              <Card className="p-4">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-black text-foreground">
                  <Trophy className="size-4 text-j-warning" /> Learner leaderboard
                </div>
                <div className="space-y-1.5">
                  {gam.leaderboard.slice(0, 5).map((u) => (
                    <div key={u.id} className={cn("flex items-center gap-2.5 rounded-xl px-2 py-1.5", u.isMe && "bg-primary/10")}>
                      <span className={cn("w-5 text-center text-[12px] font-black", u.rank === 1 ? "text-j-warning" : "text-muted-foreground")}>
                        {u.rank === 1 ? "🥇" : u.rank === 2 ? "🥈" : u.rank === 3 ? "🥉" : u.rank}
                      </span>
                      <Avatar name={u.name} color={u.avatarColor} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-foreground">
                        {u.name} {u.isMe && <span className="text-primary">(you)</span>}
                      </span>
                      <span className="text-[12px] font-black text-primary">{u.points} XP</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ) : (
            <div className="h-40 animate-pulse rounded-2xl bg-muted" />
          )}
        </Section>

        {/* preferences */}
        <Section title="Learning preferences">
          <Card className="divide-y divide-border/70 p-0">
            <div className="p-4">
              <div className="mb-1 flex items-center gap-2 text-[13px] font-black text-foreground">
                <Languages className="size-4 text-primary" /> Languages
              </div>
              <div className="mt-2 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold text-foreground">Interface language</div>
                    <div className="text-[11px] text-muted-foreground">App labels & tips</div>
                  </div>
                  <LangButton value={user.interfaceLang} onChange={(v) => patch({ interfaceLang: v })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12.5px] font-bold text-foreground">Explanation language</div>
                    <div className="text-[11px] text-muted-foreground">AI answers & translations</div>
                  </div>
                  <LangButton value={user.explanationLang} onChange={(v) => patch({ explanationLang: v })} />
                </div>
              </div>
            </div>

            <div className="p-4">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-black text-foreground">
                <GraduationCap className="size-4 text-primary" /> Subjects ({subjects.length}/6)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SUBJECTS.map((s) => {
                  const active = subjects.includes(s);
                  return (
                    <Chip
                      key={s}
                      active={active}
                      onClick={() => {
                        if (active) {
                          const next = subjects.filter((x) => x !== s);
                          setSubjects(next);
                          patch({ subjects: next });
                        } else if (subjects.length < 6) {
                          const next = [...subjects, s];
                          setSubjects(next);
                          patch({ subjects: next });
                        } else toast.info("Up to 6 subjects");
                      }}
                    >
                      {s}
                    </Chip>
                  );
                })}
              </div>
            </div>

            <div className="p-4">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-black text-foreground">
                <Target className="size-4 text-primary" /> Daily goal
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[10, 20, 30, 45, 60, 90].map((m) => (
                  <Chip
                    key={m}
                    active={goal === m}
                    onClick={() => {
                      setGoal(m);
                      patch({ dailyGoalMin: m });
                    }}
                  >
                    {m} min
                  </Chip>
                ))}
              </div>
            </div>
          </Card>
        </Section>

        {/* appearance */}
        <Section title="Appearance & accessibility">
          <Card className="divide-y divide-border/70 p-0">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2">
                <Palette className="size-4 text-primary" />
                <span className="text-[13.5px] font-bold text-foreground">Theme</span>
              </div>
              <div className="w-36">
                <Segmented
                  value={(user.theme === "dark" ? "dark" : "light") as "light" | "dark"}
                  onChange={(t) => {
                    setTheme(t);
                    patch({ theme: t });
                  }}
                  options={[
                    { value: "light", label: <Sun className="mx-auto size-4" /> },
                    { value: "dark", label: <Moon className="mx-auto size-4" /> },
                  ]}
                />
              </div>
            </div>
            <div className="p-4">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-black text-foreground">
                <Type className="size-4 text-primary" /> Text size
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-bold text-muted-foreground">A</span>
                <input
                  type="range"
                  min={0.9}
                  max={1.25}
                  step={0.05}
                  value={fontScale}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setFontScale(v);
                    document.documentElement.style.fontSize = `${16 * v}px`;
                  }}
                  onMouseUp={() => patch({ fontScale })}
                  onTouchEnd={() => patch({ fontScale })}
                  className="flex-1 accent-primary"
                  aria-label="Text size"
                />
                <span className="text-[17px] font-bold text-muted-foreground">A</span>
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">Applies across the app — great for long reading sessions.</div>
            </div>
          </Card>
        </Section>

        {/* notifications */}
        <Section title="Notifications">
          <Card className="flex items-center justify-between p-4" onClick={() => push({ name: "notifications" })}>
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-primary" />
              <span className="text-[13.5px] font-bold text-foreground">Open notification center</span>
            </div>
            <ChevronRight className="size-5 text-muted-foreground" />
          </Card>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
            In-app reminders only — no spam. Job completion (documents & media) always notifies.
          </p>
        </Section>

        {/* mobile app */}
        <Section title="Mobile app">
          <GetAppSection />
        </Section>

        {/* security & danger */}
        <Section title="Account">
          <Card className="divide-y divide-border/70 p-0">
            <button onClick={logout} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-muted/40">
              <LogOut className="size-5 text-j-warning" />
              <span className="text-[14px] font-bold text-foreground">Sign out</span>
            </button>
            <button onClick={() => setConfirmDelete(true)} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-j-error/5">
              <Trash2 className="size-5 text-j-error" />
              <div>
                <div className="text-[14px] font-bold text-j-error">Delete account</div>
                <div className="text-[11px] text-muted-foreground">Permanently removes all data</div>
              </div>
            </button>
          </Card>
        </Section>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          JeduAI v1.0 · Multilingual AI Learning
          <br />
          Learn in Your Language. Grow Without Limits. 🌍
        </p>
      </div>

      {/* edit sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen} title="Edit profile">
        <div className="space-y-4 pb-2">
          <div>
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Avatar color</div>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setAvatarColor(c)}
                  aria-label={`Color ${c}`}
                  className={cn("size-10 rounded-full transition active:scale-90", avatarColor === c && "ring-4 ring-primary/40 ring-offset-2 ring-offset-card")}
                  style={{ background: `linear-gradient(135deg, ${c}, #773DE8)` }}
                />
              ))}
            </div>
          </div>
          <button
            onClick={async () => {
              if (await patch({ name: name.trim() || user.name, avatarColor })) {
                toast.success("Profile updated");
                setEditOpen(false);
              }
            }}
            className="j-grad-primary w-full rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/25"
          >
            Save changes
          </button>
        </div>
      </Sheet>

      {/* delete confirm */}
      {confirmDelete ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={() => setConfirmDelete(false)} />
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-sm rounded-3xl border border-j-error/30 bg-card p-5 shadow-2xl">
            <div className="text-lg font-black text-j-error">Delete everything?</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              This wipes your account, documents, translations, media, quizzes and progress. It cannot be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="min-h-12 flex-1 rounded-2xl border border-border text-[14px] font-bold text-foreground">
                Keep my account
              </button>
              <button onClick={deleteAccount} className="min-h-12 flex-1 rounded-2xl bg-j-error text-[14px] font-black text-white shadow-lg shadow-j-error/30">
                Delete forever
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}
