"use client";
// JeduAI — Notifications center
import React from "react";
import { motion } from "framer-motion";
import { Bell, CheckCheck, Info, CalendarDays, ClipboardList, Cog, Award, Brain, Flame } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, EmptyState, ErrorState, Loader, TopBar, toast } from "../ui";
import { cn } from "@/lib/utils";

type Notif = {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  createdAt: string;
};

const KIND_META: Record<
  string,
  { icon: React.ReactNode; tint: string; ring: string }
> = {
  system: { icon: <Info className="size-5" />, tint: "bg-primary/10 text-primary", ring: "ring-primary/20" },
  class: { icon: <CalendarDays className="size-5" />, tint: "bg-j-cyan/10 text-j-cyan", ring: "ring-j-cyan/20" },
  assessment: { icon: <ClipboardList className="size-5" />, tint: "bg-j-warning/10 text-j-warning", ring: "ring-j-warning/20" },
  job: { icon: <Cog className="size-5" />, tint: "bg-j-success/10 text-j-success", ring: "ring-j-success/20" },
  achievement: { icon: <Award className="size-5" />, tint: "bg-j-warning/15 text-j-warning", ring: "ring-j-warning/30" },
  digest: { icon: <Brain className="size-5" />, tint: "bg-j-violet/10 text-j-violet", ring: "ring-j-violet/25" },
  streak: { icon: <Flame className="size-5" />, tint: "bg-j-error/10 text-j-error", ring: "ring-j-error/20" },
};

// titles carry emoji prefixes from the server; strip them for the icon row (icon replaces emoji)
function cleanTitle(t: string) {
  return t.replace(/^\p{Extended_Pictographic}+\s*/u, "").trim() || t;
}

export default function NotificationsScreen() {
  const pop = useJedu((s) => s.pop);
  const setUnread = useJedu((s) => s.setUnread);
  const [items, setItems] = React.useState<Notif[] | null>(null);
  const [err, setErr] = React.useState("");

  const load = React.useCallback(() => {
    api<{ items: Notif[] }>("/api/jeduai/notifications")
      .then((r) => setItems(r.items))
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function markAll() {
    try {
      await api("/api/jeduai/notifications", { method: "PATCH", json: {} });
      setUnread(0);
      setItems((is) => is?.map((n) => ({ ...n, read: true })) || null);
      toast.success("All marked as read");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const unreadCount = items?.filter((n) => !n.read).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title="Notifications"
        subtitle={unreadCount ? `${unreadCount} unread` : "Everything at a glance"}
        right={
          <button
            onClick={markAll}
            disabled={!items?.some((n) => !n.read)}
            className="flex min-h-9 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-[12.5px] font-black text-primary transition hover:bg-primary/15 active:scale-95 disabled:opacity-40"
          >
            <CheckCheck className="size-4" /> Read all
          </button>
        }
      />
      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {err ? <ErrorState message={err} onRetry={load} /> : null}
        {!items && !err ? <Loader label="Loading…" /> : null}
        {items && !items.length ? (
          <EmptyState icon={<Bell className="size-7 text-primary" />} title="All caught up!" body="No notifications right now." />
        ) : null}
        {items?.length ? (
          <div className="space-y-2.5">
            {items.map((n, i) => {
              const meta = KIND_META[n.kind] || KIND_META.system;
              return (
                <motion.div key={n.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.25) }}>
                  <Card
                    className={cn(
                      "flex gap-3 p-4 transition",
                      !n.read && cn("bg-gradient-to-br from-primary/[0.06] to-card ring-1", meta.ring)
                    )}
                  >
                    <div className={cn("grid size-10 shrink-0 place-items-center rounded-2xl", meta.tint)} aria-hidden>
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-bold text-foreground">{cleanTitle(n.title)}</span>
                        {!n.read ? <span className="size-2 shrink-0 rounded-full bg-primary" /> : null}
                      </div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{n.body}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
