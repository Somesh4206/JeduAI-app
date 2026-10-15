import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { processVideo, isVideoProcessing } from "@/lib/jeduai/mediaworker";
import { answerAboutTranscript, makeChapters, summarizeTranscript, generateQuiz } from "@/lib/jeduai/ai";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";

function fmtClockShort(sec: number): string {
  if (sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const v = await db.videoProject.findFirst({ where: { id, userId: user.id }, include: { segments: { orderBy: { idx: "asc" } } } });
    if (!v) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // self-heal: if stuck mid-pipeline, re-kick
    if ((v.status === "extracting" || v.status === "transcribing" || v.status === "translating") && !isVideoProcessing(v.id)) {
      after(async () => {
        await processVideo(v.id);
      });
    }

    let chapters: { title: string; start: number }[] = [];
    try {
      chapters = v.chapters ? JSON.parse(v.chapters) : [];
    } catch {}

    const bookmarks = await db.bookmark.findMany({
      where: { userId: user.id, sourceType: "video", sourceId: v.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      video: {
        id: v.id,
        title: v.title,
        kind: v.kind,
        fileName: v.fileName,
        hasFile: !!v.fileKey,
        sizeKB: v.sizeKB,
        durationSec: v.durationSec,
        sourceLang: v.sourceLang,
        targetLang: v.targetLang,
        status: v.status,
        progress: v.progress,
        summary: v.summary,
        chapters,
        error: v.error,
        createdAt: v.createdAt,
      },
      segments: v.segments.map((s) => ({
        id: s.id,
        idx: s.idx,
        start: s.startSec,
        end: s.endSec,
        original: s.original,
        translated: s.translated,
      })),
      bookmarks: bookmarks.map((b) => ({ id: b.id, label: b.label, note: b.note, sectionIdx: b.sectionIdx })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const v = await db.videoProject.findFirst({ where: { id, userId: user.id }, include: { segments: { orderBy: { idx: "asc" } } } });
    if (!v) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const transcript = v.segments.map((s) => s.original).filter(Boolean).join("\n");

    if (body.action === "resume") {
      if (v.status === "completed") return NextResponse.json({ ok: true, note: "already completed" });
      const status = v.segments.some((s) => !s.original) && v.fileKey ? "transcribing" : v.segments.some((s) => !s.translated) ? "translating" : "extracting";
      await db.videoProject.update({ where: { id: v.id }, data: { status, error: null, updatedAt: new Date() } });
      after(async () => {
        await processVideo(v.id);
      });
      return NextResponse.json({ ok: true, status });
    }

    if (!transcript) return NextResponse.json({ error: "This project has no transcript yet." }, { status: 400 });

    if (body.action === "summary") {
      const rl = rateLimit(`vai:${user.id}`, 10, 60_000);
      if (!rl.ok) return NextResponse.json({ error: "Too many AI requests. Wait a moment." }, { status: 429 });
      const summary = await summarizeTranscript(transcript, v.targetLang);
      await db.videoProject.update({ where: { id: v.id }, data: { summary } });
      return NextResponse.json({ summary });
    }

    if (body.action === "chapters") {
      const chapters = await makeChapters(
        v.segments.filter((s) => s.original).map((s) => ({ start: s.startSec, text: s.original })),
        v.targetLang
      );
      await db.videoProject.update({ where: { id: v.id }, data: { chapters: JSON.stringify(chapters) } });
      return NextResponse.json({ chapters });
    }

    if (body.action === "ask") {
      const q = String(body.question || "").trim().slice(0, 1000);
      if (!q) return NextResponse.json({ error: "Type a question about the video" }, { status: 400 });
      const rl = rateLimit(`vai:${user.id}`, 10, 60_000);
      if (!rl.ok) return NextResponse.json({ error: "Too many AI requests. Wait a moment." }, { status: 429 });
      const answer = await answerAboutTranscript(q, transcript, v.targetLang);
      return NextResponse.json({ answer });
    }

    if (body.action === "quiz") {
      const rl = rateLimit(`quizgen:${user.id}`, 6, 5 * 60_000);
      if (!rl.ok) return NextResponse.json({ error: "Quiz generation is limited. Try again in a few minutes." }, { status: 429 });
      const count = Math.min(Math.max(parseInt(String(body.count || "5"), 10) || 5, 3), 10);
      const gen = await generateQuiz({
        topic: v.title,
        subject: "General Knowledge",
        difficulty: String(body.difficulty || "medium"),
        count,
        lang: v.targetLang,
        sourceText: transcript,
      });
      const quiz = await db.quiz.create({
        data: {
          userId: user.id,
          title: `${gen.title} (from video)`,
          subject: "General Knowledge",
          difficulty: String(body.difficulty || "medium"),
          source: "video",
          sourceRef: v.id,
        },
      });
      await db.quizQuestion.createMany({
        data: gen.questions.slice(0, 10).map((q, i) => ({
          quizId: quiz.id,
          idx: i,
          type: q.type === "short" ? "short" : q.type === "truefalse" ? "truefalse" : "mcq",
          question: q.question,
          options: JSON.stringify(q.options || (q.type === "truefalse" ? ["True", "False"] : [])),
          correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : null,
          answerText: q.answerText || null,
          explanation: q.explanation || "",
          keywords: JSON.stringify(q.keywords || []),
        })),
      });
      return NextResponse.json({ quizId: quiz.id, count: gen.questions.length });
    }

    if (body.action === "bookmark") {
      // toggle a transcript-segment bookmark (used by library quick-access jump)
      const sectionIdx = parseInt(String(body.sectionIdx), 10);
      if (isNaN(sectionIdx)) return NextResponse.json({ error: "Missing segment" }, { status: 400 });
      const seg = v.segments.find((s) => s.idx === sectionIdx);
      if (!seg) return NextResponse.json({ error: "Segment not found" }, { status: 404 });
      const existing = await db.bookmark.findFirst({
        where: { userId: user.id, sourceType: "video", sourceId: v.id, sectionIdx },
      });
      if (existing) {
        await db.bookmark.delete({ where: { id: existing.id } });
        return NextResponse.json({ bookmarked: false });
      }
      const label = String(body.label || "").trim().slice(0, 120) || `${fmtClockShort(seg.startSec)} · ${(seg.translated || seg.original || "").slice(0, 60)}`;
      await db.bookmark.create({
        data: {
          userId: user.id,
          kind: "bookmark",
          label,
          note: body.note ? String(body.note).slice(0, 500) : null,
          sourceType: "video",
          sourceId: v.id,
          sectionIdx,
        },
      });
      return NextResponse.json({ bookmarked: true }, { status: 201 });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Action failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const v = await db.videoProject.findFirst({ where: { id, userId: user.id } });
    if (!v) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    // remove stored file
    if (v.fileKey) {
      const { deleteUpload } = await import("@/lib/jeduai/files");
      await deleteUpload(v.fileKey);
      await deleteUpload(`${v.fileKey}.wav`).catch(() => {});
    }
    await db.quiz.deleteMany({ where: { userId: user.id, source: "video", sourceRef: v.id } });
    await db.videoProject.delete({ where: { id: v.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
