// JeduAI — shared quiz answer grading (used by attempts, mistakes notebook
// aggregation and the mistake-scoped quiz loader). Mirrors the exact semantics
// of the attempt endpoint so scores never drift between features.
export type GradeQuestion = {
  idx: number;
  type: string; // mcq | truefalse | short
  question: string;
  options: string | null; // JSON string[] (nullable column)
  correctIndex: number | null;
  answerText: string | null;
  explanation: string | null;
  keywords: string | null; // JSON string[] (nullable column)
};

export type GradeAnswer = { qIdx: number; choice?: number | null; text?: string };

export type Graded = {
  qIdx: number;
  type: string;
  yourAnswer: string;
  correctAnswer: string;
  modelAnswer: string;
  correct: boolean;
};

function gradeShort(answer: string, keywords: string[]) {
  const a = (answer || "").toLowerCase();
  const hits = keywords.filter((k) => k && a.includes(k.toLowerCase()));
  const need = Math.max(1, Math.ceil(keywords.length / 2));
  return { correct: hits.length >= need, hits, need, total: keywords.length };
}

// Grade one answer against one question. Unanswered (null choice / empty text)
// counts as wrong, exactly like a submitted quiz.
export function gradeAnswer(q: GradeQuestion, a: GradeAnswer | undefined): Graded {
  const keywords: string[] = safeArr(q.keywords);
  const options: string[] = safeArr(q.options);
  if (q.type === "short") {
    const g = gradeShort(a?.text || "", keywords);
    return {
      qIdx: q.idx,
      type: q.type,
      yourAnswer: a?.text || "",
      modelAnswer: q.answerText || "",
      correctAnswer: q.answerText || "—",
      correct: g.correct,
    };
  }
  const choice = typeof a?.choice === "number" ? a.choice : null;
  return {
    qIdx: q.idx,
    type: q.type,
    yourAnswer: choice !== null ? options[choice] || String(choice) : "—",
    correctAnswer: q.correctIndex !== null ? options[q.correctIndex] || String(q.correctIndex) : "—",
    modelAnswer: q.correctIndex !== null ? options[q.correctIndex] || String(q.correctIndex) : "—",
    correct: choice !== null && choice === q.correctIndex,
  };
}

function safeArr(s: string | null): string[] {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ---- mistakes aggregation -------------------------------------------------
export type MissRow = {
  qIdx: number;
  question: string;
  type: string;
  yourAnswer: string;
  correctAnswer: string;
  missedCount: number;
  lastWrongAt: string;
};

export type QuizMistakes = {
  quizId: string;
  title: string;
  subject: string;
  lastAttemptAt: string;
  active: MissRow[]; // still missed (not answered right in the latest attempt)
  redeemedCount: number; // questions missed before, now answered right
};

// Aggregate a quiz's attempts (newest first) + questions into still-active
// misses and redeemed counts. An attempt "covers" a question when its stored
// answers include that qIdx (full attempts cover every question).
export function aggregateMistakes(
  quiz: { id: string; title: string; subject: string },
  questions: GradeQuestion[],
  attempts: { answers: string; createdAt: Date }[] // newest first
): QuizMistakes {
  const parsed = attempts.map((a) => {
    let ans: GradeAnswer[] = [];
    try {
      const v = JSON.parse(a.answers || "[]");
      if (Array.isArray(v)) ans = v.filter((x) => x && typeof x.qIdx === "number");
    } catch {}
    return { ans, at: a.createdAt };
  });

  const active: MissRow[] = [];
  let redeemedCount = 0;

  for (const q of questions) {
    const covering = parsed.filter((p) => p.ans.some((x) => x.qIdx === q.idx));
    if (!covering.length) continue; // never attempted
    const graded = covering.map((p) => ({ g: gradeAnswer(q, p.ans.find((x) => x.qIdx === q.idx)), at: p.at }));
    const wrongs = graded.filter((x) => !x.g.correct);
    if (!wrongs.length) continue; // always right
    // redeemed = the most recent covering attempt answered it correctly
    if (graded[0].g.correct) {
      redeemedCount++;
      continue;
    }
    const lastWrong = wrongs[0];
    active.push({
      qIdx: q.idx,
      question: q.question,
      type: q.type,
      yourAnswer: lastWrong.g.yourAnswer,
      correctAnswer: lastWrong.g.correctAnswer,
      missedCount: wrongs.length,
      lastWrongAt: new Date(lastWrong.at).toISOString(),
    });
  }

  return {
    quizId: quiz.id,
    title: quiz.title,
    subject: quiz.subject,
    lastAttemptAt: attempts.length ? new Date(attempts[0].createdAt).toISOString() : new Date().toISOString(),
    active,
    redeemedCount,
  };
}
