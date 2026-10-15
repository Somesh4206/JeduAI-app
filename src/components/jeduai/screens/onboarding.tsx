"use client";
// JeduAI — onboarding, authentication, and first-run preferences
import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, LogIn, Sparkles, UserPlus, ArrowRight, Languages, FileText, Palette } from "lucide-react";
import { api, saveToken, useJedu, type JUser } from "../store";
import { Card, Chip, LangButton, Segmented, toast } from "../ui";
import { EDUCATION_LEVELS, SUBJECTS } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Phase = "welcome" | "auth" | "prefs";

const SLIDES = [
  {
    icon: "🎓",
    gradient: "from-[#5B5FEF] to-[#773DE8]",
    title: "Welcome to JeduAI",
    body: "Your AI-powered learning companion — built for every student, in every language.",
  },
  {
    icon: "🗣️",
    gradient: "from-[#39C6F4] to-[#5B5FEF]",
    title: "Learn in your preferred language",
    body: "Choose from 23 languages — 13 Indian and 10 international. Explanations in the language you think in.",
  },
  {
    icon: "✨",
    gradient: "from-[#773DE8] to-[#E85D75]",
    title: "Ask AI to explain anything",
    body: "Six tutor modes — beginner explanations, exam prep, step-by-step solving, revision and more.",
  },
  {
    icon: "📄",
    gradient: "from-[#20B486] to-[#39C6F4]",
    title: "Translate documents & videos",
    body: "Upload PDFs, e-books, lectures or subtitles. Real AI translation with progress you can trust.",
  },
  {
    icon: "🎯",
    gradient: "from-[#F5A623] to-[#E85D75]",
    title: "Personalize your journey",
    body: "Quizzes, study planner, streaks and badges — gentle gamification that keeps you growing.",
  },
];

const pageAnim = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.2 },
};

