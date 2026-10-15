import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const a = await db.assessment.findFirst({
      where: { id },
      include: { author: { select: { name: true } }, submissions: { where: { studentId: user.id } } },
    });
    if (!a) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    const isStaff = user.role === "Staff" || user.role === "Admin";
    if (a.status !== "published" && !isStaff) return NextResponse.json({ error: "Not available" }, { status: 403 });
    const questions: { question: string; options: string[]; correctIndex: number; explanation: string }[] =
      JSON.parse(a.questions || "[]");
    const alreadySubmitted = a.submissions.length > 0;

    // students never receive the answer key before submitting
    const canReveal = alreadySubmitted || isStaff;
    return NextResponse.json({
      assessment: {
        id: a.id,
        title: a.title,
        subject: a.subject,
        description: a.description,
        dueAt: a.dueAt,
        totalMarks: a.totalMarks,
        status: a.status,
        author: a.author.name,
        alreadySubmitted,
        myScore: alreadySubmitted ? a.submissions[0].score : null,
      },
      questions: questions.map((q, i) => ({
        idx: i,
        question: q.question,
        options: q.options,
        correctIndex: canReveal ? q.correctIndex : null,
        explanation: canReveal ? q.explanation : null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    if (user.role !== "Student") return NextResponse.json({ error: "Only students take assessments" }, { status: 403 });
    const rl = rateLimit(`assess:${user.id}`, 15, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many submissions" }, { status: 429 });
    const a = await db.assessment.findFirst({ where: { id, status: "published" } });
    if (!a) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    const existing = await db.submission.findFirst({ where: { assessmentId: a.id, studentId: user.id } });
    if (existing) return NextResponse.json({ error: "You already submitted this assessment" }, { status: 409 });

    const body = await req.json().catch(() => null);
    const answers: { qIdx: number; choice?: number }[] = Array.isArray(body?.answers) ? body.answers : [];
    const questions = JSON.parse(a.questions || "[]");
    let score = 0;
    const results = questions.map((q: { correctIndex: number; explanation: string; options: string[] }, i: number) => {
      const a1 = answers.find((x) => x.qIdx === i);
      const choice = a1 && typeof a1.choice === "number" ? a1.choice : null;
      const correct = choice === q.correctIndex;
      if (correct) score += 1;
      return {
        qIdx: i,
        yourAnswer: choice !== null ? q.options[choice] || "—" : "—",
        correctAnswer: q.options[q.correctIndex],
        correct,
        explanation: q.explanation,
      };
    });
    const sub = await db.submission.create({
      data: { assessmentId: a.id, studentId: user.id, answers: JSON.stringify(answers), score },
    });
    const gamified = await recordActivity(user.id, "assessment_done", 10 + score, { assessment: a.title });
    return NextResponse.json({ submissionId: sub.id, score, total: questions.length, results, gamified });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const a = await db.assessment.findFirst({ where: { id } });
    if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (a.authorId !== user.id && user.role !== "Admin") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    await db.assessment.delete({ where: { id: a.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
