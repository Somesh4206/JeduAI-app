// JeduAI — media translation worker.
// Pipeline: (file) extract audio → silence-split → per-chunk ASR → translate → complete.
// Transcript uploads skip extraction/ASR and go straight to translation.
import "server-only";
import path from "path";
import { db } from "@/lib/db";
import { translateArray } from "./ai";
import { recordActivity } from "./gamify";
import {
  clipWav,
  extractMonoWav,
  probeDurationSec,
  silenceSplit,
  readUpload,
  uploadExists,
} from "./media";
import { deleteUpload } from "./files";

const active = new Set<string>();

export function isVideoProcessing(id: string) {
  return active.has(id);
}

function wavKeyOf(fileKey: string) {
  return `${fileKey}.wav`;
}

async function asrChunk(key: string): Promise<string> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const zai = await ZAI.create();
  const buf = await readUpload(key);
  const result = await zai.audio.asr.create({ file_base64: buf.toString("base64") });
  const text = (result as { text?: string })?.text;
  if (!text || !text.trim()) throw new Error("empty transcript");
  return text.trim();
}

export async function processVideo(projectId: string) {
  if (active.has(projectId)) return;
  active.add(projectId);
  try {
    let proj = await db.videoProject.findUnique({ where: { id: projectId } });
    if (!proj) return;

    const fail = async (msg: string) => {
      await db.videoProject.update({
        where: { id: projectId },
        data: { status: "failed", error: msg, updatedAt: new Date() },
      });
      await db.notification.create({
        data: {
          userId: proj!.userId,
          title: "⚠️ Media translation needs attention",
          body: `"${proj!.title}": ${msg} Open the project and tap Retry.`,
          kind: "job",
        },
      }).catch(() => {});
    };

    // ---- Stage: extract & split & transcribe (only for uploaded media files)
    if (proj.status === "extracting" || proj.status === "transcribing") {
      const fileKey = proj.fileKey;
      if (!fileKey) return await fail("Source file is missing.");
      if (!(await uploadExists(fileKey))) return await fail("Source file is missing.");
      const wk = wavKeyOf(fileKey);
      try {
        if (!(await uploadExists(wk))) {
          await extractMonoWav(fileKey, wk);
        }
        let duration = await probeDurationSec(wk);
        if (!duration) duration = proj.durationSec || 0;
        await db.videoProject.update({
          where: { id: projectId },
          data: { durationSec: duration, status: "transcribing", progress: Math.max(proj.progress, 12), updatedAt: new Date() },
        });

        // existing rows (resume case)
        let rows = await db.videoSegment.findMany({ where: { videoId: projectId }, orderBy: { idx: "asc" } });
        if (!rows.length) {
          const segs = await silenceSplit(wk, duration, {
            maxSegments: 40,
            minGap: 0.7,
            minSpeech: 0.9,
          });
          // split any >60s segment into <=30s chunks
          const plan: { start: number; end: number }[] = [];
          for (const s of segs) {
            const span = s.end - s.start;
            if (span <= 62) {
              plan.push(s);
            } else {
              const pieces = Math.ceil(span / 30);
              const size = span / pieces;
              for (let i = 0; i < pieces; i++) plan.push({ start: s.start + i * size, end: i === pieces - 1 ? s.end : s.start + (i + 1) * size });
            }
          }
          await db.videoSegment.createMany({
            data: plan.map((p, i) => ({
              videoId: projectId,
              idx: i,
              startSec: p.start,
              endSec: p.end,
              original: "",
            })),
          });
          rows = await db.videoSegment.findMany({ where: { videoId: projectId }, orderBy: { idx: "asc" } });
        }

        const pending = rows.filter((r) => !r.original);
        const total = rows.length;
        const done0 = total - pending.length;
        for (let i = 0; i < pending.length; i++) {
          const seg = pending[i];
          const clipKey = `${wk}.c${String(seg.idx).padStart(3,"0")}.wav`;
          try {
            await clipWav(wk, clipKey, seg.startSec, Math.max(seg.startSec + 0.4, seg.endSec));
            const text = await asrChunk(clipKey);
            await db.videoSegment.update({ where: { id: seg.id }, data: { original: text } });
            await deleteUpload(clipKey);
          } catch (asrErr) {
            console.error("[mediaworker] segment ASR failed:", seg.idx, (asrErr as Error)?.message || asrErr);
            await deleteUpload(clipKey).catch(() => {});
            // leave empty; collected as failure afterwards
          }
          const done = done0 + i + 1;
          await db.videoProject.update({
            where: { id: projectId },
            data: { progress: Math.min(58, 12 + Math.round((done / total) * 46)), updatedAt: new Date() },
          });
        }

        rows = await db.videoSegment.findMany({ where: { videoId: projectId }, orderBy: { idx: "asc" } });
        const empty = rows.filter((r) => !r.original);
        if (empty.length) {
          return await fail(
            `${empty.length} of ${rows.length} audio segment${empty.length > 1 ? "s" : ""} could not be transcribed.`
          );
        }
        await db.videoProject.update({
          where: { id: projectId },
          data: { status: "translating", progress: 60, updatedAt: new Date() },
        });
        proj = await db.videoProject.findUnique({ where: { id: projectId } });
        if (!proj) return;
      } catch (err) {
        return await fail("Audio processing failed. The file may be corrupted or an unsupported codec.");
      }
    }

    // ---- Stage: translate
    if (proj.status === "translating") {
      const rows = await db.videoSegment.findMany({ where: { videoId: projectId }, orderBy: { idx: "asc" } });
      const todo = rows.filter((r) => !r.translated && r.original);
      if (!todo.length) {
        // nothing to translate — maybe all done earlier; fall through to complete
      } else {
        try {
          const BATCH = 6;
          for (let i = 0; i < todo.length; i += BATCH) {
            const slice = todo.slice(i, i + BATCH);
            const outs = await translateArray(
              slice.map((s) => s.original),
              proj.sourceLang,
              proj.targetLang
            );
            for (let j = 0; j < slice.length; j++) {
              if (outs[j]) await db.videoSegment.update({ where: { id: slice[j].id }, data: { translated: outs[j] } });
            }
            const doneCount = i + slice.length;
            await db.videoProject.update({
              where: { id: projectId },
              data: {
                progress: Math.min(97, 60 + Math.round((doneCount / todo.length) * 37)),
                updatedAt: new Date(),
              },
            });
          }
        } catch {
          return await fail("Translation step failed.");
        }
      }

      const rows2 = await db.videoSegment.findMany({ where: { videoId: projectId } });
      const missing = rows2.filter((r) => !r.translated);
      if (missing.length) return await fail(`${missing.length} segments still untranslated.`);

      // cleanup temp wav
      if (proj.fileKey) await deleteUpload(wavKeyOf(proj.fileKey));

      await db.videoProject.update({
        where: { id: projectId },
        data: { status: "completed", progress: 100, error: null, updatedAt: new Date() },
      });
      const pts = proj.kind === "transcript" ? 10 : 20;
      await recordActivity(proj.userId, "zero", pts, { kind: proj.kind });
      await db.notification.create({
        data: {
          userId: proj.userId,
          title: "🎬 Media translation complete!",
          body: `"${proj.title}" is now available in ${proj.targetLang}.`,
          kind: "job",
        },
      }).catch(() => {});
    }
  } finally {
    active.delete(projectId);
  }
}
