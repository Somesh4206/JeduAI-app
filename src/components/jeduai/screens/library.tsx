"use client";
// JeduAI — My Learning library
import React from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Clapperboard,
  Target,
  MessagesSquare,
  Languages,
  Bookmark as BmIcon,
  ListChecks,
  Search,
  ArrowUpDown,
  Pencil,
  Trash2,
  PlayCircle,
  Layers,
  BookMarked,
  NotebookPen,
  ChevronRight,
} from "lucide-react";
import { api, useJedu, timeAgo, type Screen } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, TopBar, toast } from "../ui";
import { cn } from "@/lib/utils";

type Item = {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  status?: string;
  progress?: number;
  score?: number;
  at: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sectionIdx?: number | null;
};

const TYPES: { key: string; label: string; icon: React.ReactNode; tint: string }[] = [
  { key: "all", label: "All", icon: null, tint: "" },
  { key: "document", label: "Documents", icon: <BookOpen className="size-3.5" />, tint: "bg-primary/10 text-primary" },
  { key: "video", label: "Media", icon: <Clapperboard className="size-3.5" />, tint: "bg-j-warning/10 text-j-warning" },
  { key: "quiz", label: "Quizzes", icon: <Target className="size-3.5" />, tint: "bg-j-success/10 text-j-success" },
  { key: "flashcards", label: "Flashcards", icon: <Layers className="size-3.5" />, tint: "bg-j-violet/10 text-j-violet" },
  { key: "vocab", label: "Words", icon: <BookMarked className="size-3.5" />, tint: "bg-j-cyan/10 text-j-cyan" },
  { key: "conversation", label: "AI Chats", icon: <MessagesSquare className="size-3.5" />, tint: "bg-j-violet/10 text-j-violet" },
  { key: "translation", label: "Translations", icon: <Languages className="size-3.5" />, tint: "bg-j-cyan/10 text-j-cyan" },
  { key: "bookmark", label: "Bookmarks", icon: <BmIcon className="size-3.5" />, tint: "bg-j-error/10 text-j-error" },
  { key: "task", label: "Done tasks", icon: <ListChecks className="size-3.5" />, tint: "bg-j-warning/10 text-j-warning" },
];

