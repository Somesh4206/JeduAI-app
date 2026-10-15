import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { DOC_LIMITS, LANG_NAMES, OCR_LIMITS } from "@/lib/jeduai/constants";
import { extractDocumentText, chunkIntoSections, saveUpload, isImageFile, pdfPageCount } from "@/lib/jeduai/files";
import { processDocument } from "@/lib/jeduai/docworker";
import { runOcrDocument } from "@/lib/jeduai/ocrworker";

export async function GET() {
  try {
    const user = await requireUser();
    const documents = await db.document.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 60,
      include: { sections: { select: { id: true, status: true } } },
    });
    return NextResponse.json({
      documents: documents.map((d) => ({
        id: d.id,
        title: d.title,
        fileName: d.fileName,
        fileType: d.fileType,
        sizeKB: d.sizeKB,
        sourceLang: d.sourceLang,
        targetLang: d.targetLang,
        status: d.status,
        progress: d.progress,
        error: d.error,
        pageRange: d.pageRange,
        sections: d.sections.length,
        sectionsDone: d.sections.filter((s) => s.status === "done").length,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

// Parse a user-supplied page range like "3", "3-10" or "9 - 16".
// Returns null when absent/invalid. Caller clamps against the real page count.
function parsePageRange(raw: string): { from: number; to: number } | null {
  const m = /^\s*(\d{1,4})\s*(?:-|–|to|bis)?\s*(\d{0,4})\s*$/i.exec(raw);
  if (!m) return null;
  const from = parseInt(m[1], 10);
  const to = m[2] ? parseInt(m[2], 10) : from;
  if (!from || from < 1 || to < from) return null;
  return { from, to: Math.max(to, from) };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`docupload:${user.id}`, 6, 10 * 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many uploads. Please wait a few minutes." }, { status: 429 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const sourceLang = String(form.get("sourceLang") || "English");
    const targetLang = String(form.get("targetLang") || user.explanationLang || "Hindi");
    const title = String(form.get("title") || "").trim().slice(0, 90);
    const pages = parsePageRange(String(form.get("pages") || ""));

    if (!file) return NextResponse.json({ error: "Choose a file to upload" }, { status: 400 });
    if (file.size > DOC_LIMITS.maxMB * 1024 * 1024) {
      return NextResponse.json({ error: `File is too large. Maximum ${DOC_LIMITS.maxMB} MB.` }, { status: 400 });
    }
    if (!LANG_NAMES.includes(sourceLang) || !LANG_NAMES.includes(targetLang)) {
      return NextResponse.json({ error: "Pick valid source and target languages" }, { status: 400 });
    }
    // No-op guard: translating a document into its own language wastes the
    // upload and the whole background pipeline.
    if (sourceLang === targetLang) {
      const suggestion =
        user.interfaceLang !== targetLang && LANG_NAMES.includes(user.interfaceLang)
          ? user.interfaceLang
          : "Hindi" !== targetLang
            ? "Hindi"
            : LANG_NAMES.find((l) => l !== targetLang) || "English";
      return NextResponse.json(
        {
          error: `Source and target are both ${targetLang} — the document would come back unchanged. Pick a different target language.`,
          suggestion,
        },
        { status: 422 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.toLowerCase().split(".").pop() || "txt").replace(/[^a-z0-9]/g, "").slice(0, 5);

    // ---------- images: photo / scan of a page -> OCR pipeline ----------
    if (isImageFile(file.name, file.type || "")) {
      if (file.size > OCR_LIMITS.imageMaxKB * 1024) {
        return NextResponse.json(
          { error: `Image is too large for OCR — maximum ${Math.round(OCR_LIMITS.imageMaxKB / 1024)} MB.` },
          { status: 400 }
        );
      }
      const doc = await db.document.create({
        data: {
          userId: user.id,
          title: title || file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          fileType: ext,
          fileKey: `doc-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sizeKB: Math.round(file.size / 1024),
          sourceLang,
          targetLang,
          status: "ocr",
          progress: 2,
        },
      });
      await saveUpload(doc.fileKey!, buf);
      after(async () => {
        await runOcrDocument(doc.id);
      });
      return NextResponse.json(
        { document: { id: doc.id, status: "ocr" } },
        { status: 201 }
      );
    }

    let extracted;
    try {
      extracted = await extractDocumentText(file.name, buf, file.type || "");
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    // ---------- scanned PDF (no selectable text) -> OCR pipeline ----------
    if (extracted.needsOcr) {
      // work out which pages AI vision should read (default: the first maxPages)
      const total = await pdfPageCount(buf);
      let from = 1;
      let to = Math.min(OCR_LIMITS.maxPages, total || OCR_LIMITS.maxPages);
      if (pages) {
        from = Math.min(pages.from, Math.max(1, total || pages.from));
        to = Math.min(pages.to, total || pages.to);
        // keep the span within the OCR page budget (counting from the start page)
        to = Math.min(to, from + OCR_LIMITS.maxPages - 1);
        if (to < from) to = from;
      }
      const doc = await db.document.create({
        data: {
          userId: user.id,
          title: title || file.name,
          fileName: file.name,
          fileType: ext,
          fileKey: `doc-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          pageRange: `${from}-${to}`,
          sizeKB: Math.round(file.size / 1024),
          sourceLang,
          targetLang,
          status: "ocr",
          progress: 2,
        },
      });
      await saveUpload(doc.fileKey!, buf);
      after(async () => {
        await runOcrDocument(doc.id);
      });
      return NextResponse.json(
        {
          document: { id: doc.id, status: "ocr" },
          note:
            total > 0
              ? `Scanned PDF detected — reading ${from === to ? `page ${from}` : `pages ${from}–${to}`} of ${total} with AI vision (OCR), then translating.`
              : `Scanned PDF detected — reading up to ${OCR_LIMITS.maxPages} pages with AI vision (OCR), then translating.`,
        },
        { status: 201 }
      );
    }

    const sections = chunkIntoSections(extracted.text);
    if (!sections.length) {
      return NextResponse.json({ error: "The document appears to be empty." }, { status: 400 });
    }

    const doc = await db.document.create({
      data: {
        userId: user.id,
        title: title || file.name,
        fileName: file.name,
        fileType: ext,
        sizeKB: Math.round(file.size / 1024),
        sourceLang,
        targetLang,
        status: "translating",
        progress: 0,
      },
    });
    await db.documentSection.createMany({
      data: sections.map((s, i) => ({
        documentId: doc.id,
        idx: i,
        heading: s.heading,
        original: s.text,
        status: "pending",
      })),
    });

    after(async () => {
      await processDocument(doc.id);
    });

    return NextResponse.json(
      { document: { id: doc.id, status: "translating", sections: sections.length } },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Upload failed" }, { status: 500 });
  }
}
