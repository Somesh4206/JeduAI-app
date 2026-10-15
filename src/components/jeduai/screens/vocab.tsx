"use client";
// JeduAI — Vocabulary Builder: personal word collection + practice modes
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookMarked,
  Plus,
  Search,
  Trash2,
  Sparkles,
  Check,
  X,
  Languages,
  MessagesSquare,
  PencilLine,
  Brain,
  GraduationCap,
  Flame,
  RotateCcw,
  ChevronRight,
  Zap,
  Timer,
  TrendingUp,
  Layers,
} from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, ProgressBar, Segmented, Sheet, TopBar, toast } from "../ui";
import { LANGUAGES } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type VWord = {
  id: string;
  term: string;
  meaning: string;
  example: string | null;
  lang: string;
  meaningLang: string;
  source: string;
  box: number;
  lastResult: string | null;
  mastered: boolean;
  dueAt: string;
  createdAt: string;
};
type Stats = { total: number; learning: number; mastered: number; due: number };
type WeekReport = { days: string[]; added: number[]; practiced: number[]; correct: number[] };

const BOX_LABELS = ["New", "Learning", "Familiar", "Strong", "Mastered"];
const SOURCE_META: Record<string, { icon: React.ReactNode; label: string; tint: string }> = {
  translation: { icon: <Languages className="size-3.5" />, label: "From translation", tint: "bg-j-cyan/10 text-j-cyan" },
  tutor: { icon: <MessagesSquare className="size-3.5" />, label: "From AI tutor", tint: "bg-j-violet/10 text-j-violet" },
  manual: { icon: <PencilLine className="size-3.5" />, label: "Added by you", tint: "bg-primary/10 text-primary" },
};

function flagOf(lang: string) {
  return LANGUAGES.find((l) => l.name === lang)?.flag || "🌍";
}

