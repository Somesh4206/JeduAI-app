"use client";
// JeduAI — Admin portal: analytics, user management, system monitor
import React from "react";
import { motion } from "framer-motion";
import { Shield, Users, Search, Trash2, Activity, Database, TrendingUp, Zap, Download, ChevronRight } from "lucide-react";
import { api, useJedu } from "../store";
import { Avatar, Card, Chip, EmptyState, ErrorState, Loader, Segmented, TopBar, toast } from "../ui";
import StudentSheet from "../student-sheet";
import { cn } from "@/lib/utils";

type AdminUser = {
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
};
type AData = {
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
  users: AdminUser[];
};

export default function AdminScreen() {
  const pop = useJedu((s) => s.pop);
  const user = useJedu((s) => s.user)!;
  const [data, setData] = React.useState<AData | null>(null);
  const [err, setErr] = React.useState("");
  const [q, setQ] = React.useState("");
  const [tab, setTab] = React.useState<"analytics" | "users" | "system">("analytics");
  const [roleFor, setRoleFor] = React.useState<AdminUser | null>(null);
  const [roleSel, setRoleSel] = React.useState("");
  const [sheetId, setSheetId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api<AData>(`/api/jeduai/admin${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then((r) => setData(r))
      .catch((e) => setErr((e as Error).message));
  }, [q]);

  React.useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function setRole(u: AdminUser, role: string) {
    try {
      await api("/api/jeduai/admin", { method: "PATCH", json: { id: u.id, role } });
      toast.success(`${u.name} is now ${role}`);
      setRoleFor(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeUser(u: AdminUser) {
    if (!confirm(`Delete ${u.name}'s account and all their data?`)) return;
    try {
      await api(`/api/jeduai/admin?id=${u.id}`, { method: "DELETE" });
      toast.success("User deleted");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // export the current (search-filtered) user list as CSV — records / spreadsheet import
  function exportCsv() {
    if (!filtered.length) {
      toast.info("No users match this search — nothing to export.");
      return;
    }
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    const lines = [
      `JeduAI users${q ? ` — search "${q}"` : ""}`,
      `Exported,${new Date().toISOString().slice(0, 10)}`,
      "",
      "Name,Email,Role,Education,XP,Streak (days),Joined,Demo account",
      ...filtered.map((u) =>
        [
          esc(u.name),
          esc(u.email),
          esc(u.role),
          esc(u.educationLevel),
          u.points,
          u.streak,
          u.createdAt.slice(0, 10),
          u.isDemo ? "yes" : "no",
        ].join(",")
      ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jeduai-users${q ? `-${q.replace(/[^\w-]+/g, "-").slice(0, 30)}` : ""}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${filtered.length} users as CSV`);
  }

  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Admin Portal" />
        <div className="p-4">
          <ErrorState message={err} onRetry={load} />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Admin Portal" />
        <Loader label="Loading admin data…" />
      </div>
    );
  }

  const a = data.analytics;
  const filtered = data.users.filter(
    (u) => !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()) || u.role.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar onBack={pop} title="Admin Portal" subtitle={`Signed in as ${user.name}`} />

      <div className="border-b border-border/70 bg-card/60 px-4 py-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "analytics", label: "📊 Analytics" },
            { value: "users", label: `👥 Users (${a.totalUsers})` },
            { value: "system", label: "🖥 System" },
          ]}
        />
      </div>

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {tab === "analytics" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Total users" value={a.totalUsers} sub={`${a.students} students · ${a.staff} staff`} icon={<Users className="size-5" />} grad="from-[#5B5FEF] to-[#773DE8]" />
              <Metric label="Active today" value={a.activeToday} sub="learning sessions" icon={<Activity className="size-5" />} grad="from-[#20B486] to-[#39C6F4]" />
              <Metric label="Platform XP" value={a.platformPoints} sub="awarded to learners" icon={<Zap className="size-5" />} grad="from-[#F5A623] to-[#E85D75]" />
              <Metric label="Signups (7d)" value={a.signupsWeek} sub="new accounts" icon={<TrendingUp className="size-5" />} grad="from-[#39C6F4] to-[#5B5FEF]" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Documents translated" value={a.documents.total} sub={`${a.documents.byStatus.completed || 0} completed`} icon={<Database className="size-5" />} grad="from-[#20B486] to-[#773DE8]" />
              <Metric label="Media projects" value={a.videos.total} sub={`${a.videos.byStatus.completed || 0} completed`} icon={<Database className="size-5" />} grad="from-[#773DE8] to-[#5B5FEF]" />
              <Metric label="Classes" value={a.classes.total} sub={`${a.classes.byStatus.scheduled || 0} scheduled`} icon={<Database className="size-5" />} grad="from-[#F5A623] to-[#5B5FEF]" />
              <Metric label="Avg quiz score" value={`${a.avgQuizPct}%`} sub={`${a.assessments.total} assessments`} icon={<TrendingUp className="size-5" />} grad="from-[#E85D75] to-[#773DE8]" />
            </div>
          </>
        ) : null}

        {tab === "users" ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-2">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-foreground">
                <Users className="size-4.5 text-primary" /> Platform users
                <span className="text-[12px] font-bold text-muted-foreground">
                  {filtered.length}{filtered.length !== data.users.length ? ` of ${data.users.length}` : ""}
                </span>
              </h2>
              <button
                onClick={exportCsv}
                disabled={!filtered.length}
                title="Download this user list as CSV"
                aria-label="Download this user list as CSV"
                className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-j-success/10 px-3 py-1.5 text-[11.5px] font-black text-j-success transition active:scale-95 disabled:opacity-50"
              >
                <Download className="size-3.5" /> CSV
              </button>
            </div>
            <div className="mb-3 flex items-center gap-2 rounded-2xl border border-border bg-card px-3.5">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search users…"
                className="min-h-11 flex-1 bg-transparent text-[14px] outline-none"
              />
            </div>
            {!filtered.length ? (
              <EmptyState icon="🔍" title="No users found" />
            ) : (
              <div className="space-y-2.5">
                {filtered.map((u) => (
                  <Card key={u.id} className="p-0 overflow-hidden">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSheetId(u.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSheetId(u.id)}
                      aria-label={`Open profile for ${u.name}`}
                      className="flex cursor-pointer items-center gap-3 p-3.5 transition hover:bg-muted/40 active:scale-[0.99]"
                    >
                      <Avatar name={u.name} color={u.avatarColor} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[14px] font-bold text-foreground">{u.name}</span>
                          {u.isMe ? <Chip tone="primary">you</Chip> : null}
                          {u.isDemo ? <Chip tone="muted">demo</Chip> : null}
                        </div>
                        <div className="truncate text-[11.5px] text-muted-foreground">{u.email}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <Chip tone={u.role === "Admin" ? "error" : u.role === "Staff" ? "warning" : "muted"}>{u.role}</Chip>
                          <span className="text-[11px] text-muted-foreground">{u.points} XP</span>
                        </div>
                      </div>
                      {!u.isMe ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRoleFor(u);
                            setRoleSel(u.role);
                          }}
                          aria-label="Change role"
                          className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                        >
                          <Shield className="size-4" />
                        </button>
                      ) : null}
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                    {!u.isMe && !u.isDemo ? (
                      <div className="flex border-t border-border/70">
                        <button
                          onClick={() => removeUser(u)}
                          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-j-error"
                        >
                          <Trash2 className="size-3.5" /> Delete user
                        </button>
                      </div>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === "system" ? (
          <>
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-[14px] font-black text-foreground">
                <Activity className="size-4 text-j-success" /> Pipeline health
              </div>
              {[
                { name: "Document translation jobs", stats: a.documents.byStatus, total: a.documents.total },
                { name: "Media translation jobs", stats: a.videos.byStatus, total: a.videos.total },
                { name: "Classes", stats: a.classes.byStatus, total: a.classes.total },
              ].map((g) => (
                <div key={g.name} className="mb-4 last:mb-0">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[12.5px] font-bold text-foreground">{g.name}</span>
                    <span className="text-[11.5px] text-muted-foreground">{g.total} total</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(g.stats).map(([k, v]) => (
                      <Chip key={k} tone={k === "completed" ? "success" : k === "failed" || k === "needs_ocr" ? "error" : k === "translating" || k === "transcribing" || k === "extracting" || k === "ocr" ? "primary" : "muted"}>
                        {k}: {v}
                      </Chip>
                    ))}
                    {!Object.keys(g.stats).length ? <Chip tone="muted">no activity yet</Chip> : null}
                  </div>
                </div>
              ))}
            </Card>
            <Card className="mt-3 p-4">
              <div className="mb-2 flex items-center gap-2 text-[14px] font-black text-foreground">
                <Database className="size-4 text-primary" /> Deployment info
              </div>
              <div className="space-y-1.5 text-[12.5px] text-muted-foreground">
                <div>Database: SQLite (Prisma) — persistent in <code className="rounded bg-muted px-1.5 py-0.5">db/custom.db</code></div>
                <div>Uploads: <code className="rounded bg-muted px-1.5 py-0.5">db/uploads/</code> (per-user ownership enforced)</div>
                <div>AI: LLM chat completions + ASR speech recognition via server SDK</div>
                <div>Media: ffmpeg extraction + silence-aligned transcription</div>
                <div>Auth: server-side sessions (httpOnly cookies), scrypt password hashing</div>
              </div>
            </Card>
            <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
              Demo accounts (admin/staff/student) are protected from role changes and deletion so testing always remains possible.
            </p>
          </>
        ) : null}
      </div>

      {roleFor ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={() => setRoleFor(null)} />
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-2xl">
            <div className="text-[15px] font-black text-foreground">Change role — {roleFor.name}</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">{roleFor.email}</p>
            <div className="mt-4 flex gap-2">
              {["Student", "Staff", "Admin"].map((r) => (
                <Chip key={r} active={roleSel === r} onClick={() => setRoleSel(r)}>
                  {r}
                </Chip>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setRoleFor(null)} className="min-h-12 flex-1 rounded-2xl border border-border text-[14px] font-bold text-foreground">
                Cancel
              </button>
              <button
                onClick={() => setRole(roleFor, roleSel)}
                disabled={roleSel === roleFor.role}
                className="j-grad-primary min-h-12 flex-1 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}

      <StudentSheet studentId={sheetId} open={!!sheetId} onOpenChange={(v) => !v && setSheetId(null)} />
    </div>
  );
}

function Metric({ label, value, sub, icon, grad }: { label: string; value: React.ReactNode; sub: string; icon: React.ReactNode; grad: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-[22px] bg-gradient-to-br p-4 text-white shadow-lg", grad)}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl font-black leading-none">{value}</div>
          <div className="mt-1.5 text-[11.5px] font-bold text-white/85">{label}</div>
          <div className="text-[10.5px] text-white/70">{sub}</div>
        </div>
        {icon}
      </div>
    </motion.div>
  );
}
