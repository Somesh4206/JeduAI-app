import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { generateQuiz } from "@/lib/jeduai/ai";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { SUBJECTS, LANG_NAMES } from "@/lib/jeduai/constants";
import { aggregateMistakes, type QuizMistakes } from "@/lib/jeduai/quiz-grade";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();

    // ?view=mistakes_drill — full question payloads for every currently-missed
    // question, so the client can assemble one cross-quiz "practice all" session.
    if (req.nextUrl.searchParams.get("view") === "mistakes_drill") {
      const quizzes = await db.quiz.findMany({
        where: { userId: user.id, attempts: { some: {} } },
        orderBy: { createdAt: "desc" },
        take: 40,
        include: {
          questions: { orderBy: { idx: "asc" } },
          attempts: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      });
      const items: {
        quizId: string;
        title: string;
        subject: string;
        questions: {
          idx: number;
          type: string;
          question: string;
          options: string[];
          correctIndex: number | null;
          answerText: string | null;
          explanation: string | null;
          keywords: string[];
        }[];
      }[] = [];
      let activeTotal = 0;
      for (const q of quizzes) {
        const agg = aggregateMistakes(q, q.questions, q.attempts);
        if (!agg.active.length) continue;
        const keep = new Set(agg.active.map((m) => m.qIdx));
        const questions = q.questions
          .filter((qq) => keep.has(qq.idx))
          .map((qq) => ({
            idx: qq.idx,
            type: qq.type,
            question: qq.question,
            options: JSON.parse(qq.options || "[]") as string[],
            correctIndex: qq.correctIndex,
            answerText: qq.answerText,
            explanation: qq.explanation,
            keywords: JSON.parse(qq.keywords || "[]") as string[],
          }));
        activeTotal += questions.length;
        items.push({ quizId: q.id, title: q.title, subject: q.subject, questions });
      }
      return NextResponse.json({ activeTotal, items });
    }

    // ?view=mistakes — the "mistakes notebook": every question this user has
    // gotten wrong and not yet redeemed, grouped per quiz.
    if (req.nextUrl.searchParams.get("view") === "mistakes") {
      const quizzes = await db.quiz.findMany({
        where: { userId: user.id, attempts: { some: {} } },
        orderBy: { createdAt: "desc" },
        take: 40,
        include: {
          questions: { orderBy: { idx: "asc" } },
          attempts: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      });
      const perQuiz: QuizMistakes[] = [];
      for (const q of quizzes) {
        const agg = aggregateMistakes(q, q.questions, q.attempts);
        if (agg.active.length || agg.redeemedCount) perQuiz.push(agg);
      }
      const withActive = perQuiz.filter((x) => x.active.length);
      return NextResponse.json({
        activeTotal: withActive.reduce((s, x) => s + x.active.length, 0),
        fixedTotal: perQuiz.reduce((s, x) => s + x.redeemedCount, 0),
        quizzes: withActive,
      });
    }

    const quizzes = await db.quiz.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: {
        questions: { select: { id: true } },
        attempts: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return NextResponse.json({
      quizzes: quizzes.map((q) => ({
        id: q.id,
        title: q.title,
        subject: q.subject,
        difficulty: q.difficulty,
        source: q.source,
        questions: q.questions.length,
        lastAttempt: q.attempts[0]
          ? { score: q.attempts[0].score, total: q.attempts[0].total, mode: q.attempts[0].mode, at: q.attempts[0].createdAt }
          : null,
        createdAt: q.createdAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`quizgen:${user.id}`, 6, 5 * 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Quiz generation is limited to a few per 5 minutes. Try again shortly." }, { status: 429 });
    const body = await req.json().catch(() => null);
    const topic = String(body?.topic || "").trim().slice(0, 200);
    if (!topic) return NextResponse.json({ error: "Enter a topic for the quiz" }, { status: 400 });
    const subject = (SUBJECTS as readonly string[]).includes(body?.subject) ? body.subject : "General Knowledge";
    const difficulty = ["easy", "medium", "hard"].includes(body?.difficulty) ? body.difficulty : "medium";
    const count = Math.min(Math.max(parseInt(String(body?.count || "5"), 10) || 5, 3), 12);
    const lang = LANG_NAMES.includes(body?.lang) ? body.lang : user.explanationLang || "English";

    const gen = await generateQuiz({ topic, subject, difficulty, count, lang });
    const quiz = await db.quiz.create({
      data: {
        userId: user.id,
        title: gen.title,
        subject,
        difficulty,
        source: "ai",
        timeLimit: body?.timeLimit ? Math.min(Math.max(parseInt(String(body.timeLimit), 10) || 0, 0), 3600) || null : null,
      },
    });
    await db.quizQuestion.createMany({
      data: gen.questions.slice(0, 12).map((q, i) => ({
        quizId: quiz.id,
        idx: i,
        type: q.type === "short" ? "short" : q.type === "truefalse" ? "truefalse" : "mcq",
        question: q.question,
        options: JSON.stringify(q.options || (q.type === "truefalse" ? ["True", "False"] : [])),
        correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : null,
        answerText: q.answerText || null,
        explanation: q.explanation || "",
        keywords: JSON.stringify(q.keywords || []),
      })),
    });
    return NextResponse.json({ quizId: quiz.id, count: gen.questions.length }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Quiz generation failed" }, { status: 500 });
  }
}
