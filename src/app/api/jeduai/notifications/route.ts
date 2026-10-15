import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { todayStr } from "@/lib/jeduai/constants";

// GET — list notifications; also synthesizes the daily digest (due flashcards +
// streak nudge) at most once per day per kind.
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "30"), 60);

    // ---- daily digest synthesis (fire-and-forget style, cheap queries) ----
    try {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const todays = await db.notification.findMany({
        where: { userId: user.id, kind: "digest", createdAt: { gte: dayStart } },
        select: { title: true },
      });
      const hasDueDigest = todays.some((t) => t.title.includes("Daily review"));
      const hasStreakNudge = todays.some((t) => t.title.includes("streak"));

      if (!hasDueDigest) {
        const due = await db.flashcard.count({ where: { userId: user.id, dueAt: { lte: new Date() } } });
        if (due > 0) {
          await db.notification.create({
            data: {
              userId: user.id,
              title: "🧠 Daily review ready",
              body: `${due} flashcard${due === 1 ? " is" : "s are"} due today. A quick review keeps your memory strong — about ${Math.max(1, Math.round(due / 4))} min.`,
              kind: "digest",
            },
          });
        }
      }

      if (!hasStreakNudge && user.streak > 0 && user.lastActiveDay !== todayStr()) {
        await db.notification.create({
          data: {
            userId: user.id,
            title: "🔥 Keep your streak alive",
            body: `You're on a ${user.streak}-day learning streak. Do one small thing today — even a single review counts.`,
            kind: "digest",
          },
        });
      }
    } catch {
      /* digest synthesis must never break the list */
    }

    const items = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    if (body.id) {
      await db.notification.updateMany({ where: { id: String(body.id), userId: user.id }, data: { read: true } });
    } else {
      await db.notification.updateMany({ where: { userId: user.id }, data: { read: true } });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
