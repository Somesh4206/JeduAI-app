"use client";
// JeduAI — Global search
import React from "react";
import { Search as SearchIcon, ArrowRight, BookOpen, Clapperboard, Target, MessagesSquare, Languages } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, EmptyState, Loader, TopBar } from "../ui";
import { cn } from "@/lib/utils";

type Item = { type: string; id: string; title: string; subtitle: string; at: string };

export default function SearchScreen() {
  const pop = useJedu((s) => s.pop);
  const push = useJedu((s) => s.push);
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [typing, setTyping] = React.useState(false);

  React.useEffect(() => {
    if (!q.trim()) {
      setItems(null);
      return;
    }
    setTyping(true);
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: Item[] }>(`/api/jeduai/library?q=${encodeURIComponent(q.trim())}`);
        setItems(r.items);
      } catch {
        setItems([]);
      } finally {
        setTyping(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function open(it: Item) {
    if (it.type === "document") push({ name: "document-reader", id: it.id });
    else if (it.type === "video") push({ name: "video-studio", id: it.id });
    else if (it.type === "quiz") push({ name: "quiz-play", id: it.id });
    else if (it.type === "conversation") push({ name: "tutor-chat", conversationId: it.id });
    else if (it.type === "translation") useJedu.getState().setTab("translate");
    else pop();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar onBack={pop} title="Search" />
      <div className="border-b border-border/70 bg-card/95 px-4 py-3">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3.5 focus-within:border-primary/50">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search documents, videos, quizzes, chats…"
            className="min-h-10 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted-foreground/70"
          />
        </div>
      </div>
      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {typing ? <Loader label="Searching…" /> : null}
        {!typing && !q.trim() ? (
          <EmptyState icon="🔍" title="Search everything you've learned" body="Documents, translated media, quizzes, AI conversations, bookmarks…" />
        ) : null}
        {!typing && q.trim() && items ? (
          !items.length ? (
            <EmptyState icon="🫥" title="No results" body={`Nothing matches “${q}”.`} />
          ) : (
            <div className="space-y-2.5">
              {items.slice(0, 40).map((it) => (
                <Card key={it.type + it.id} onClick={() => open(it)} className="flex items-center gap-3 p-3.5">
                  <div
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-2xl",
                      it.type === "document"
                        ? "bg-primary/10 text-primary"
                        : it.type === "video"
                          ? "bg-j-warning/10 text-j-warning"
                          : it.type === "quiz"
                            ? "bg-j-success/10 text-j-success"
                            : it.type === "conversation"
                              ? "bg-j-violet/10 text-j-violet"
                              : "bg-j-cyan/10 text-j-cyan"
                    )}
                  >
                    {it.type === "document" ? (
                      <BookOpen className="size-5" />
                    ) : it.type === "video" ? (
                      <Clapperboard className="size-5" />
                    ) : it.type === "quiz" ? (
                      <Target className="size-5" />
                    ) : it.type === "conversation" ? (
                      <MessagesSquare className="size-5" />
                    ) : (
                      <Languages className="size-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold text-foreground">{it.title}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{it.subtitle}</div>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </Card>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
