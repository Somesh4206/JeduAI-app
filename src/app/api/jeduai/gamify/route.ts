import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { BADGES, levelOf, todayStr, shiftDay } from "@/lib/jeduai/constants";

export async function GET() {
  try {
    const user = await requireUser();
    const day = todayStr();
    const week = Array.from({ length: 7 }, (_, i) => shiftDay(day, -6 + i));
    const [acts, myBadges, topUsers, taskCounts] = await Promise.all([
      db.activity.findMany({ where: { userId: user.id, day: { in: week } } }),
      db.badge.findMany({ where: { userId: user.id }, orderBy: { threshold: "asc" } }),
      db.user.findMany({
        where: { role: "Student" },
        orderBy: { points: "desc" },
        take: 10,
        select: { id: true, name: true, points: true, streak: true, avatarColor: true },
      }),
      db.studyTask.count({ where: { userId: user.id, done: true } }),
    ]);
    const weekPoints = week.map((d) => acts.filter((a) => a.day === d).reduce((s, a) => s + a.points, 0));
    const byType: Record<string, number> = {};
    for (const a of acts) byType[a.type] = (byType[a.type] || 0) + 1;

    return NextResponse.json({
      points: user.points,
      streak: user.streak,
      ...levelOf(user.points),
      weekDays: week,
      weekPoints,
      byType,
      badges: BADGES.map((b) => ({
        ...b,
        earned: myBadges.some((mb) => mb.name === b.name),
        earnedAt: myBadges.find((mb) => mb.name === b.name)?.createdAt || null,
      })),
      leaderboard: topUsers.map((u, i) => ({ rank: i + 1, ...u, isMe: u.id === user.id })),
      tasksCompleted: taskCounts,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
