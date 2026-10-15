"use client";
// JeduAI — Focus timer engine (module singleton, survives in-app navigation)
// Timestamp-based so throttled tabs still report accurate remaining time.
import { api } from "./store";

export type FocusPhase = "idle" | "focus" | "paused" | "break" | "celebrate";

export type FocusState = {
  phase: FocusPhase;
  minutes: number; // planned focus minutes
  subject: string;
  left: number; // seconds left in the current phase
  total: number; // seconds in the current phase
  breakLeft: number; // seconds left in a queued break (0 = none)
  lastXp: number | null; // XP earned by the last completed focus session
};

let state: FocusState = {
  phase: "idle",
  minutes: 25,
  subject: "",
  left: 0,
  total: 0,
  breakLeft: 0,
  lastXp: null,
};

let endsAt = 0; // epoch ms when the running phase ends
let ticker: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

// ---- persistence: survive full page reloads (not just in-app navigation) ----
const LS_KEY = "jeduai_focus_v1";

type Snapshot = {
  phase: FocusPhase;
  minutes: number;
  subject: string;
  left: number;
  endsAt: number;
  savedAt: number;
};

function persist() {
  if (typeof window === "undefined") return;
  try {
    const snap: Snapshot = {
      phase: state.phase,
      minutes: state.minutes,
      subject: state.subject,
      left: state.left,
      endsAt,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(LS_KEY, JSON.stringify(snap));
  } catch {}
}

function clearPersisted() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {}
}

// Restore a running/paused timer on load. Timestamp-based, so a focus phase
// that elapsed while the app was closed is completed honestly on return.
function restore() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Snapshot;
    if (!s || typeof s.phase !== "string") return;
    const minutes = Math.min(Math.max(s.minutes || 25, 1), 120);
    if (s.phase === "focus") {
      if (s.endsAt > Date.now()) {
        state = { ...state, phase: "focus", minutes, subject: s.subject || "", left: Math.round((s.endsAt - Date.now()) / 1000), total: minutes * 60, breakLeft: 0, lastXp: null };
        endsAt = s.endsAt;
        startTicker();
      } else {
        // the timer finished while the tab was closed — record the session
        state = { ...state, phase: "focus", minutes, subject: s.subject || "", left: 0, total: minutes * 60, breakLeft: 0, lastXp: null };
        void completeSession();
      }
    } else if (s.phase === "break" && s.endsAt > Date.now()) {
      state = { ...state, phase: "break", minutes, subject: "", left: Math.round((s.endsAt - Date.now()) / 1000), total: 300, breakLeft: 0, lastXp: null };
      endsAt = s.endsAt;
      startTicker();
    } else if (s.phase === "paused" && s.left > 0) {
      state = { ...state, phase: "paused", minutes, subject: s.subject || "", left: s.left, total: minutes * 60, breakLeft: 0, lastXp: null };
    } else if (s.phase === "celebrate") {
      state = { ...state, phase: "celebrate", minutes, subject: s.subject || "", left: 0, total: minutes * 60, breakLeft: 0, lastXp: null };
    }
  } catch {}
}
restore();

function emit() {
  for (const fn of listeners) fn();
}

function syncLeft() {
  if (state.phase === "focus" || state.phase === "break") {
    state.left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
  }
}

function tick() {
  syncLeft();
  if (state.left <= 0 && (state.phase === "focus" || state.phase === "break")) {
    const finishedPhase = state.phase;
    stopTicker();
    if (finishedPhase === "focus") {
      void completeSession();
    } else {
      state.phase = "idle";
      state.breakLeft = 0;
      chime(2);
      clearPersisted(); // break over — nothing left to restore
    }
  }
  emit();
}

function startTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(tick, 500);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

async function completeSession() {
  const { minutes, subject } = state;
  state.left = 0;
  state.phase = "celebrate";
  state.lastXp = null;
  persist();
  emit();
  chime(1);
  if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
  try {
    const r = await api<{ xp: number; gamified?: { gained: number } }>("/api/jeduai/focus", {
      method: "POST",
      json: { minutes, subject },
    });
    state.lastXp = r.xp;
  } catch {
    // session not recorded (e.g. duplicate guard) — celebration still shows
  }
  emit();
}

// soft completion chime via WebAudio (no assets needed)
function chime(kind: 1 | 2) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = kind === 1 ? [523.25, 659.25, 783.99] : [659.25, 523.25];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

export function getFocus(): FocusState {
  syncLeft();
  return state;
}

export function subscribeFocus(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function startFocus(minutes: number, subject: string) {
  state = {
    ...state,
    phase: "focus",
    minutes,
    subject,
    left: minutes * 60,
    total: minutes * 60,
    breakLeft: 0,
    lastXp: null,
  };
  endsAt = Date.now() + minutes * 60_000;
  startTicker();
  persist();
  emit();
}

export function pauseFocus() {
  if (state.phase !== "focus") return;
  syncLeft();
  endsAt = 0;
  state.phase = "paused";
  stopTicker();
  persist();
  emit();
}

export function resumeFocus() {
  if (state.phase !== "paused") return;
  endsAt = Date.now() + state.left * 1000;
  state.phase = "focus";
  startTicker();
  persist();
  emit();
}

export function resetFocus() {
  stopTicker();
  endsAt = 0;
  state = { phase: "idle", minutes: state.minutes, subject: "", left: 0, total: 0, breakLeft: 0, lastXp: null };
  clearPersisted();
  emit();
}

export function startBreak(minutes = 5) {
  if (state.phase !== "celebrate" && state.phase !== "idle") return;
  state.phase = "break";
  state.total = minutes * 60;
  state.left = minutes * 60;
  endsAt = Date.now() + minutes * 60_000;
  startTicker();
  persist();
  emit();
}

export function addMinutes(m: number) {
  if (state.phase !== "focus") return;
  endsAt += m * 60_000;
  state.minutes = Math.max(1, state.minutes + m);
  state.total = state.minutes * 60;
  syncLeft();
  persist();
  emit();
}
