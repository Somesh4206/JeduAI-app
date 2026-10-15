import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { generateQuiz } from "@/lib/jeduai/ai";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { SUBJECTS } from "@/lib/jeduai/constants";

type StaffQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
};

function sanitizeQuestions(raw: unknown): StaffQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffQuestion[] = [];
  for (const q of raw.slice(0, 30)) {
    const question = String((q as any)?.question || "").trim().slice(0, 600);
    const options = (Array.isArray((q as any)?.options) ? (q as any).options : [])
      .map((o: unknown) => String(o || "").trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 5);
    const correctIndex = Number((q as any)?.correctIndex);
    if (!question || options.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      continue;
    }
    out.push({
      question,
      options,
      correctIndex,
      explanation: String((q as any)?.explanation || "").slice(0, 600) || "—",
    });
  }
  return out;
}

export async function GET() {
  try {
    const user = await requireUser();
    const isStaff = user.role === "Staff" || user.role === "Admin";
    const assessments = await db.assessment.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      include: {
        author: { select: { name: true, avatarColor: true } },
        submissions: { select: { studentId: true, score: true } },
      },
    });
    const mine = await db.submission.findMany({ where: { studentId: user.id }, select: { assessmentId: true, score: true } });
    const mineMap = new Map(mine.map((m) => [m.assessmentId, m]));

    return NextResponse.json({
      assessments: assessments
        .filter((a) => isStaff || a.status === "published")
        .map((a) => {
          const qs: StaffQuestion[] = JSON.parse(a.questions || "[]");
          const my = mineMap.get(a.id);
          const isAuthor = a.authorId === user.id;
          return {
            id: a.id,
            title: a.title,
            subject: a.subject,
            description: a.description,
            dueAt: a.dueAt,
            totalMarks: a.totalMarks || qs.length,
            questionCount: qs.length,
            status: a.status,
            author: a.author.name,
            isAuthor,
            submitted: !!my,
            myScore: my ? my.score : null,
            submissions: isStaff ? a.submissions.length : undefined,
            avgScore: isStaff && a.submissions.length
              ? Math.round((a.submissions.reduce((s, x) => s + x.score, 0) / a.submissions.length) * 10) / 10
              : undefined,
            createdAt: a.createdAt,
          };
        }),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "Staff" && user.role !== "Admin") {
      return NextResponse.json({ error: "Only staff can create assessments" }, { status: 403 });
    }
    const body = await req.json().catch(() => null);

    if (body?.ai) {
      const rl = rateLimit(`aigen:${user.id}`, 6, 5 * 60_000);
      if (!rl.ok) return NextResponse.json({ error: "AI generation limit reached. Try again in a few minutes." }, { status: 429 });
      const topic = String(body.topic || "").trim().slice(0, 200);
      if (!topic) return NextResponse.json({ error: "Enter an assessment topic" }, { status: 400 });
      const subject = (SUBJECTS as readonly string[]).includes(body.subject) ? body.subject : "General Knowledge";
      const count = Math.min(Math.max(parseInt(String(body.count || "5"), 10) || 5, 3), 15);
      const lang = String(body.lang || "English");
      const gen = await generateQuiz({
        topic,
        subject,
        difficulty: String(body.difficulty || "medium"),
        count,
        lang,
      });
      const questions = gen.questions
        .filter((q) => (q.type === "mcq" || q.type === "truefalse") && q.question)
        .map((q) => ({
          question: q.question,
          options: q.type === "truefalse" ? ["True", "False"] : q.options || [],
          correctIndex: q.type === "truefalse" ? (q.correctIndex ?? 0) : (q.correctIndex ?? 0),
          explanation: q.explanation || "—",
        }))
        .filter((q) => q.options.length >= 2);
      if (!questions.length) return NextResponse.json({ error: "AI returned no usable questions. Try again." }, { status: 502 });
      return NextResponse.json({ draft: { title: gen.title, subject, questions } });
    }

    // manual save
    const title = String(body?.title || "").trim().slice(0, 140);
    const subject = String(body?.subject || "General Knowledge").slice(0, 40);
    const questions = sanitizeQuestions(body?.questions);
    if (!title || questions.length < 1) {
      return NextResponse.json({ error: "A title and at least 1 valid question are required" }, { status: 400 });
    }
    const dueAt = body?.dueAt ? new Date(String(body.dueAt)) : null;
    const a = await db.assessment.create({
      data: {
        authorId: user.id,
        title,
        subject,
        description: String(body?.description || "").slice(0, 500) || null,
        dueAt: dueAt && !isNaN(dueAt.getTime()) ? dueAt : null,
        totalMarks: questions.length,
        status: "published",
        questions: JSON.stringify(questions),
      },
    });
    // notify students
    const students = await db.user.findMany({ where: { role: "Student" }, select: { id: true } });
    if (students.length) {
      await db.notification.createMany({
        data: students.map((s) => ({
          userId: s.id,
          title: "📝 New assessment published",
          body: `${title} — ${subject}${dueAt ? ` · due ${new Date(dueAt).toLocaleString()}` : ""}`,
          kind: "assessment",
        })),
      });
    }
    return NextResponse.json({ assessment: { id: a.id } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
