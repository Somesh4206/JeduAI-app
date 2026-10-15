import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { processDocument, isProcessing } from "@/lib/jeduai/docworker";
import { runOcrDocument, isOcrProcessing } from "@/lib/jeduai/ocrworker";
import { answerAboutDocument } from "@/lib/jeduai/ai";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { deleteUpload, readUpload, pdfPageCount } from "@/lib/jeduai/files";
import { OCR_LIMITS } from "@/lib/jeduai/constants";

// Parse a user-supplied page range like "3", "3-10" or "9 - 16" (same rules as
// the upload route). Returns null when absent/invalid.
function parsePageRange(raw: string): { from: number; to: number } | null {
  const m = /^\s*(\d{1,4})\s*(?:-|–|to|bis)?\s*(\d{0,4})\s*$/i.exec(raw);
  if (!m) return null;
  const from = parseInt(m[1], 10);
  const to = m[2] ? parseInt(m[2], 10) : from;
  if (!from || from < 1 || to < from) return null;
  return { from, to: Math.max(to, from) };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const doc = await db.document.findFirst({
      where: { id, userId: user.id },
      include: { sections: { orderBy: { idx: "asc" } } },
    });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // drive processing while there are pending sections (only if the pipeline
    // looks stalled — the doc row isn't being touched by a running worker)
    const pending = doc.sections.some((s) => s.status === "pending");
    const stalledMs = Date.now() - doc.updatedAt.getTime();
    if (doc.status === "translating" && pending && !isProcessing(doc.id) && stalledMs > 90_000) {
      after(async () => {
        await processDocument(doc.id);
      });
    }
    // resume a stalled OCR pass (e.g. server restarted mid-OCR); a fresh upload
    // refreshes progress per page, so only a truly stuck job passes this check
    if (doc.status === "ocr" && !isOcrProcessing(doc.id) && stalledMs > 90_000) {
      after(async () => {
        await runOcrDocument(doc.id);
      });
    }

    const bookmarks = await db.bookmark.findMany({
      where: { userId: user.id, sourceType: "document", sourceId: doc.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      document: {
        id: doc.id,
        title: doc.title,
        fileName: doc.fileName,
        fileType: doc.fileType,
        sizeKB: doc.sizeKB,
        pageRange: doc.pageRange,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        status: doc.status,
        progress: doc.progress,
        error: doc.error,
        createdAt: doc.createdAt,
      },
      sections: doc.sections.map((s) => ({
        id: s.id,
        idx: s.idx,
        heading: s.heading,
        original: s.original,
        translated: s.translated,
        status: s.status,
      })),
      bookmarks: bookmarks.map((b) => ({
        id: b.id,
        label: b.label,
        note: b.note,
        sectionIdx: b.sectionIdx,
        kind: b.kind,
        createdAt: b.createdAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const doc = await db.document.findFirst({ where: { id, userId: user.id } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));

    // Ask the AI about this document (RAG-lite: keyword-relevant sections + LLM answer)
    if (body.action === "ask") {
      const q = String(body.question || "").trim().slice(0, 1000);
      if (!q) return NextResponse.json({ error: "Type a question about this document" }, { status: 400 });
      const rl = rateLimit(`dai:${user.id}`, 10, 60_000);
      if (!rl.ok) return NextResponse.json({ error: "Too many AI requests. Wait a moment." }, { status: 429 });
      const sections = await db.documentSection.findMany({ where: { documentId: doc.id }, orderBy: { idx: "asc" } });
      const scored = sections
        .map((s) => {
          const hay = `${s.heading || ""}\n${s.translated || s.original}`.toLowerCase();
          let score = 0;
          for (const w of q.toLowerCase().split(/\W+/).filter((x) => x.length > 3)) {
            const hits = hay.split(w).length - 1;
            score += Math.min(hits, 4);
            if ((s.heading || "").toLowerCase().includes(w)) score += 2;
          }
          return { idx: s.idx, heading: s.heading, text: (s.translated || s.original).slice(0, 1500), score };
        })
        .sort((a, b) => b.score - a.score);
      const picked = (scored[0]?.score ?? 0) > 0 ? scored.slice(0, 6) : scored.slice(0, 4);
      const answer = await answerAboutDocument(
        q,
        picked.map((p) => ({ idx: p.idx, heading: p.heading, text: p.text })),
        doc.targetLang
      );
      return NextResponse.json({ answer, sectionsUsed: picked.map((p) => p.idx) });
    }

    if (typeof body.sectionIdx === "number" && body.action === "retry") {
      const sec = await db.documentSection.findFirst({ where: { documentId: doc.id, idx: body.sectionIdx } });
      if (!sec) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      await db.documentSection.update({ where: { id: sec.id }, data: { status: "pending" } });
      await db.document.update({ where: { id: doc.id }, data: { status: "translating", error: null } });
      after(async () => {
        await processDocument(doc.id);
      });
      return NextResponse.json({ ok: true });
    }

    // Retry a failed OCR pass (scanned pdf / image document).
    // Optional "pages" ("3" / "3-10") re-picks which pages AI vision reads —
    // clamped to the real page count and the OCR budget, persisted to pageRange.
    if (body.action === "ocr-retry") {
      if (doc.status !== "failed" && doc.status !== "needs_ocr") {
        return NextResponse.json({ error: "OCR retry is only available for failed documents." }, { status: 400 });
      }
      let pageRange: string | undefined;
      if (typeof body.pages === "string" && body.pages.trim() && doc.fileType === "pdf" && doc.fileKey) {
        const parsed = parsePageRange(body.pages);
        if (!parsed) return NextResponse.json({ error: "Page range looks invalid — try “3” or “3-10”." }, { status: 400 });
        const buf = await readUpload(doc.fileKey).catch(() => null);
        const total = buf ? await pdfPageCount(buf).catch(() => 0) : 0;
        let from = Math.min(parsed.from, Math.max(1, total || parsed.from));
        let to = Math.min(parsed.to, total || parsed.to);
        if (to - from + 1 > OCR_LIMITS.maxPages) to = from + OCR_LIMITS.maxPages - 1;
        pageRange = `${from}-${to}`;
      }
      await db.document.update({
        where: { id: doc.id },
        data: { status: "ocr", progress: 2, error: null, ...(pageRange ? { pageRange } : {}) },
      });
      after(async () => {
        await runOcrDocument(doc.id);
      });
      return NextResponse.json({ ok: true, ...(pageRange ? { pageRange } : {}) });
    }

    if (body.action === "bookmark" && typeof body.sectionIdx === "number") {
      const label = String(body.label || "").slice(0, 120) || `Section ${body.sectionIdx + 1}`;
      const note = body.note ? String(body.note).slice(0, 500) : null;
      const kind = body.kind === "highlight" ? "highlight" : "bookmark";
      const bm = await db.bookmark.create({
        data: {
          userId: user.id,
          kind,
          label,
          note,
          sourceType: "document",
          sourceId: doc.id,
          sectionIdx: body.sectionIdx,
        },
      });
      return NextResponse.json({ bookmark: bm });
    }

    if (typeof body.title === "string") {
      await db.document.update({ where: { id: doc.id }, data: { title: body.title.slice(0, 90) || doc.title } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const doc = await db.document.findFirst({ where: { id, userId: user.id } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    await db.bookmark.deleteMany({ where: { userId: user.id, sourceType: "document", sourceId: doc.id } });
    await db.document.delete({ where: { id: doc.id } });
    if (doc.fileKey) await deleteUpload(doc.fileKey); // clean up saved OCR upload
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
