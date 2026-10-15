// JeduAI Notebook — source ingestion worker.
// Processes a NotebookSource row (status queued) into ready SourceChunks.
// All kinds funnel into the same pipeline: extract pieces -> chunkText ->
// bulk insert chunks -> mark ready + notify. Failures are honest and sticky
// (status failed + notification); PATCH action:"retry" resets and re-queues.
import "server-only";
import { db } from "@/lib/db";
import {
  deleteUpload,
  extractDocumentText,
  imageToJpegBase64,
  pdfPageCount,
  rasterizePdfPages,
  readUpload,
  uploadExists,
} from "../files";
import { clipWav, extractMonoWav, probeDurationSec, silenceSplit } from "../media";
import { ocrImage } from "../ai";
import { chunkText, tokensKey, type RawChunk } from "./retrieval";
import { fetchWebPage, importYouTube } from "./webimport";

const active = new Set<string>();

export function isProcessing(id: string) {
  return active.has(id);
}

// ---------------- helpers ----------------

type Piece = { text: string; page?: number | null; heading?: string | null; startSec?: number | null; endSec?: number | null };

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function wordCountOf(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

/** Titles the web/youtube importers replace with the real title. */
function isDefaultImportTitle(title: string): boolean {
  const t = (title || "").trim().toLowerCase();
  return t === "" || t === "importing…" || t === "importing..." || t === "importing";
}

function friendlyError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err || "")).trim();
  if (/ffmpeg|ffprobe/i.test(msg)) {
    return "Audio processing failed. The file may be corrupted or an unsupported codec.";
  }
  if (!msg) return "Processing failed unexpectedly. Please try again.";
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

async function requireFile(source: { fileKey: string | null }): Promise<Buffer> {
  if (!source.fileKey) throw new Error("The uploaded file is missing.");
  if (!(await uploadExists(source.fileKey))) throw new Error("The uploaded file is missing.");
  return readUpload(source.fileKey);
}

// ---------------- worker ----------------

