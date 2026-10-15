// JeduAI — shared constants (aligned with original app's language/subject lists)

export const APP_NAME = "JeduAI";
export const APP_TAGLINE = "Learn in Your Language. Grow Without Limits.";

export const LANGUAGES: { name: string; native: string; flag: string }[] = [
  { name: "English", native: "English", flag: "🌍" },
  { name: "Hindi", native: "हिन्दी", flag: "🇮🇳" },
  { name: "Tamil", native: "தமிழ்", flag: "🇮🇳" },
  { name: "Telugu", native: "తెలుగు", flag: "🇮🇳" },
  { name: "Kannada", native: "ಕನ್ನಡ", flag: "🇮🇳" },
  { name: "Malayalam", native: "മലയാളം", flag: "🇮🇳" },
  { name: "Bengali", native: "বাংলা", flag: "🇮🇳" },
  { name: "Marathi", native: "मराठी", flag: "🇮🇳" },
  { name: "Gujarati", native: "ગુજરાતી", flag: "🇮🇳" },
  { name: "Punjabi", native: "ਪੰਜਾਬੀ", flag: "🇮🇳" },
  { name: "Urdu", native: "اردو", flag: "🇮🇳" },
  { name: "Odia", native: "ଓଡ଼ିଆ", flag: "🇮🇳" },
  { name: "Assamese", native: "অসমীয়া", flag: "🇮🇳" },
  { name: "Spanish", native: "Español", flag: "🇪🇸" },
  { name: "French", native: "Français", flag: "🇫🇷" },
  { name: "German", native: "Deutsch", flag: "🇩🇪" },
  { name: "Chinese", native: "中文", flag: "🇨🇳" },
  { name: "Japanese", native: "日本語", flag: "🇯🇵" },
  { name: "Korean", native: "한국어", flag: "🇰🇷" },
  { name: "Arabic", native: "العربية", flag: "🇸🇦" },
  { name: "Portuguese", native: "Português", flag: "🇵🇹" },
  { name: "Russian", native: "Русский", flag: "🇷🇺" },
  { name: "Italian", native: "Italiano", flag: "🇮🇹" },
];

export const LANG_NAMES = LANGUAGES.map((l) => l.name);

export const EDUCATION_LEVELS = ["School", "College", "University", "Self-learner"] as const;

export const SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "Computer Science",
  "English",
  "History",
  "Geography",
  "Economics",
  "Accounting",
  "Commerce",
  "General Knowledge",
] as const;

export const TUTOR_MODES: {
  id: string;
  label: string;
  icon: string;
  blurb: string;
}[] = [
  { id: "balanced", label: "Balanced Tutor", icon: "✨", blurb: "Adaptive explanations with examples" },
  { id: "beginner", label: "Explain Like I'm a Beginner", icon: "🌱", blurb: "Simple words, zero jargon" },
  { id: "exam", label: "Exam Preparation", icon: "🎯", blurb: "Focused, exam-style answers" },
  { id: "steps", label: "Step-by-Step Problem Solving", icon: "🪜", blurb: "Numbered steps with reasoning" },
  { id: "revision", label: "Quick Revision", icon: "⚡", blurb: "Crisp summaries and key points" },
  { id: "language", label: "Language Learning", icon: "🗣️", blurb: "Bilingual help + vocabulary" },
];

export const BADGES: { name: string; icon: string; points: number }[] = [
  { name: "First Steps", icon: "🎯", points: 10 },
  { name: "Getting Started", icon: "🌟", points: 50 },
  { name: "Dedicated Learner", icon: "📚", points: 100 },
  { name: "Knowledge Seeker", icon: "🔍", points: 250 },
  { name: "Master Student", icon: "🏆", points: 500 },
  { name: "Legend", icon: "👑", points: 1000 },
];

export const POINT_RULES = {
  signup: 10,
  chat: 2,
  translate: 1,
  document_done: 15,
  video_done: 20,
  quiz_done: 5,
  task_done: 3,
  class_joined: 5,
  assessment_done: 10,
  flashcards: 8,
  vocab: 2,
  focus: 15,
} as const;

export const DOC_LIMITS = { maxMB: 15, maxSections: 40, sectionChars: 1200 };
// OCR (AI vision) settings for scanned PDFs & image documents
export const OCR_LIMITS = { maxPages: 8, imageMaxKB: 8 * 1024, pageDpi: 130, pageMaxWidth: 1500 };
export const MEDIA_LIMITS = { maxMB: 60, maxSegments: 40 };
export const AVATAR_COLORS = ["#5B5FEF", "#773DE8", "#20B486", "#F5A623", "#E85D75", "#39C6F4", "#e11d48", "#0ea5e9"];

export function levelOf(points: number) {
  const level = Math.floor(points / 100) + 1;
  const inLevel = points % 100;
  return { level, inLevel, toNext: 100 - inLevel };
}

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shiftDay(day: string, delta: number) {
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return todayStr(d);
}
