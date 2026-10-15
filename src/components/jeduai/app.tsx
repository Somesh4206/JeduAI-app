"use client";
// JeduAI — root app shell
import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home, Sparkles, Languages, Library, User } from "lucide-react";
import { api, useJedu, type Screen, type Tab } from "./store";
import { cn } from "@/lib/utils";
import Onboarding from "./screens/onboarding";
import HomeScreen from "./screens/home";
import TutorScreen from "./screens/tutor";
import TutorChat from "./screens/tutor-chat";
import TranslateScreen from "./screens/translate";
import DocumentsScreen from "./screens/documents";
import DocumentReader from "./screens/document-reader";
import VideoScreen from "./screens/video";
import VideoStudio from "./screens/video-studio";
import LibraryScreen from "./screens/library";
import QuizzesScreen from "./screens/quizzes";
import QuizPlay from "./screens/quiz-play";
import MistakeDrill from "./screens/mistake-drill";
import FlashcardsScreen from "./screens/flashcards";
import FocusScreen from "./screens/focus";
import PlannerScreen from "./screens/planner";
import ClassesScreen from "./screens/classes";
import AssessmentsScreen from "./screens/assessments";
import AssessmentTake from "./screens/assessment-take";
import ProfileScreen from "./screens/profile";
import StaffScreen from "./screens/staff";
import AdminScreen from "./screens/admin";
import NotificationsScreen from "./screens/notifications";
import SearchScreen from "./screens/search";
import VocabScreen from "./screens/vocab";
import InsightsScreen from "./screens/insights";
import NotebookStudioScreen from "./screens/notebook-studio";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "tutor", label: "AI Tutor", icon: Sparkles },
  { id: "translate", label: "Translate", icon: Languages },
  { id: "library", label: "My Learning", icon: Library },
  { id: "profile", label: "Profile", icon: User },
];

/** Desktop (lg) flag for JS-driven layout: the phone frame gets a hard viewport
 *  height (100dvh mobile / 100dvh − 48px desktop) so the flex chain constrains —
 *  bottom nav pins to the frame bottom and bottom sheets anchor to the visible
 *  screen instead of the scrollable document. Spacing is applied as PADDING on
 *  the hero wrapper (margins would collapse and overflow the document). */
function useIsDesktop() {
  const [d, setD] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const upd = () => setD(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);
  return d;
}

export default function JeduApp() {
  const booted = useJedu((s) => s.booted);
  const user = useJedu((s) => s.user);
  const theme = useJedu((s) => s.theme);
  const isDesktop = useIsDesktop();

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // PWA: register the service worker (installable app + offline shell)
  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const host = window.location.hostname;
    if (window.location.protocol !== "https:" && host !== "localhost" && host !== "127.0.0.1") return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }, 1500);
    return () => window.clearTimeout(id);
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await api<{ user: null | NonNullable<ReturnType<typeof Object>> }>("/api/jeduai/session");
        // shape: { user, unread }
        const data = r as unknown as { user: import("./store").JUser | null; unread?: number };
        useJedu.getState().setUser(data.user, data.unread || 0);
      } catch {
        useJedu.getState().setUser(null);
      } finally {
        useJedu.getState().setBooted(true);
      }
    })();
  }, []);

  if (!booted) {
    return <BootSplash />;
  }

  return (
    <div className="j-grad-hero relative min-h-dvh w-full" style={isDesktop ? { paddingTop: 24, paddingBottom: 24 } : undefined}>
      {/* ambient decoration (visible on wide screens) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
        <div className="absolute -left-32 top-16 size-96 rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute -right-24 top-1/3 size-80 rounded-full bg-j-cyan/20 blur-[120px]" />
        <div className="absolute bottom-10 left-1/3 size-72 rounded-full bg-j-violet/15 blur-[110px]" />
      </div>

      <div style={{ height: isDesktop ? "calc(100dvh - 48px)" : "100dvh" }} className="relative mx-auto flex w-full max-w-[440px] flex-col bg-background shadow-2xl lg:rounded-[36px] lg:ring-1 lg:ring-border">
        {!user || !user.onboarded ? (
          <Onboarding />
        ) : (
          <Main />
        )}
      </div>
    </div>
  );
}

function BootSplash() {
  return (
    <div className="j-grad-hero flex min-h-dvh flex-col items-center justify-center gap-5">
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="j-grad-primary grid size-24 place-items-center rounded-[28px] text-5xl font-black text-white shadow-2xl shadow-primary/40"
      >
        J
      </motion.div>
      <div className="text-center">
        <div className="text-2xl font-black tracking-tight text-foreground">JeduAI</div>
        <div className="text-sm text-muted-foreground">Learn in Your Language. Grow Without Limits.</div>
      </div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
        <motion.div className="h-full w-1/3 rounded-full j-grad-primary" animate={{ x: [0, 100, 0] }} transition={{ repeat: Infinity, duration: 1.1 }} />
      </div>
    </div>
  );
}

function Main() {
  const tab = useJedu((s) => s.tab);
  const stack = useJedu((s) => s.stack);
  const current: Screen = stack.length ? stack[stack.length - 1] : ({ name: tab } as Screen);
  const key = stack.length ? `s-${stack.length}-${current.name}` : `t-${current.name}`;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 12, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.17, ease: "easeOut" }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <ScreenRouter screen={current} />
        </motion.div>
      </AnimatePresence>

      {/* bottom nav acts as the sticky footer — always at bottom, pushed naturally */}
      <BottomNav current={current} />
    </div>
  );
}

