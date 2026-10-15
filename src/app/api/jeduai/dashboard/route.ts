import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { levelOf, todayStr, shiftDay } from "@/lib/jeduai/constants";

export async function GET() {
  try {
    const user = await requireUser();
    const day = todayStr();
    const week = Array.from({ length: 7 }, (_, i) => shiftDay(day, -6 + i));

    const [acts, docs, vids, quizzes, convs, classes, pendingAssess, notifCount, recentDocs, recentVids, recentQuizzes, recentTrans, dueCards] =
      await Promise.all([
        db.activity.findMany({ where: { userId: user.id, day: { in: week } } }),
        db.document.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 8 }),
        db.videoProject.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 8 }),
        db.quiz.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8, include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } } }),
        db.conversation.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 5 }),
        db.enrollment.findMany({ where: { studentId: user.id }, include: { class: true } }),
        db.submission.findMany({ where: { studentId: user.id }, select: { assessmentId: true } }),
        db.notification.count({ where: { userId: user.id, read: false } }),
        db.document.findMany({ where: { userId: user.id, status: "completed" }, orderBy: { updatedAt: "desc" }, take: 3 }),
        db.videoProject.findMany({ where: { userId: user.id, status: "completed" }, orderBy: { updatedAt: "desc" }, take: 3 }),
        db.quizAttempt.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 3, include: { quiz: true } }),
        db.translationRecord.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 3 }),
        db.flashcard.findMany({
          where: { userId: user.id, dueAt: { lte: new Date() } },
          select: { deckTitle: true, sourceType: true, sourceId: true, dueAt: true },
          take: 120,
        }),
      ]);

    // aggregate due flashcards per deck (drives the Home review reminder)
    const dueByDeck = new Map<string, { deck: string; title: string; due: number; sourceType: string }>();
    for (const c of dueCards) {
      const deck = `${c.sourceType}:${c.sourceId || ""}`;
      let d = dueByDeck.get(deck);
      if (!d) {
        d = { deck, title: c.deckTitle, due: 0, sourceType: c.sourceType };
        dueByDeck.set(deck, d);
      }
      d.due++;
    }
    const dueDecks = Array.from(dueByDeck.values()).sort((a, b) => b.due - a.due);
    const flashcardsDue = { total: dueCards.length, top: dueDecks[0] || null, decks: dueDecks.slice(0, 3) };

    // published assessments not yet submitted by this student
    const submittedIds = new Set(pendingAssess.map((s) => s.assessmentId));
    const allAssess = await db.assessment.findMany({
      where: { status: "published" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const openAssessments = allAssess.filter((a) => !submittedIds.has(a.id)).slice(0, 4);

    const weekPoints = week.map((d) => acts.filter((a) => a.day === d).reduce((s, a) => s + a.points, 0));
    const todayActs = acts.filter((a) => a.day === day);
    const todayPoints = todayActs.reduce((s, a) => s + a.points, 0);

    const enrolled = classes
      .map((e) => e.class)
      .filter((c) => c.status === "scheduled" && new Date(c.scheduledAt) > new Date())
      .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))
      .slice(0, 3);

    const continueItems: { kind: string; id: string; title: string; progress: number; subtitle: string }[] = [];
    for (const d of docs) if (d.status !== "failed") continueItems.push({ kind: "document", id: d.id, title: d.title, progress: d.progress, subtitle: `${d.sourceLang} → ${d.targetLang}` });
    for (const v of vids) if (v.status !== "failed") continueItems.push({ kind: "video", id: v.id, title: v.title, progress: v.progress, subtitle: `${v.sourceLang} → ${v.targetLang}` });
    continueItems.sort(() => 0);
    const continueLearning = continueItems.slice(0, 4);

    const lv = levelOf(user.points);
    return NextResponse.json({
      greeting: {
        name: user.name.split(" ")[0],
        streak: user.streak,
        points: user.points,
        ...lv,
        todayPoints,
        goalMin: user.dailyGoalMin,
      },
      weekDays: week,
      weekPoints,
      continueLearning,
      recent: {
        documents: recentDocs.map((d) => ({ id: d.id, title: d.title, status: d.status, progress: d.progress, at: d.updatedAt })),
        videos: recentVids.map((v) => ({ id: v.id, title: v.title, status: v.status, progress: v.progress, at: v.updatedAt })),
        quizzes: recentQuizzes.map((a) => ({ id: a.quizId, title: a.quiz.title, score: a.score, total: a.total, at: a.createdAt })),
        translations: recentTrans.map((t) => ({ id: t.id, from: t.sourceLang, to: t.targetLang, preview: t.sourceText.slice(0, 60), at: t.createdAt })),
        conversations: convs.map((c) => ({ id: c.id, title: c.title, subject: c.subject, at: c.updatedAt })),
      },
      upcomingClasses: enrolled.map((c) => ({
        id: c.id,
        title: c.title,
        subject: c.subject,
        at: c.scheduledAt,
        teacher: c.title ? undefined : undefined,
        durationMin: c.durationMin,
      })),
      openAssessments: openAssessments.map((a) => ({ id: a.id, title: a.title, subject: a.subject, dueAt: a.dueAt, totalMarks: a.totalMarks })),
      flashcardsDue,
      unread: notifCount,
      counts: {
        documents: await db.document.count({ where: { userId: user.id } }),
        videos: await db.videoProject.count({ where: { userId: user.id } }),
        quizzes: await db.quizAttempt.count({ where: { userId: user.id } }),
        translations: await db.translationRecord.count({ where: { userId: user.id } }),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