export default function Onboarding() {
  const [phase, setPhase] = React.useState<Phase>("welcome");
  const [slide, setSlide] = React.useState(0);
  const user = useJedu((s) => s.user);
  const setUser = useJedu((s) => s.setUser);

  const showAuth = phase === "auth";
  const showPrefs = phase === "prefs" && !!user && !user.onboarded;

  // signed-in but not onboarded (e.g. reload): jump straight to preferences
  React.useEffect(() => {
    if (user && !user.onboarded && phase === "welcome") setPhase("prefs");
  }, [user, phase]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        {phase === "welcome" ? (
          <motion.div key="welcome" {...pageAnim} className="flex min-h-0 flex-1 flex-col">
            <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6 pb-4">
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={slide}
                  initial={{ opacity: 0, x: 34, scale: 0.97 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -34, scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="flex w-full flex-col items-center text-center"
                >
                  <div
                    className={cn(
                      "grid size-32 place-items-center rounded-[40px] bg-gradient-to-br text-6xl shadow-2xl shadow-primary/25",
                      SLIDES[slide].gradient
                    )}
                  >
                    <span className="drop-shadow-lg">{SLIDES[slide].icon}</span>
                  </div>
                  <div className="mt-8 text-[26px] font-black leading-tight tracking-tight text-foreground">
                    {SLIDES[slide].title}
                  </div>
                  <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-muted-foreground">
                    {SLIDES[slide].body}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="flex items-center justify-center gap-1.5 pb-5">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => setSlide(i)}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    i === slide ? "w-7 j-grad-primary" : "w-2 bg-muted-foreground/25"
                  )}
                />
              ))}
            </div>
            <div className="border-t border-border/70 bg-card/60 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-4">
              <button
                type="button"
                onClick={() => (slide < SLIDES.length - 1 ? setSlide(slide + 1) : setPhase("auth"))}
                className="j-grad-primary flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold text-white shadow-lg shadow-primary/30 transition active:scale-[0.98]"
              >
                {slide < SLIDES.length - 1 ? (
                  <>Next <ArrowRight className="size-4" /></>
                ) : (
                  <>Get started <Sparkles className="size-4" /></>
                )}
              </button>
              <button
                type="button"
                onClick={() => setPhase("auth")}
                className="mt-3 w-full pb-2 text-center text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Skip introduction
              </button>
            </div>
          </motion.div>
        ) : null}

        {showAuth ? (
          <motion.div key="auth" {...pageAnim} className="j-app-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
            <AuthView
              onDone={(u) => {
                setUser(u, 1);
                if (!u.onboarded) setPhase("prefs");
              }}
            />
          </motion.div>
        ) : null}

        {showPrefs ? (
          <motion.div key="prefs" {...pageAnim} className="flex min-h-0 flex-1 flex-col">
            <PrefsView />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ---------------- Auth ----------------
function AuthView({ onDone }: { onDone: (u: JUser) => void }) {
  const [mode, setMode] = React.useState<"login" | "signup">("login");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);

  const [login, setLogin] = React.useState({ email: "", password: "" });
  const [signup, setSignup] = React.useState({
    name: "",
    email: "",
    password: "",
    role: "Student" as "Student" | "Staff" | "Admin",
    roleCode: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "login") {
        const r = await api<{ user: JUser; token: string }>("/api/jeduai/auth", {
          method: "POST",
          json: { action: "login", ...login },
        });
        saveToken(r.token);
        toast.success(`Welcome back, ${r.user.name.split(" ")[0]}! 👋`);
        onDone(r.user);
      } else {
        const r = await api<{ user: JUser; token: string }>("/api/jeduai/auth", {
          method: "POST",
          json: {
            action: "signup",
            name: signup.name,
            email: signup.email,
            password: signup.password,
            role: signup.role === "Student" ? undefined : signup.role,
            roleCode: signup.roleCode || undefined,
          },
        });
        saveToken(r.token);
        toast.success("Account created — let's personalize it! 🎉");
        onDone(r.user);
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "min-h-12 w-full rounded-2xl border border-border bg-card px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70 outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/15";

  return (
    <div className="flex flex-1 flex-col justify-center px-6 py-8">
      <div className="j-grad-primary mx-auto grid size-16 place-items-center rounded-3xl text-3xl font-black text-white shadow-xl shadow-primary/30">
        J
      </div>
      <h1 className="mt-5 text-center text-[22px] font-black tracking-tight text-foreground">
        {mode === "login" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        {mode === "login" ? "Sign in to continue learning" : "Free for students, staff and admins"}
      </p>

      <div className="mt-6">
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            setErr("");
          }}
          options={[
            { value: "login", label: "Sign in" },
            { value: "signup", label: "Sign up" },
          ]}
        />
      </div>

      <form onSubmit={submit} className="mt-5 space-y-3">
        {mode === "signup" ? (
          <input
            className={inputCls}
            placeholder="Full name"
            autoComplete="name"
            required
            minLength={2}
            value={signup.name}
            onChange={(e) => setSignup({ ...signup, name: e.target.value })}
          />
        ) : null}
        <input
          className={inputCls}
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          value={mode === "login" ? login.email : signup.email}
          onChange={(e) =>
            mode === "login"
              ? setLogin({ ...login, email: e.target.value })
              : setSignup({ ...signup, email: e.target.value })
          }
        />
        <div className="relative">
          <input
            className={cn(inputCls, "pr-12")}
            type={showPw ? "text" : "password"}
            placeholder={mode === "login" ? "Password" : "Password (8+ characters)"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : 1}
            value={mode === "login" ? login.password : signup.password}
            onChange={(e) =>
              mode === "login"
                ? setLogin({ ...login, password: e.target.value })
                : setSignup({ ...signup, password: e.target.value })
            }
          />
          <button
            type="button"
            aria-label={showPw ? "Hide password" : "Show password"}
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted-foreground hover:bg-muted"
          >
            {showPw ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>

        {mode === "signup" ? (
          <div className="grid grid-cols-2 gap-3">
            <select
              className={cn(inputCls, "appearance-none")}
              value={signup.role}
              onChange={(e) => setSignup({ ...signup, role: e.target.value as typeof signup.role })}
              aria-label="Account type"
            >
              <option value="Student">Student</option>
              <option value="Staff">Staff (code)</option>
              <option value="Admin">Admin (code)</option>
            </select>
            <input
              className={cn(inputCls, signup.role === "Student" && "opacity-50")}
              placeholder={signup.role === "Admin" ? "Admin code" : "Join code"}
              disabled={signup.role === "Student"}
              value={signup.roleCode}
              onChange={(e) => setSignup({ ...signup, roleCode: e.target.value })}
            />
          </div>
        ) : null}

        {err ? (
          <div
            role="alert"
            className="rounded-2xl border border-j-error/30 bg-j-error/10 px-4 py-3 text-sm font-semibold text-j-error"
          >
            {err}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="j-grad-primary flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold text-white shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? (
            <span className="size-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
          ) : mode === "login" ? (
            <>
              <LogIn className="size-4" /> Sign in
            </>
          ) : (
            <>
              <UserPlus className="size-4" /> Create account
            </>
          )}
        </button>
      </form>

      <Card className="mt-6 border-dashed bg-lavender/60 p-4">
        <div className="flex items-center gap-2 text-[13px] font-bold text-foreground">
          <Sparkles className="size-4 text-primary" /> Demo accounts (tap to fill)
        </div>
        <div className="mt-2 grid gap-1.5">
          {[
            ["Student", "student@jeduai.app"],
            ["Staff", "staff@jeduai.app"],
            ["Admin", "admin@jeduai.app"],
          ].map(([r, em]) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setMode("login");
                setLogin({ email: em, password: "JeduAI@123" });
              }}
              className="flex min-h-10 items-center justify-between rounded-xl bg-card px-3 text-left text-[12.5px] transition hover:bg-primary/5 active:scale-[0.99]"
            >
              <span className="font-bold text-foreground">{r}</span>
              <span className="text-muted-foreground">{em} · JeduAI@123</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
          Staff/Admin sign-up codes: JEDU-STAFF / JEDU-ADMIN
        </p>
      </Card>
    </div>
  );
}

// ---------------- Preferences (new users) ----------------
function PrefsView() {
  const user = useJedu((s) => s.user)!;
  const setUser = useJedu((s) => s.setUser);
  const [step, setStep] = React.useState(0);
  const [interfaceLang, setInterfaceLang] = React.useState(user.interfaceLang || "English");
  const [explanationLang, setExplanationLang] = React.useState(user.explanationLang || "English");
  const [level, setLevel] = React.useState(user.educationLevel || "School");
  const [subjects, setSubjects] = React.useState<string[]>(user.subjects?.length ? user.subjects : []);
  const [goal, setGoal] = React.useState(user.dailyGoalMin || 20);
  const [busy, setBusy] = React.useState(false);

  const stepTitles = [
    { icon: <Languages className="size-5" />, title: "Your languages", sub: "Pick the languages you learn in" },
    { icon: <Palette className="size-5" />, title: "Education level", sub: "So explanations match your level" },
    { icon: <FileText className="size-5" />, title: "Subjects you love", sub: "Choose up to 6 — change later anytime" },
    { icon: <Sparkles className="size-5" />, title: "Daily learning goal", sub: "A gentle target, not a chore" },
  ] as const;

  async function finish() {
    setBusy(true);
    try {
      const r = await api<{ user: JUser }>("/api/jeduai/account", {
        method: "PATCH",
        json: {
          interfaceLang,
          explanationLang,
          educationLevel: level,
          subjects,
          dailyGoalMin: goal,
          onboarded: true,
        },
      });
      toast.success("You're all set! Happy learning 🎓");
      setUser(r.user);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const st = stepTitles[step];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pt-8">
        <div className="flex items-center gap-3">
          <div className="j-grad-primary grid size-11 place-items-center rounded-2xl text-white shadow-lg shadow-primary/30">
            {st.icon}
          </div>
          <div>
            <div className="text-[19px] font-black leading-tight text-foreground">{st.title}</div>
            <div className="text-[13px] text-muted-foreground">{st.sub}</div>
          </div>
        </div>
        <div className="mt-4 flex gap-1.5">
          {stepTitles.map((_, i) => (
            <div key={i} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "j-grad-primary" : "bg-muted")} />
          ))}
        </div>
      </div>

      <div className="j-app-scroll flex-1 overflow-y-auto px-6 py-6">
        {step === 0 ? (
          <div className="space-y-5">
            <div>
              <div className="mb-2 px-1 text-[13px] font-bold text-foreground">Interface language</div>
              <LangButton value={interfaceLang} onChange={setInterfaceLang} />
              <div className="mt-1.5 text-xs text-muted-foreground">Used for app labels and tips.</div>
            </div>
            <div>
              <div className="mb-2 px-1 text-[13px] font-bold text-foreground">
                Explanation language <span className="text-primary">· AI answers in this language</span>
              </div>
              <LangButton value={explanationLang} onChange={setExplanationLang} />
            </div>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="grid grid-cols-2 gap-3">
            {EDUCATION_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={cn(
                  "min-h-16 rounded-2xl border-2 text-[14px] font-bold transition active:scale-[0.98]",
                  level === l
                    ? "j-grad-primary border-transparent text-white shadow-lg shadow-primary/25"
                    : "border-border bg-card text-foreground hover:border-primary/40"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        ) : null}
        {step === 2 ? (
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map((s) => {
              const active = subjects.includes(s);
              return (
                <Chip
                  key={s}
                  active={active}
                  onClick={() => {
                    if (active) setSubjects(subjects.filter((x) => x !== s));
                    else if (subjects.length < 6) setSubjects([...subjects, s]);
                    else toast.info("Up to 6 subjects — you can edit these anytime in Profile.");
                  }}
                >
                  {s}
                </Chip>
              );
            })}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="space-y-4">
            <div className="j-shadow-soft rounded-3xl border border-border bg-card p-6 text-center">
              <div className="text-5xl font-black text-foreground">
                {goal}
                <span className="text-lg font-bold text-muted-foreground"> min/day</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">≈ {Math.round((goal * 7) / 60)} hours a week</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {[10, 20, 30, 45, 60, 90].map((m) => (
                <Chip key={m} active={goal === m} onClick={() => setGoal(m)}>
                  {m} min
                </Chip>
              ))}
            </div>
            <p className="px-2 text-xs leading-relaxed text-muted-foreground">
              Streaks celebrate consistency — you never lose progress for taking a break day.
            </p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/70 bg-card/60 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-4">
        <div className="flex gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="min-h-14 rounded-2xl border border-border bg-card px-6 text-[15px] font-bold text-foreground transition active:scale-[0.98]"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || (step === 2 && subjects.length === 0)}
            onClick={() => (step < 3 ? setStep(step + 1) : finish())}
            className="j-grad-primary flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-[15px] font-bold text-white shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-50"
          >
            {step < 3 ? (
              <>
                Continue <ArrowRight className="size-4" />
              </>
            ) : busy ? (
              <span className="size-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
            ) : (
              "Start learning 🚀"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
