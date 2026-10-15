// JeduAI — OCR worker (scanned PDFs & image documents).
// Rasterizes saved uploads page-by-page, transcribes each page with the
// vision model, then feeds the recovered text into the normal document
// translation pipeline.
import "server-only";
import { db } from "@/lib/db";
import { ocrImage } from "./ai";
import { chunkIntoSections, readUpload, uploadExists, imageToJpegBase64, rasterizePdfPages } from "./files";
import { processDocument } from "./docworker";
import { OCR_LIMITS } from "./constants";
import { recordActivity } from "./gamify";

const active = new Set<string>();

export function isOcrProcessing(id: string) {
  return active.has(id);
}

export async function runOcrDocument(documentId: string) {
  if (active.has(documentId)) return;
  active.add(documentId);
  try {
    const doc = await db.document.findUnique({ where: { id: documentId } });
    if (!doc || !doc.fileKey || !(await uploadExists(doc.fileKey))) return;
    if (doc.status !== "ocr") return; // only run from the ocr state

    await db.document.update({
      where: { id: documentId },
      data: { status: "ocr", progress: 4, error: null },
    });

    const buf = await readUpload(doc.fileKey);

    // 1) page images — honour the page range chosen at upload (e.g. "3-10")
    let ocrFrom = 1;
    let ocrTo = OCR_LIMITS.maxPages;
    if (doc.fileType === "pdf" && doc.pageRange) {
      const m = /^(\d+)-(\d+)$/.exec(doc.pageRange);
      if (m) {
        ocrFrom = Math.max(1, parseInt(m[1], 10));
        ocrTo = Math.max(ocrFrom, parseInt(m[2], 10));
      }
    }
    let pages: { base64: string }[];
    try {
      pages = doc.fileType === "pdf" ? await rasterizePdfPages(buf, ocrFrom, ocrTo) : [{ base64: (await imageToJpegBase64(buf)).base64 }];
    } catch {
      await db.document.update({
        where: { id: documentId },
        data: { status: "failed", progress: 0, error: "Could not open this file for OCR. It may be corrupted — try re-uploading." },
      });
      return;
    }
    if (!pages.length) {
      await db.document.update({
        where: { id: documentId },
        data: { status: "failed", progress: 0, error: "No pages could be rendered from this file." },
      });
      return;
    }

    // 2) transcribe each page (progress 10 → 85)
    const texts: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      let text = "";
      try {
        text = await ocrImage({
          base64: pages[i].base64,
          mime: "image/jpeg",
          page: doc.fileType === "pdf" ? ocrFrom + i : i + 1, // real PDF page number
          totalPages: doc.fileType === "pdf" && doc.pageRange ? `${ocrFrom}–${ocrTo}` : String(pages.length),
        });
      } catch {
        text = ""; // a failed page shouldn't sink the whole document
      }
      texts.push(text);
      await db.document.update({
        where: { id: documentId },
        data: { progress: 10 + Math.round((75 * (i + 1)) / pages.length) },
      });
    }

    const full = texts.filter(Boolean).join("\n\n");
    if (full.replace(/\s/g, "").length < 40) {
      await db.document.update({
        where: { id: documentId },
        data: {
          status: "failed",
          progress: 0,
          error: "AI vision read the page(s) but found no readable text. If the scan is very faint or handwritten, try a clearer photo.",
        },
      });
      await db.notification.create({
        data: {
          userId: doc.userId,
          title: "⚠️ OCR couldn't read your document",
          body: `"${doc.title}" — the scan quality was too low to extract text.`,
          kind: "job",
        },
      });
      return;
    }

    // 3) chunk + queue translation
    const sections = chunkIntoSections(full);
    if (!sections.length) {
      await db.document.update({
        where: { id: documentId },
        data: { status: "failed", progress: 0, error: "OCR finished but produced no usable sections." },
      });
      return;
    }
    await db.documentSection.deleteMany({ where: { documentId } });
    await db.documentSection.createMany({
      data: sections.map((s, i) => ({
        documentId,
        idx: i,
        heading: s.heading,
        original: s.text,
        status: "pending",
      })),
    });
    await db.document.update({
      where: { id: documentId },
      data: { status: "translating", progress: 88, error: null, updatedAt: new Date() },
    });
    await recordActivity(doc.userId, "zero", 0, { ocr: doc.fileName, pages: pages.length });

    // 4) straight into the normal translation pipeline
    await processDocument(documentId);
  } catch (err) {
    // conditional update: never flip a document that a concurrent pass already
    // completed or reset (dev-mode module duplication can race two OCR runs)
    await db.document
      .updateMany({
        where: { id: documentId, status: { in: ["ocr", "translating"] } },
        data: { status: "failed", progress: 0, error: `OCR failed: ${(err as Error).message}` },
      })
      .catch(() => {});
  } finally {
    active.delete(documentId);
  }
}

export const OCR_PAGE_LIMIT = OCR_LIMITS.maxPages;
