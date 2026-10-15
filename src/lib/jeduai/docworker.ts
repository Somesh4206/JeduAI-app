// JeduAI — document translation worker.
// Translates sections sequentially with per-call progress persistence.
import "server-only";
import { db } from "@/lib/db";
import { translateText } from "./ai";
import { recordActivity } from "./gamify";

const active = new Set<string>();

export function isProcessing(id: string) {
  return active.has(id);
}

export async function processDocument(documentId: string) {
  if (active.has(documentId)) return;
  active.add(documentId);
  try {
    const doc = await db.document.findUnique({ where: { id: documentId }, include: { sections: true } });
    if (!doc) return;
    if (doc.status !== "translating" && doc.status !== "completed") {
      return;
    }
    const sections = doc.sections.sort((a, b) => a.idx - b.idx);
    const total = sections.length;
    let done = sections.filter((s) => s.status === "done").length;

    for (const s of sections) {
      if (s.status === "done") continue;
      // re-fetch to honor retry reset
      const fresh = await db.documentSection.findUnique({ where: { id: s.id } });
      if (!fresh || fresh.status === "done") continue;
      try {
        const r = await translateText({
          text: fresh.heading ? `${fresh.heading}\n\n${fresh.original}` : fresh.original,
          from: doc.sourceLang,
          to: doc.targetLang,
          mode: "direct",
        });
        await db.documentSection.update({ where: { id: fresh.id }, data: { translated: r.translated, status: "done" } });
        done += 1;
      } catch (err) {
        try {
          await db.documentSection.update({ where: { id: fresh.id }, data: { status: "failed" } });
        } catch {
          /* the section was replaced by a concurrent OCR re-run — nothing to mark; skip it */
        }
        await db.document
          .update({
            where: { id: documentId },
            data: {
              error: "One or more sections failed to translate. Use Retry on the failed section.",
              progress: Math.round((done / total) * 100),
            },
          })
          .catch(() => {});
        continue;
      }
      await db.document.update({
        where: { id: documentId },
        data: { progress: Math.min(99, Math.round((done / total) * 100)) },
      });
    }

    const afterSections = await db.documentSection.findMany({ where: { documentId } });
    const allDone = afterSections.every((s) => s.status === "done");
    const anyFailed = afterSections.some((s) => s.status === "failed");
    if (allDone) {
      await db.document.update({
        where: { id: documentId },
        data: { status: "completed", progress: 100, error: null, updatedAt: new Date() },
      });
      await recordActivity(doc.userId, "document_done");
      await db.notification.create({
        data: {
          userId: doc.userId,
          title: "📄 Document translated!",
          body: `"${doc.title}" is ready to read in ${doc.targetLang}.`,
          kind: "job",
        },
      });
    } else if (anyFailed) {
      await db.document.update({
        where: { id: documentId },
        data: { status: "failed", progress: Math.round((afterSections.filter((s) => s.status === "done").length / afterSections.length) * 100) },
      });
    }
  } finally {
    active.delete(documentId);
  }
}
