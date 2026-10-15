import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { todayStr, shiftDay } from "@/lib/jeduai/constants";
import { rateLimit } from "@/lib/jeduai/ratelimit";

// GET /api/jeduai/classes/leaderboard — staff/admin analytics
//   ?classId=<id>  (optional — omit for "all students")
//   ?scope=week|all (default week)
// Returns classes (for the picker) + ranked student rows with weekly XP,
// all-time XP, streak and quiz average for the selected cohort.
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "Staff" && user.role !== "Admin") {
      return NextResponse.json({ error: "Staff only" }, { status: 403 });
    }
    const classId = req.nextUrl.searchParams.get("classId") || "";
    const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "week";

    const classes = await db.onlineClass.findMany({
      orderBy: { scheduledAt: "desc" },
      select: {
        id: true,
        title: true,
        subject: true,
        status: true,
        scheduledAt: true,
        enrollments: { select: { studentId: true } },
      },
    });

    // cohort: enrolled students of the picked class, or every student
    let studentIds: string[] | null = null;
    if (classId) {
      const cls = classes.find((c) => c.id === classId);
      if (!cls) return NextResponse.json({ error: "Class not found" }, { status: 404 });
      studentIds = cls.enrollments.map((e) => e.studentId);
    }

    const students = await db.user.findMany({
      where: { role: "Student", ...(studentIds ? { id: { in: studentIds } } : {}) },
      select: {
        id: true,
        name: true,
        avatarColor: true,
        streak: true,
        points: true,
        isDemo: true,
        educationLevel: true,
        lastActiveDay: true,
      },
    });

    const ids = students.map((s) => s.id);
    const week = Array.from({ length: 7 }, (_, i) => shiftDay(todayStr(), -6 + i));

    const [acts, attempts] = await Promise.all([
      ids.length
        ? db.activity.findMany({
            where: { userId: { in: ids }, day: { in: week } },
            select: { userId: true, points: true, day: true },
          })
        : Promise.resolve([] as { userId: string; points: number; day: string }[]),
      ids.length
        ? db.quizAttempt.findMany({
            where: { userId: { in: ids } },
            select: { userId: true, score: true, total: true },
          })
        : Promise.resolve([] as { userId: string; score: number; total: number }[]),
    ]);

    const weekSet = new Set(week);
    const weekXp = new Map<string, number>();
    for (const a of acts) {
      if (!weekSet.has(a.day)) continue;
      weekXp.set(a.userId, (weekXp.get(a.userId) || 0) + a.points);
    }
    const quizAgg = new Map<string, { pct: number; n: number }>();
    for (const at of attempts) {
      if (!at.total) continue;
      const cur = quizAgg.get(at.userId) || { pct: 0, n: 0 };
      quizAgg.set(at.userId, { pct: cur.pct + (at.score / at.total) * 100, n: cur.n + 1 });
    }

    const rows = students
      .map((s) => {
        const q = quizAgg.get(s.id);
        return {
          id: s.id,
          name: s.name,
          avatarColor: s.avatarColor,
          streak: s.streak,
          points: s.points,
          weekPoints: weekXp.get(s.id) || 0,
          quizAvgPct: q ? Math.round(q.pct / q.n) : null,
          quizCount: q ? q.n : 0,
          isDemo: s.isDemo,
          educationLevel: s.educationLevel,
          lastActiveDay: s.lastActiveDay,
        };
      })
      .sort((a, b) => (scope === "week" ? b.weekPoints - a.weekPoints || b.points - a.points : b.points - a.points))
      .map((r, i) => ({ rank: i + 1, ...r }));

    return NextResponse.json({
      scope,
      classId: classId || null,
      classes: classes.map((c) => ({
        id: c.id,
        title: c.title,
        subject: c.subject,
        status: c.status,
        scheduledAt: c.scheduledAt,
        enrolled: c.enrollments.length,
      })),
      rows,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

// POST /api/jeduai/classes/leaderboard — "message the class" broadcast
//   { classId?: string, title: string, body: string }
// Sends an in-app notification to every student in the cohort
// (enrolled students of the class, or all students when classId is empty).
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "Staff" && user.role !== "Admin") {
      return NextResponse.json({ error: "Staff only" }, { status: 403 });
    }
    const rl = rateLimit(`classmsg:${user.id}`, 5, 10 * 60_000);
    if (!rl.ok) return NextResponse.json({ error: "You're sending messages too quickly — wait a moment." }, { status: 429 });
    const payload = await req.json().catch(() => null);
    const title = String(payload?.title || "").trim().slice(0, 90);
    const body = String(payload?.body || "").trim().slice(0, 400);
    const classId = typeof payload?.classId === "string" ? payload.classId : "";
    if (title.length < 3) return NextResponse.json({ error: "Give the message a short title (3+ characters)." }, { status: 400 });
    if (body.length < 3) return NextResponse.json({ error: "Write the message body (3+ characters)." }, { status: 400 });

    let students: { id: string }[];
    let audience: string;
    if (classId) {
      const cls = await db.onlineClass.findUnique({
        where: { id: classId },
        select: { title: true, subject: true, enrollments: { select: { studentId: true } } },
      });
      if (!cls) return NextResponse.json({ error: "Class not found" }, { status: 404 });
      students = cls.enrollments.map((e) => ({ id: e.studentId }));
      audience = cls.title;
    } else {
      students = await db.user.findMany({ where: { role: "Student" }, select: { id: true } });
      audience = "All students";
    }
    if (!students.length) {
      return NextResponse.json({ error: "No students in this cohort yet — share the class code first." }, { status: 400 });
    }

    await db.notification.createMany({
      data: students.map((s) => ({
        userId: s.id,
        title: `📣 ${title}`,
        body,
        kind: "class",
      })),
    });
    return NextResponse.json({ sent: students.length, audience }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
