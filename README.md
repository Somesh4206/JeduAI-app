# JeduAI — AI-Powered Multilingual Learning Platform

**Learn in Your Language. Grow Without Limits.** 🌍

JeduAI rebuilt from the original Flutter/Firebase project ([source](https://github.com/Somesh4206/JeduAI)) as a **mobile-first web application** with a real AI backend: multilingual AI tutoring, document & e-book translation, audio/video translation with real speech recognition, quizzes, a study planner, online classes, and gamification — for Students, Staff and Admins.

> **Why a web app?** This deployment environment exposes a single web route, so the app is delivered as an installable mobile-first PWA (430px app shell, bottom tab navigation, safe-area support, offline manifest). It behaves like the native app it replaces — all screens and logic are purpose-built. (A thin, **real signed Android WebView client** is also built from this repo for `.apk` distribution — see [Getting it on your phone](#-getting-it-on-your-phone).)

---

## ✨ Feature Highlights (all backed by real services)

| Area | What it does |
|---|---|
| **AI Tutor** | 6 tutor modes (Beginner / Exam / Step-by-step / Revision / Language / Balanced), 12 subjects, answers in any of 23 languages, conversation history, rename/delete, copy, retry, thumbs rating |
| **Translation Center** | Direct (faithful) & Learning (with vocabulary + grammar notes) modes, auto language detection, 23 languages (13 Indian + 10 international), history, saved translations, simple-language explanations |
| **Documents & E-books** | Upload PDF / DOCX / TXT / MD **or photos & scans (PNG/JPG/WEBP)** → **scanned PDFs and page photos are read with AI vision (OCR, up to 8 pages — pick WHICH pages for long scans, and re-pick the range when retrying a failed read)** → section-by-section AI translation with live progress; reader with translated/original/compare views, font-size control, search, bookmarks + notes, .txt/PDF export, ask-the-document |
| **Media Studio** | Upload audio/video → ffmpeg audio extraction → silence-aligned segmentation → **real AI speech-to-text per chunk** → timestamped translation; synced transcript player, summary, chapters, ask-about-video, quiz-from-video, .srt export (translated + original). Transcript/SRT/VTT paste also supported |
| **Quizzes** | AI-generated MCQ/true-false/short-answer quizzes in any language & difficulty, optional timer, keyword-graded short answers, per-question explanations, attempt history, **and a "Mistakes notebook" — every question you've missed (with your wrong answer vs the correct one and how many times you missed it) grouped per quiz, redeemed when you answer it right; one tap retries ONLY the missed questions, and "Practice all" runs one mixed session across every quiz's misses at once (subject pills, source chips per question)** |
| **Assessments** | Staff create manually or generate with AI (review-before-publish), students take them, auto-scored with explanations, submission stats |
| **Online Classes** | Staff schedule classes (Jitsi/meeting links), students browse/enroll/join, go-live & complete controls, notifications |
| **Study Planner** | 7-day plan, tasks with subjects & durations, daily goal progress, weak-subject detection, AI study tips |
| **Focus Timer** | Pomodoro-style study sessions (15/25/50 min presets, subject tags, pause/resume, 5-min breaks) — survives in-app navigation **and full page reloads**; completed sessions earn XP and log minutes into the study planner / daily goal |
| **Ask Your Content** | Ask-the-document (RAG-lite: keyword-relevant sections + AI answer with section citations, answered in the document's target language) and ask-the-video (timestamped transcript Q&A) |
| **Flashcards** | AI-generated decks from translated docs/media **or any tutor answer** ("Flashcards" action under AI replies) with Leitner spaced repetition (5 boxes), flip-card review, due reminders on Home, deck CSV export, **deck sharing — publish a 6-character code valid for 30 days (up to 25 imports), anyone can preview & import the deck into their own library; expired/retired codes are cleaned up automatically** — and **paste/CSV authoring: write your own deck as "front | back" lines or load a .csv file (2–60 cards)**, plus **one-tap deck creation from your saved Vocabulary words** |
| **Vocabulary Builder** | Personal word collection: save key vocabulary from Learning-mode translations with one tap, extract words from tutor answers (then **practice them straight from the toast**), add your own — with Leitner-box multiple-choice practice (**distractors filtered for clarity**, +2 XP per correct answer), **🎓 brush-up mode that re-checks mastered words (a miss honestly un-masters them)**, **⚡ Speed Match game (75s timed pair-matching with combos & rounds)**, **weekly vocabulary report** (words added / sessions / correct charts), mastered tracking, search, due-word banners — and **turn any word set (all / due / learning / mastered) into a flashcard deck in one tap** |
| **Notifications** | Achievement/class/job alerts plus a daily digest synthesized server-side (due flashcards reminder, streak keeper) — Lucide-iconed notification center with unread badges |
| **Gamification** | XP, levels, 6 badges, streaks, weekly chart, leaderboard — points only for real completed activities |
| **Learning Insights** | Dedicated stats screen (from Profile/Home): This week / month / all-time ranges, XP-per-day chart, **goal-consistency card — a hit-rate ring plus per-day dots showing which days you met your daily goal (target XP = half your minute goal, mirroring the Home ring), with best-run streak**, **GitHub-style 13-week consistency heatmap (tap any square for that day's XP; tap a month name to zoom into that month's day-by-day grid with XP per day, active-days and best-day summary)**, activity breakdown (chats, translations, docs, quizzes, vocab, focus… with counts & focus minutes), **"By subject" strength rows (chats, quiz averages, done tasks per subject)**, all-time library totals (documents, media minutes, quiz average, vocab & flashcard mastery, focused minutes, enrolled classes) and best-day highlights |
| **Portals** | Staff portal (students, stats, quick actions, **class-scoped leaderboards — rank any class or all students by weekly/all-time XP with quiz averages, export any ranking as CSV — plus "Message the class" broadcast to any cohort**, **and per-student drill-down: tap any learner for their profile sheet with XP/streak/quiz-avg tiles, a 7-day XP sparkline, the open mistakes they need help with, recent quiz attempts and an activity feed**) and Admin portal (user management, role changes, analytics, pipeline/system monitor, **user-list CSV export — download the current search-filtered users with roles, XP, streaks and join dates**, **same per-student drill-down on every user row**) |
| **Notebook Studio** | NotebookLM-style research space: notebooks with multi-source ingestion (**PDF / DOCX / TXT / MD, photos & scans via AI-vision OCR, web pages, YouTube links, audio (ASR transcript), pasted text**), grounded chat with **inline source citations** (tap a citation to open the source), and **9 AI Studio artifacts** — Audio Overview (real two-host TTS podcast MP3), Video Overview (MP4 with chapters), Mind Map, Reports, Flashcards (→ Leitner library), Quizzes (→ scoring/history), Infographics (SVG + PNG export), Slides (PPTX export) and Data Tables (CSV export) — all generated server-side with live progress and honest failure states |

See `docs/feature-mapping.md` for the complete original-feature → new-feature mapping.

---

## 🚀 Quick Start (Windows / macOS / Linux)

**Requirements:** Node.js 20+ (or Bun 1.1+), a modern browser.

```bash
# 1. Install dependencies
bun install        # or: npm install

# 2. Configure environment (see below — defaults work out of the box)
cp .env.example .env

# 3. Create the database
bun run db:push    # or: npx prisma db push

# 4. Start the dev server
bun run dev        # or: npm run dev
```

Open **http://localhost:3000** — the app frame renders like a phone; on a real phone it fills the screen.

### Demo accounts (seeded on first run)

| Role | Email | Password |
|---|---|---|
| Student | `student@jeduai.app` | `JeduAI@123` |
| Staff | `staff@jeduai.app` | `JeduAI@123` |
| Admin | `admin@jeduai.app` | `JeduAI@123` |

Sign-up is open to everyone. Creating **Staff**/**Admin** accounts at sign-up requires the join codes `JEDU-STAFF` / `JEDU-ADMIN` (demo accounts are protected from role changes/deletion so testing is always possible).

---

## ⚙️ Environment Variables

Copy `.env.example` → `.env`. Everything works with the defaults in this sandbox; for other deployments set:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file path (Prisma) |
| `STAFF_JOIN_CODE` / `ADMIN_JOIN_CODE` | Codes required to self-register staff/admin (defaults: `JEDU-STAFF`, `JEDU-ADMIN`) |
| `ZAI_*` | z-ai-web-dev-sdk credentials (AI chat/ASR) — server-side only, never shipped to the client |

AI provider credentials live **only on the server** (`src/lib/jeduai/ai.ts`, `mediaworker.ts`). The client never sees an API key.

---

## 🏗 Architecture

```
src/
  app/
    page.tsx                  → single-page app shell (user-visible route)
    api/jeduai/*              → 40 REST endpoints (auth, tutor, translate,
                                 documents, media, notebook sources/chat/
                                 artifacts, quizzes, flashcards, vocab,
                                 library, planner, classes, assessments,
                                 notifications, admin…)
    globals.css               → JeduAI design tokens (light + dark)
  components/jeduai/
    app.tsx                   → boot, navigation stack, bottom tab bar
    store.tsx                 → zustand store + typed API client
    ui.tsx                    → design system (cards, chips, sheets, states)
    screens/                  → 27 screens (onboarding → portals + Notebook Studio)
  lib/jeduai/
    ai.ts                     → LLM service (tutor, translation, quizzes…)
    auth.ts                   → scrypt hashing, httpOnly session cookies
    gamify.ts                 → XP / streaks / badges engine
    files.ts                  → PDF/DOCX/TXT extraction, SRT/VTT parsing
    media.ts + mediaworker.ts → ffmpeg pipeline + ASR worker
    docworker.ts              → progressive document translation worker
    notebook/                 → Notebook Studio engine (ingest, BM25
                                 retrieval, grounding, web/YouTube import)
    studio/                   → artifact generators (TTS podcast, video,
                                 mindmap, slides, infographics, exports)
    seed.ts                   → demo data (idempotent)
prisma/schema.prisma          → 31 models (SQLite)
db/uploads/                   → user media uploads (ownership-checked)
```

**Security model:** every API route resolves the user from the httpOnly session cookie and scopes queries by `userId` — cross-user access is impossible regardless of what the client sends. Role checks (`Student`/`Staff`/`Admin`) are enforced server-side; rate limits protect AI endpoints; upload types/sizes are validated; AI answers for unpublished assessments are never sent before submission.

**Media pipeline (real, not mocked):** `ffmpeg` extracts mono 16 kHz audio, `silencedetect` splits it on natural speech pauses, each chunk is transcribed with the ASR service (`z-ai-web-dev-sdk`), timestamps come from the actual audio clock, then the LLM translates segment batches. Progress, failure, and retry states are persisted per segment.

---

## 📱 Getting it on your phone

Two ways, both built in:

1. **PWA** — open the site in a mobile browser → **Add to Home Screen**. The web manifest + service worker (`public/manifest.webmanifest`, `public/sw.js`) make it launch full-screen like a native app (one-tap install prompt on Android Chrome, contextual instructions for iOS/desktop).
2. **Android APK (real, signed)** — a 38 KB native WebView client built from this repo (`android/` — plain Java, zero dependencies, no Gradle) and served in-app at `/downloads/jeduai.apk`. Users get it from **Profile → “Get the app”**: big Download button, QR code, a 3-step install guide and a copyable server address for the APK's first-run setup. On first launch the APK asks for the school's JeduAI server URL once, then runs the full web app natively — file uploads (multi-select), downloads (incl. tokenized media URLs), client-side blob exports via a JS bridge, branded offline screen and hardware-back navigation.

**Rebuild / version-bump the APK:** edit `android/` (bump `versionCode`/`versionName` in `AndroidManifest.xml`) → `sh android/build.sh` (needs the Android build-tools toolchain — see the script's header comments) → copy `out/JeduAI.apk` to `public/downloads/jeduai.apk`. The signing keystore is kept at `android/jeduai.keystore` (self-signed, alias `jeduai`) so new versions upgrade-install over old ones; for Play Store distribution, re-sign with a Play upload key.

---

## 🧪 QA

Verified end-to-end in a real browser (agent-browser) during development: onboarding → signup → preferences → dashboard; live AI chat; real translations (English→Hindi/Tamil); document upload → progressive translation → comparison reader; TTS-generated lecture → ASR → timestamped Hindi transcript → chapters/summary/quiz-from-video; quiz grading incl. short answers; assessment submission; class enrollment; planner tasks; dark mode; 390 px mobile layout; sticky bottom navigation. No console or hydration errors.

## ⚠️ Known Limitations

- OCR is AI-vision based with a practical cap (8 pages per pass — pick which pages for longer scans); illegible scans are reported honestly.
- ASR quality depends on audio clarity; very long media is capped (60 MB, ≤40 segments) with honest failure messages.
- Subtitle export is `.srt` (translated + original). No dubbed audio generation (Audio Overview podcasts are real TTS, not voice clones).
- Translated-text export is `.txt` (PDF re-rendering of translated scripts is not bundled).
- The original app's Firebase push notifications are represented as an in-app notification center (browser push not configured).
- Notebook chat retrieval is lexical (BM25-style) — strong on exact terms; the retriever interface is pluggable for embedding-based search later.
- YouTube imports depend on YouTube being reachable — some networks (including this dev sandbox's IP) are bot-walled, and the app reports that honestly.
- The Android APK is self-signed: sideloading goes through Android's “install unknown apps” flow (guided in-app); it is verified statically (apksigner / zipalign / badging) but was not launched on a physical device during development.