function ScreenRouter({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case "home":
      return <HomeScreen />;
    case "tutor":
      return <TutorScreen />;
    case "tutor-chat":
      return <TutorChat conversationId={screen.conversationId} />;
    case "translate":
      return <TranslateScreen />;
    case "library":
      return <LibraryScreen />;
    case "profile":
      return <ProfileScreen />;
    case "documents":
      return <DocumentsScreen />;
    case "document-reader":
      return <DocumentReader id={screen.id} jumpToSection={screen.section} />;
    case "video":
      return <VideoScreen />;
    case "video-studio":
      return <VideoStudio id={screen.id} jumpToSegment={screen.segment} />;
    case "quizzes":
      return <QuizzesScreen />;
    case "quiz-play":
      return <QuizPlay id={screen.id} mistakes={screen.mistakes} />;
    case "mistake-drill":
      return <MistakeDrill />;
    case "flashcards":
      return <FlashcardsScreen deck={screen.deck} />;
    case "focus":
      return <FocusScreen />;
    case "planner":
      return <PlannerScreen />;
    case "classes":
      return <ClassesScreen />;
    case "assessments":
      return <AssessmentsScreen />;
    case "assessment-take":
      return <AssessmentTake id={screen.id} />;
    case "staff":
      return <StaffScreen />;
    case "admin":
      return <AdminScreen />;
    case "notifications":
      return <NotificationsScreen />;
    case "search":
      return <SearchScreen />;
    case "vocab":
      return <VocabScreen autoPractice={screen.practice} />;
    case "insights":
      return <InsightsScreen />;
    case "notebook-studio":
      return <NotebookStudioScreen notebookId={screen.id} openArtifactId={screen.artifact} />;
    default:
      return <HomeScreen />;
  }
}

function BottomNav({ current }: { current: Screen }) {
  const setTab = useJedu((s) => s.setTab);
  const stack = useJedu((s) => s.stack);
  const hidden =
    stack.length > 0 &&
    ["tutor-chat", "document-reader", "video-studio", "quiz-play", "mistake-drill", "assessment-take", "notifications", "search", "vocab", "notebook-studio"].includes(
      current.name
    );
  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        "relative z-40 shrink-0 border-t border-border/80 bg-card/95 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 backdrop-blur-xl transition-transform duration-200",
        hidden && "translate-y-full absolute bottom-0 inset-x-0"
      )}
      style={{ display: hidden ? "none" : undefined }}
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between px-3">
        {TABS.map((t) => {
          const active = current.name === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 transition",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {active ? (
                <motion.span
                  layoutId="navpill"
                  className="absolute inset-0 rounded-2xl bg-primary/10"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              ) : null}
              <Icon className={cn("relative size-[22px]", active && "drop-shadow-sm")} />
              <span className={cn("relative text-[10.5px] font-bold", active && "text-primary")}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