function dueInHint(dueAt: string, mastered: boolean): string {
  if (mastered) return "mastered";
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `next in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `next in ${hours}h`;
  return `next in ${Math.round(hours / 24)}d`;
}

// Token-set similarity (Dice coefficient) between two meanings — used to keep
// multiple-choice distractors clearly different from the correct answer.
function meaningSimilarity(a: string, b: string): number {
  const toks = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1)
    );
  const A = toks(a);
  const B = toks(b);
  if (!A.size || !B.size) return 0;
  let hits = 0;
  for (const t of A) if (B.has(t)) hits++;
  return (2 * hits) / (A.size + B.size);
}

export default function VocabScreen({ autoPractice }: { autoPractice?: boolean }) {
  const pop = useJedu((s) => s.pop);
  const user = useJedu((s) => s.user)!;
  const [words, setWords] = React.useState<VWord[] | null>(null);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [week, setWeek] = React.useState<WeekReport | null>(null);
  const [err, setErr] = React.useState("");
  const [q, setQ] = React.useState("");
  const [tab, setTab] = React.useState<"words" | "practice">("words");
  const [addOpen, setAddOpen] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [session, setSession] = React.useState<{ questions: Q[]; idx: number; correct: number; wrong: number; mode: "review" | "brushup" } | null>(null);
  const [match, setMatch] = React.useState<MatchGame | null>(null);

  // add-word sheet state
  const [nt, setNt] = React.useState({ term: "", meaning: "", example: "" });
  const [saving, setSaving] = React.useState(false);

  // export-to-flashcards sheet state
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportScope, setExportScope] = React.useState<"all" | "learning" | "due" | "mastered">("all");
  const [exportBusy, setExportBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setErr("");
    api<{ words: VWord[]; stats: Stats; week: WeekReport }>("/api/jeduai/vocab")
      .then((r) => {
        setWords(r.words);
        setStats(r.stats);
        setWeek(r.week);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    load();
  }, [load, reload]);

  // deep-link: tutor "Practice these words" jumps straight into a session (once words are loaded)
  const autoPracticed = React.useRef(false);
  React.useEffect(() => {
    if (!autoPractice || autoPracticed.current || !words) return;
    if (words.length < 4) return;
    autoPracticed.current = true;
    setTab("practice");
    startPractice();
  }, [autoPractice, words]);

  const filtered = React.useMemo(() => {
    if (!words) return null;
    const s = q.trim().toLowerCase();
    if (!s) return words;
    return words.filter((w) => w.term.toLowerCase().includes(s) || w.meaning.toLowerCase().includes(s));
  }, [words, q]);

  async function addWord() {
    if (!nt.term.trim() || !nt.meaning.trim()) {
      toast.error("Term and meaning are both needed.");
      return;
    }
    setSaving(true);
    try {
      const r = await api<{ created: number }>("/api/jeduai/vocab", {
        method: "POST",
        json: {
          words: [
            {
              term: nt.term,
              meaning: nt.meaning,
              example: nt.example || undefined,
              lang: user.interfaceLang || "English",
              meaningLang: user.explanationLang || "English",
            },
          ],
          source: "manual",
        },
      });
      toast.success(r.created ? "Word added to your vocabulary" : "Already in your vocabulary");
      setNt({ term: "", meaning: "", example: "" });
      setAddOpen(false);
      setReload((n) => n + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleMaster(w: VWord) {
    try {
      const r = await api<{ word: VWord }>("/api/jeduai/vocab", { method: "PATCH", json: { id: w.id, action: "master" } });
      setWords((ws) => ws?.map((x) => (x.id === w.id ? r.word : x)) || null);
      setStats((s) => (s ? { ...s, mastered: s.mastered + (r.word.mastered ? 1 : -1), learning: s.learning + (r.word.mastered ? -1 : 1) } : s));
      toast.success(r.word.mastered ? `“${w.term}” marked as mastered 🎉` : "Back to learning");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeWord(w: VWord) {
    try {
      await api(`/api/jeduai/vocab?id=${w.id}`, { method: "DELETE" });
      setWords((ws) => ws?.filter((x) => x.id !== w.id) || null);
      setStats((s) =>
        s
          ? {
              total: s.total - 1,
              learning: s.learning - (w.mastered ? 0 : 1),
              mastered: s.mastered - (w.mastered ? 1 : 0),
              due: s.due - (!w.mastered && new Date(w.dueAt) <= new Date() ? 1 : 0),
            }
          : s
      );
      toast.success("Removed");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // export the word collection (or a subset) as a flashcard deck
  async function exportDeck() {
    setExportBusy(true);
    try {
      const r = await api<{ created: number; deck: string }>("/api/jeduai/vocab", {
        method: "POST",
        json: { action: "export-deck", scope: exportScope },
      });
      toast.success(`${r.created} cards → “${r.deck}” — review it under Flashcards`);
      setExportOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  }

  function exportScopeCount(scope: "all" | "learning" | "due" | "mastered"): number {
    if (!stats) return 0;
    return scope === "all" ? stats.total : scope === "mastered" ? stats.mastered : scope === "due" ? stats.due : stats.learning;
  }

  // ---------------- practice session ----------------
  type Q = { word: VWord; options: string[]; correct: number };
  type PracticeMode = "review" | "brushup";
  function startPractice(mode: PracticeMode = "review") {
    if (!words || words.length < 4) return;
    const now = Date.now();
    const pool = [...words].sort((a, b) => {
      if (mode === "brushup") {
        // mastered & strongest words first — keep old knowledge fresh
        return Number(b.mastered) - Number(a.mastered) || b.box - a.box;
      }
      const ad = !a.mastered && new Date(a.dueAt).getTime() <= now ? 0 : 1;
      const bd = !b.mastered && new Date(b.dueAt).getTime() <= now ? 0 : 1;
      return ad - bd || a.box - b.box;
    });
    const count = Math.min(10, pool.length);
    const questions: Q[] = [];
    for (let i = 0; i < count; i++) {
      const word = pool[i];
      // distractor tightening: prefer meanings clearly different from the correct
      // answer AND from each other, so options never look like near-duplicates
      const others = words.filter((w) => w.id !== word.id && w.meaning !== word.meaning);
      const ranked = others
        .map((w) => ({ meaning: w.meaning, sim: meaningSimilarity(word.meaning, w.meaning) }))
        .sort((x, y) => x.sim - y.sim);
      const distractors: string[] = [];
      for (const { meaning, sim } of ranked) {
        if (distractors.length >= 3) break;
        if (sim > 0.6) continue; // too close to the correct meaning
        if (distractors.some((d) => meaningSimilarity(d, meaning) > 0.7)) continue; // near-duplicate option
        distractors.push(meaning);
      }
      // fallback when the filter is too strict for this collection: fill from the rest
      if (distractors.length < 3) {
        for (const w of others) {
          if (distractors.length >= 3) break;
          if (w.meaning === word.meaning || distractors.includes(w.meaning)) continue;
          distractors.push(w.meaning);
        }
      }
      const options = [word.meaning, ...distractors.slice(0, 3)];
      // shuffle
      for (let j = options.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [options[j], options[k]] = [options[k], options[j]];
      }
      questions.push({ word, options, correct: options.indexOf(word.meaning) });
    }
    setSession({ questions, idx: 0, correct: 0, wrong: 0, mode });
  }

  const [picked, setPicked] = React.useState<number | null>(null);

  async function answer(i: number) {
    if (!session || picked !== null) return;
    setPicked(i);
    const qz = session.questions[session.idx];
    const known = i === qz.correct;
    try {
      await api("/api/jeduai/vocab", { method: "PATCH", json: { id: qz.word.id, result: known ? "known" : "again" } });
    } catch {
      /* box update failure is non-critical for the session */
    }
    if (navigator.vibrate) navigator.vibrate(known ? 10 : [12, 40, 12]);
    setTimeout(() => {
      setPicked(null);
      setSession((s) => {
        if (!s) return s;
        return {
          ...s,
          idx: s.idx + 1,
          correct: s.correct + (known ? 1 : 0),
          wrong: s.wrong + (known ? 0 : 1),
        };
      });
    }, 950);
  }

  async function finishPractice() {
    if (!session) return;
    const { correct } = session;
    setSession(null);
    setReload((n) => n + 1);
    if (correct > 0) {
      try {
        const r = await api<{ xp: number }>("/api/jeduai/vocab", { method: "PATCH", json: { action: "practice-done", correct } });
        if (r.xp) toast.success(`Practice complete — +${r.xp} XP ⚡`);
      } catch {
        /* XP award failure is non-critical */
      }
    }
  }

  // ---------------- speed match game ----------------
  type MatchTile = { key: string; wordId: string; kind: "term" | "meaning"; text: string };
  type MatchGame = {
    tiles: MatchTile[];
    selected: string | null;
    wrongKey: string | null;
    matchedIds: string[];
    usedIds: string[];
    round: number;
    pairs: number;
    combo: number;
    bestCombo: number;
    timeLeft: number;
    finished: boolean;
    lastPairAt: number;
  };

  const MATCH_SECONDS = 75;

  function buildRound(pool: VWord[], usedIds: string[]): MatchTile[] | null {
    const now = Date.now();
    const fresh = pool.filter((w) => !usedIds.includes(w.id));
    const candidates = (fresh.length >= 4 ? fresh : pool)
      .slice() // prefer due words first
      .sort((a, b) => {
        const ad = !a.mastered && new Date(a.dueAt).getTime() <= now ? 0 : 1;
        const bd = !b.mastered && new Date(b.dueAt).getTime() <= now ? 0 : 1;
        return ad - bd || a.box - b.box;
      })
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);
    if (candidates.length < 4) return null;
    const tiles: MatchTile[] = [];
    for (const w of candidates) {
      tiles.push({ key: `t-${w.id}`, wordId: w.id, kind: "term", text: w.term });
      tiles.push({ key: `m-${w.id}`, wordId: w.id, kind: "meaning", text: w.meaning });
    }
    for (let i = tiles.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[k]] = [tiles[k], tiles[i]];
    }
    return tiles;
  }

  function startMatch() {
    if (!words || words.length < 4) return;
    const tiles = buildRound(words, []);
    if (!tiles) return;
    setMatch({
      tiles,
      selected: null,
      wrongKey: null,
      matchedIds: [],
      usedIds: [],
      round: 1,
      pairs: 0,
      combo: 0,
      bestCombo: 0,
      timeLeft: MATCH_SECONDS,
      finished: false,
      lastPairAt: Date.now(),
    });
  }

  // countdown
  const matchRunning = match !== null && !match.finished;
  React.useEffect(() => {
    if (!matchRunning) return;
    const t = setInterval(() => {
      setMatch((m) => {
        if (!m || m.finished) return m;
        if (m.timeLeft <= 1) {
          return { ...m, timeLeft: 0, finished: true };
        }
        return { ...m, timeLeft: m.timeLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [matchRunning]);

  // round advance: when all pairs of the current grid are matched, load the next round
  const roundComplete = match !== null && !match.finished && match.matchedIds.length >= match.tiles.length / 2;
  React.useEffect(() => {
    if (!roundComplete || !match) return;
    const usedIds = match.usedIds;
    const t = setTimeout(() => {
      setMatch((cur) => {
        if (!cur || cur.finished || cur.matchedIds.length < cur.tiles.length / 2) return cur;
        const nextTiles = words ? buildRound(words, usedIds) : null;
        if (!nextTiles) return { ...cur, finished: true, timeLeft: 0 };
        return { ...cur, tiles: nextTiles, matchedIds: [], selected: null, wrongKey: null, round: cur.round + 1, lastPairAt: Date.now() };
      });
    }, 650);
    return () => clearTimeout(t);
  }, [roundComplete, match?.matchedIds.length, match?.tiles.length]);

  async function tapTile(t: MatchTile) {
    // promote the word (Leitner "known") when this tap completes a correct pair
    const current = match;
    let pairCompleted = false;
    if (current && current.selected !== null && !current.finished && !current.wrongKey) {
      const first = current.tiles.find((x) => x.key === current.selected);
      if (first && first.kind !== t.kind && first.wordId === t.wordId && !current.matchedIds.includes(t.wordId)) {
        pairCompleted = true;
      }
    }

    setMatch((m) => {
      if (!m || m.finished || m.wrongKey) return m;
      if (m.matchedIds.includes(t.wordId)) return m; // already matched
      if (m.selected === null) {
        return { ...m, selected: t.key, wrongKey: null };
      }
      if (m.selected === t.key) {
        return { ...m, selected: null }; // tap again to deselect
      }
      const first = m.tiles.find((x) => x.key === m.selected);
      if (!first) return { ...m, selected: null };
      if (first.kind !== t.kind && first.wordId === t.wordId) {
        // ---- correct pair ----
        const now = Date.now();
        const quick = now - m.lastPairAt < 6000;
        const combo = quick ? m.combo + 1 : 1;
        const matchedIds = [...m.matchedIds, t.wordId];
        const usedIds = [...new Set([...m.usedIds, t.wordId])];
        const pairs = m.pairs + 1;
        if (navigator.vibrate) navigator.vibrate(12);
        return { ...m, matchedIds, usedIds, pairs, combo, bestCombo: Math.max(m.bestCombo, combo), selected: null, wrongKey: null, lastPairAt: now };
      }
      // ---- wrong pair ----
      if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
      setTimeout(() => setMatch((cur) => (cur ? { ...cur, wrongKey: null } : cur)), 500);
      return { ...m, wrongKey: t.key, combo: 0, selected: null };
    });

    if (pairCompleted) {
      try {
        await api("/api/jeduai/vocab", { method: "PATCH", json: { id: t.wordId, result: "known" } });
      } catch {
        /* non-critical */
      }
    }
  }

  async function finishMatch(reason: "time" | "done" | "exit") {
    const m = match;
    if (!m) return;
    setMatch(null);
    setReload((n) => n + 1);
    // matched pairs already promoted the words — award their XP on any exit path
    if (m.pairs > 0) {
      try {
        const r = await api<{ xp: number }>("/api/jeduai/vocab", { method: "PATCH", json: { action: "practice-done", correct: m.pairs } });
        if (r.xp && reason !== "exit") toast.success(`Speed match — +${r.xp} XP ⚡`);
      } catch {
        /* non-critical */
      }
    }
  }

  // ---------------- PRACTICE UI ----------------
  if (session) {
    const total = session.questions.length;
    const finished = session.idx >= total;
    const qz = finished ? session.questions[total - 1] : session.questions[Math.min(session.idx, total - 1)];
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar
          onBack={() => {
            setSession(null);
            setReload((n) => n + 1);
          }}
          title="Word practice"
          subtitle={
            session.mode === "brushup"
              ? `Brush-up · mastered ${session.questions.filter((x) => x.word.mastered).length} ${
                  session.questions.filter((x) => x.word.mastered).length === 1 ? "word" : "words"
                }`
              : `${qz.word.lang} → ${qz.word.meaningLang}`
          }
          right={
            <div className="flex items-center gap-1.5">
              {session.mode === "brushup" ? (
                <span className="rounded-full bg-j-success/10 px-2.5 py-1 text-[11px] font-black text-j-success">Brush-up</span>
              ) : null}
              <span className="rounded-full bg-j-success/10 px-2.5 py-1 text-[11px] font-black text-j-success">✓ {session.correct}</span>
              <span className="rounded-full bg-j-error/10 px-2.5 py-1 text-[11px] font-black text-j-error">✗ {session.wrong}</span>
            </div>
          }
        />
        <div className="border-b border-border/70 bg-card/60 px-4 py-3">
          <ProgressBar value={(Math.min(session.idx, total) / total) * 100} />
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-muted-foreground">
            <span>
              {Math.min(session.idx + 1, total)} of {total}
            </span>
            <span>+2 XP per correct answer</span>
          </div>
        </div>
        <div className="j-app-scroll flex flex-1 flex-col overflow-y-auto px-4 py-5">
          {finished ? (
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-6">
              <div className={cn("j-shadow-soft rounded-[26px] p-6 text-center text-white", session.mode === "brushup" ? "bg-gradient-to-br from-j-success to-emerald-600" : "j-grad-primary")}>
                <div className="text-5xl">
                  {session.mode === "brushup" ? (session.wrong === 0 ? "🎓" : "🧠") : session.correct >= total * 0.8 ? "🌟" : session.correct > 0 ? "📖" : "💪"}
                </div>
                <div className="mt-2 text-3xl font-black">
                  {session.correct}
                  <span className="text-lg font-bold text-white/70">/{total} correct</span>
                </div>
                <div className="mt-1.5 text-[13px] font-bold text-white/85">
                  {session.mode === "brushup"
                    ? session.wrong === 0
                      ? "Memory check passed — your mastered words are still sharp."
                      : `${session.wrong} ${session.wrong === 1 ? "word" : "words"} slipped — moved back to learning for a refresh.`
                    : session.wrong === 0
                      ? "Flawless! Words moved to higher boxes."
                      : `${session.wrong} ${session.wrong === 1 ? "word" : "words"} will come back sooner — that's how memory works.`}
                </div>
                {session.correct > 0 ? (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-[12.5px] font-black">
                    ⚡ +{session.correct * 2} XP earned
                  </div>
                ) : null}
              </div>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => {
                    const mode = session.mode;
                    setSession(null);
                    startPractice(mode);
                  }}
                  className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-[14px] font-bold text-foreground active:scale-[0.98]"
                >
                  <RotateCcw className="size-4" /> Practice again
                </button>
                <button
                  onClick={finishPractice}
                  className="j-grad-primary flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30 active:scale-[0.98]"
                >
                  <Check className="size-4" /> Done
                </button>
              </div>
            </motion.div>
          ) : (
            <>
              {/* term card */}
              <div className="perspective-1000">
                <AnimatePresence initial={false} mode="wait">
                  <motion.div
                    key={qz.word.id + String(session.idx)}
                    initial={{ rotateY: 70, opacity: 0.3 }}
                    animate={{ rotateY: 0, opacity: 1 }}
                    exit={{ rotateY: -70, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="flex min-h-40 flex-col rounded-[26px] border-2 border-primary/30 bg-gradient-to-br from-primary/10 to-card p-6 text-center shadow-xl"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-black uppercase tracking-widest text-primary">
                        {flagOf(qz.word.lang)} {qz.word.lang}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {qz.word.mastered ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-j-success/10 px-2 py-0.5 text-[10px] font-black text-j-success">
                            <Check className="size-3" /> Mastered
                          </span>
                        ) : null}
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                          Box {qz.word.box}/5
                        </span>
                      </span>
                    </div>
                    <div className="j-app-scroll flex flex-1 items-center justify-center overflow-y-auto py-3">
                      <p className="text-[24px] font-black leading-snug text-foreground">{qz.word.term}</p>
                    </div>
                    <div className="text-[11px] font-semibold text-muted-foreground">What does it mean?</div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* options */}
              <div className="mt-5 space-y-2.5">
                {qz.options.map((opt, i) => {
                  const isCorrect = i === qz.correct;
                  const isPicked = picked === i;
                  const state = picked === null ? "idle" : isPicked && isCorrect ? "correct" : isPicked ? "wrong" : isCorrect ? "reveal" : "dim";
                  return (
                    <motion.button
                      key={opt + String(session.idx)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => answer(i)}
                      disabled={picked !== null}
                      aria-label={`Option ${String.fromCharCode(65 + i)}: ${opt}`}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition active:scale-[0.98]",
                        state === "idle" && "border-border bg-card hover:border-primary/40",
                        state === "correct" && "border-j-success/50 bg-j-success/10",
                        state === "wrong" && "border-j-error/50 bg-j-error/10",
                        state === "reveal" && "border-j-success/30 bg-j-success/5",
                        state === "dim" && "border-border/60 bg-muted/40 opacity-50"
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-xl text-[13px] font-black",
                          state === "idle" && "bg-primary/10 text-primary",
                          state === "correct" && "bg-j-success/15 text-j-success",
                          state === "wrong" && "bg-j-error/15 text-j-error",
                          state === "reveal" && "bg-j-success/15 text-j-success",
                          state === "dim" && "bg-muted text-muted-foreground"
                        )}
                      >
                        {state === "correct" || state === "reveal" ? <Check className="size-4" /> : state === "wrong" ? <X className="size-4" /> : String.fromCharCode(65 + i)}
                      </span>
                      <span className="j-app-scroll text-[14px] font-semibold leading-snug text-foreground">{opt}</span>
                    </motion.button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---------------- MATCH UI ----------------
  if (match) {
    const timePct = (match.timeLeft / MATCH_SECONDS) * 100;
    const urgent = match.timeLeft <= 15;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar
          onBack={() => finishMatch("exit")}
          title="Speed match"
          subtitle={`Round ${match.round} · ${match.pairs} ${match.pairs === 1 ? "pair" : "pairs"}`}
          right={
            <div className="flex items-center gap-1.5">
              {match.combo >= 2 ? (
                <span className="animate-pulse rounded-full bg-j-warning/10 px-2.5 py-1 text-[11px] font-black text-j-warning">
                  🔥 x{match.combo}
                </span>
              ) : null}
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] font-black tabular-nums",
                  urgent ? "animate-pulse bg-j-error/10 text-j-error" : "bg-primary/10 text-primary"
                )}
              >
                <Timer className="mr-0.5 inline size-3" />
                {Math.floor(match.timeLeft / 60)}:{String(match.timeLeft % 60).padStart(2, "0")}
              </span>
            </div>
          }
        />

        {/* timer bar */}
        <div className="h-1.5 w-full bg-muted">
          <div
            className={cn("h-full transition-all duration-1000 ease-linear", urgent ? "bg-j-error" : "j-grad-primary")}
            style={{ width: `${timePct}%` }}
          />
        </div>

        <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4">
          {match.finished ? (
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-6">
              <div className="j-grad-cyan j-shadow-soft rounded-[26px] p-6 text-center text-white">
                <div className="text-5xl">{match.pairs >= 12 ? "🏆" : match.pairs >= 6 ? "⚡" : "📖"}</div>
                <div className="mt-2 text-3xl font-black">
                  {match.pairs}
                  <span className="text-lg font-bold text-white/70"> {match.pairs === 1 ? "pair" : "pairs"} matched</span>
                </div>
                <div className="mt-1.5 text-[13px] font-bold text-white/85">
                  {match.round} {match.round === 1 ? "round" : "rounds"} · best combo x{match.bestCombo}
                </div>
                {match.pairs > 0 ? (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-[12.5px] font-black">
                    ⚡ +{match.pairs * 2} XP earned
                  </div>
                ) : null}
              </div>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => {
                    setMatch(null);
                    startMatch();
                  }}
                  className="flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-[14px] font-bold text-foreground active:scale-[0.98]"
                >
                  <RotateCcw className="size-4" /> Play again
                </button>
                <button
                  onClick={() => finishMatch("done")}
                  className="j-grad-primary flex min-h-13 flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black text-white shadow-lg shadow-primary/30 active:scale-[0.98]"
                >
                  <Check className="size-4" /> Done
                </button>
              </div>
            </motion.div>
          ) : (
            <>
              <div className="mb-3.5 flex items-center justify-between px-1">
                <span className="text-[11.5px] font-bold text-muted-foreground">
                  Tap a word, then its meaning — match all 4 before the clock runs out.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {match.tiles.map((tile, i) => {
                  const isMatched = match.matchedIds.includes(tile.wordId);
                  const isSelected = match.selected === tile.key;
                  const isWrong = match.wrongKey === tile.key;
                  return (
                    <motion.button
                      key={tile.key + "-" + match.round}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={
                        isWrong
                          ? { opacity: 1, scale: 1, x: [0, -6, 6, -4, 4, 0] }
                          : isMatched
                            ? { opacity: 0.35, scale: 0.96 }
                            : { opacity: 1, scale: 1 }
                      }
                      transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.18 }}
                      onClick={() => tapTile(tile)}
                      disabled={isMatched || !!match.wrongKey}
                      aria-label={`${tile.kind === "term" ? "Word" : "Meaning"}: ${tile.text}`}
                      className={cn(
                        "flex min-h-24 items-center justify-center rounded-2xl border-2 px-3 py-3.5 text-center transition active:scale-[0.97] disabled:opacity-100",
                        isMatched && "pointer-events-none border-j-success/40 bg-j-success/10 opacity-35",
                        isSelected && !isMatched && "border-primary bg-primary/10 ring-4 ring-primary/20",
                        isWrong && "border-j-error bg-j-error/10",
                        !isSelected && !isMatched && !isWrong && "border-border bg-card hover:border-primary/40"
                      )}
                    >
                      <span className="flex flex-col items-center gap-1">
                        <span
                          className={cn(
                            "rounded-full px-1.5 text-[9px] font-black uppercase tracking-wider",
                            tile.kind === "term" ? "bg-j-cyan/10 text-j-cyan" : "bg-j-violet/10 text-j-violet"
                          )}
                        >
                          {tile.kind === "term" ? "word" : "meaning"}
                        </span>
                        <span
                          className={cn(
                            "j-app-scroll text-[13.5px] font-bold leading-snug text-foreground",
                            tile.kind === "term" && "text-[15px] font-black"
                          )}
                        >
                          {tile.text}
                        </span>
                      </span>
                    </motion.button>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center justify-center gap-2 text-[11.5px] font-bold text-muted-foreground">
                <Zap className="size-3.5 shrink-0 text-j-warning" />
                Quick pairs build a combo — a wrong tap resets it. Matched words move up a box.
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---------------- LIST UI ----------------
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title="Vocabulary"
        subtitle="Your personal word collection"
        right={
          <button
            onClick={() => setAddOpen(true)}
            aria-label="Add word"
            className="j-grad-primary grid size-10 place-items-center rounded-full text-white shadow-lg shadow-primary/25 transition active:scale-90"
          >
            <Plus className="size-5" />
          </button>
        }
      />

      {/* stats header */}
      <div className="border-b border-border/70 bg-card/60 px-4 py-3.5">
        <div className="flex items-stretch gap-2">
          <StatMini icon={<BookMarked className="size-4" />} value={stats?.total ?? 0} label="words" tint="bg-primary/10 text-primary" />
          <StatMini icon={<Flame className="size-4" />} value={stats?.learning ?? 0} label="learning" tint="bg-j-warning/10 text-j-warning" />
          <StatMini icon={<GraduationCap className="size-4" />} value={stats?.mastered ?? 0} label="mastered" tint="bg-j-success/10 text-j-success" />
        </div>
        {stats && stats.due > 0 ? (
          <button
            onClick={() => {
              setTab("practice");
              startPractice();
            }}
            className="mt-3 flex w-full items-center gap-2.5 rounded-2xl border border-j-violet/25 bg-j-violet/10 px-3.5 py-2.5 text-left transition active:scale-[0.99]"
          >
            <Brain className="size-5 shrink-0 text-j-violet" />
            <span className="flex-1 text-[13px] font-bold text-foreground">
              {stats.due} {stats.due === 1 ? "word is" : "words are"} due for practice
            </span>
            <span className="flex items-center gap-0.5 text-[12px] font-black text-j-violet">
              Practice <ChevronRight className="size-4" />
            </span>
          </button>
        ) : null}
        <div className="mt-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "words", label: "📚 Words" },
              { value: "practice", label: "🎯 Practice" },
            ]}
          />
        </div>
      </div>

      {tab === "words" ? (
        <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          {/* search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your words…"
              aria-label="Search vocabulary"
              className="w-full rounded-2xl border border-border bg-card py-3 pl-10 pr-4 text-[14px] font-medium text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
            />
          </div>

          {err ? (
            <div className="mt-4">
              <ErrorState message={err} onRetry={load} />
            </div>
          ) : !filtered ? (
            <div className="mt-4">
              <Loader label="Loading vocabulary…" />
            </div>
          ) : !filtered.length ? (
            <div className="mt-4">
              <EmptyState
                icon={<BookMarked className="size-7 text-primary" />}
                title={q ? "No matching words" : "No words saved yet"}
                body={
                  q
                    ? "Try a different search."
                    : "Save words from Learning-mode translations, extract them from tutor answers, or add your own — then practice them here."
                }
                action={
                  !q ? (
                    <button
                      onClick={() => setAddOpen(true)}
                      className="j-grad-primary mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[13px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-95"
                    >
                      <Plus className="size-4" /> Add your first word
                    </button>
                  ) : null
                }
              />
            </div>
          ) : (
            <>
              <div className="mb-2 px-1 text-[11.5px] font-bold text-muted-foreground">
                {filtered.length} {filtered.length === 1 ? "word" : "words"}
              </div>
              <div className="space-y-2.5">
                {filtered.map((w, i) => {
                  const src = SOURCE_META[w.source] || SOURCE_META.manual;
                  const dueNow = !w.mastered && new Date(w.dueAt) <= new Date();
                  return (
                    <motion.div
                      key={w.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.25) }}
                      whileHover={{ y: -2 }}
                      className="transition-shadow hover:shadow-md hover:shadow-primary/5"
                    >
                      <Card className="overflow-hidden p-0">
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-[16px] font-black leading-snug text-foreground">{w.term}</span>
                                <span className="text-[11px] font-bold text-muted-foreground">
                                  {flagOf(w.lang)} {w.lang} → {flagOf(w.meaningLang)} {w.meaningLang}
                                </span>
                              </div>
                              <div className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{w.meaning}</div>
                              {w.example ? (
                                <div className="mt-1.5 rounded-xl bg-lavender px-3 py-1.5 text-[12px] italic leading-relaxed text-foreground/80">
                                  “{w.example}”
                                </div>
                              ) : null}
                            </div>
                            <button
                              onClick={() => toggleMaster(w)}
                              aria-label={w.mastered ? "Mark as learning" : "Mark as mastered"}
                              title={w.mastered ? "Mark as learning" : "Mark as mastered"}
                              className={cn(
                                "grid size-9 shrink-0 place-items-center rounded-xl transition active:scale-90",
                                w.mastered ? "bg-j-success/15 text-j-success" : "bg-muted text-muted-foreground hover:bg-j-success/10 hover:text-j-success"
                              )}
                            >
                              <GraduationCap className="size-4.5" />
                            </button>
                          </div>
                          <div className="mt-2.5 flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-black", src.tint)}>
                                {src.icon} {src.label}
                              </span>
                              {w.mastered ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-j-success/10 px-2.5 py-1 text-[10.5px] font-black text-j-success">
                                  <Check className="size-3" /> Mastered
                                </span>
                              ) : (
                                <span className={cn("text-[10.5px] font-bold", dueNow ? "text-j-error" : "text-muted-foreground")}>
                                  {BOX_LABELS[Math.min(Math.max(w.box, 1), 5) - 1]} · {dueInHint(w.dueAt, w.mastered)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10.5px] text-muted-foreground">{timeAgo(w.createdAt)}</span>
                              <button
                                onClick={() => removeWord(w)}
                                aria-label="Delete word"
                                className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-j-error/10 hover:text-j-error"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
              <p className="mt-5 px-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Tip: switch to Learning mode in Translate to get key vocabulary with every translation — save the useful ones here.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
          {!stats ? (
            <Loader label="Loading…" />
          ) : stats.total < 4 ? (
            <EmptyState
              icon={<Brain className="size-7 text-j-violet" />}
              title="Practice unlocks at 4 words"
              body={`You have ${stats.total} ${stats.total === 1 ? "word" : "words"} — practice needs at least 4 to build multiple-choice questions.`}
              action={
                <button
                  onClick={() => setTab("words")}
                  className="j-grad-primary mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[13px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-95"
                >
                  <Plus className="size-4" /> Add words
                </button>
              }
            />
          ) : (
            <div className="space-y-4">
              <Card className="overflow-hidden p-0">
                <div className="bg-gradient-to-br from-j-violet/15 via-card to-card p-5">
                  <div className="flex items-center gap-3">
                    <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-j-violet/15 text-j-violet">
                      <Brain className="size-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[16.5px] font-black text-foreground">Multiple-choice practice</div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                        {Math.min(10, stats.total)} questions · meanings in {user.explanationLang || "English"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-card/80 py-2 ring-1 ring-border/60">
                      <div className="text-[15px] font-black text-primary">{stats.due}</div>
                      <div className="text-[10px] font-bold text-muted-foreground">DUE NOW</div>
                    </div>
                    <div className="rounded-xl bg-card/80 py-2 ring-1 ring-border/60">
                      <div className="text-[15px] font-black text-j-warning">{stats.learning}</div>
                      <div className="text-[10px] font-bold text-muted-foreground">LEARNING</div>
                    </div>
                    <div className="rounded-xl bg-card/80 py-2 ring-1 ring-border/60">
                      <div className="text-[15px] font-black text-j-success">{stats.mastered}</div>
                      <div className="text-[10px] font-bold text-muted-foreground">MASTERED</div>
                    </div>
                  </div>
                  <button
                    onClick={() => startPractice()}
                    className="j-grad-primary mt-4 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98]"
                  >
                    <Sparkles className="size-5" /> Start practice
                  </button>
                </div>
              </Card>

              {/* brush-up mode: revisit mastered words so they stay fresh */}
              {stats.mastered >= 1 ? (
                <Card className="overflow-hidden p-0">
                  <div className="bg-gradient-to-br from-j-success/15 via-card to-card p-5">
                    <div className="flex items-center gap-3">
                      <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-j-success/15 text-j-success">
                        <GraduationCap className="size-7" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[16.5px] font-black text-foreground">Brush-up</div>
                        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                          {stats.mastered} mastered {stats.mastered === 1 ? "word" : "words"} · a quick check keeps them
                          fresh
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => startPractice("brushup")}
                      className="mt-4 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-j-success to-emerald-600 py-3.5 text-[15px] font-black text-white shadow-lg shadow-j-success/30 transition active:scale-[0.98]"
                    >
                      <GraduationCap className="size-5" /> Brush up mastered words
                    </button>
                  </div>
                </Card>
              ) : null}

              {/* speed match game card */}
              <Card className="overflow-hidden p-0">
                <div className="bg-gradient-to-br from-j-cyan/15 via-card to-card p-5">
                  <div className="flex items-center gap-3">
                    <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-j-cyan/15 text-j-cyan">
                      <Zap className="size-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[16.5px] font-black text-foreground">Speed match</div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                        75 seconds · endless rounds of 4 pairs · build combos
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={startMatch}
                    className="j-grad-cyan mt-4 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-black text-white shadow-lg shadow-j-cyan/30 transition active:scale-[0.98]"
                  >
                    <Timer className="size-5" /> Play speed match
                  </button>
                </div>
              </Card>

              {/* export words as a flashcard deck */}
              <Card className="overflow-hidden p-0">
                <div className="bg-gradient-to-br from-primary/12 via-card to-card p-5">
                  <div className="flex items-center gap-3">
                    <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
                      <Layers className="size-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[16.5px] font-black text-foreground">Flashcard deck</div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                        Practice your words as swipeable flashcards — with spaced repetition
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setExportOpen(true)}
                    className="j-grad-primary mt-4 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98]"
                  >
                    <Layers className="size-5" /> Make deck from words
                  </button>
                </div>
              </Card>

              {/* weekly vocabulary report */}
              <Card className="overflow-hidden p-0">
                <div className="p-5">
                  <div className="flex items-center gap-2.5">
                    <TrendingUp className="size-4.5 text-primary" />
                    <span className="text-[15px] font-black text-foreground">This week</span>
                    <span className="ml-auto text-[11px] font-bold text-muted-foreground">last 7 days</span>
                  </div>
                  {week ? (
                    <WeekChart week={week} />
                  ) : (
                    <div className="mt-4 h-20 animate-pulse rounded-2xl bg-muted" />
                  )}
                </div>
              </Card>

              <p className="px-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Correct answers promote a word&rsquo;s box (spaced repetition: 1 → 2 → 4 → 8 → 16 days); misses bring it back in 10
                minutes. Each correct answer earns +2 XP — including matched pairs.
              </p>
            </div>
          )}
        </div>
      )}

      {/* add-word sheet */}
      <Sheet open={addOpen} onOpenChange={setAddOpen} title="Add a word">
        <div className="space-y-4 pb-2">
          <div>
            <label htmlFor="vw-term" className="mb-1.5 block text-[12.5px] font-bold text-foreground">
              Term or phrase
            </label>
            <input
              id="vw-term"
              value={nt.term}
              onChange={(e) => setNt({ ...nt, term: e.target.value })}
              placeholder="e.g. photosynthesis"
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <div>
            <label htmlFor="vw-meaning" className="mb-1.5 block text-[12.5px] font-bold text-foreground">
              Meaning (in {user.explanationLang || "English"})
            </label>
            <input
              id="vw-meaning"
              value={nt.meaning}
              onChange={(e) => setNt({ ...nt, meaning: e.target.value })}
              placeholder="short, clear definition"
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <div>
            <label htmlFor="vw-example" className="mb-1.5 block text-[12.5px] font-bold text-foreground">
              Example sentence <span className="font-medium text-muted-foreground">(optional)</span>
            </label>
            <input
              id="vw-example"
              value={nt.example}
              onChange={(e) => setNt({ ...nt, example: e.target.value })}
              placeholder="a natural sentence using the word"
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <button
            onClick={addWord}
            disabled={saving}
            className="j-grad-primary flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14.5px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? (
              <>
                <span className="size-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" /> Saving…
              </>
            ) : (
              <>
                <Plus className="size-4.5" /> Save to vocabulary
              </>
            )}
          </button>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Words save instantly and become due for practice. You can also collect them automatically — tap the bookmark icon on
            vocabulary rows in Translate, or &ldquo;Save words&rdquo; under any tutor answer.
          </p>
        </div>
      </Sheet>

      {/* export-to-flashcards sheet */}
      <Sheet open={exportOpen} onOpenChange={setExportOpen} title="Words → flashcard deck">
        <div className="space-y-4 pb-2">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Turn your word collection into a flashcard deck — the term goes on the front, the meaning (and example, if you have
            one) on the back. Review it under Flashcards with the same spaced-repetition schedule.
          </p>
          <div>
            <div className="mb-2 text-[12.5px] font-bold text-foreground">Which words?</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "all", label: "All words", count: exportScopeCount("all"), tint: "border-primary/30 bg-primary/10 text-primary" },
                { key: "due", label: "Due for practice", count: exportScopeCount("due"), tint: "border-j-error/30 bg-j-error/10 text-j-error" },
                { key: "learning", label: "Learning", count: exportScopeCount("learning"), tint: "border-j-warning/30 bg-j-warning/10 text-j-warning" },
                { key: "mastered", label: "Mastered", count: exportScopeCount("mastered"), tint: "border-j-success/30 bg-j-success/10 text-j-success" },
              ] as const).map((o) => (
                <button
                  key={o.key}
                  onClick={() => setExportScope(o.key)}
                  className={cn(
                    "flex min-h-13 flex-col items-start gap-0.5 rounded-2xl border px-3.5 py-3 text-left transition active:scale-[0.98]",
                    exportScope === o.key ? `${o.tint} ring-2 ring-inset` : "border-border bg-card text-foreground hover:bg-muted/40"
                  )}
                  aria-pressed={exportScope === o.key}
                >
                  <span className="text-[13px] font-black">{o.label}</span>
                  <span className={cn("text-[11px] font-bold", exportScope === o.key ? "" : "text-muted-foreground")}>
                    {o.count} {o.count === 1 ? "word" : "words"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-3.5 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
            Re-exporting the same set refreshes that deck — your review progress on other decks is never touched. Decks need at
            least 4 words (up to 60 are exported).
          </div>
          <button
            onClick={exportDeck}
            disabled={exportBusy || exportScopeCount(exportScope) < 4}
            className="j-grad-primary flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14.5px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-60"
          >
            {exportBusy ? (
              <>
                <span className="size-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" /> Building deck…
              </>
            ) : (
              <>
                <Layers className="size-4.5" /> Create {exportScopeCount(exportScope)}-card deck
              </>
            )}
          </button>
          {exportScopeCount(exportScope) < 4 ? (
            <p className="text-center text-[11.5px] font-bold text-j-error">
              This set has only {exportScopeCount(exportScope)} {exportScopeCount(exportScope) === 1 ? "word" : "words"} — pick a
              bigger set.
            </p>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}

function StatMini({ icon, value, label, tint }: { icon: React.ReactNode; value: number; label: string; tint: string }) {
  return (
    <div className="flex flex-1 items-center gap-2.5 rounded-2xl bg-card px-3 py-2.5 ring-1 ring-border/60">
      <div className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tint)}>{icon}</div>
      <div className="leading-tight">
        <div className="text-[17px] font-black text-foreground">{value}</div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// Weekly vocabulary report: two stacked mini bar-charts (words added / practice sessions)
function WeekChart({ week }: { week: WeekReport }) {
  const dayLabels = week.days.map((d) => "SMTWTFS"[new Date(d + "T12:00:00").getDay()]);
  const maxAdded = Math.max(1, ...week.added);
  const maxPracticed = Math.max(1, ...week.practiced);
  const totalAdded = week.added.reduce((a, b) => a + b, 0);
  const totalPracticed = week.practiced.reduce((a, b) => a + b, 0);
  const totalCorrect = week.correct.reduce((a, b) => a + b, 0);

  const Bar = ({ h, max, tone }: { h: number; max: number; tone: string }) => (
    <div className="flex h-14 flex-1 flex-col justify-end">
      <div
        className={cn("w-full rounded-md transition-all", tone, h === 0 && "opacity-70 ring-1 ring-inset ring-border")}
        style={{ height: `${Math.max(h > 0 ? 12 : 7, (h / max) * 100)}%` }}
      />
    </div>
  );

  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-primary/5 py-2 ring-1 ring-primary/15">
          <div className="text-[16px] font-black text-primary">{totalAdded}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">words added</div>
        </div>
        <div className="rounded-xl bg-j-violet/5 py-2 ring-1 ring-j-violet/15">
          <div className="text-[16px] font-black text-j-violet">{totalPracticed}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">sessions</div>
        </div>
        <div className="rounded-xl bg-j-success/5 py-2 ring-1 ring-j-success/15">
          <div className="text-[16px] font-black text-j-success">{totalCorrect}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">correct</div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-black uppercase tracking-wide text-primary">
            <span className="size-2 rounded-sm bg-primary" /> Words added
          </div>
          <div className="flex items-end gap-1.5">
            {week.added.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <Bar h={v} max={maxAdded} tone={v > 0 ? "j-grad-primary" : "bg-muted"} />
                <span className="text-[9px] font-bold text-muted-foreground">{dayLabels[i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-black uppercase tracking-wide text-j-violet">
            <span className="size-2 rounded-sm bg-j-violet" /> Practice sessions
          </div>
          <div className="flex items-end gap-1.5">
            {week.practiced.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <Bar h={v} max={maxPracticed} tone={v > 0 ? "bg-j-violet" : "bg-muted"} />
                <span className="text-[9px] font-bold text-muted-foreground">{dayLabels[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
