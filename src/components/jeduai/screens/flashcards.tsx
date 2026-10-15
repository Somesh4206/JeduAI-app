"use client";
// JeduAI — Flashcards: AI-generated decks with Leitner spaced repetition
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  BookOpen,
  BookMarked,
  Clapperboard,
  MessagesSquare,
  Trash2,
  RotateCcw,
  Check,
  X,
  ChevronRight,
  Sparkles,
  Download,
  Share2,
  UserPlus,
  Copy,
  PencilLine,
  FileUp,
  NotebookPen,
} from "lucide-react";
import { api, useJedu } from "../store";
import { Card, EmptyState, ErrorState, Loader, ProgressBar, Segmented, Sheet, TopBar, toast } from "../ui";
import { cn } from "@/lib/utils";

type FCard = {
  id: string;
  deckTitle: string;
  sourceType: string;
  sourceId: string | null;
  front: string;
  back: string;
  lang: string;
  box: number;
  streak: number;
  lastResult: string | null;
  dueAt: string;
  createdAt: string;
};
type Deck = {
  key: string;
  deckTitle: string;
  sourceType: string;
  sourceId: string | null;
  total: number;
  due: number;
  learned: number;
  nextDue: string | null;
};

const BOX_LABELS = ["New", "Learning", "Familiar", "Strong", "Mastered"];

const PASTE_LANGS = ["English", "Hindi", "Marathi", "Bengali", "Tamil", "Telugu", "Kannada", "Gujarati", "Urdu", "Punjabi", "Spanish", "French", "German", "Arabic"];

// parse "front | back" style lines: pipe > tab > semicolon > comma separators;
// skips blanks and a leading "front,back" header row.
function parseCards(text: string): { front: string; back: string }[] {
  const lines = text.split(/\r?\n/);
  const out: { front: string; back: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const sep = ["|", "\t", ";", ","].find((s) => line.includes(s));
    if (!sep) continue;
    const idx = line.indexOf(sep);
    const front = line.slice(0, idx).trim();
    const back = line.slice(idx + sep.length).trim();
    if (!front || !back) continue;
    if (i === 0 && /^front$/i.test(front) && /^back$/i.test(back)) continue; // CSV header
    out.push({ front: front.slice(0, 300), back: back.slice(0, 800) });
  }
  return out.slice(0, 60);
}

type SharePreview = {
  code: string;
  title: string;
  lang: string;
  count: number;
  creator: string;
  imports: number;
  expiresAt: string | null;
  mine: boolean;
  alreadyImported: boolean;
  sample: { front: string; back: string }[];
};

