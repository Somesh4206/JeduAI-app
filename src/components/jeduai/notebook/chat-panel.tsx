"use client";
// JeduAI Notebook Studio — grounded chat panel (SSE streaming, citations)
import React from "react";
import { motion } from "framer-motion";
import { ArrowUp, Copy, Check, RotateCcw, Square, MoreVertical, Pencil, Trash2, Plus, Sparkles, BookOpen, Lightbulb } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, EmptyState, ErrorState, Loader, MarkdownBody, PillSpan, Sheet, toast } from "../ui";
import { cn } from "@/lib/utils";
import { LANGUAGES } from "@/lib/jeduai/constants";
import { CitedText, CitationSheet, useChatStream } from "./shared";
import type { Citation, ConversationDTO, MessageDTO, SourceDTO } from "@/lib/jeduai/notebook/types";

const MODES = [
  { id: "balanced", icon: "⚖️", label: "Balanced", blurb: "Clear, well-rounded answers" },
  { id: "beginner", icon: "🌱", label: "Beginner", blurb: "Simple language, step by step" },
  { id: "exam", icon: "🎯", label: "Exam", blurb: "Focused, exam-ready detail" },
  { id: "advanced", icon: "🚀", label: "Advanced", blurb: "Depth, nuance and terminology" },
];

