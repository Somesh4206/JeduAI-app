import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";

type Answer = { qIdx: number; choice?: number | null; text?: string };

function gradeShort(answer: string, keywords: string[]) {
  const a = (answer || "").toLowerCase();
  const hits = keywords.filter((k) => k && a.includes(k.toLowerCase()));
  const need = Math.max(1, Math.ceil(keywords.length / 2));
  return { correct: hits.length >= need, hits, need, total: keywords.length };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const rl = rateLimit(`attempt:${user.id}`, 20, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many submissions. Slow down a little." }, { status: 429 });
    const quiz = await db.quiz.findFirst({
      where: { id, userId: user.id },
      include: { questions: { orderBy: { idx: "asc" } } },
    });
    if (!quiz) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    const body = await req.json().catch(() => null);
    const answers: Answer[] = Array.isArray(body?.answers) ? body.answers.slice(0, 40) : [];
    if (!answers.length) return NextResponse.json({ error: "No answers submitted" }, { status: 400 });
    const mode = body?.mode === "mistakes" ? "mistakes" : "full";

    // mistakes retry: grade only the questions actually re-answered
    const gradedQuestions =
      mode === "mistakes" ? quiz.questions.filter((q) => answers.some((a) => a.qIdx === q.idx)) : quiz.questions;
    if (!gradedQuestions.length)
      return NextResponse.json({ error: "None of these questions are in this quiz" }, { status: 400 });

    const results = gradedQuestions.map((q) => {
      const a = answers.find((x) => x.qIdx === q.idx) || { qIdx: q.idx, choice: null, text: "" };
      const keywords: string[] = JSON.parse(q.keywords || "[]");
      if (q.type === "short") {
        const g = gradeShort(a.text || "", keywords);
        return {
          qIdx: q.idx,
          type: q.type,
          yourAnswer: a.text || "",
          modelAnswer: q.answerText || "",
          correct: g.correct,
          explanation: q.explanation || "",
          keywordFeedback: g,
        };
      }
      const choice = typeof a.choice === "number" ? a.choice : null;
      const correct = choice !== null && choice === q.correctIndex;
      const options: string[] = JSON.parse(q.options || "[]");
      return {
        qIdx: q.idx,
        type: q.type,
        yourAnswer: choice !== null ? options[choice] || String(choice) : "—",
        correctAnswer: q.correctIndex !== null ? options[q.correctIndex] || String(q.correctIndex) : "—",
        correct,
        explanation: q.explanation || "",
      };
    });

    const score = results.filter((r) => r.correct).length;
    const total = gradedQuestions.length;

    const attempt = await db.quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: user.id,
        answers: JSON.stringify(answers),
        mode,
        score,
        total,
      },
    });
    const gamified = await recordActivity(user.id, "quiz_done", 5 + score, { quiz: quiz.title });
    return NextResponse.json({ attemptId: attempt.id, score, total, results, gamified, mode });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
