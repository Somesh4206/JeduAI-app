import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/jeduai/auth";
import { todayStr, shiftDay } from "@/lib/jeduai/constants";
import { aggregateMistakes } from "@/lib/jeduai/quiz-grade";

// GET /api/jeduai/admin/student?id=<userId> — per-student drill-down for the
// staff/admin portals: profile, last-7-day XP sparkline, quiz history, active
// mistakes (what the learner needs help with), recent activity and classes.
export async function GET(req: NextRequest) {
  try {
    await requireRole(["Admin", "Staff"]);
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing student id" }, { status: 400 });

    const student = await db.user.findFirst({
      where: { id },
      include: {
        enrollments: { include: { class: true }, orderBy: { createdAt: "desc" }, take: 6 },
        submissions: { include: { assessment: true }, orderBy: { submittedAt: "desc" }, take: 5 },
      },
    });
    if (!student) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const today = todayStr();
    const week = Array.from({ length: 7 }, (_, i) => shiftDay(today, -6 + i));

    const [acts, attempts, quizzes, allAttempts] = await Promise.all([
      db.activity.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { type: true, points: true, day: true, createdAt: true },
      }),
      db.quizAttempt.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { quiz: { select: { title: true, subject: true } } },
      }),
      db.quiz.findMany({
        where: { userId: id, attempts: { some: {} } },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          questions: { orderBy: { idx: "asc" } },
          attempts: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      }),
      db.quizAttempt.findMany({ where: { userId: id }, select: { score: true, total: true } }),
    ]);

    // last-7-day XP sparkline
    const weekXp = week.map((d) => acts.filter((a) => a.day === d).reduce((s, a) => s + a.points, 0));

    // quiz average
    const scored = allAttempts.filter((a) => a.total > 0);
    const avgPct = scored.length ? Math.round(scored.reduce((s, a) => s + (a.score / a.total) * 100, 0) / scored.length) : null;

    // active mistakes across quizzes (what the learner needs help with)
    const missRows: { quizTitle: string; subject: string; question: string; yourAnswer: string; correctAnswer: string; missedCount: number }[] = [];
    let activeTotal = 0;
    let fixedTotal = 0;
    for (const q of quizzes) {
      const agg = aggregateMistakes(q, q.questions, q.attempts);
      activeTotal += agg.active.length;
      fixedTotal += agg.redeemedCount;
      for (const m of agg.active) {
        missRows.push({
          quizTitle: q.title,
          subject: q.subject,
          question: m.question,
          yourAnswer: m.yourAnswer,
          correctAnswer: m.correctAnswer,
          missedCount: m.missedCount,
        });
      }
    }
    missRows.sort((a, b) => b.missedCount - a.missedCount);

    let subjects: string[] = [];
    try {
      const parsed = JSON.parse(student.subjects || "[]");
      if (Array.isArray(parsed)) subjects = parsed.slice(0, 6);
    } catch {}

    return NextResponse.json({
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
        avatarColor: student.avatarColor,
        educationLevel: student.educationLevel,
        points: student.points,
        streak: student.streak,
        lastActiveDay: student.lastActiveDay,
        createdAt: student.createdAt,
        isDemo: student.isDemo,
        subjects,
        interfaceLang: student.interfaceLang,
      },
      week: { days: week, xp: weekXp },
      quiz: {
        attempts: allAttempts.length,
        avgPct,
        last: attempts.map((a) => ({ id: a.id, title: a.quiz.title, subject: a.quiz.subject, score: a.score, total: a.total, mode: a.mode, at: a.createdAt })),
      },
      misses: { activeTotal, fixedTotal, top: missRows.slice(0, 5) },
      activity: acts.slice(0, 10).map((a) => ({ type: a.type, points: a.points, day: a.day, at: a.createdAt })),
      classes: student.enrollments.map((e) => ({
        title: e.class.title,
        subject: e.class.subject,
        status: e.class.status,
        scheduledAt: e.class.scheduledAt,
      })),
      assessments: student.submissions.map((s) => ({
        title: s.assessment.title,
        score: s.score,
        totalMarks: s.assessment.totalMarks,
        submittedAt: s.submittedAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