export default function LibraryScreen() {
  const push = useJedu((s) => s.push);
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [err, setErr] = React.useState("");
  const [q, setQ] = React.useState("");
  const [type, setType] = React.useState("all");
  const [sort, setSort] = React.useState<"recent" | "title" | "type">("recent");
  const [sortOpen, setSortOpen] = React.useState(false);
  const [renameFor, setRenameFor] = React.useState<Item | null>(null);
  const [renameVal, setRenameVal] = React.useState("");

  const load = React.useCallback(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (type !== "all") params.set("type", type);
    params.set("sort", sort);
    api<{ items: Item[] }>(`/api/jeduai/library?${params}`)
      .then((r) => setItems(r.items))
      .catch((e) => setErr((e as Error).message));
  }, [q, type, sort]);

  React.useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  function openItem(it: Item) {
    const go: Record<string, () => void> = {
      document: () => push({ name: "document-reader", id: it.id }),
      video: () => push({ name: "video-studio", id: it.id }),
      quiz: () => push({ name: "quiz-play", id: it.id }),
      conversation: () => push({ name: "tutor-chat", conversationId: it.id }),
      translation: () => useJedu.getState().setTab("translate"),
      flashcards: () => push({ name: "flashcards", deck: it.id }),
      vocab: () => push({ name: "vocab" }),
      bookmark: () => {
        // Jump straight to the bookmarked section / segment
        if (it.sourceType === "document" && it.sourceId) {
          push({ name: "document-reader", id: it.sourceId, section: it.sectionIdx ?? undefined });
        } else if (it.sourceType === "video" && it.sourceId) {
          push({ name: "video-studio", id: it.sourceId, segment: it.sectionIdx ?? undefined });
        } else {
          toast.info("This bookmark has no linked section.");
        }
      },
      task: () => push({ name: "planner" }),
    };
    (go[it.type] || (() => {}))();
  }

  async function remove(it: Item) {
    if (!confirm(`Delete "${it.title.slice(0, 50)}"?`)) return;
    try {
      await api("/api/jeduai/library", { method: "DELETE", json: { type: it.type, id: it.id } });
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function doRename() {
    if (!renameFor || !renameVal.trim()) return;
    try {
      await api("/api/jeduai/library", { method: "PATCH", json: { type: renameFor.type, id: renameFor.id, title: renameVal.trim() } });
      toast.success("Renamed");
      setRenameFor(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="My Learning" subtitle="Everything you've studied, in one place" />

      <div className="sticky top-0 z-20 border-b border-border/70 bg-card/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your library…"
            className="min-h-10 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/70"
          />
          <button
            onClick={() => setSortOpen(!sortOpen)}
            aria-label="Sort"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary"
          >
            <ArrowUpDown className="size-4" />
          </button>
        </div>
        {sortOpen ? (
          <div className="mt-2 flex gap-2">
            {(["recent", "title", "type"] as const).map((s) => (
              <Chip
                key={s}
                active={sort === s}
                onClick={() => {
                  setSort(s);
                  setSortOpen(false);
                }}
              >
                {s === "recent" ? "Recent" : s === "title" ? "A–Z" : "By type"}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="j-app-scroll mt-2 flex gap-2 overflow-x-auto pb-0.5">
          {TYPES.map((t) => (
            <Chip key={t.key} active={type === t.key} onClick={() => setType(t.key)} className="shrink-0">
              {t.icon} {t.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {/* Notebook Studio featured card */}
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => push({ name: "notebook-studio" })}
          className="j-shadow-soft mb-4 flex w-full items-center gap-3.5 rounded-3xl border border-j-violet/30 bg-gradient-to-r from-j-violet/12 to-j-violet/5 p-4 text-left transition active:scale-[0.98]"
        >
          <span className="j-grad-violet grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-md shadow-j-violet/25">
            <NotebookPen className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-black leading-tight text-foreground">Notebook Studio</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
              Research notebooks — sources, grounded chat & study artifacts
            </span>
          </span>
          <ChevronRight className="size-4.5 shrink-0 text-j-violet" />
        </motion.button>
        {err ? <ErrorState message={err} onRetry={load} /> : null}
        {!items && !err ? (
          <div className="space-y-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : !items?.length ? (
          <EmptyState
            icon="📚"
            title={q ? "Nothing matches your search" : "Your library is empty"}
            body={
              q
                ? `No results for “${q}”. Try a different term or filter.`
                : "Documents, videos, quizzes, chats and bookmarks will all live here."
            }
          />
        ) : (
          <>
            <div className="mb-2 px-1 text-[11.5px] font-bold text-muted-foreground">{items.length} items</div>
            <div className="space-y-2.5">
              {items.map((it, i) => {
                const meta = TYPES.find((t) => t.key === it.type);
                return (
                  <motion.div key={it.type + it.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
                    <Card className={cn("p-0 overflow-hidden", it.type === "bookmark" && "border-j-warning/40")}>
                      <button onClick={() => openItem(it)} className="flex w-full items-center gap-3 p-3.5 text-left transition hover:bg-muted/30 active:scale-[0.99]">
                        <div className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", meta?.tint || "bg-muted")}>
                          {it.type === "document" ? (
                            <BookOpen className="size-5" />
                          ) : it.type === "video" ? (
                            <PlayCircle className="size-5" />
                          ) : it.type === "quiz" ? (
                            <Target className="size-5" />
                          ) : it.type === "conversation" ? (
                            <MessagesSquare className="size-5" />
                          ) : it.type === "translation" ? (
                            <Languages className="size-5" />
                          ) : it.type === "flashcards" ? (
                            <Layers className="size-5" />
                          ) : it.type === "vocab" ? (
                            <BookMarked className="size-5" />
                          ) : it.type === "bookmark" ? (
                            <BmIcon className="size-5" />
                          ) : (
                            <ListChecks className="size-5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={cn("truncate text-[13.5px] font-bold text-foreground", it.type === "translation" && "italic")}>
                            {it.title}
                          </div>
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {it.type === "bookmark" && it.sourceType === "document" && it.sectionIdx !== null
                              ? `Section ${(it.sectionIdx ?? 0) + 1} · jump to it ↗`
                              : it.subtitle}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {typeof it.score === "number" ? (
                            <div className="text-[12px] font-black text-j-success">✓ {it.status}</div>
                          ) : null}
                          <div className="text-[11px] text-muted-foreground">{timeAgo(it.at)}</div>
                        </div>
                      </button>
                      {it.type === "bookmark" ? (
                        <div className="flex border-t border-border/70">
                          <button
                            onClick={() => remove(it)}
                            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-j-error"
                          >
                            <Trash2 className="size-3.5" /> Delete
                          </button>
                        </div>
                      ) : ["document", "video", "quiz", "conversation"].includes(it.type) ? (
                        <div className="flex border-t border-border/70">
                          <button
                            onClick={() => {
                              setRenameFor(it);
                              setRenameVal(it.title);
                            }}
                            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-primary"
                          >
                            <Pencil className="size-3.5" /> Rename
                          </button>
                          <button
                            onClick={() => remove(it)}
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
          </>
        )}
      </div>

      {renameFor ? (
        <div className="absolute inset-0 z-50 flex items-end">
          <button className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={() => setRenameFor(null)} />
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} className="relative w-full rounded-t-[28px] border-t border-border bg-card p-5 pb-[max(env(safe-area-inset-bottom),20px)]">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
            <h3 className="text-base font-black text-foreground">Rename</h3>
            <input
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              maxLength={90}
              className="mt-3 min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setRenameFor(null)} className="min-h-12 flex-1 rounded-2xl border border-border text-[14px] font-bold text-foreground">
                Cancel
              </button>
              <button onClick={doRename} className="j-grad-primary min-h-12 flex-1 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25">
                Save
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}
