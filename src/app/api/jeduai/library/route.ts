import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = req.nextUrl.searchParams.get("q") || "";
    const type = req.nextUrl.searchParams.get("type") || "";
    const sort = req.nextUrl.searchParams.get("sort") || "recent";

    const [documents, videos, quizzes, conversations, translations, bookmarks, tasks, flashcards, vocabWords] = await Promise.all([
      db.document.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
      db.videoProject.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
      db.quiz.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: { questions: { select: { id: true } }, attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
      }),
      db.conversation.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
      db.translationRecord.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
      db.bookmark.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
      db.studyTask.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } }),
      db.flashcard.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
      db.vocabWord.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    ]);

    type Item = {
      type: string;
      id: string;
      title: string;
      subtitle: string;
      status?: string;
      progress?: number;
      score?: number;
      at: Date;
      sourceType?: string | null;
      sourceId?: string | null;
      sectionIdx?: number | null;
    };
    const fmtSize = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);
    let items: Item[] = [];

    for (const d of documents)
      items.push({
        type: "document",
        id: d.id,
        title: d.title,
        subtitle: `${d.sourceLang} → ${d.targetLang} · ${d.fileType.toUpperCase()} · ${fmtSize(d.sizeKB)}`,
        status: d.status,
        progress: d.progress,
        at: d.updatedAt,
      });
    for (const v of videos)
      items.push({
        type: "video",
        id: v.id,
        title: v.title,
        subtitle: `${v.sourceLang} → ${v.targetLang} · ${v.kind}`,
        status: v.status,
        progress: v.progress,
        at: v.updatedAt,
      });
    for (const qz of quizzes)
      items.push({
        type: "quiz",
        id: qz.id,
        title: qz.title,
        subtitle: `${qz.subject} · ${qz.difficulty} · ${qz.questions.length} questions`,
        score: qz.attempts[0]?.score,
        status: qz.attempts[0] ? `${qz.attempts[0].score}/${qz.attempts[0].total}` : "new",
        at: qz.createdAt,
      });
    for (const c of conversations)
      items.push({
        type: "conversation",
        id: c.id,
        title: c.title,
        subtitle: `AI Tutor · ${c.subject}`,
        at: c.updatedAt,
      });
    for (const t of translations)
      items.push({
        type: "translation",
        id: t.id,
        title: t.sourceText.replace(/\s+/g, " ").slice(0, 60),
        subtitle: `${t.sourceLang} → ${t.targetLang} · ${t.mode === "learning" ? "Learning" : "Direct"}${t.saved ? " · saved" : ""}`,
        at: t.createdAt,
      });
    for (const b of bookmarks)
      items.push({
        type: "bookmark",
        id: b.id,
        title: b.label,
        subtitle: `${b.kind === "highlight" ? "Highlight" : "Bookmark"}${b.sourceType ? ` · ${b.sourceType}` : ""}${b.note ? " · note" : ""}`,
        at: b.createdAt,
        sourceType: b.sourceType,
        sourceId: b.sourceId,
        sectionIdx: b.sectionIdx,
      });
    for (const t of tasks.filter((t) => t.done))
      items.push({ type: "task", id: t.id, title: t.title, subtitle: `Study task · ${t.subject} · ${t.minutes} min`, at: t.createdAt });

    // flashcard decks (grouped by source)
    const deckMap = new Map<string, { deckTitle: string; sourceType: string; sourceId: string | null; total: number; due: number; learned: number; at: Date }>();
    const now = new Date();
    for (const c of flashcards) {
      const key = `${c.sourceType}:${c.sourceId || ""}`;
      let d = deckMap.get(key);
      if (!d) {
        d = { deckTitle: c.deckTitle, sourceType: c.sourceType, sourceId: c.sourceId, total: 0, due: 0, learned: 0, at: c.createdAt };
        deckMap.set(key, d);
      }
      d.total++;
      if (c.dueAt <= now) d.due++;
      if (c.box >= 4) d.learned++;
      if (c.updatedAt > d.at) d.at = c.updatedAt;
    }
    for (const [key, d] of deckMap)
      items.push({
        type: "flashcards",
        id: key,
        title: d.deckTitle,
        subtitle: `${d.total} flashcards · ${d.learned} mastered${d.due ? ` · ${d.due} due` : ""}`,
        status: d.due ? `${d.due} due` : "reviewed",
        at: d.at,
        sourceType: d.sourceType,
        sourceId: d.sourceId,
      });

    // vocabulary (one aggregated row)
    if (vocabWords.length) {
      const vwNow = new Date();
      const vwMastered = vocabWords.filter((w) => w.mastered).length;
      const vwDue = vocabWords.filter((w) => !w.mastered && w.dueAt <= vwNow).length;
      const latest = vocabWords.reduce((acc, w) => (w.updatedAt > acc ? w.updatedAt : acc), vocabWords[0].updatedAt);
      items.push({
        type: "vocab",
        id: "vocab",
        title: "Vocabulary",
        subtitle: `${vocabWords.length} words · ${vwMastered} mastered${vwDue ? ` · ${vwDue} due` : ""}`,
        status: vwDue ? `${vwDue} due` : "on track",
        at: latest,
      });
    }

    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((i) => i.title.toLowerCase().includes(needle) || i.subtitle.toLowerCase().includes(needle));
    }
    if (type && type !== "all") items = items.filter((i) => i.type === type);
    if (sort === "title") items.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "type") items.sort((a, b) => a.type.localeCompare(b.type) || +b.at - +a.at);
    else items.sort((a, b) => +b.at - +a.at);

    return NextResponse.json({ items: items.slice(0, 200), total: items.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").slice(0, 90);
    if (!body.type || !body.id || !title) return NextResponse.json({ error: "Invalid rename request" }, { status: 400 });
    if (body.type === "document") {
      const d = await db.document.findFirst({ where: { id: String(body.id), userId: user.id } });
      if (d) await db.document.update({ where: { id: d.id }, data: { title } });
    } else if (body.type === "video") {
      const v = await db.videoProject.findFirst({ where: { id: String(body.id), userId: user.id } });
      if (v) await db.videoProject.update({ where: { id: v.id }, data: { title } });
    } else if (body.type === "quiz") {
      const qz = await db.quiz.findFirst({ where: { id: String(body.id), userId: user.id } });
      if (qz) await db.quiz.update({ where: { id: qz.id }, data: { title } });
    } else if (body.type === "conversation") {
      const c = await db.conversation.findFirst({ where: { id: String(body.id), userId: user.id } });
      if (c) await db.conversation.update({ where: { id: c.id }, data: { title } });
    } else {
      return NextResponse.json({ error: "Unsupported type" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    if (!body.type || !body.id) return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
    const id = String(body.id);
    if (body.type === "document") {
      const d = await db.document.findFirst({ where: { id, userId: user.id } });
      if (d) await db.document.delete({ where: { id: d.id } });
    } else if (body.type === "video") {
      const v = await db.videoProject.findFirst({ where: { id, userId: user.id } });
      if (v) {
        if (v.fileKey) {
          const { deleteUpload } = await import("@/lib/jeduai/files");
          await deleteUpload(v.fileKey).catch(() => {});
          await deleteUpload(`${v.fileKey}.wav`).catch(() => {});
        }
        await db.videoProject.delete({ where: { id: v.id } });
      }
    } else if (body.type === "quiz") {
      const qz = await db.quiz.findFirst({ where: { id, userId: user.id } });
      if (qz) await db.quiz.delete({ where: { id: qz.id } });
    } else if (body.type === "conversation") {
      const c = await db.conversation.findFirst({ where: { id, userId: user.id } });
      if (c) await db.conversation.delete({ where: { id: c.id } });
    } else if (body.type === "translation") {
      const t = await db.translationRecord.findFirst({ where: { id, userId: user.id } });
      if (t) await db.translationRecord.delete({ where: { id: t.id } });
    } else if (body.type === "bookmark") {
      const b = await db.bookmark.findFirst({ where: { id, userId: user.id } });
      if (b) await db.bookmark.delete({ where: { id: b.id } });
    } else {
      return NextResponse.json({ error: "Unsupported type" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
