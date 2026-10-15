import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { plannerRecommendations } from "@/lib/jeduai/ai";
import { recordActivity } from "@/lib/jeduai/gamify";
import { todayStr, shiftDay, SUBJECTS, LANG_NAMES } from "@/lib/jeduai/constants";
import { rateLimit } from "@/lib/jeduai/ratelimit";

export async function GET() {
  try {
    const user = await requireUser();
    const day = todayStr();
    const from = shiftDay(day, -7);
    const [tasks, acts] = await Promise.all([
      db.studyTask.findMany({ where: { userId: user.id, date: { gte: from } }, orderBy: { date: "asc" } }),
      db.activity.findMany({ where: { userId: user.id, day: { gte: from } } }),
    ]);

    // weak subjects from quiz attempts
    const attempts = await db.quizAttempt.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { quiz: { select: { subject: true, title: true } } },
    });
    const bySubject: Record<string, { total: number; got: number }[]> = {};
    for (const a of attempts) {
      const s = a.quiz.subject;
      bySubject[s] = bySubject[s] || [];
      if (bySubject[s].length < 8) bySubject[s].push({ total: a.total, got: a.score });
    }
    const weak = Object.entries(bySubject)
      .map(([s, arr]) => ({ subject: s, pct: arr.reduce((x, y) => x + y.got / Math.max(1, y.total), 0) / arr.length }))
      .filter((x) => x.pct < 0.75)
      .sort((a, b) => a.pct - b.pct)
      .map((x) => x.subject)
      .slice(0, 3);

    const userSubjects = JSON.parse(user.subjects || "[]") as string[];
    const tips = await plannerRecommendations({
      subjects: userSubjects,
      weak,
      pendingTasks: tasks.filter((t) => !t.done).length,
      goalMin: user.dailyGoalMin,
      lang: user.explanationLang || "English",
    }).catch(() => [] as string[]);

    return NextResponse.json({
      today: day,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        subject: t.subject,
        date: t.date,
        minutes: t.minutes,
        done: t.done,
      })),
      weak,
      tips,
      streak: user.streak,
      goalMin: user.dailyGoalMin,
      doneToday: tasks.filter((t) => t.done && t.date === day).length,
      minutesDoneToday: tasks.filter((t) => t.done && t.date === day).reduce((s, t) => s + t.minutes, 0),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const title = String(body?.title || "").trim().slice(0, 120);
    if (!title) return NextResponse.json({ error: "Enter what you want to study" }, { status: 400 });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date)) ? body.date : todayStr();
    const subject = (SUBJECTS as readonly string[]).includes(body?.subject) ? body.subject : "General Knowledge";
    const minutes = Math.min(Math.max(parseInt(String(body?.minutes || "30"), 10) || 30, 5), 480);
    const task = await db.studyTask.create({ data: { userId: user.id, title, subject, date, minutes } });
    return NextResponse.json({ task }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const task = await db.studyTask.findFirst({ where: { id: String(body.id || ""), userId: user.id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (body.action === "toggle") {
      const done = !task.done;
      await db.studyTask.update({ where: { id: task.id }, data: { done } });
      if (done) {
        const gamified = await recordActivity(user.id, "task_done", undefined, { task: task.title });
        return NextResponse.json({ ok: true, done, gamified });
      }
      return NextResponse.json({ ok: true, done });
    }
    if (typeof body.title === "string") {
      await db.studyTask.update({ where: { id: task.id }, data: { title: String(body.title).slice(0, 120) || task.title } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = req.nextUrl.searchParams.get("id");
    const task = await db.studyTask.findFirst({ where: { id: String(id || ""), userId: user.id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    await db.studyTask.delete({ where: { id: task.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
