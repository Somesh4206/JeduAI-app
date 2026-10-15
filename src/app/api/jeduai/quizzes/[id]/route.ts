import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { aggregateMistakes } from "@/lib/jeduai/quiz-grade";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const wantMistakes = req.nextUrl.searchParams.get("mistakes") === "1";
    const q = await db.quiz.findFirst({
      where: { id, userId: user.id },
      include: {
        questions: { orderBy: { idx: "asc" } },
        attempts: { orderBy: { createdAt: "desc" }, take: wantMistakes ? 10 : 5 },
      },
    });
    if (!q) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

    // mistakes retry: only the questions the learner currently has wrong
    let questions = q.questions;
    if (wantMistakes) {
      const agg = aggregateMistakes(q, q.questions, q.attempts);
      const keep = new Set(agg.active.map((m) => m.qIdx));
      questions = q.questions.filter((qq) => keep.has(qq.idx));
    }

    return NextResponse.json({
      quiz: {
        id: q.id,
        title: q.title,
        subject: q.subject,
        difficulty: q.difficulty,
        source: q.source,
        sourceRef: q.sourceRef,
        timeLimit: q.timeLimit,
        createdAt: q.createdAt,
      },
      questions: questions.map((qq) => ({
        id: qq.id,
        idx: qq.idx,
        type: qq.type,
        question: qq.question,
        options: JSON.parse(qq.options || "[]"),
        correctIndex: qq.correctIndex,
        answerText: qq.answerText,
        explanation: qq.explanation,
        keywords: JSON.parse(qq.keywords || "[]"),
      })),
      attempts: q.attempts.map((a) => ({ id: a.id, score: a.score, total: a.total, at: a.createdAt })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const q = await db.quiz.findFirst({ where: { id, userId: user.id } });
    if (!q) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    await db.quiz.delete({ where: { id: q.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