export async function processSource(sourceId: string): Promise<void> {
  if (active.has(sourceId)) return;
  active.add(sourceId);
  try {
    const source = await db.notebookSource.findUnique({ where: { id: sourceId } });
    if (!source) return;
    if (source.status !== "queued") return; // ready/failed/processing are never re-run implicitly

    const meta: Record<string, unknown> = parseMeta(source.meta);
    let titleOverride: string | null = null;

    const fail = async (msg: string) => {
      await db
        .notebookSource
        .update({
          where: { id: sourceId },
          data: { status: "failed", error: msg, progress: 0, updatedAt: new Date() },
        })
        .catch(() => {});
      await db
        .notification
        .create({
          data: {
            userId: source.userId,
            title: "⚠️ Notebook source needs attention",
            body: `"${source.title}": ${msg}`,
            kind: "job",
          },
        })
        .catch(() => {});
    };

    const setProgress = (p: number) =>
      db
        .notebookSource
        .update({
          where: { id: sourceId },
          data: { progress: Math.max(1, Math.min(99, Math.round(p))), updatedAt: new Date() },
        })
        .catch(() => {});

    try {
      await db.notebookSource.update({
        where: { id: sourceId },
        data: { status: "processing", progress: 5, error: null, updatedAt: new Date() },
      });

      const pieces: Piece[] = [];

      switch (source.kind) {
        // ---------- uploaded documents ----------
        case "pdf": {
          const buf = await requireFile(source);
          const fileName = String(meta.fileName || "source.pdf");
          const extracted = await extractDocumentText(fileName, buf, "application/pdf");
          if (extracted.needsOcr) {
            const total = await pdfPageCount(buf).catch(() => 0);
            const pageImages = await rasterizePdfPages(buf, 1, Math.min(8, total || 8));
            if (!pageImages.length) {
              throw new Error("This PDF could not be read. It may be corrupt or password-protected.");
            }
            meta.pages = total || pageImages.length;
            meta.ocrPages = `1-${pageImages.length}`;
            if (total > pageImages.length) {
              meta.ocrNote = `Only the first ${pageImages.length} of ${total} pages were read (OCR limit is 8 pages).`;
            }
            for (let i = 0; i < pageImages.length; i++) {
              const text = await ocrImage({
                base64: pageImages[i].base64,
                mime: "image/jpeg",
                page: i + 1,
                totalPages: pageImages.length,
              });
              if (text.trim()) pieces.push({ text, page: i + 1 });
              await setProgress(20 + Math.round(((i + 1) / pageImages.length) * 60));
            }
          } else {
            const rawPages = extracted.text.split("\f"); // pdf-parse separates pages with \f
            for (let i = 0; i < rawPages.length; i++) {
              const t = rawPages[i];
              if (t && t.trim()) pieces.push({ text: t, page: i + 1 });
            }
            const fromMeta = parseInt(extracted.meta.pages || "", 10);
            meta.pages = fromMeta > 0 ? fromMeta : rawPages.length;
          }
          break;
        }

        case "image": {
          const buf = await requireFile(source);
          const { base64 } = await imageToJpegBase64(buf);
          const text = await ocrImage({ base64, mime: "image/jpeg", page: 1, totalPages: 1 });
          if (text.trim()) pieces.push({ text, page: 1 });
          meta.pages = 1;
          meta.ocrPages = "1";
          break;
        }

        case "docx":
        case "txt":
        case "md":
        case "pasted": {
          // pasted sources are stored as a .txt upload at creation time
          const buf = await requireFile(source);
          const fileName = String(meta.fileName || (source.kind === "pasted" ? "pasted.txt" : `source.${source.kind}`));
          const mime = source.kind === "pasted" || source.kind === "txt" || source.kind === "md" ? "text/plain" : "";
          const extracted = await extractDocumentText(fileName, buf, mime);
          if (extracted.text.trim()) pieces.push({ text: extracted.text });
          meta.charCount = extracted.text.length;
          break;
        }

        // ---------- linked sources ----------
        case "web": {
          if (!source.originUrl) throw new Error("This source has no URL.");
          const page = await fetchWebPage(source.originUrl);
          if (page.text.trim()) pieces.push({ text: page.text });
          if (page.siteName) meta.siteName = page.siteName;
          meta.charCount = page.text.length;
          if (isDefaultImportTitle(source.title)) titleOverride = page.title.slice(0, 90);
          break;
        }

        case "youtube": {
          if (!source.originUrl) throw new Error("This source has no URL.");
          const yt = await importYouTube(source.originUrl);
          for (const s of yt.segments) {
            if (s.text.trim()) pieces.push({ text: s.text, startSec: s.startSec, endSec: s.endSec });
          }
          meta.durationSec = yt.durationSec;
          if (yt.author) meta.videoAuthor = yt.author;
          meta.segments = yt.segments.length;
          if (isDefaultImportTitle(source.title)) titleOverride = yt.title.slice(0, 90);
          break;
        }

        // ---------- audio (ASR) ----------
        case "audio": {
          if (!source.fileKey) throw new Error("The uploaded file is missing.");
          if (!(await uploadExists(source.fileKey))) throw new Error("The uploaded file is missing.");
          const wavKey = `${source.fileKey}.wav`;
          try {
            await extractMonoWav(source.fileKey, wavKey);
            const dur = await probeDurationSec(wavKey);
            if (!dur) throw new Error("Could not read the audio. The file may be corrupted or an unsupported codec.");
            meta.durationSec = dur;
            await setProgress(18);

            const segs = await silenceSplit(wavKey, dur, { maxSegments: 40, minGap: 0.7, minSpeech: 0.9 });
            const plan: { start: number; end: number }[] = [];
            for (const s of segs) {
              const span = s.end - s.start;
              if (span <= 62) plan.push(s);
              else {
                const n = Math.ceil(span / 30);
                const size = span / n;
                for (let i = 0; i < n; i++) {
                  plan.push({ start: s.start + i * size, end: i === n - 1 ? s.end : s.start + (i + 1) * size });
                }
              }
            }
            if (!plan.length) throw new Error("No speech was detected in this audio.");

            const { default: ZAI } = await import("z-ai-web-dev-sdk");
            const zai = await ZAI.create();

            let failed = 0;
            for (let i = 0; i < plan.length; i++) {
              const seg = plan[i];
              const clipKey = `${wavKey}.c${String(i).padStart(3, "0")}.wav`;
              let text = "";
              try {
                await clipWav(wavKey, clipKey, seg.start, Math.max(seg.start + 0.4, seg.end));
                const clipBuf = await readUpload(clipKey);
                const r = await zai.audio.asr.create({ file_base64: clipBuf.toString("base64") });
                text = String((r as { text?: string })?.text || "").trim();
              } catch {
                text = "";
              }
              await deleteUpload(clipKey).catch(() => {});
              if (text) pieces.push({ text, startSec: seg.start, endSec: seg.end });
              else failed += 1;
              await setProgress(20 + Math.round(((i + 1) / plan.length) * 65));
            }
            if (failed === plan.length || (failed > 0 && failed / plan.length > 0.3)) {
              throw new Error(`${failed} of ${plan.length} audio segments could not be transcribed.`);
            }
            if (failed > 0) meta.asrGaps = failed;
          } finally {
            await deleteUpload(wavKey).catch(() => {}); // temp wav never outlives the job
          }
          break;
        }

        // ---------- references into existing JeduAI modules ----------
        case "document": {
          if (!source.refId) throw new Error("This source has no document reference.");
          const doc = await db.document.findFirst({ where: { id: source.refId, userId: source.userId } });
          if (!doc) throw new Error("The original document no longer exists.");
          const sections = await db.documentSection.findMany({
            where: { documentId: doc.id },
            orderBy: { idx: "asc" },
          });
          for (const s of sections) {
            const text = (s.translated || s.original || "").trim();
            if (text) pieces.push({ text, heading: s.heading, page: null });
          }
          if (!pieces.length) throw new Error("The original document has no readable content yet.");
          meta.sourceLang = doc.sourceLang;
          meta.targetLang = doc.targetLang;
          break;
        }

        case "videoproject": {
          if (!source.refId) throw new Error("This source has no video reference.");
          const v = await db.videoProject.findFirst({ where: { id: source.refId, userId: source.userId } });
          if (!v) throw new Error("The original video project no longer exists.");
          const segs = await db.videoSegment.findMany({ where: { videoId: v.id }, orderBy: { idx: "asc" } });
          for (const s of segs) {
            const text = (s.original || "").trim();
            if (text) pieces.push({ text, startSec: s.startSec, endSec: s.endSec });
          }
          if (!pieces.length) throw new Error("The original video project has no transcript yet.");
          meta.durationSec = v.durationSec;
          break;
        }

        default:
          throw new Error(`Unsupported source kind "${source.kind}".`);
      }

      // ---------- shared pipeline ----------
      const usable = pieces.filter((p) => p.text && p.text.trim());
      if (!usable.length) {
        return await fail("No readable text could be extracted from this source.");
      }
      const chunks: RawChunk[] = chunkText(usable);
      if (!chunks.length) {
        return await fail("No readable text could be extracted from this source.");
      }

      await setProgress(90);
      await db.sourceChunk.createMany({
        data: chunks.map((c, i) => ({
          sourceId: sourceId,
          notebookId: source.notebookId,
          userId: source.userId,
          idx: i,
          page: c.page ?? null,
          heading: c.heading ?? null,
          startSec: c.startSec ?? null,
          endSec: c.endSec ?? null,
          text: c.text,
          tokens: tokensKey(c.text),
        })),
      });
      await setProgress(95);

      const words = chunks.reduce((n, c) => n + wordCountOf(c.text), 0);
      const finalTitle = titleOverride || source.title;
      try {
        await db.notebookSource.update({
          where: { id: sourceId },
          data: {
            status: "ready",
            progress: 100,
            error: null,
            chunkCount: chunks.length,
            wordCount: words,
            meta: JSON.stringify(meta),
            ...(titleOverride ? { title: titleOverride } : {}),
            updatedAt: new Date(),
          },
        });
      } catch {
        return; // the source was deleted mid-flight — nothing to finish
      }
      await db.notebook.update({ where: { id: source.notebookId }, data: { updatedAt: new Date() } }).catch(() => {});
      await db
        .notification
        .create({
          data: {
            userId: source.userId,
            title: "📚 Notebook source ready",
            body: `"${finalTitle}" was added to your notebook.`,
            kind: "job",
          },
        })
        .catch(() => {});
    } catch (err) {
      return await fail(friendlyError(err));
    }
  } finally {
    active.delete(sourceId);
  }
}
