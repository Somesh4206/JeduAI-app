import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { recordActivity } from "@/lib/jeduai/gamify";
import { todayStr } from "@/lib/jeduai/constants";

export async function GET() {
  try {
    const user = await requireUser();
    const isStaff = user.role === "Staff" || user.role === "Admin";
    const classes = await db.onlineClass.findMany({
      orderBy: { scheduledAt: "asc" },
      include: {
        teacher: { select: { id: true, name: true, avatarColor: true } },
        enrollments: { select: { studentId: true } },
      },
    });
    const enrolledIds = await db.enrollment.findMany({ where: { studentId: user.id }, select: { classId: true } });
    const enrolledSet = new Set(enrolledIds.map((e) => e.classId));

    const visible = isStaff
      ? classes
      : classes.filter((c) => enrolledSet.has(c.id) || c.status !== "cancelled");

    return NextResponse.json({
      classes: visible.map((c) => ({
        id: c.id,
        title: c.title,
        subject: c.subject,
        description: c.description,
        scheduledAt: c.scheduledAt,
        durationMin: c.durationMin,
        meetingLink: c.meetingLink,
        status: c.status,
        classCode: c.classCode,
        teacher: { id: c.teacher.id, name: c.teacher.name, avatarColor: c.teacher.avatarColor },
        enrolled: c.enrollments.length,
        isEnrolled: enrolledSet.has(c.id),
        isMine: c.teacherId === user.id,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "Staff" && user.role !== "Admin") {
      return NextResponse.json({ error: "Only staff can schedule classes" }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const title = String(body?.title || "").trim().slice(0, 120);
    const subject = String(body?.subject || "General Knowledge").slice(0, 40);
    const description = String(body?.description || "").slice(0, 500) || null;
    const when = new Date(String(body?.scheduledAt || ""));
    if (!title || isNaN(when.getTime())) return NextResponse.json({ error: "Title and valid date/time required" }, { status: 400 });
    if (when.getTime() < Date.now() - 3600_000) return NextResponse.json({ error: "Schedule the class in the future" }, { status: 400 });
    const link = String(body?.meetingLink || "").trim().slice(0, 300);
    if (!/^https?:\/\//.test(link)) return NextResponse.json({ error: "Enter a valid meeting link (https://...)" }, { status: 400 });
    const durationMin = Math.min(Math.max(parseInt(String(body?.durationMin || "45"), 10) || 45, 10), 240);

    const c = await db.onlineClass.create({
      data: {
        teacherId: user.id,
        title,
        subject,
        description,
        scheduledAt: when,
        durationMin,
        meetingLink: link,
        status: "scheduled",
      },
    });
    // notify all students
    const students = await db.user.findMany({ where: { role: "Student" }, select: { id: true } });
    if (students.length) {
      await db.notification.createMany({
        data: students.map((s) => ({
          userId: s.id,
          title: "📅 New class scheduled",
          body: `${title} — ${subject}, ${when.toLocaleString()}`,
          kind: "class",
        })),
      });
    }
    return NextResponse.json({ class: { id: c.id } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const c = await db.onlineClass.findFirst({ where: { id: String(body.id || "") } });
    if (!c) return NextResponse.json({ error: "Class not found" }, { status: 404 });

    if (body.action === "enroll") {
      if (user.role !== "Student") return NextResponse.json({ error: "Only students can enroll" }, { status: 403 });
      const exists = await db.enrollment.findFirst({ where: { classId: c.id, studentId: user.id } });
      if (exists) return NextResponse.json({ ok: true, note: "already enrolled" });
      await db.enrollment.create({ data: { classId: c.id, studentId: user.id } });
      const gamified = await recordActivity(user.id, "class_joined", undefined, { class: c.title });
      return NextResponse.json({ ok: true, gamified });
    }

    // teacher/admin status changes
    if (c.teacherId !== user.id && user.role !== "Admin") {
      return NextResponse.json({ error: "You can only manage your own classes" }, { status: 403 });
    }
    const allowed = ["scheduled", "live", "completed", "cancelled"];
    if (allowed.includes(body.status)) {
      await db.onlineClass.update({ where: { id: c.id }, data: { status: body.status } });
      if (body.status === "live" || body.status === "cancelled") {
        const enr = await db.enrollment.findMany({ where: { classId: c.id }, select: { studentId: true } });
        if (enr.length) {
          await db.notification.createMany({
            data: enr.map((e) => ({
              userId: e.studentId,
              title: body.status === "live" ? "🔴 Class is LIVE now" : "🚫 Class cancelled",
              body: `${c.title} — ${c.subject}`,
              kind: "class",
            })),
          });
        }
      }
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
    const c = await db.onlineClass.findFirst({ where: { id: String(id || "") } });
    if (!c) return NextResponse.json({ error: "Class not found" }, { status: 404 });
    if (c.teacherId !== user.id && user.role !== "Admin") {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    await db.onlineClass.delete({ where: { id: c.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
