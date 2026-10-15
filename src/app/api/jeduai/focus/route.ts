import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { recordActivity } from "@/lib/jeduai/gamify";
import { todayStr, shiftDay } from "@/lib/jeduai/constants";

// GET /api/jeduai/focus — focus-time stats (today + last 7 days)
export async function GET() {
  try {
    const user = await requireUser();
    const day = todayStr();
    const from = shiftDay(day, -6);
    const acts = await db.activity.findMany({
      where: { userId: user.id, type: "focus", day: { gte: from } },
      orderBy: { createdAt: "desc" },
    });
    let minutesToday = 0;
    let sessionsToday = 0;
    const byDay = new Map<string, number>();
    for (const a of acts) {
      try {
        const meta = JSON.parse(a.meta || "{}") as { minutes?: number };
        const m = Math.max(0, Math.min(480, Number(meta.minutes) || 0));
        byDay.set(a.day, (byDay.get(a.day) || 0) + m);
        if (a.day === day) {
          minutesToday += m;
          sessionsToday++;
        }
      } catch {}
    }
    const week = Array.from({ length: 7 }, (_, i) => shiftDay(day, -6 + i));
    return NextResponse.json({
      today: day,
      minutesToday,
      sessionsToday,
      goalMin: user.dailyGoalMin,
      weekDays: week,
      weekMinutes: week.map((d) => byDay.get(d) || 0),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

// POST /api/jeduai/focus — record a completed focus session
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const minutes = Math.min(Math.max(parseInt(String(body?.minutes), 10) || 0, 5), 120);
    if (!minutes) return NextResponse.json({ error: "Invalid session length" }, { status: 400 });
    const subject = String(body?.subject || "General").slice(0, 40);
    const rl = rateLimitFocus(user.id, minutes);
    if (!rl.ok) return NextResponse.json({ error: rl.msg }, { status: 429 });

    // XP scales with focused minutes, capped so one session can't jump levels
    const xp = Math.min(minutes, 30);
    const gamified = await recordActivity(user.id, "focus", xp, { minutes, subject });

    // log a completed planner task so study minutes count toward the daily goal
    const task = await db.studyTask.create({
      data: {
        userId: user.id,
        title: `Focus session — ${subject}`,
        subject: "General Knowledge",
        date: todayStr(),
        minutes,
        done: true,
      },
    });

    return NextResponse.json({ ok: true, xp, minutes, task: { id: task.id }, gamified }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// A finished session can only be recorded once: at most one per minute per length.
const recent = new Map<string, number>();
function rateLimitFocus(userId: string, minutes: number) {
  const key = `${userId}:${minutes}`;
  const now = Date.now();
  const last = recent.get(key) || 0;
  if (now - last < 60_000) return { ok: false, msg: "This session was already recorded." };
  recent.set(key, now);
  if (recent.size > 500) {
    for (const [k, t] of recent) if (now - t > 300_000) recent.delete(k);
  }
  return { ok: true };
}