export default function FlashcardsScreen({ deck }: { deck?: string }) {
  const pop = useJedu((s) => s.pop);
  const [decks, setDecks] = React.useState<Deck[] | null>(null);
  const [err, setErr] = React.useState("");
  // review session state
  const [session, setSession] = React.useState<FCard[] | null>(null);
  const [sessionDeck, setSessionDeck] = React.useState<string>("");
  const [idx, setIdx] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [known, setKnown] = React.useState(0);
  const [again, setAgain] = React.useState(0);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // share / import state
  const [shareDeck, setShareDeck] = React.useState<string | null>(null);
  const [shareCode, setShareCode] = React.useState("");
  const [shareExpiry, setShareExpiry] = React.useState<string | null>(null);
  const [shareBusy, setShareBusy] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importCode, setImportCode] = React.useState("");
  const [preview, setPreview] = React.useState<SharePreview | null>(null);
  const [importBusy, setImportBusy] = React.useState(false);
  // paste / CSV deck authoring
  const [importTab, setImportTab] = React.useState<"code" | "paste">("code");
  const [pasteTitle, setPasteTitle] = React.useState("");
  const [pasteLang, setPasteLang] = React.useState("");
  const [pasteText, setPasteText] = React.useState("");
  const [pasteBusy, setPasteBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const parsedCards = React.useMemo(() => parseCards(pasteText), [pasteText]);

  const loadDecks = React.useCallback(() => {
    api<{ decks: Deck[] }>("/api/jeduai/flashcards")
      .then((r) => setDecks(r.decks))
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    if (deck) {
      // deep link: start reviewing this deck right away
      startSession(deck);
    } else {
      loadDecks();
    }
  }, [deck]);

  async function startSession(deckKey: string) {
    setBusy(true);
    try {
      const r = await api<{ cards: FCard[] }>(`/api/jeduai/flashcards?deck=${encodeURIComponent(deckKey)}`);
      if (!r.cards.length) {
        toast.info("This deck has no cards.");
        loadDecks();
        return;
      }
      // due cards first, then the rest (new/early boxes)
      const now = Date.now();
      const sorted = [...r.cards].sort((a, b) => {
        const ad = new Date(a.dueAt).getTime() <= now ? 0 : 1;
        const bd = new Date(b.dueAt).getTime() <= now ? 0 : 1;
        return ad - bd || a.box - b.box;
      });
      setSession(sorted);
      setSessionDeck(deckKey);
      setIdx(0);
      setFlipped(false);
      setKnown(0);
      setAgain(0);
      setDone(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(result: "known" | "again") {
    if (!session) return;
    const card = session[idx];
    try {
      await api("/api/jeduai/flashcards", { method: "PATCH", json: { id: card.id, result } });
      if (result === "known") setKnown((k) => k + 1);
      else setAgain((a) => a + 1);
      if (idx + 1 < session.length) {
        setFlipped(false);
        setTimeout(() => setIdx((i) => i + 1), 120);
      } else {
        setDone(true);
      }
      if (navigator.vibrate) navigator.vibrate(result === "known" ? 10 : [12, 40, 12]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteDeck(deckKey: string) {
    if (!confirm("Delete this flashcard deck?")) return;
    try {
      await api(`/api/jeduai/flashcards?deck=${encodeURIComponent(deckKey)}`, { method: "DELETE" });
      toast.success("Deck deleted");
      loadDecks();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function exportCsv(deckKey: string) {
    try {
      const r = await api<{ cards: FCard[] }>(`/api/jeduai/flashcards?deck=${encodeURIComponent(deckKey)}`);
      if (!r.cards.length) {
        toast.info("This deck has no cards.");
        return;
      }
      const esc = (v: string) => `"${v.replace(/"/g, "\"\"").replace(/\r?\n/g, " ")}"`;
      const rows = [
        "Front,Back,Language,Box,Status",
        ...r.cards.map((c) => [esc(c.front), esc(c.back), esc(c.lang), String(c.box), c.lastResult || "new"].join(",")),
      ];
      const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${r.cards[0].deckTitle.slice(0, 50)} — flashcards.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${r.cards.length} cards as CSV`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function nextReviewIn(nextDue: string | null): string {
    if (!nextDue) return "";
    const ms = new Date(nextDue).getTime() - Date.now();
    if (ms <= 0) return "";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `next in ${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `next in ${hours}h`;
    return `next in ${Math.round(hours / 24)}d`;
  }

  function endSession() {
    setSession(null);
    setSessionDeck("");
    loadDecks();
  }

  async function openShare(deckKey: string) {
    setShareDeck(deckKey);
    setShareCode("");
    setShareExpiry(null);
    setShareBusy(true);
    try {
      const r = await api<{ code: string; count: number; title: string; expiresAt: string | null }>("/api/jeduai/flashcards/share", {
        method: "POST",
        json: { deck: deckKey },
      });
      setShareCode(r.code);
      setShareExpiry(r.expiresAt);
    } catch (e) {
      toast.error((e as Error).message);
      setShareDeck(null);
    } finally {
      setShareBusy(false);
    }
  }

  async function lookupCode() {
    const code = importCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      toast.error("Codes are 6 characters (letters & digits, no O/I/L/0/1).");
      return;
    }
    setImportBusy(true);
    setPreview(null);
    try {
      const r = await api<SharePreview>(`/api/jeduai/flashcards/share?code=${encodeURIComponent(code)}`);
      setPreview(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

  async function importDeck() {
    if (!preview) return;
    setImportBusy(true);
    try {
      const r = await api<{ imported: number; title: string }>("/api/jeduai/flashcards/share", {
        method: "PUT",
        json: { code: preview.code },
      });
      toast.success(`Added “${r.title}” · ${r.imported} cards ready to review`);
      setImportOpen(false);
      setImportCode("");
      setPreview(null);
      loadDecks();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

  async function createBulkDeck() {
    if (parsedCards.length < 2) return;
    setPasteBusy(true);
    try {
      const r = await api<{ count: number; title: string }>("/api/jeduai/flashcards/bulk", {
        method: "POST",
        json: { title: pasteTitle.trim() || "My deck", lang: pasteLang || undefined, cards: parsedCards },
      });
      toast.success(`Created “${r.title}” · ${r.count} cards ready to review`);
      setImportOpen(false);
      setPasteTitle("");
      setPasteText("");
      loadDecks();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPasteBusy(false);
    }
  }

  function onLoadFile(file: File | null) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("File too large — keep it under 512 KB (up to 60 cards).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPasteText(String(reader.result || "").slice(0, 200_000));
    };
    reader.readAsText(file);
  }

  // ---------------- REVIEW SESSION ----------------
  if (session) {
    const card = session[Math.min(idx, session.length - 1)];
    const progress = ((idx + (done ? 1 : 0)) / session.length) * 100;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar
          onBack={endSession}
          title={card.deckTitle}
          subtitle={`Flashcards · ${card.lang}`}
          right={
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-j-success/10 px-2.5 py-1 text-[11px] font-black text-j-success">✓ {known}</span>
              <span className="rounded-full bg-j-error/10 px-2.5 py-1 text-[11px] font-black text-j-error">↻ {again}</span>
            </div>
          }
        />

        <div className="border-b border-border/70 bg-card/60 px-4 py-3">
          <ProgressBar value={progress} />
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-muted-foreground">
            <span>
              {Math.min(idx + 1, session.length)} of {session.length}
            </span>
            <span>
              Box {card.box}/5 · {BOX_LABELS[Math.min(Math.max(card.box, 1), 5) - 1]}
            </span>
          </div>
        </div>

        <div className="j-app-scroll flex flex-1 flex-col overflow-y-auto px-4 py-5">
          {done ? (
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-6">
              <div className="j-grad-primary j-shadow-soft rounded-[26px] p-6 text-center text-white">
                <div className="text-5xl">{known >= again ? "🧠" : "💪"}</div>
                <div className="mt-2 text-3xl font-black">
                  {known}
                  <span className="text-lg font-bold text-white/70">/{session.length} recalled</span>
                </div>
                <div className="mt-1.5 text-[13px] font-bold text-white/85">
                  {again === 0
                    ? "Perfect run! Cards moved to higher boxes."
                    : `${again} ${again === 1 ? "card needs" : "cards need"} another pass — they'll come back sooner.`}
                </div>
              </div>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => startSession(sessionDeck)}
                  className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-[14px] font-bold text-foreground active:scale-[0.98]"
                >
                  <RotateCcw className="size-4" /> Review again
                </button>
                <button
                  onClick={endSession}
                  className="j-grad-primary flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30 active:scale-[0.98]"
                >
                  Done
                </button>
              </div>
            </motion.div>
          ) : (
            <>
              {/* flip card */}
              <div className="perspective-1000 relative h-72">
                <AnimatePresence initial={false} mode="wait">
                  <motion.button
                    key={card.id + String(flipped)}
                    initial={{ rotateY: flipped ? -90 : 90, opacity: 0.4 }}
                    animate={{ rotateY: 0, opacity: 1 }}
                    exit={{ rotateY: flipped ? 90 : -90, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    onClick={() => setFlipped((f) => !f)}
                    aria-label={flipped ? "Show question side" : "Reveal answer"}
                    className={cn(
                      "flex h-full w-full flex-col rounded-[26px] border-2 p-6 text-left shadow-xl",
                      flipped
                        ? "border-j-success/40 bg-gradient-to-br from-j-success/10 to-card"
                        : "border-primary/30 bg-gradient-to-br from-primary/10 to-card"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn("text-[10.5px] font-black uppercase tracking-widest", flipped ? "text-j-success" : "text-primary")}>
                        {flipped ? "Answer" : "Question"}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                        {flipped ? "tap to flip back" : "tap to reveal"}
                      </span>
                    </div>
                    <div className="j-app-scroll flex flex-1 items-center justify-center overflow-y-auto py-2">
                      <p
                        className={cn(
                          "text-center leading-relaxed text-foreground",
                          flipped ? "text-[16.5px] font-semibold" : "text-[19px] font-black"
                        )}
                      >
                        {flipped ? card.back : card.front}
                      </p>
                    </div>
                    {flipped ? null : (
                      <div className="text-center text-[11px] font-semibold text-muted-foreground">
                        Think of the answer first, then flip 🤔
                      </div>
                    )}
                  </motion.button>
                </AnimatePresence>
              </div>

              {/* result buttons */}
              {flipped ? (
                <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => review("again")}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-j-error/30 bg-j-error/10 py-4 text-[15px] font-black text-j-error transition active:scale-[0.97]"
                  >
                    <X className="size-5" /> Again
                    <span className="text-[10px] font-bold opacity-70">10 min</span>
                  </button>
                  <button
                    onClick={() => review("known")}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-j-success/30 bg-j-success/10 py-4 text-[15px] font-black text-j-success transition active:scale-[0.97]"
                  >
                    <Check className="size-5" /> I knew it
                    <span className="text-[10px] font-bold opacity-70">{[1, 2, 4, 8, 16][Math.min(card.box, 4)]}d</span>
                  </button>
                </motion.div>
              ) : (
                <button
                  onClick={() => setFlipped(true)}
                  className="j-grad-primary mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98]"
                >
                  <Sparkles className="size-5" /> Reveal answer
                </button>
              )}

              <p className="mt-4 px-2 text-center text-[11.5px] leading-relaxed text-muted-foreground">
                Spaced repetition: &ldquo;I knew it&rdquo; pushes the card further away, &ldquo;Again&rdquo; brings it back in 10 minutes.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---------------- DECK LIST ----------------
  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Flashcards" />
        <div className="p-4">
          <ErrorState message={err} onRetry={loadDecks} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title="Flashcards"
        subtitle="Spaced-repetition decks from your material"
        right={
          <button
            onClick={() => {
              setImportOpen(true);
              setPreview(null);
            }}
            className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[11.5px] font-black text-primary transition active:scale-95"
          >
            <UserPlus className="size-3.5" /> Add deck
          </button>
        }
      />
      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {!decks ? (
          <Loader label="Loading decks…" />
        ) : !decks.length ? (
          <EmptyState
            icon="🃏"
            title="No flashcard decks yet"
            body="Open a translated document or media project and tap “Make flashcards” — or tap “Flashcards” under any tutor answer. The AI writes the cards for you, in your language."
          />
        ) : (
          <>
            <div className="mb-2 px-1 text-[11.5px] font-bold text-muted-foreground">
              {decks.length} {decks.length === 1 ? "deck" : "decks"}
            </div>
            <div className="space-y-2.5">
              {decks.map((d, i) => {
                return (
                  <motion.div key={d.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.25) }}>
                    <Card className="p-0 overflow-hidden">
                      <button
                        onClick={() => startSession(d.key)}
                        disabled={busy}
                        className="flex w-full items-center gap-3.5 p-4 text-left transition hover:bg-muted/30 active:scale-[0.99] disabled:opacity-60"
                      >
                        <div
                          className={cn(
                            "grid size-12 shrink-0 place-items-center rounded-2xl",
                            d.sourceType === "video"
                              ? "bg-j-warning/10 text-j-warning"
                              : d.sourceType === "message"
                                ? "bg-j-violet/10 text-j-violet"
                                : d.sourceType === "shared"
                                  ? "bg-j-cyan/10 text-j-cyan"
                                  : d.sourceType === "manual"
                                    ? "bg-j-violet/10 text-j-violet"
                                    : d.sourceType === "notebook"
                                      ? "bg-j-violet/10 text-j-violet"
                                      : d.sourceType === "vocab"
                                        ? "bg-primary/10 text-primary"
                                        : "bg-primary/10 text-primary"
                          )}
                        >
                          {d.sourceType === "video" ? (
                            <Clapperboard className="size-6" />
                          ) : d.sourceType === "message" ? (
                            <MessagesSquare className="size-6" />
                          ) : d.sourceType === "shared" ? (
                            <Share2 className="size-6" />
                          ) : d.sourceType === "manual" ? (
                            <PencilLine className="size-6" />
                          ) : d.sourceType === "notebook" ? (
                            <NotebookPen className="size-6" />
                          ) : d.sourceType === "vocab" ? (
                            <BookMarked className="size-6" />
                          ) : (
                            <BookOpen className="size-6" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[14.5px] font-black text-foreground">{d.deckTitle}</span>
                            {d.sourceType === "shared" ? (
                              <span className="inline-flex shrink-0 items-center rounded-full border border-j-cyan/25 bg-j-cyan/12 px-2 py-0.5 text-[10.5px] font-bold text-j-cyan">shared</span>
                            ) : null}
                            {d.sourceType === "manual" ? (
                              <span className="inline-flex shrink-0 items-center rounded-full border border-j-violet/25 bg-j-violet/12 px-2 py-0.5 text-[10.5px] font-bold text-j-violet">mine</span>
                            ) : null}
                            {d.sourceType === "vocab" ? (
                              <span className="inline-flex shrink-0 items-center rounded-full border border-primary/25 bg-primary/12 px-2 py-0.5 text-[10.5px] font-bold text-primary">words</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                            {d.total} cards · {d.learned} mastered ·{" "}
                            {d.due > 0 ? (
                              <span className="font-bold text-j-error">{d.due} due now</span>
                            ) : (
                              <span>
                                all reviewed{nextReviewIn(d.nextDue) ? ` · ${nextReviewIn(d.nextDue)}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="mt-2">
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-primary to-j-violet"
                                style={{ width: `${Math.round((d.learned / Math.max(d.total, 1)) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                        {d.due > 0 ? (
                          <span className="grid min-w-6 shrink-0 place-items-center rounded-full bg-j-error px-1.5 py-0.5 text-[11px] font-black text-white">
                            {d.due}
                          </span>
                        ) : (
                          <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex border-t border-border/70">
                        <button
                          onClick={() => startSession(d.key)}
                          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-primary"
                        >
                          <Layers className="size-3.5" /> Review
                        </button>
                        <button
                          onClick={() => openShare(d.key)}
                          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-primary"
                        >
                          <Share2 className="size-3.5" /> Share
                        </button>
                        <button
                          onClick={() => exportCsv(d.key)}
                          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-primary"
                        >
                          <Download className="size-3.5" /> Export
                        </button>
                        <button
                          onClick={() => deleteDeck(d.key)}
                          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-j-error"
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </button>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
            <p className="mt-5 px-2 text-[11.5px] leading-relaxed text-muted-foreground">
              Tip: generate decks from the document reader or media studio — or turn your saved Words into a deck from the
              Vocabulary screen. Everything lands here for daily review.
            </p>
          </>
        )}
      </div>

      {/* share sheet */}
      <Sheet open={!!shareDeck} onOpenChange={(v) => !v && setShareDeck(null)} title="Share this deck">
        {shareBusy ? (
          <div className="grid h-32 place-items-center">
            <Loader label="Preparing share code…" />
          </div>
        ) : shareCode ? (
          <div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Anyone with this code can add this deck to their own library — their copies track progress separately.
            </p>
            <div className="mt-4 rounded-[22px] border-2 border-dashed border-primary/40 bg-primary/5 p-5 text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Share code</div>
              <div className="mt-1.5 font-mono text-[34px] font-black tracking-[0.12em] text-foreground">{shareCode}</div>
              <div className="mt-1.5 text-[11px] font-semibold text-muted-foreground">
                {shareExpiry
                  ? `Works for 30 days — until ${new Date(shareExpiry).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}`
                  : "Valid for 30 days from creation"}
              </div>
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(shareCode).then(
                  () => toast.success("Code copied"),
                  () => toast.info(`Code: ${shareCode}`)
                );
              }}
              className="j-grad-primary mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98]"
            >
              <Copy className="size-4.5" /> Copy code
            </button>
          </div>
        ) : null}
      </Sheet>

      {/* import sheet */}
      <Sheet open={importOpen} onOpenChange={setImportOpen} title="Add a deck">
        <div>
          <Segmented
            value={importTab}
            onChange={(v) => setImportTab(v)}
            options={[
              { value: "code", label: "By code" },
              { value: "paste", label: "Paste cards" },
            ]}
          />

          {importTab === "code" ? (
            <>
              <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
                Got a code from a classmate or teacher? Enter it to preview and add their flashcards.
              </p>
              <div className="mt-4 flex gap-2.5">
                <input
                  value={importCode}
                  onChange={(e) => {
                    setImportCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6));
                    setPreview(null);
                  }}
                  placeholder="e.g. K7QM2X"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  aria-label="Share code"
                  className="min-h-12 flex-1 rounded-2xl border-2 border-border bg-card px-4 text-center font-mono text-[20px] font-black tracking-[0.18em] text-foreground placeholder:font-sans placeholder:text-[14px] placeholder:font-bold placeholder:tracking-normal placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
                />
                <button
                  onClick={lookupCode}
                  disabled={importBusy || importCode.length !== 6}
                  className="j-grad-primary flex min-h-12 shrink-0 items-center self-stretch rounded-2xl px-5 text-[13.5px] font-black text-white shadow-md shadow-primary/25 transition active:scale-95 disabled:opacity-50"
                >
                  {importBusy ? "…" : "Find"}
                </button>
              </div>

              {importBusy && !preview ? <div className="mt-4"><Loader label="Looking up the deck…" /></div> : null}

              {preview ? (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                  <Card className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="j-grad-cyan grid size-11 shrink-0 place-items-center rounded-2xl text-white">
                        <Share2 className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-black text-foreground">{preview.title}</div>
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {preview.count} cards · {preview.lang} · by {preview.creator}
                        </div>
                        {preview.expiresAt ? (
                          <div className="mt-0.5 text-[10.5px] font-semibold text-muted-foreground">
                            Code valid until {new Date(preview.expiresAt).toLocaleDateString("en", { month: "short", day: "numeric" })} · {preview.imports} import{preview.imports === 1 ? "" : "s"} so far
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {preview.sample.length ? (
                      <div className="mt-3 space-y-2">
                        {preview.sample.map((s, i) => (
                          <div key={i} className="rounded-xl bg-muted/50 px-3 py-2">
                            <div className="line-clamp-1 text-[12px] font-bold text-foreground">{s.front}</div>
                            <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{s.back}</div>
                          </div>
                        ))}
                        <div className="text-center text-[10.5px] font-semibold text-muted-foreground">
                          + {Math.max(preview.count - preview.sample.length, 0)} more cards
                        </div>
                      </div>
                    ) : null}
                  </Card>
                  {preview.mine ? (
                    <p className="mt-3 rounded-xl bg-j-warning/10 px-3 py-2.5 text-center text-[12px] font-bold text-j-warning">
                      This is your own deck — it&apos;s already in your library.
                    </p>
                  ) : preview.alreadyImported ? (
                    <p className="mt-3 rounded-xl bg-j-success/10 px-3 py-2.5 text-center text-[12px] font-bold text-j-success">
                      Already in your library ✓
                    </p>
                  ) : (
                    <button
                      onClick={importDeck}
                      disabled={importBusy}
                      className="j-grad-primary mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-60"
                    >
                      <UserPlus className="size-4.5" /> Add {preview.count} cards to my decks
                    </button>
                  )}
                </motion.div>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
                Write your own deck — one card per line as <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-bold text-foreground">front | back</span>{" "}
                (tabs, semicolons and commas also work). Or load a .csv / .txt file.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <input
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value.slice(0, 80))}
                  placeholder="Deck name"
                  aria-label="Deck name"
                  className="min-h-12 w-full rounded-2xl border-2 border-border bg-card px-4 text-[14px] font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
                />
                <select
                  value={pasteLang}
                  onChange={(e) => setPasteLang(e.target.value)}
                  aria-label="Card language"
                  className="min-h-12 w-full appearance-none rounded-2xl border-2 border-border bg-card px-4 text-[14px] font-semibold text-foreground focus:border-primary/50 focus:outline-none"
                >
                  <option value="">My language</option>
                  {PASTE_LANGS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative mt-3">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value.slice(0, 200_000))}
                  placeholder={"Photosynthesis | How plants make food from sunlight\nCell | The smallest unit of life\nOsmosis | Water moving across a membrane"}
                  rows={6}
                  aria-label="Cards, one per line"
                  className="w-full resize-none rounded-2xl border-2 border-border bg-card px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[11.5px] font-black text-muted-foreground transition hover:text-primary active:scale-95"
                  >
                    <FileUp className="size-3.5" /> Load .csv / .txt
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      onLoadFile(e.target.files?.[0] || null);
                      e.target.value = "";
                    }}
                  />
                  <span
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[11.5px] font-black",
                      parsedCards.length >= 2 ? "bg-j-success/12 text-j-success" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {parsedCards.length} card{parsedCards.length === 1 ? "" : "s"} parsed
                  </span>
                </div>
              </div>

              <button
                onClick={createBulkDeck}
                disabled={pasteBusy || parsedCards.length < 2}
                className="j-grad-primary mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-50"
              >
                <PencilLine className="size-4.5" /> {pasteBusy ? "Creating…" : `Create deck (${parsedCards.length || 0} cards)`}
              </button>
              <p className="mt-2 text-center text-[10.5px] text-muted-foreground">2–60 cards per deck · your decks can be shared with a code too</p>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}
