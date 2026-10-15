"use client";
// JeduAI — Online classes: browse, enroll, join, manage (staff)
import React from "react";
import { motion } from "framer-motion";
import { CalendarClock, Plus, Users, Video, Trash2, X, CheckCircle2 } from "lucide-react";
import { api, useJedu } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, StatusPill, TopBar, toast } from "../ui";
import { SUBJECTS } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Cls = {
  id: string;
  title: string;
  subject: string;
  description: string | null;
  scheduledAt: string;
  durationMin: number;
  meetingLink: string | null;
  status: string;
  classCode: string;
  teacher: { id: string; name: string; avatarColor: string };
  enrolled: number;
  isEnrolled: boolean;
  isMine: boolean;
};

export default function ClassesScreen() {
  const pop = useJedu((s) => s.pop);
  const user = useJedu((s) => s.user)!;
  const canTeach = user.role === "Staff" || user.role === "Admin";
  const [classes, setClasses] = React.useState<Cls[] | null>(null);
  const [err, setErr] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<"upcoming" | "all">("upcoming");

  const [form, setForm] = React.useState({
    title: "",
    subject: "Mathematics",
    description: "",
    date: "",
    time: "17:00",
    durationMin: 45,
    meetingLink: "",
  });

  const load = React.useCallback(() => {
    api<{ classes: Cls[] }>("/api/jeduai/classes")
      .then((r) => setClasses(r.classes))
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function enroll(c: Cls) {
    try {
      const r = await api<{ gamified?: { gained: number } }>("/api/jeduai/classes", { method: "PATCH", json: { id: c.id, action: "enroll" } });
      if (r.gamified?.gained) toast.success(`Enrolled! +${r.gamified.gained} XP ⚡`);
      else toast.success("You're enrolled 🎉");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function setStatus(c: Cls, status: string) {
    try {
      await api("/api/jeduai/classes", { method: "PATCH", json: { id: c.id, status } });
      toast.success(`Marked ${status}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(c: Cls) {
    if (!confirm(`Delete class "${c.title}"?`)) return;
    try {
      await api(`/api/jeduai/classes?id=${c.id}`, { method: "DELETE" });
      toast.success("Class deleted");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function create() {
    if (busy) return;
    if (!form.title.trim() || !form.date) {
      toast.error("Title and date are required");
      return;
    }
    setBusy(true);
    try {
      const when = new Date(`${form.date}T${form.time || "17:00"}`);
      await api("/api/jeduai/classes", {
        method: "POST",
        json: {
          title: form.title.trim(),
          subject: form.subject,
          description: form.description.trim() || undefined,
          scheduledAt: when.toISOString(),
          durationMin: form.durationMin,
          meetingLink: form.meetingLink.trim(),
        },
      });
      toast.success("Class scheduled — students were notified 📅");
      setCreateOpen(false);
      setForm({ title: "", subject: "Mathematics", description: "", date: "", time: "17:00", durationMin: 45, meetingLink: "" });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();
  const visible = (classes || []).filter((c) => {
    if (filter === "all") return true;
    return new Date(c.scheduledAt).getTime() > now - 3600_000 && c.status !== "cancelled" && c.status !== "completed";
  });
  const sorted = [...visible].sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title="Online Classes"
        subtitle={canTeach ? "Schedule and manage live classes" : "Join live classes with your teachers"}
        right={
          canTeach ? (
            <button
              onClick={() => setCreateOpen(true)}
              className="j-grad-primary ml-auto flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-black text-white shadow-lg shadow-primary/30 active:scale-95"
            >
              <Plus className="size-4" /> Schedule
            </button>
          ) : undefined
        }
      />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <div className="mb-3 flex gap-2">
          <Chip active={filter === "upcoming"} onClick={() => setFilter("upcoming")}>
            Upcoming
          </Chip>
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
        </div>

        {err ? <ErrorState message={err} onRetry={load} /> : null}
        {!classes && !err ? <Loader label="Loading classes…" /> : null}
        {classes && !sorted.length ? (
          <EmptyState
            icon="📅"
            title="No classes here"
            body={canTeach ? "Schedule a class and students will be notified instantly." : "When your teachers schedule classes, they'll appear here."}
          />
        ) : (
          <div className="space-y-3">
            {sorted.map((c, i) => {
              const when = new Date(c.scheduledAt);
              const isLive = c.status === "live";
              const past = when.getTime() < now;
              return (
                <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <Card className={cn("overflow-hidden p-0", isLive && "ring-2 ring-j-error/40")}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={cn("grid size-12 shrink-0 place-items-center rounded-2xl text-[13px] font-black leading-none text-white", isLive ? "bg-j-error" : "j-grad-cyan")}>
                            {isLive ? (
                              <span className="animate-pulse">LIVE</span>
                            ) : (
                              <span className="text-center leading-tight">
                                {when.toLocaleDateString(undefined, { day: "numeric" })}
                                <span className="block text-[9px] font-bold uppercase">{when.toLocaleDateString(undefined, { month: "short" })}</span>
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-black leading-tight text-foreground">{c.title}</div>
                            <div className="text-[12px] text-muted-foreground">
                              {c.subject} · {when.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} · {c.durationMin} min
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                              <Users className="size-3.5" /> {c.enrolled} enrolled · by {c.teacher.name}
                            </div>
                          </div>
                        </div>
                        <StatusPill status={c.status} />
                      </div>
                      {c.description ? (
                        <p className="mt-2 line-clamp-2 rounded-xl bg-muted/50 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
                          {c.description}
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {user.role === "Student" ? (
                          !c.isEnrolled ? (
                            <button
                              onClick={() => enroll(c)}
                              disabled={past || c.status === "cancelled"}
                              className="j-grad-primary flex min-h-10 items-center gap-1.5 rounded-full px-5 text-[13px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50"
                            >
                              Enroll
                            </button>
                          ) : (
                            <span className="flex min-h-10 items-center gap-1.5 rounded-full bg-j-success/12 px-4 text-[13px] font-black text-j-success">
                              <CheckCircle2 className="size-4" /> Enrolled
                            </span>
                          )
                        ) : null}
                        {(c.isEnrolled || c.isMine || user.role === "Admin") && c.meetingLink ? (
                          <a
                            href={c.meetingLink}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-h-10 items-center gap-1.5 rounded-full bg-j-error/12 px-4 text-[13px] font-black text-j-error transition hover:bg-j-error/20"
                          >
                            <Video className="size-4" /> Join
                          </a>
                        ) : null}
                        {c.isMine && c.status === "scheduled" ? (
                          <button onClick={() => setStatus(c, "live")} className="flex min-h-10 items-center gap-1.5 rounded-full bg-j-error/10 px-4 text-[12.5px] font-bold text-j-error">
                            ▶ Go live
                          </button>
                        ) : null}
                        {c.isMine && (c.status === "live" || c.status === "scheduled") ? (
                          <button onClick={() => setStatus(c, "completed")} className="text-[12.5px] font-bold text-j-success">
                            Mark done
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {c.isMine || user.role === "Admin" ? (
                      <div className="flex border-t border-border/70">
                        <button
                          onClick={() => remove(c)}
                          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-j-error"
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </button>
                      </div>
                    ) : null}
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* create sheet */}
      {createOpen ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-50 flex items-end">
          <button className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={() => setCreateOpen(false)} />
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} className="j-app-scroll max-h-[88%] w-full overflow-y-auto rounded-t-[28px] border-t border-border bg-card p-5 pb-[max(env(safe-area-inset-bottom),20px)]">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
            <h3 className="text-lg font-black text-foreground">Schedule a class</h3>
            <p className="text-[12px] text-muted-foreground">All students are notified when you publish.</p>

            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Class title"
              className="mt-4 min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUBJECTS.slice(0, 8).map((s) => (
                <Chip key={s} active={form.subject === s} onClick={() => setForm({ ...form, subject: s })}>
                  {s}
                </Chip>
              ))}
            </div>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What will you cover? (optional)"
              rows={2}
              className="mt-3 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-[14px] outline-none focus:border-primary/50"
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-muted-foreground">Date</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-[14px] outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-muted-foreground">Start time</span>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-[14px] outline-none focus:border-primary/50"
                />
              </label>
            </div>
            <div className="mt-3">
              <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-muted-foreground">Duration</span>
              <div className="flex flex-wrap gap-1.5">
                {[30, 45, 60, 90].map((m) => (
                  <Chip key={m} active={form.durationMin === m} onClick={() => setForm({ ...form, durationMin: m })}>
                    {m} min
                  </Chip>
                ))}
              </div>
            </div>
            <input
              value={form.meetingLink}
              onChange={(e) => setForm({ ...form, meetingLink: e.target.value })}
              placeholder="Meeting link (https://meet.jit.si/…)"
              className="mt-3 min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[14px] outline-none focus:border-primary/50"
            />
            <p className="mt-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
              Tip: create a free room at meet.jit.si and paste the link. JeduAI opens it at class time.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setCreateOpen(false)} className="min-h-12 flex-1 rounded-2xl border border-border text-[14px] font-bold text-foreground">
                Cancel
              </button>
              <button onClick={create} disabled={busy} className="j-grad-primary min-h-12 flex-1 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50">
                {busy ? "…" : "Schedule class"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </div>
  );
}
