"use client";
// JeduAI — AI Tutor chat
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Copy, RotateCcw, ThumbsUp, ThumbsDown, Settings2, SquareUserRound, Layers, BookMarked } from "lucide-react";
import { api, useJedu } from "../store";
import { Card, Chip, EmptyState, LangButton, Sheet, TopBar, toast, MarkdownBody } from "../ui";
import { SUBJECTS, TUTOR_MODES, LANGUAGES } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  rating?: number | null;
  createdAt: string;
};
type Conv = {
  id: string;
  title: string;
  subject: string;
  mode: string;
  lang: string;
  updatedAt: string;
  messages: Msg[];
};

export default function TutorChat({ conversationId }: { conversationId?: string }) {
  const pop = useJedu((s) => s.pop);
  const push = useJedu((s) => s.push);
  const user = useJedu((s) => s.user)!;
  const [conv, setConv] = React.useState<Conv | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [setupOpen, setSetupOpen] = React.useState(false);

  const [subject, setSubject] = React.useState(user.subjects?.[0] || "Mathematics");
  const [mode, setMode] = React.useState("balanced");
  const [lang, setLang] = React.useState(user.explanationLang || "English");

  const scroller = React.useRef<HTMLDivElement>(null);

  const scrollDown = React.useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }, []);

  React.useEffect(() => {
    if (!conversationId) {
      setConv({ id: "", title: "New chat", subject, mode, lang, updatedAt: new Date().toISOString(), messages: [] });
      setLoading(false);
      return;
    }
    api<{ conversation: Conv }>(`/api/jeduai/tutor?id=${conversationId}`)
      .then((r) => {
        setConv(r.conversation);
        setSubject(r.conversation.subject);
        setMode(r.conversation.mode);
        setLang(r.conversation.lang);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [conversationId]);

  React.useEffect(() => {
    if (!loading) scrollDown(false);
  }, [loading, scrollDown]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || sending) return;
    setInput("");
    setErr("");
    setSending(true);

    // optimistic user bubble
    const tempId = `tmp-${Date.now()}`;
    setConv((c) =>
      c
        ? { ...c, messages: [...c.messages, { id: tempId, role: "user", content: q, createdAt: new Date().toISOString() }] }
        : c
    );
    scrollDown();

    try {
      const r = await api<{ conversationId: string; userMessage: Msg; aiMessage: Msg }>("/api/jeduai/tutor", {
        method: "POST",
        json: {
          conversationId: conv?.id || undefined,
          question: q,
          subject,
          mode,
          lang,
        },
      });
      setConv((c) => {
        if (!c) return c;
        const messages = c.messages.map((m) => (m.id === tempId ? r.userMessage : m));
        return { ...c, id: r.conversationId, messages: [...messages, r.aiMessage] };
      });
      scrollDown();
    } catch (e) {
      setConv((c) => (c ? { ...c, messages: c.messages.filter((m) => m.id !== tempId) } : c));
      setInput(q);
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function rate(m: Msg, v: 1 | -1) {
    if (m.rating) return;
    try {
      await api("/api/jeduai/tutor", { method: "PATCH", json: { messageId: m.id, rating: v } });
      setConv((c) =>
        c ? { ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, rating: v } : x)) } : c
      );
      toast.success(v > 0 ? "Thanks for the feedback!" : "Sorry about that — we'll do better.");
    } catch {
      /* non-critical */
    }
  }

  const [toolBusy, setToolBusy] = React.useState<string | null>(null);

  async function makeFlashcards(m: Msg) {
    if (toolBusy) return;
    setToolBusy(m.id);
    try {
      const r = await api<{ created: number; gamified?: { gained: number } }>("/api/jeduai/flashcards", {
        method: "POST",
        json: { sourceType: "message", sourceId: m.id, count: 6, lang: conv?.lang || lang },
      });
      toast.success(`${r.created} flashcards from this explanation`, {
        description: "Review them now or later — they're in your Flashcards decks.",
        action: {
          label: "Review",
          onClick: () => push({ name: "flashcards", deck: `message:${m.id}` }),
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToolBusy(null);
    }
  }

  async function saveVocabulary(m: Msg) {
    if (toolBusy) return;
    setToolBusy(m.id);
    try {
      const r = await api<{ created: number; skipped: number }>("/api/jeduai/vocab", {
        method: "POST",
        json: { messageId: m.id },
      });
      if (r.created) {
        toast.success(`${r.created} ${r.created === 1 ? "word" : "words"} saved to Vocabulary`, {
          action: { label: "Practice", onClick: () => push({ name: "vocab", practice: true }) },
        });
      } else {
        toast.info("All key terms from this answer are already in your Vocabulary");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToolBusy(null);
    }
  }

  const modeMeta = TUTOR_MODES.find((m) => m.id === mode);
  const langFlag = LANGUAGES.find((l) => l.name === lang)?.flag || "🌍";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title={conv?.title === "New chat" ? "New chat" : conv?.title || "New chat"}
        subtitle={`${modeMeta?.icon} ${modeMeta?.label || "Balanced"} · ${subject} · ${langFlag} ${lang}`}
        right={
          <button
            onClick={() => setSetupOpen(true)}
            aria-label="Chat settings"
            className="grid size-10 place-items-center rounded-full text-foreground/80 transition hover:bg-muted active:scale-95"
          >
            <Settings2 className="size-5" />
          </button>
        }
      />

      <div ref={scroller} className="j-app-scroll flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                <div className="h-16 w-52 animate-pulse rounded-3xl bg-muted" />
              </div>
            ))}
          </div>
        ) : !conv || !conv.messages.length ? (
          <div className="flex flex-col items-center pt-6">
            <EmptyState
              icon="🤖"
              title="What's on your mind today?"
              body={`I'll explain in ${lang}. Try one of these:`}
            />
            <div className="mt-4 grid w-full gap-2">
              {[
                `Explain photosynthesis with a real-life analogy`,
                `Help me solve: solve for x → 2x² − 8x + 6 = 0`,
                `5 quick revision questions on ${subject}`,
                `Why do we fall ill? Explain simply`,
              ].map((s) => (
                <Card
                  key={s}
                  onClick={() => send(s)}
                  className="flex min-h-12 items-center gap-2.5 px-4 text-[13.5px] font-semibold text-foreground/90 transition active:scale-[0.99]"
                >
                  <SquareUserRound className="size-4 shrink-0 text-primary" />
                  <span className="leading-snug">{s}</span>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {conv.messages.map((m) => (
              <MessageBubble
                key={m.id}
                m={m}
                onRate={rate}
                onRetry={m.role === "assistant" ? undefined : () => send(m.content)}
                onMakeFlashcards={m.role === "assistant" ? makeFlashcards : undefined}
                onSaveVocabulary={m.role === "assistant" ? saveVocabulary : undefined}
                toolBusy={toolBusy === m.id}
              />
            ))}
            {sending ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-3xl rounded-bl-lg bg-card px-4 py-3.5 shadow-sm ring-1 ring-border">
                  <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
                  <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                  <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-border/70 bg-card/95 px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2.5 backdrop-blur">
        {err ? (
          <button
            onClick={() => send()}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-j-error/10 py-2.5 text-[12.5px] font-bold text-j-error"
          >
            <RotateCcw className="size-4" /> {err} — tap to retry
          </button>
        ) : null}
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
            placeholder={`Ask anything — replies in ${lang}…`}
            aria-label="Message"
            className="j-app-scroll max-h-32 min-h-11 flex-1 resize-none rounded-3xl border border-border bg-background px-4 py-3 text-[14.5px] leading-snug text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            aria-label="Send message"
            className="j-grad-primary grid size-11 shrink-0 place-items-center rounded-full text-white shadow-lg shadow-primary/30 transition active:scale-90 disabled:opacity-40"
          >
            <ArrowUp className="size-5" />
          </button>
        </div>
      </div>

      <Sheet open={setupOpen} onOpenChange={setSetupOpen} title="Tutor setup">
        <div className="space-y-5 pb-2">
          <div>
            <div className="mb-2 text-[13px] font-bold text-foreground">Tutor mode</div>
            <div className="grid gap-1.5">
              {TUTOR_MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left transition",
                    mode === m.id ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"
                  )}
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
          </div>
          <div>
            <div className="mb-2 text-[13px] font-bold text-foreground">Subject focus</div>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map((s) => (
                <Chip key={s} active={subject === s} onClick={() => setSubject(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-bold text-foreground">Answer language</div>
            <LangButton value={lang} onChange={setLang} />
            <div className="mt-2 text-xs text-muted-foreground">
              The tutor writes explanations in this language even if you ask in another language.
            </div>
          </div>
          <button
            onClick={() => {
              setSetupOpen(false);
              push({ name: "tutor-chat" });
            }}
            className="j-grad-primary w-full rounded-2xl py-3 text-sm font-black text-white shadow-lg shadow-primary/25"
          >
            Start a fresh chat with these settings
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function MessageBubble({
  m,
  onRate,
  onRetry,
  onMakeFlashcards,
  onSaveVocabulary,
  toolBusy,
}: {
  m: Msg;
  onRate: (m: Msg, v: 1 | -1) => void;
  onRetry?: () => void;
  onMakeFlashcards?: (m: Msg) => void;
  onSaveVocabulary?: (m: Msg) => void;
  toolBusy?: boolean;
}) {
  const mine = m.role === "user";
  const [showTools, setShowTools] = React.useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex", mine ? "justify-end" : "justify-start")}
    >
      <div className={cn("max-w-[85%]", mine ? "items-end" : "items-start", "flex flex-col gap-1")}>
        <div
          className={cn(
            "px-4 py-3 shadow-sm",
            mine
              ? "j-grad-primary rounded-3xl rounded-br-lg text-white"
              : "rounded-3xl rounded-bl-lg bg-card text-foreground ring-1 ring-border"
          )}
        >
          {mine ? (
            <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{m.content}</p>
          ) : (
            <MarkdownBody text={m.content} className="text-foreground" />
          )}
        </div>
        <div className={cn("flex items-center gap-1 px-1", mine ? "flex-row-reverse" : "")}>
          <button
            aria-label="Copy message"
            onClick={() => {
              navigator.clipboard.writeText(m.content).then(() => toast.success("Copied"));
            }}
            className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Copy className="size-3.5" />
          </button>
          {!mine ? (
            <>
              <button
                aria-label="Helpful"
                onClick={() => onRate(m, 1)}
                className={cn(
                  "grid size-7 place-items-center rounded-full transition hover:bg-muted",
                  m.rating === 1 ? "text-j-success" : "text-muted-foreground hover:text-j-success"
                )}
              >
                <ThumbsUp className="size-3.5" />
              </button>
              <button
                aria-label="Not helpful"
                onClick={() => onRate(m, -1)}
                className={cn(
                  "grid size-7 place-items-center rounded-full transition hover:bg-muted",
                  m.rating === -1 ? "text-j-error" : "text-muted-foreground hover:text-j-error"
                )}
              >
                <ThumbsDown className="size-3.5" />
              </button>
            </>
          ) : null}
          {onMakeFlashcards ? (
            <button
              aria-label="Make flashcards from this explanation"
              title="Make flashcards"
              onClick={() => onMakeFlashcards(m)}
              disabled={toolBusy}
              className="flex min-h-7 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-muted-foreground transition hover:bg-j-violet/10 hover:text-j-violet disabled:opacity-50"
            >
              {toolBusy ? (
                <span className="size-3 animate-spin rounded-full border-[2px] border-j-violet/30 border-t-j-violet" />
              ) : (
                <Layers className="size-3.5" />
              )}
              Flashcards
            </button>
          ) : null}
          {onSaveVocabulary ? (
            <button
              aria-label="Save key vocabulary from this explanation"
              title="Save vocabulary"
              onClick={() => onSaveVocabulary(m)}
              disabled={toolBusy}
              className="flex min-h-7 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-muted-foreground transition hover:bg-j-cyan/10 hover:text-j-cyan disabled:opacity-50"
            >
              <BookMarked className="size-3.5" /> Words
            </button>
          ) : null}
          {onRetry ? (
            <button
              aria-label="Resend"
              onClick={onRetry}
              className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-primary"
            >
              <RotateCcw className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
