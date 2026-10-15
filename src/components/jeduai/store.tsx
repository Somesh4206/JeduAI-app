"use client";
// JeduAI — client store (zustand) + typed API client
import { create } from "zustand";

export type JUser = {
  id: string;
  email: string;
  name: string;
  role: "Student" | "Staff" | "Admin";
  avatarColor: string;
  profileImage: string | null;
  educationLevel: string;
  interfaceLang: string;
  explanationLang: string;
  subjects: string[];
  interests: string[];
  dailyGoalMin: number;
  points: number;
  streak: number;
  theme: string;
  fontScale: number;
  onboarded: boolean;
  notifPrefs: Record<string, unknown>;
};

export type Screen =
  | { name: "home" }
  | { name: "tutor" }
  | { name: "translate" }
  | { name: "library" }
  | { name: "profile" }
  | { name: "tutor-chat"; conversationId?: string }
  | { name: "documents" }
  | { name: "document-reader"; id: string; section?: number }
  | { name: "video" }
  | { name: "video-studio"; id: string; segment?: number }
  | { name: "quizzes" }
  | { name: "quiz-play"; id: string; mistakes?: boolean }
  | { name: "mistake-drill" }
  | { name: "flashcards"; deck?: string }
  | { name: "focus" }
  | { name: "planner" }
  | { name: "classes" }
  | { name: "assessments" }
  | { name: "assessment-take"; id: string }
  | { name: "staff" }
  | { name: "admin" }
  | { name: "notifications" }
  | { name: "search" }
  | { name: "vocab"; practice?: boolean }
  | { name: "insights" }
  | { name: "notebook-studio"; id?: string; artifact?: string };

export type Tab = "home" | "tutor" | "translate" | "library" | "profile";

type JState = {
  booted: boolean;
  user: JUser | null;
  unread: number;
  theme: "light" | "dark";
  tab: Tab;
  stack: Screen[];
  setBooted: (v: boolean) => void;
  setUser: (u: JUser | null, unread?: number) => void;
  setUnread: (n: number) => void;
  setTheme: (t: "light" | "dark") => void;
  setTab: (t: Tab) => void;
  push: (s: Screen) => void;
  replace: (s: Screen) => void;
  pop: () => void;
  popToRoot: () => void;
};

export const useJedu = create<JState>((set) => ({
  booted: false,
  user: null,
  unread: 0,
  theme: "light",
  tab: "home",
  stack: [],
  setBooted: (v) => set({ booted: v }),
  setUser: (user, unread) =>
    set((s) => ({
      user,
      unread: unread ?? s.unread,
      theme: (user?.theme as "light" | "dark") || "light",
      stack: [],
      tab: "home",
    })),
  setUnread: (unread) => set({ unread }),
  setTheme: (theme) => set({ theme }),
  setTab: (tab) => set({ tab, stack: [] }),
  push: (s) => set((st) => ({ stack: [...st.stack, s] })),
  replace: (s) => set((st) => ({ stack: [...st.stack.slice(0, -1), s] })),
  pop: () => set((st) => ({ stack: st.stack.slice(0, -1) })),
  popToRoot: () => set({ stack: [] }),
}));

export function top(s: JState): Screen {
  return s.stack.length ? s.stack[s.stack.length - 1] : ({ name: s.tab } as Screen);
}

// ---------- API client ----------
export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Session token fallback storage. The sandbox preview renders the app inside a
// cross-site iframe where browsers block session cookies (SameSite). The token
// is kept in localStorage and sent as `Authorization: Bearer` on every request;
// the httpOnly cookie still works for normal first-party access.
const TOKEN_KEY = "jeduai_token";

export function saveToken(t: string | null | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (t) window.localStorage.setItem(TOKEN_KEY, t);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init || {};
  const token = getToken();
  const res = await fetch(path, {
    ...rest,
    credentials: "include",
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers || {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    // Stale stored token (session revoked / logged out elsewhere): drop it so
    // the next request falls back to the cookie (or a fresh sign-in).
    if (res.status === 401 && token && !path.includes("/api/jeduai/auth")) saveToken(null);
    let msg = `Request failed (${res.status})`;
    if (data && typeof data === "object" && "error" in data) {
      const e = (data as { error?: unknown }).error;
      if (typeof e === "string" && e.trim()) msg = e;
      else if (e !== null && e !== undefined) msg = String(e);
    }
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export function fmtDate(d: string | Date, opts?: Intl.DateTimeFormatOptions) {
  return new Date(d).toLocaleDateString(undefined, opts || { month: "short", day: "numeric" });
}
export function fmtDateTime(d: string | Date) {
  return new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function timeAgo(d: string | Date) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString();
}
export function fmtClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
