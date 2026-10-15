"use client";
// JeduAI — Multilingual Translation Center
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeftRight, Copy, FileDown, Share2, Star, Trash2, Wand2, BookMarked, X, History, AlertTriangle, Plus, Check } from "lucide-react";
import { api, useJedu, timeAgo, ApiError } from "../store";
import { Card, Chip, EmptyState, LangButton, Loader, Segmented, TopBar, toast } from "../ui";
import { printHTML, translationPrintView } from "../export";
import { LANGUAGES } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type TRecord = {
  id: string;
  sourceLang: string;
  targetLang: string;
  mode: "direct" | "learning";
  sourceText: string;
  translatedText: string;
  explanation: string | null;
  saved: boolean;
  createdAt: string;
};

const PHRASES = ["Hello, how are you?", "What are you doing?", "Thank you so much for your help", "Where is the library?", "Can you explain this again, please?"];

export default function TranslateScreen() {
  const user = useJedu((s) => s.user)!;
  const [from, setFrom] = React.useState("Auto-detect");
  const [to, setTo] = React.useState(user.explanationLang || "Hindi");
  const [mode, setMode] = React.useState<"direct" | "learning">("direct");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ record: TRecord; vocabulary: { word: string; meaning: string }[] } | null>(null);
  const [err, setErr] = React.useState("");
  const [hint, setHint] = React.useState<{ message: string; suggestion: string } | null>(null);

  const [history, setHistory] = React.useState<TRecord[] | null>(null);
  const [showSaved, setShowSaved] = React.useState(false);
  const [tab, setTab] = React.useState<"translate" | "history">("translate");
  const [savedWords, setSavedWords] = React.useState<Set<string>>(new Set());
  const [savingWord, setSavingWord] = React.useState<string | null>(null);

  const loadHistory = React.useCallback(() => {
    api<{ items: TRecord[] }>(`/api/jeduai/translate${showSaved ? "?saved=1" : ""}`)
      .then((r) => setHistory(r.items))
      .catch(() => setHistory([]));
  }, [showSaved]);

  React.useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  function swap() {
    if (from === "Auto-detect") {
      toast.info("Pick a specific source language first, then swap.");
      return;
    }
    const f = from;
    setFrom(to);
    setTo(f);
    if (result) {
      setText(result.record.translatedText);
      setResult(null);
    }
  }

  async function translate(targetOverride?: string) {
    const target = targetOverride || to;
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr("");
    setHint(null);
    setResult(null);
    setSavedWords(new Set());
    try {
      const r = await api<{ record: TRecord; vocabulary: { word: string; meaning: string }[] }>("/api/jeduai/translate", {
        method: "POST",
        json: { text, from, to: target, mode, autoDetect: from === "Auto-detect" },
      });
      if (targetOverride) setTo(targetOverride);
      setResult(r);
      if (navigator.vibrate) navigator.vibrate(8);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const d = (e.data || {}) as { suggestion?: string; error?: string };
        setHint({ message: e.message, suggestion: d.suggestion || "Hindi" });
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "save" | "simplify") {
    try {
      const r = await api<{ record: TRecord }>("/api/jeduai/translate", { method: "PATCH", json: { id, action } });
      if (result && result.record.id === id) setResult({ ...result, record: r.record });
      if (action === "simplify") toast.success("Simplified explanation added below the translation");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/jeduai/translate?id=${id}`, { method: "DELETE" });
      if (result?.record.id === id) setResult(null);
      if (history) setHistory(history.filter((h) => h.id !== id));
      toast.success("Removed");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveVocabWord(word: string, meaning: string) {
    if (!result || savingWord) return;
    setSavingWord(word);
    try {
      const r = await api<{ created: number; skipped: number }>("/api/jeduai/vocab", {
        method: "POST",
        json: {
          words: [{ term: word, meaning, lang: result.record.sourceLang, meaningLang: result.record.targetLang }],
          source: "translation",
        },
      });
      setSavedWords((s) => new Set(s).add(word));
      toast.success(r.created ? `“${word}” saved to Vocabulary` : `“${word}” is already in your Vocabulary`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingWord(null);
    }
  }

  const fromFlag = from === "Auto-detect" ? "✨" : LANGUAGES.find((l) => l.name === from)?.flag || "🌍";
  const toFlag = LANGUAGES.find((l) => l.name === to)?.flag || "🌍";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Translate" subtitle="Text translation with learning mode" />

      <div className="border-b border-border/70 bg-card/60 px-4 pt-3 pb-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "translate", label: "🌐 Translate" },
            { value: "history", label: `🗂 History` },
          ]}
        />
      </div>

      {tab === "translate" ? (
        <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          {/* language bar */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 px-1 text-[11px] font-black uppercase tracking-wider text-muted-foreground">From</div>
              <LangButton value={from} onChange={setFrom} includeAuto />
            </div>
            <button
              onClick={swap}
              aria-label="Swap languages"
              className="j-grad-primary mx-auto mt-5 grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg shadow-primary/30 transition active:rotate-180"
            >
              <ArrowLeftRight className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 px-1 text-right text-[11px] font-black uppercase tracking-wider text-muted-foreground">To</div>
              <div className="flex justify-end">
                <LangButton value={to} onChange={setTo} />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "direct", label: "Direct — faithful" },
                { value: "learning", label: "Learning — with notes" },
              ]}
            />
            <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {mode === "direct"
                ? "Meaning-preserving translation for reading and study."
                : "Translation + notes on difficult words, idioms and grammar — great for language learners."}
            </p>
          </div>

          {/* source */}
          <Card className="mt-4 p-0">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                {fromFlag} {from === "Auto-detect" ? "Auto-detect" : from}
              </span>
              <div className="flex items-center gap-1">
                {text ? (
                  <button
                    onClick={() => {
                      setText("");
                      setResult(null);
                    }}
                    aria-label="Clear"
                    className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
                <span className="text-[11px] text-muted-foreground">{text.length}/5000</span>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 5000))}
              rows={4}
              placeholder="Type or paste text… (any of 23 languages)"
              aria-label="Text to translate"
              className="w-full resize-none bg-transparent px-4 pb-3 pt-1 text-[15.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <div className="flex gap-1.5 overflow-x-auto border-t border-border/70 px-3 py-2 j-app-scroll">
              {PHRASES.map((p) => (
                <Chip key={p} onClick={() => setText(p)} className="shrink-0 text-[11.5px]">
                  {p.length > 26 ? p.slice(0, 26) + "…" : p}
                </Chip>
              ))}
            </div>
          </Card>

          <button
            onClick={() => translate()}
            disabled={busy || !text.trim()}
            className="j-grad-primary mt-4 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? (
              <>
                <span className="size-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" /> Translating…
              </>
            ) : (
              <>
                <Wand2 className="size-4" /> Translate to {to}
              </>
            )}
          </button>

          {err ? (
            <div className="mt-3 rounded-2xl border border-j-error/30 bg-j-error/10 px-4 py-3 text-sm font-semibold text-j-error">
              {err}
            </div>
          ) : null}

          <AnimatePresence>
            {hint ? (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="mt-3 rounded-2xl border border-j-warning/30 bg-j-warning/10 px-4 py-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-j-warning" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-bold leading-relaxed text-foreground">{hint.message}</p>
                    <button
                      onClick={() => {
                        setHint(null);
                        translate(hint.suggestion);
                      }}
                      className="j-grad-primary mt-2.5 inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-black text-white shadow-md shadow-primary/25 transition active:scale-95"
                    >
                      <Wand2 className="size-3.5" /> Translate to {hint.suggestion} instead
                    </button>
                  </div>
                  <button
                    onClick={() => setHint(null)}
                    aria-label="Dismiss"
                    className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {result ? (
              <motion.div
                key={result.record.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4"
              >
                <Card className="overflow-hidden p-0">
                  <div className="flex items-center justify-between bg-primary/5 px-4 py-2.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-primary">
                      {toFlag} {result.record.targetLang} · {result.record.mode === "learning" ? "Learning" : "Direct"}
                    </span>
                    <div className="flex items-center gap-1">
                      <IconBtn
                        label="Copy translation"
                        onClick={() => {
                          navigator.clipboard.writeText(result.record.translatedText).then(() => toast.success("Copied"));
                        }}
                      >
                        <Copy className="size-4" />
                      </IconBtn>
                      <IconBtn
                        label="Share"
                        onClick={() => {
                          if (navigator.share) {
                            navigator.share({ text: `${result.record.sourceText}\n\n— ${result.record.sourceLang} → ${result.record.targetLang} —\n\n${result.record.translatedText}` }).catch(() => {});
                          } else {
                            navigator.clipboard.writeText(result.record.translatedText).then(() => toast.success("Copied to clipboard"));
                          }
                        }}
                      >
                        <Share2 className="size-4" />
                      </IconBtn>
                      <IconBtn
                        label={result.record.saved ? "Unsave" : "Save"}
                        active={result.record.saved}
                        onClick={() => act(result.record.id, "save")}
                      >
                        <Star className={cn("size-4", result.record.saved && "fill-current")} />
                      </IconBtn>
                      <IconBtn label="Explain in simple words" onClick={() => act(result.record.id, "simplify")}>
                        <BookMarked className="size-4" />
                      </IconBtn>
                      <IconBtn
                        label="Export as PDF"
                        onClick={() => {
                          const ok = printHTML(
                            translationPrintView({
                              sourceText: result.record.sourceText,
                              translatedText: result.record.translatedText,
                              sourceLang: result.record.sourceLang,
                              targetLang: result.record.targetLang,
                              mode: result.record.mode,
                              explanation: result.record.explanation,
                              vocabulary: result.vocabulary,
                            })
                          );
                          if (ok) toast.success("Opening print dialog — choose “Save as PDF”");
                          else toast.error("Couldn't open the print dialog");
                        }}
                      >
                        <FileDown className="size-4" />
                      </IconBtn>
                    </div>
                  </div>
                  <div className="px-4 py-4">
                    <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-foreground">
                      {result.record.translatedText}
                    </p>

                    {result.vocabulary?.length ? (
                      <div className="mt-4">
                        <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                          Key vocabulary — tap + to save for practice
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {result.vocabulary.map((v, i) => {
                            const isSaved = savedWords.has(v.word);
                            return (
                              <div key={i} className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 transition hover:bg-muted">
                                <span className="text-[13.5px] font-black text-primary">{v.word}</span>
                                <span className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">{v.meaning}</span>
                                <button
                                  onClick={() => saveVocabWord(v.word, v.meaning)}
                                  disabled={isSaved || savingWord === v.word}
                                  aria-label={isSaved ? "Saved to vocabulary" : `Save ${v.word} to vocabulary`}
                                  title={isSaved ? "Saved" : "Save to Vocabulary"}
                                  className={cn(
                                    "grid size-8 shrink-0 place-items-center rounded-lg transition active:scale-90",
                                    isSaved
                                      ? "bg-j-success/15 text-j-success"
                                      : "bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50"
                                  )}
                                >
                                  {savingWord === v.word ? (
                                    <span className="size-3.5 animate-spin rounded-full border-[2px] border-primary/30 border-t-primary" />
                                  ) : isSaved ? (
                                    <Check className="size-4" />
                                  ) : (
                                    <Plus className="size-4" />
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {result.record.explanation ? (
                      <div className="mt-4 rounded-2xl bg-lavender p-4">
                        <div className="mb-1 text-[11px] font-black uppercase tracking-wider text-primary">
                          💡 Simple-language explanation
                        </div>
                        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">
                          {result.record.explanation}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </Card>
                <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                  Saved to history · {timeAgo(result.record.createdAt)}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <p className="mt-6 px-2 text-[11.5px] leading-relaxed text-muted-foreground">
            Tip: Learning mode is ideal for studying English material in your language — save the key vocabulary rows to build your
            personal word collection, then practice them under Home → Words.
          </p>
        </div>
      ) : (
        <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex gap-2">
              <Chip active={!showSaved} onClick={() => setShowSaved(false)}>
                <History className="size-3.5" /> All
              </Chip>
              <Chip active={showSaved} onClick={() => setShowSaved(true)}>
                <Star className="size-3.5" /> Saved
              </Chip>
            </div>
            <button onClick={loadHistory} className="text-[12.5px] font-bold text-primary">
              Refresh
            </button>
          </div>
          {!history ? (
            <Loader label="Loading history…" />
          ) : !history.length ? (
            <EmptyState
              icon="🗂"
              title={showSaved ? "No saved translations" : "Nothing translated yet"}
              body={showSaved ? "Star a translation to keep it here." : "Your translations will appear here."}
            />
          ) : (
            <div className="space-y-2.5">
              {history.map((h) => (
                <Card key={h.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                      {h.sourceLang} → {h.targetLang} · {h.mode === "learning" ? "Learning" : "Direct"}
                    </span>
                    <div className="flex items-center gap-1">
                      {h.saved ? <Star className="size-3.5 fill-j-warning text-j-warning" /> : null}
                      <IconBtn label="Delete" onClick={() => remove(h.id)}>
                        <Trash2 className="size-4" />
                      </IconBtn>
                    </div>
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">{h.sourceText}</div>
                  <div className="mt-1 line-clamp-3 font-semibold text-foreground">{h.translatedText}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{timeAgo(h.createdAt)}</span>
                    <button
                      onClick={() => {
                        setTab("translate");
                        setText(h.sourceText);
                        setFrom(h.sourceLang);
                        setTo(h.targetLang);
                        setMode(h.mode);
                        setResult(null);
                      }}
                      className="text-[12px] font-bold text-primary"
                    >
                      Open ↗
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-9 place-items-center rounded-xl text-muted-foreground transition hover:bg-primary/10 hover:text-primary active:scale-90",
        active && "bg-j-warning/15 text-j-warning hover:bg-j-warning/20 hover:text-j-warning"
      )}
    >
      {children}
    </button>
  );
}