export function ChatPanel({
  notebookId,
  notebookTitle,
  sources,
  onOpenSource,
  onGoSources,
}: {
  notebookId: string;
  notebookTitle: string;
  sources: SourceDTO[] | null;
  onOpenSource: (c: Citation) => void;
  onGoSources: () => void;
}) {
  const user = useJedu((s) => s.user)!;
  const [conversations, setConversations] = React.useState<ConversationDTO[] | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<MessageDTO[] | null>(null);
  const [msgsLoading, setMsgsLoading] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<string[] | null>(null);
  const [input, setInput] = React.useState("");
  const [mode, setMode] = React.useState("balanced");
  const [lang, setLang] = React.useState(user.explanationLang || "English");
  const [modeOpen, setModeOpen] = React.useState(false);
  const [langOpen, setLangOpen] = React.useState(false);
  const [convMenu, setConvMenu] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");
  const [citeMsg, setCiteMsg] = React.useState<MessageDTO | null>(null);
  const [copied, setCopied] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);
  const stream = useChatStream(notebookId);

  const readyCount = (sources || []).filter((s) => s.status === "ready").length;
  const activeConv = (conversations || []).find((c) => c.id === activeId) || null;

  const loadConversations = React.useCallback(async () => {
    try {
      const r = await api<{ conversations: ConversationDTO[] }>(`/api/jeduai/notebook/${notebookId}/chat`);
      setConversations(r.conversations || []);
      return r.conversations || [];
    } catch {
      setConversations([]);
      return [];
    }
  }, [notebookId]);

  const loadMessages = React.useCallback(
    async (convId: string | null) => {
      if (!convId) {
        setMessages([]);
        return;
      }
      setMsgsLoading(true);
      try {
        const r = await api<{ conversation: ConversationDTO }>(`/api/jeduai/notebook/${notebookId}/chat?conversationId=${convId}`);
        setMessages(r.conversation?.messages || []);
      } catch {
        setMessages([]);
      } finally {
        setMsgsLoading(false);
      }
    },
    [notebookId]
  );

  React.useEffect(() => {
    let alive = true;
    loadConversations().then((convs) => {
      if (!alive) return;
      if (convs.length) {
        setActiveId(convs[0].id);
        loadMessages(convs[0].id);
      } else {
        setMessages([]);
      }
    });
    return () => {
      alive = false;
    };
  }, [loadConversations, loadMessages]);

  // suggested questions for the welcome state
  React.useEffect(() => {
    if (readyCount === 0 || activeId) return;
    let alive = true;
    setSuggestions(null);
    api<{ questions: string[] }>(`/api/jeduai/notebook/${notebookId}/chat?suggest=1`)
      .then((r) => alive && setSuggestions(r.questions || []))
      .catch(() => alive && setSuggestions([]));
    return () => {
      alive = false;
    };
  }, [notebookId, activeId, readyCount]);

  const scrollDown = React.useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }, []);

  React.useEffect(() => {
    scrollDown(false);
  }, [msgsLoading, scrollDown]);

  React.useEffect(() => {
    if (stream.streaming) scrollDown();
  }, [stream.streamText, stream.streaming, scrollDown]);

  function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || stream.streaming) return;
    setInput("");
    const tmpId = `tmp-${Date.now()}`;
    setMessages((m) => [
      ...(m || []),
      { id: tmpId, role: "user", content: q, citations: [], createdAt: new Date().toISOString() },
    ]);
    scrollDown();
    let convId = activeId;
    stream.send({
      question: q,
      conversationId: activeId,
      mode,
      lang,
      onConversationId: (id) => {
        convId = id;
        if (id !== activeId) setActiveId(id);
      },
      onDone: async (final) => {
        const target = final.conversationId || convId;
        if (target) {
          await Promise.all([loadMessages(target), loadConversations()]);
        } else {
          // failed before meta — drop the optimistic bubble
          setMessages((m) => (m || []).filter((x) => x.id !== tmpId));
          loadConversations();
        }
        stream.clearStream();
      },
    });
  }

  function switchConversation(id: string | null) {
    setActiveId(id);
    stream.stop();
    stream.clearStream();
    loadMessages(id);
  }

  async function renameConversation() {
    if (!activeId || !renameVal.trim()) return;
    try {
      await api(`/api/jeduai/notebook/${notebookId}/chat`, { method: "PATCH", json: { conversationId: activeId, title: renameVal.trim() } });
      toast.success("Renamed");
      setRenameOpen(false);
      setConvMenu(false);
      loadConversations();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteConversation() {
    if (!activeId) return;
    if (!confirm("Delete this conversation?")) return;
    try {
      await api(`/api/jeduai/notebook/${notebookId}/chat?conversationId=${activeId}`, { method: "DELETE" });
      toast.success("Conversation deleted");
      setConvMenu(false);
      const convs = await loadConversations();
      switchConversation(convs[0]?.id ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function copyMessage(m: MessageDTO) {
    navigator.clipboard
      .writeText(m.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error("Couldn't copy"));
  }

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const langFlag = LANGUAGES.find((l) => l.name === lang)?.flag || "🌍";
  const welcome = !activeId && !(messages || []).length;
  const lastAssistant = [...(messages || [])].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* conversation header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/85 px-4 py-2.5 backdrop-blur">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold text-foreground">{activeConv?.title || "New chat"}</div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            {readyCount > 0 ? `Grounded in ${readyCount} ready source${readyCount === 1 ? "" : "s"} · ${modeMeta.icon} ${modeMeta.label} · ${langFlag} ${lang}` : "Chat unlocks once sources are ready"}
          </div>
        </div>
        <button
          onClick={() => {
            setRenameVal(activeConv?.title || "");
            setConvMenu(true);
          }}
          aria-label="Conversation options"
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95"
        >
          <MoreVertical className="size-4.5" />
        </button>
      </div>

      {/* conversation switcher */}
      {(conversations || []).length > 0 || !welcome ? (
        <div className="j-app-scroll flex shrink-0 gap-2 overflow-x-auto border-b border-border/50 bg-muted/25 px-3 py-2">
          <button
            onClick={() => switchConversation(null)}
            className={cn(
              "flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[12px] font-bold transition active:scale-95",
              !activeId ? "j-grad-primary border-transparent text-white shadow-md shadow-primary/20" : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            <Plus className="size-3.5" /> New chat
          </button>
          {(conversations || []).map((c) => (
            <button
              key={c.id}
              onClick={() => switchConversation(c.id)}
              className={cn(
                "flex min-h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold transition active:scale-95",
                c.id === activeId ? "j-grad-primary border-transparent text-white shadow-md shadow-primary/20" : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="truncate">{c.title}</span>
              <span className={cn("shrink-0 text-[10px] font-semibold", c.id === activeId ? "text-white/75" : "text-muted-foreground/70")}>{timeAgo(c.updatedAt)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* messages */}
      <div ref={scroller} className="j-app-scroll min-h-0 flex-1 overflow-y-auto px-3.5 py-4">
        {readyCount === 0 && sources !== null ? (
          <div className="pt-4">
            <EmptyState
              icon="📚"
              title="No sources to chat with yet"
              body="Add a document, link or audio file first — answers are grounded strictly in your notebook sources."
              action={
                <button onClick={onGoSources} className="j-grad-primary flex min-h-11 items-center gap-2 rounded-full px-5 text-[13.5px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-95">
                  <BookOpen className="size-4" /> Go to Sources
                </button>
              }
            />
          </div>
        ) : msgsLoading && !messages ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                <div className="h-16 w-52 animate-pulse rounded-3xl bg-muted" />
              </div>
            ))}
          </div>
        ) : welcome ? (
          <div className="flex flex-col items-center pt-2">
            <div className="grid size-14 place-items-center rounded-3xl bg-primary/10 text-primary">
              <Sparkles className="size-6" />
            </div>
            <div className="mt-3 text-center text-[15px] font-black text-foreground">Ask {notebookTitle}</div>
            <p className="mt-1 max-w-[280px] text-center text-[12px] leading-relaxed text-muted-foreground">
              Answers come only from your selected sources, with citations you can verify.
            </p>
            <div className="mt-4 grid w-full gap-2">
              {suggestions === null
                ? [0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-muted" />)
                : suggestions.length
                  ? suggestions.slice(0, 4).map((s, i) => (
                      <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                        <Card onClick={() => setInput(s)} className="flex min-h-12 items-center gap-2.5 px-4 text-[13px] font-semibold text-foreground/90 transition active:scale-[0.99]">
                          <Lightbulb className="size-4 shrink-0 text-j-warning" />
                          <span className="leading-snug">{s}</span>
                        </Card>
                      </motion.div>
                    ))
                  : [
                      "Summarize the key ideas across all sources",
                      "What do my sources disagree about?",
                      "Explain the most difficult concept simply",
                      "Give me 5 flashcard-worthy facts",
                    ].map((s, i) => (
                      <Card key={i} onClick={() => setInput(s)} className="flex min-h-12 items-center gap-2.5 px-4 text-[13px] font-semibold text-foreground/90 transition active:scale-[0.99]">
                        <Lightbulb className="size-4 shrink-0 text-j-warning" />
                        <span className="leading-snug">{s}</span>
                      </Card>
                    ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {(messages || []).map((m, i) =>
              m.role === "user" ? (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                  <div className="j-grad-primary max-w-[85%] rounded-3xl rounded-br-lg px-4 py-3 text-white shadow-sm">
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{m.content}</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-1">
                  <Card className="rounded-3xl rounded-bl-lg p-3.5">
                    <CitedText content={m.content} citations={m.citations || []} onCitation={() => setCiteMsg(m)} className="text-[13.5px] leading-relaxed text-foreground" />
                    {m.citations?.length ? (
                      <button onClick={() => setCiteMsg(m)} className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 text-[11.5px] font-bold text-muted-foreground transition hover:text-primary">
                        <BookOpen className="size-3.5" /> {m.citations.length} source{m.citations.length === 1 ? "" : "s"} cited
                      </button>
                    ) : null}
                  </Card>
                  {m.id === lastAssistant?.id && !stream.streaming ? (
                    <div className="flex items-center gap-1 px-1">
                      <button onClick={() => copyMessage(m)} aria-label="Copy answer" className="flex min-h-8 items-center gap-1 rounded-full px-2 text-[11.5px] font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground">
                        {copied ? <Check className="size-3.5 text-j-success" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
                      </button>
                      <button onClick={() => stream.regenerate()} aria-label="Ask again" className="flex min-h-8 items-center gap-1 rounded-full px-2 text-[11.5px] font-bold text-muted-foreground transition hover:bg-muted hover:text-primary">
                        <RotateCcw className="size-3.5" /> Retry
                      </button>
                    </div>
                  ) : null}
                </motion.div>
              )
            )}

            {/* streaming bubble */}
            {stream.streaming ? (
              <div className="flex flex-col gap-1">
                <Card className="rounded-3xl rounded-bl-lg p-3.5">
                  {stream.streamText ? (
                    <>
                      <MarkdownBody text={stream.streamText} className="text-[13.5px] leading-relaxed text-foreground" />
                      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-text-bottom" aria-hidden />
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5 py-1">
                      <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
                      <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                      <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
                    </div>
                  )}
                  {stream.streamCitations.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {stream.streamCitations.map((c) => (
                        <span key={c.index} className="inline-flex animate-pulse items-center gap-1 rounded-full border border-primary/25 bg-primary/8 px-2 py-0.5 text-[10.5px] font-bold text-primary">
                          [{c.index}] {c.sourceTitle.slice(0, 22)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Card>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-border/70 bg-card/95 px-3 pt-2 pb-[max(env(safe-area-inset-bottom),10px)] backdrop-blur">
        {stream.error ? (
          <button
            onClick={() => stream.regenerate()}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-j-error/10 py-2.5 text-[12.5px] font-bold text-j-error"
          >
            <RotateCcw className="size-4" /> {stream.error} — tap to retry
          </button>
        ) : null}
        {/* quick actions */}
        <div className="j-app-scroll mb-2 flex gap-2 overflow-x-auto pb-0.5">
          <QuickChip onClick={() => setInput("Explain simply: ")}>Explain simply</QuickChip>
          <QuickChip onClick={() => setInput("Summarize: ")}>Summarize</QuickChip>
          <QuickChip onClick={() => setInput("Compare my sources on: ")}>Compare sources</QuickChip>
          <QuickChip onClick={() => setInput("Key facts: ")}>Key facts</QuickChip>
          <button
            onClick={() => setModeOpen(true)}
            className="flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 text-[12px] font-bold text-foreground/80 transition hover:border-primary/40 hover:text-primary active:scale-95"
          >
            {modeMeta.icon} {modeMeta.label}
          </button>
          <button
            onClick={() => setLangOpen(true)}
            className="flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 text-[12px] font-bold text-foreground/80 transition hover:border-primary/40 hover:text-primary active:scale-95"
          >
            {langFlag} {lang}
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={readyCount ? "Ask about your sources…" : "Add sources to unlock chat…"}
            aria-label="Question"
            disabled={readyCount === 0 && sources !== null}
            className="j-app-scroll max-h-32 min-h-11 flex-1 resize-none rounded-3xl border border-border bg-background px-4 py-3 text-[14px] leading-snug text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
          />
          {stream.streaming ? (
            <button
              onClick={stream.stop}
              aria-label="Stop generating"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-j-error/10 text-j-error shadow-sm ring-1 ring-j-error/25 transition active:scale-90"
            >
              <Square className="size-4.5" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim() || stream.streaming}
              aria-label="Send question"
              className="j-grad-primary grid size-11 shrink-0 place-items-center rounded-full text-white shadow-lg shadow-primary/30 transition active:scale-90 disabled:opacity-40"
            >
              <ArrowUp className="size-5" />
            </button>
          )}
        </div>
      </div>

      {/* conversation menu */}
      <Sheet open={convMenu} onOpenChange={setConvMenu} title="Conversation">
        <div className="space-y-1.5 pb-2">
          <button
            onClick={() => {
              setConvMenu(false);
              switchConversation(null);
            }}
            className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold text-foreground transition hover:bg-muted"
          >
            <Plus className="size-4.5" /> New chat
          </button>
          {activeId ? (
            <>
              <button
                onClick={() => {
                  setConvMenu(false);
                  setRenameOpen(true);
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold text-foreground transition hover:bg-muted"
              >
                <Pencil className="size-4.5" /> Rename
              </button>
              <button
                onClick={deleteConversation}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold text-j-error transition hover:bg-j-error/8"
              >
                <Trash2 className="size-4.5" /> Delete conversation
              </button>
            </>
          ) : null}
        </div>
      </Sheet>

      <Sheet open={renameOpen} onOpenChange={setRenameOpen} title="Rename conversation">
        <div className="space-y-3 pb-2">
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            maxLength={90}
            aria-label="Conversation title"
            className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
          />
          <button onClick={renameConversation} className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25">
            Save
          </button>
        </div>
      </Sheet>

      {/* mode */}
      <Sheet open={modeOpen} onOpenChange={setModeOpen} title="Answer mode">
        <div className="grid gap-1.5 pb-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                setModeOpen(false);
              }}
              className={cn("flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left transition", mode === m.id ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted")}
            >
              <span className="text-xl">{m.icon}</span>
              <span className="flex-1 leading-tight">
                <span className="block text-[13.5px] font-bold text-foreground">{m.label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{m.blurb}</span>
              </span>
              {mode === m.id ? <span className="text-sm font-black text-primary">✓</span> : null}
            </button>
          ))}
        </div>
      </Sheet>

      {/* language */}
      <Sheet open={langOpen} onOpenChange={setLangOpen} title="Answer language">
        <div className="grid gap-1 pb-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.name}
              onClick={() => {
                setLang(l.name);
                setLangOpen(false);
              }}
              className={cn("flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left transition", lang === l.name ? "bg-primary/10" : "hover:bg-muted")}
            >
              <span className="text-xl">{l.flag}</span>
              <span className="flex-1 leading-tight">
                <span className="block text-sm font-bold text-foreground">{l.name}</span>
                <span className="block text-xs text-muted-foreground">{l.native}</span>
              </span>
              {lang === l.name ? <span className="text-sm font-black text-primary">✓</span> : null}
            </button>
          ))}
        </div>
      </Sheet>

      <CitationSheet
        open={!!citeMsg}
        onOpenChange={(v) => {
          if (!v) setCiteMsg(null);
        }}
        citations={citeMsg?.citations || []}
        sources={sources || []}
        onOpenSource={onOpenSource}
      />
    </div>
  );
}

function QuickChip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-8 shrink-0 items-center rounded-full border border-border bg-muted/60 px-3 text-[12px] font-bold text-foreground/80 transition hover:bg-muted hover:text-primary active:scale-95"
    >
      {children}
    </button>
  );
}
