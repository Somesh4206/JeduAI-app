"use client";
// JeduAI — AI Tutor: conversations list
import React from "react";
import { Plus, Sparkles, MessageCircle, Trash2, Pencil } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, Sheet, TopBar, toast } from "../ui";
import { TUTOR_MODES } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Conv = {
  id: string;
  title: string;
  subject: string;
  mode: string;
  updatedAt: string;
  messages: { content: string; role: string }[];
};

export default function TutorScreen() {
  const push = useJedu((s) => s.push);
  const user = useJedu((s) => s.user)!;
  const [convs, setConvs] = React.useState<Conv[] | null>(null);
  const [err, setErr] = React.useState("");
  const [reload, setReload] = React.useState(0);
  const [renameFor, setRenameFor] = React.useState<Conv | null>(null);
  const [renameVal, setRenameVal] = React.useState("");

  React.useEffect(() => {
    api<{ conversations: Conv[] }>("/api/jeduai/tutor")
      .then((r) => setConvs(r.conversations))
      .catch((e) => setErr((e as Error).message));
  }, [reload]);

  async function remove(c: Conv) {
    if (!confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
    try {
      await api(`/api/jeduai/tutor?id=${c.id}`, { method: "DELETE" });
      toast.success("Conversation deleted");
      setReload(reload + 1);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function doRename() {
    if (!renameFor || !renameVal.trim()) return;
    try {
      await api("/api/jeduai/tutor", {
        method: "PATCH",
        json: { conversationId: renameFor.id, title: renameVal.trim() },
      });
      toast.success("Renamed");
      setRenameFor(null);
      setReload(reload + 1);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title="AI Tutor"
        subtitle={`${user.explanationLang} · ${user.educationLevel} level`}
        right={
          <button
            onClick={() => push({ name: "tutor-chat" })}
            aria-label="New chat"
            className="j-grad-primary ml-auto mr-1 flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-95"
          >
            <Plus className="size-4" /> New chat
          </button>
        }
      />

      <div className="j-app-scroll flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <div className="j-grad-primary j-shadow-soft relative overflow-hidden rounded-[26px] p-5 text-white">
          <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-white/10" />
          <div className="text-lg font-black leading-tight">🤖 Ask anything, in any language</div>
          <p className="mt-1 text-[13px] leading-relaxed text-white/85">
            Six tutor modes: beginner explanations, exam prep, step-by-step, quick revision, language learning and balanced.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TUTOR_MODES.slice(0, 4).map((m) => (
              <span key={m.id} className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold backdrop-blur">
                {m.icon} {m.label.split(" ").slice(-1)}
              </span>
            ))}
          </div>
        </div>

        <h2 className="mb-2.5 mt-5 px-1 text-[15px] font-bold text-foreground">Your conversations</h2>

        {err ? <ErrorState message={err} onRetry={() => setReload(reload + 1)} /> : null}
        {!convs && !err ? <Loader label="Loading conversations…" /> : null}
        {convs && !convs.length ? (
          <EmptyState
            icon="💬"
            title="No conversations yet"
            body="Ask your first question — the tutor answers in your preferred language."
            action={
              <button
                onClick={() => push({ name: "tutor-chat" })}
                className="j-grad-primary mt-1 flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-black text-white shadow-lg shadow-primary/30"
              >
                <Sparkles className="size-4" /> Start chatting
              </button>
            }
          />
        ) : null}
        {convs?.length ? (
          <div className="space-y-2.5">
            {convs.map((c) => {
              const mode = TUTOR_MODES.find((m) => m.id === c.mode);
              return (
                <Card key={c.id} className="p-0 overflow-hidden">
                  <button
                    onClick={() => push({ name: "tutor-chat", conversationId: c.id })}
                    className="flex w-full items-center gap-3 p-3.5 text-left transition hover:bg-muted/40 active:scale-[0.99]"
                  >
                    <div className="j-grad-primary grid size-11 shrink-0 place-items-center rounded-2xl text-white">
                      <MessageCircle className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-bold text-foreground">{c.title}</div>
                      <div className="truncate text-[11.5px] text-muted-foreground">
                        {c.subject} · {mode?.icon} {mode?.label || c.mode}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(c.updatedAt)}</span>
                  </button>
                  <div className="flex border-t border-border/70">
                    <button
                      onClick={() => {
                        setRenameFor(c);
                        setRenameVal(c.title);
                      }}
                      className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-primary"
                    >
                      <Pencil className="size-3.5" /> Rename
                    </button>
                    <button
                      onClick={() => remove(c)}
                      className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-j-error"
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : null}
      </div>

      <Sheet open={!!renameFor} onOpenChange={(v) => !v && setRenameFor(null)} title="Rename conversation">
        <div className="flex gap-2">
          <input
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            maxLength={80}
            className="min-h-12 flex-1 rounded-2xl border border-border bg-card px-4 text-[15px] outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/15"
            placeholder="Conversation name"
          />
          <button
            onClick={doRename}
            className="j-grad-primary min-h-12 rounded-2xl px-5 text-sm font-black text-white shadow-lg shadow-primary/25"
          >
            Save
          </button>
        </div>
      </Sheet>
    </div>
  );
}
