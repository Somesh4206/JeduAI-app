import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { todayStr, shiftDay } from "@/lib/jeduai/constants";

// GET /api/jeduai/stats?range=week|month|all — learning insights for the student
// Chart XP per day + activity-type breakdown for the range, plus all-time
// library counters (documents, media, quizzes, vocab, flashcards, focus),
// and a 91-day activity heatmap (always included, range-independent).
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const range = req.nextUrl.searchParams.get("range") === "month" ? "month" : req.nextUrl.searchParams.get("range") === "all" ? "all" : "week";
    const today = todayStr();
    const nDays = range === "week" ? 7 : 30;
    const days = Array.from({ length: nDays }, (_, i) => shiftDay(today, -(nDays - 1) + i));
    const daySet = new Set(days);
    // "all" still charts the last 30 days but totals cover everything
    const rangeDays = range === "all" ? null : days;

    const [acts, docs, vids, trans, attempts, vocab, cards, tasks, submissions, enrollments, convs, subjAttempts] = await Promise.all([
      db.activity.findMany({
        where: { userId: user.id, ...(rangeDays ? { day: { in: rangeDays } } : {}) },
        select: { type: true, points: true, day: true, meta: true, createdAt: true },
      }),
      db.document.findMany({ where: { userId: user.id }, select: { status: true, updatedAt: true } }),
      db.videoProject.findMany({ where: { userId: user.id }, select: { status: true, durationSec: true, updatedAt: true } }),
      db.translationRecord.findMany({ where: { userId: user.id }, select: { createdAt: true } }),
      db.quizAttempt.findMany({ where: { userId: user.id }, select: { score: true, total: true, createdAt: true } }),
      db.vocabWord.findMany({ where: { userId: user.id }, select: { mastered: true, createdAt: true } }),
      db.flashcard.findMany({ where: { userId: user.id }, select: { box: true, createdAt: true } }),
      db.studyTask.findMany({ where: { userId: user.id }, select: { done: true, minutes: true, date: true, subject: true } }),
      db.submission.findMany({ where: { studentId: user.id }, select: { submittedAt: true } }),
      db.enrollment.findMany({ where: { studentId: user.id }, select: { createdAt: true } }),
      db.conversation.findMany({ where: { userId: user.id }, select: { subject: true, updatedAt: true } }),
      db.quizAttempt.findMany({
        where: { userId: user.id },
        select: { score: true, total: true, createdAt: true, quiz: { select: { subject: true } } },
      }),
    ]);

    // ---- chart: XP per day (skip zero-XP leading days for "all" trim) ----
    const xpByDay = days.map((d) => acts.filter((a) => a.day === d).reduce((s, a) => s + a.points, 0));

    // ---- 13-week activity heatmap (always returned, independent of range) ----
    const heatDays = Array.from({ length: 91 }, (_, i) => shiftDay(today, -90 + i));
    const heatActs = await db.activity.findMany({
      where: { userId: user.id, day: { in: heatDays } },
      select: { day: true, points: true, type: true },
    });
    const heat = heatDays.map((d) => {
      const rows = heatActs.filter((a) => a.day === d);
      return { xp: rows.reduce((s, a) => s + a.points, 0), count: rows.length };
    });

    // ---- range totals from activities ----
    const byType: Record<string, number> = {};
    let xp = 0;
    let focusMinutes = 0;
    let focusSessions = 0;
    for (const a of acts) {
      byType[a.type] = (byType[a.type] || 0) + 1;
      xp += a.points;
      if (a.type === "focus") {
        focusSessions++;
        try {
          focusMinutes += Math.max(0, Math.min(480, Number((JSON.parse(a.meta || "{}") as { minutes?: number }).minutes) || 0));
        } catch {}
      }
    }
    const inRange = (iso: Date | string | null) => {
      if (!iso) return false;
      const d = typeof iso === "string" ? iso.slice(0, 10) : new Date(iso).toISOString().slice(0, 10);
      return rangeDays ? daySet.has(d) : true;
    };

    // ---- all-time library counters ----
    const docDone = docs.filter((d) => d.status === "completed");
    const vidDone = vids.filter((v) => v.status === "completed");
    const scoredAttempts = attempts.filter((a) => a.total > 0);
    const quizAvgPct = scoredAttempts.length
      ? Math.round(scoredAttempts.reduce((s, a) => s + (a.score / a.total) * 100, 0) / scoredAttempts.length)
      : null;
    const mediaMinutes = Math.round(vidDone.reduce((s, v) => s + v.durationSec, 0) / 60);

    const totals = {
      xp,
      chats: byType["chat"] || 0,
      translations: byType["translate"] || 0,
      documents: byType["document_done"] || 0,
      videos: byType["video_done"] || 0,
      quizzes: byType["quiz_done"] || 0,
      tasks: byType["task_done"] || 0,
      classesJoined: byType["class_joined"] || 0,
      assessments: byType["assessment_done"] || 0,
      flashcardSessions: byType["flashcards"] || 0,
      vocabSessions: byType["vocab"] || 0,
      focusSessions,
      focusMinutes,
    };

    // ---- best day in range ----
    let bestDay: { day: string; points: number } | null = null;
    for (let i = 0; i < days.length; i++) {
      if (!bestDay || xpByDay[i] > bestDay.points) bestDay = { day: days[i], points: xpByDay[i] };
    }

    // ---- daily-goal consistency (XP semantics mirror the home hero:
    // 100% goal = goalMin/2 XP in a day) ----
    const xpTarget = Math.max(1, Math.round(user.dailyGoalMin / 2));
    const goalHits = xpByDay.map((x) => x >= xpTarget);
    let goalHitDays = 0;
    let goalBestRun = 0;
    let run = 0;
    for (let i = 0; i < goalHits.length; i++) {
      if (goalHits[i]) {
        goalHitDays++;
        run++;
        goalBestRun = Math.max(goalBestRun, run);
      } else run = 0;
    }
    const goal = {
      goalMin: user.dailyGoalMin,
      xpTarget,
      days: days.length,
      hits: goalHits,
      hitDays: goalHitDays,
      bestRun: goalBestRun,
    };

    // ---- streak stats ----
    const doneTasks = tasks.filter((t) => t.done);
    const studyMinutesPlanned = doneTasks.reduce((s, t) => s + t.minutes, 0);

    // ---- per-subject strength (chats / quizzes / study tasks) ----
    type SubjAgg = { subject: string; chats: number; quizAttempts: number; quizPoints: number; tasksDone: number; studyMinutes: number };
    const subjMap = new Map<string, SubjAgg>();
    const subjOf = (s: string) => {
      const key = (s || "General").trim().slice(0, 40) || "General";
      let row = subjMap.get(key);
      if (!row) {
        row = { subject: key, chats: 0, quizAttempts: 0, quizPoints: 0, tasksDone: 0, studyMinutes: 0 };
        subjMap.set(key, row);
      }
      return row;
    };
    for (const c of convs) if (inRange(c.updatedAt)) subjOf(c.subject).chats++;
    for (const a of subjAttempts) {
      if (!inRange(a.createdAt)) continue;
      const row = subjOf(a.quiz?.subject);
      row.quizAttempts++;
      if (a.total > 0) row.quizPoints += (a.score / a.total) * 100;
    }
    for (const t of tasks) {
      if (!t.done || !inRange(t.date)) continue;
      const row = subjOf(t.subject);
      row.tasksDone++;
      row.studyMinutes += t.minutes;
    }
    const subjects = Array.from(subjMap.values())
      .map((r) => ({
        subject: r.subject,
        chats: r.chats,
        quizAttempts: r.quizAttempts,
        quizAvgPct: r.quizAttempts ? Math.round(r.quizPoints / r.quizAttempts) : null,
        tasksDone: r.tasksDone,
        studyMinutes: r.studyMinutes,
      }))
      .filter((r) => r.chats + r.quizAttempts + r.tasksDone > 0)
      .sort((a, b) => b.chats + b.quizAttempts * 2 + b.tasksDone - (a.chats + a.quizAttempts * 2 + a.tasksDone))
      .slice(0, 8);

    return NextResponse.json({
      range,
      days,
      xpByDay,
      byType,
      subjects,
      totals,
      goal,
      bestDay: bestDay && bestDay.points > 0 ? bestDay : null,
      heat: { days: heatDays, cells: heat },
      library: {
        documents: docDone.length,
        documentsInRange: docDone.filter((d) => inRange(d.updatedAt)).length,
        mediaProjects: vidDone.length,
        mediaInRange: vidDone.filter((v) => inRange(v.updatedAt)).length,
        mediaMinutes,
        translations: trans.length,
        translationsInRange: trans.filter((t) => inRange(t.createdAt)).length,
        quizAttempts: attempts.length,
        quizInRange: attempts.filter((a) => inRange(a.createdAt)).length,
        quizAvgPct,
        vocabWords: vocab.length,
        vocabMastered: vocab.filter((v) => v.mastered).length,
        vocabInRange: vocab.filter((v) => inRange(v.createdAt)).length,
        flashcards: cards.length,
        flashcardsMastered: cards.filter((c) => c.box >= 4).length,
        flashcardsInRange: cards.filter((c) => inRange(c.createdAt)).length,
        tasksDone: doneTasks.length,
        studyMinutesPlanned,
        assessments: submissions.length,
        classesJoined: enrollments.length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
