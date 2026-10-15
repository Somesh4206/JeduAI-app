import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/jeduai/auth";
import { todayStr, shiftDay } from "@/lib/jeduai/constants";

export async function GET(req: NextRequest) {
  try {
    // Staff can view analytics + student list; role changes/deletion stay admin-only (below)
    const admin = await requireRole(["Admin", "Staff"]);
    const q = (req.nextUrl.searchParams.get("q") || "").toLowerCase();

    const [users, docs, vids, quizAttempts, classes, assess, day] = await Promise.all([
      db.user.findMany({ orderBy: { createdAt: "desc" } }),
      db.document.findMany({ select: { userId: true, status: true } }),
      db.videoProject.findMany({ select: { userId: true, status: true } }),
      db.quizAttempt.findMany({ select: { userId: true, score: true, total: true, createdAt: true } }),
      db.onlineClass.findMany({ select: { id: true, status: true, teacherId: true } }),
      db.assessment.findMany({ select: { id: true, status: true, authorId: true } }),
      Promise.resolve(todayStr()),
    ]);

    const week = Array.from({ length: 7 }, (_, i) => shiftDay(day, -6 + i));
    const signupsWeek = users.filter((u) => {
      const d = todayStr(u.createdAt);
      return week.includes(d);
    }).length;

    const students = users.filter((u) => u.role === "Student");
    const staff = users.filter((u) => u.role === "Staff");

    const filtered = q
      ? users.filter(
          (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
        )
      : users;

    return NextResponse.json({
      analytics: {
        totalUsers: users.length,
        students: students.length,
        staff: staff.length,
        admins: users.length - students.length - staff.length,
        signupsWeek,
        platformPoints: users.reduce((s, u) => s + u.points, 0),
        activeToday: users.filter((u) => u.lastActiveDay === day).length,
        documents: { total: docs.length, byStatus: countBy(docs.map((d) => d.status)) },
        videos: { total: vids.length, byStatus: countBy(vids.map((v) => v.status)) },
        classes: { total: classes.length, byStatus: countBy(classes.map((c) => c.status)) },
        assessments: { total: assess.length },
        avgQuizPct: quizAttempts.length
          ? Math.round((quizAttempts.reduce((s, a) => s + a.score / Math.max(1, a.total), 0) / quizAttempts.length) * 100)
          : 0,
      },
      users: filtered.slice(0, 100).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        points: u.points,
        streak: u.streak,
        avatarColor: u.avatarColor,
        educationLevel: u.educationLevel,
        isDemo: u.isDemo,
        createdAt: u.createdAt,
        isMe: u.id === admin.id,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

function countBy(arr: string[]) {
  const out: Record<string, number> = {};
  for (const a of arr) out[a] = (out[a] || 0) + 1;
  return out;
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireRole(["Admin"]);
    const body = await req.json().catch(() => ({}));
    const target = await db.user.findFirst({ where: { id: String(body.id || "") } });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (target.id === admin.id) return NextResponse.json({ error: "You cannot change your own role here" }, { status: 400 });
    if (["Student", "Staff", "Admin"].includes(body.role)) {
      if (target.isDemo) return NextResponse.json({ error: "Demo accounts keep their roles for testing" }, { status: 400 });
      await db.user.update({ where: { id: target.id }, data: { role: body.role } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireRole(["Admin"]);
    const id = req.nextUrl.searchParams.get("id");
    const target = await db.user.findFirst({ where: { id: String(id || "") } });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (target.id === admin.id) return NextResponse.json({ error: "You cannot delete your own account here" }, { status: 400 });
    if (target.isDemo) return NextResponse.json({ error: "Demo accounts cannot be deleted (needed for testing)" }, { status: 400 });
    await db.user.delete({ where: { id: target.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
