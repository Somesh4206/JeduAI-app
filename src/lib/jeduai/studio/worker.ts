// JeduAI Notebook Studio — artifact generation worker.
// Dispatches the 9 artifact kinds: LLM generators for content, real TTS audio +
// ffmpeg still-image scenes for the overviews, flashcard/quiz persistence into
// the existing JeduAI modules. Active-set guard, progress persistence, cancel
// checks between expensive steps, temp-file cleanup in finally.
import "server-only";
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { probeDurationSec } from "@/lib/jeduai/media";
import { deleteUpload, saveUpload, UPLOAD_DIR } from "@/lib/jeduai/files";
import { recordActivity } from "@/lib/jeduai/gamify";
import { SUBJECTS } from "@/lib/jeduai/constants";
import { renderSlideSVG } from "./render";
import {
  gatherEvidence,
  generateAudioScript,
  generateFlashcardCards,
  generateInfographic,
  generateMindMap,
  generateQuizArtifact,
  generateReport,
  generateSlides,
  generateStoryboard,
  generateTable,
  type QuizArtifactQuestion,
} from "./generators";
import { concatMp4s, concatWavs, runFfmpeg, synthesizeWav, TTS_VOICES, wavToMp3 } from "./tts";
import type {
  ArtifactDTO,
  ArtifactKind,
  ArtifactStatus,
  AudioOverviewContent,
  Citation,
  FlashcardsContent,
  InfographicContent,
  MindMapContent,
  QuizContent,
  ReportContent,
  SlidesContent,
  TableContent,
  VideoOverviewContent,
} from "@/lib/jeduai/notebook/types";

const active = new Set<string>();

function ff(key: string) {
  return path.join(UPLOAD_DIR, key);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function safeParse(s: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function cfgStr(v: unknown, max = 200): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

export function isArtifactRunning(artifactId: string) {
  return active.has(artifactId);
}

/** Map a NotebookArtifact row to the API DTO. `full` includes the parsed content
 *  regardless of size; the list view omits content unless ready && < 60 KB. */
export function toArtifactDTO(
  a: {
    id: string;
    notebookId: string;
    kind: string;
    title: string;
    status: string;
    progress: number;
    error: string | null;
    config: string;
    content: string | null;
    fileKey: string | null;
    sourceIds: string;
    refType: string | null;
    refId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  full = false
): ArtifactDTO {
  let config: Record<string, unknown> = {};
  try {
    const v = JSON.parse(a.config || "{}");
    if (v && typeof v === "object") config = v as Record<string, unknown>;
  } catch {}
  let parsed: Record<string, unknown> | null = null;
  try {
    const v = a.content ? JSON.parse(a.content) : null;
    if (v && typeof v === "object") parsed = v as Record<string, unknown>;
  } catch {}
  const rawLen = a.content?.length ?? 0;
  const includeContent = full || (a.status === "ready" && rawLen > 0 && rawLen < 60000);
  let sourceIds: string[] = [];
  try {
    const v = JSON.parse(a.sourceIds || "[]");
    if (Array.isArray(v)) sourceIds = v.filter((x): x is string => typeof x === "string");
  } catch {}
  return {
    id: a.id,
    notebookId: a.notebookId,
    kind: a.kind as ArtifactKind,
    title: a.title,
    status: a.status as ArtifactStatus,
    progress: a.progress,
    error: a.error,
    config,
    content: includeContent ? parsed : null,
    hasMedia: !!a.fileKey,
    mediaType: a.kind === "audio-overview" ? "audio" : a.kind === "video-overview" ? "video" : null,
    mediaDurationSec: parsed && typeof parsed.durationSec === "number" ? parsed.durationSec : null,
    refType: (a.refType as "quiz" | "deck" | null) ?? null,
    refId: a.refId,
    sourceIds,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : new Date(a.createdAt).toISOString(),
    updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : new Date(a.updatedAt).toISOString(),
  };
}

export async function runArtifact(artifactId: string): Promise<void> {
  if (active.has(artifactId)) return;
  active.add(artifactId);
  const tempKeys = new Set<string>();
  try {
    const artifact0 = await db.notebookArtifact.findUnique({ where: { id: artifactId } });
    if (!artifact0 || !["queued", "processing"].includes(artifact0.status)) return;
    const userId = artifact0.userId;
    const notebookId = artifact0.notebookId;

    // sweep temp files left behind by a previous crashed run of this artifact
    try {
      const files = await fs.readdir(UPLOAD_DIR);
      await Promise.all(
        files.filter((f) => f.startsWith(`nbtmp-${artifactId}-`)).map((f) => fs.unlink(path.join(UPLOAD_DIR, f)).catch(() => {}))
      );
    } catch {}

    const update = async (patch: Record<string, unknown>) => {
      await db.notebookArtifact
        .update({ where: { id: artifactId }, data: { ...patch, updatedAt: new Date() } })
        .catch(() => {});
    };
    const fail = async (msg: string) => {
      await db.notebookArtifact
        .update({ where: { id: artifactId }, data: { status: "failed", error: String(msg).slice(0, 480), updatedAt: new Date() } })
        .catch(() => {});
      await db.notification
        .create({
          data: {
            userId,
            title: "⚠️ Studio generation failed",
            body: `"${artifact0.title}": ${msg}`.slice(0, 280),
            kind: "job",
          },
        })
        .catch(() => {});
    };
    const cancelled = async () => {
      const a = await db.notebookArtifact.findUnique({ where: { id: artifactId }, select: { cancelRequested: true } });
      return a?.cancelRequested === true;
    };
    const notify = async (title: string, body: string) => {
      await db.notification.create({ data: { userId, title, body: body.slice(0, 280), kind: "job" } }).catch(() => {});
    };
    const touchNotebook = async () => {
      await db.notebook.update({ where: { id: notebookId }, data: { updatedAt: new Date() } }).catch(() => {});
    };
    const markReady = async (contentJson: string, extra: Record<string, unknown> = {}) => {
      await db.notebookArtifact.update({
        where: { id: artifactId },
        data: { status: "ready", progress: 100, error: null, content: contentJson, updatedAt: new Date(), ...extra },
      });
      await touchNotebook();
    };

    await update({ status: "processing", progress: 3, error: null, cancelRequested: false });

    const config = safeParse(artifact0.config);
    const sourceIds = (() => {
      try {
        const v = JSON.parse(artifact0.sourceIds || "[]");
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      } catch {
        return [];
      }
    })();
    const lang = typeof config.lang === "string" ? config.lang : "English";
    const topic = cfgStr(config.topic, 120);

    let evidence: Awaited<ReturnType<typeof gatherEvidence>>;
    try {
      evidence = await gatherEvidence({ notebookId, userId, sourceIds, topic });
    } catch (e) {
      return await fail((e as Error).message || "Could not gather notebook evidence.");
    }
    const { evidenceText, citations } = evidence;

    const cancelRequested = async () => {
      if (!(await cancelled())) return false;
      await update({ status: "cancelled", error: null, cancelRequested: false });
      return true;
    };

    const citAt = (i?: number): Citation | null | undefined =>
      typeof i === "number" && i >= 1 && i <= citations.length ? citations[i - 1] : undefined;

    // ---------- kind handlers ----------

    const runAudio = async () => {
      const script = await generateAudioScript({
        format: String(config.format || "deepdive"),
        topic,
        audience: cfgStr(config.audience, 60),
        goals: cfgStr(config.goals, 200),
        lang,
        evidenceText,
        citations,
      });
      await update({ progress: 10 });
      const okTurns: { host: "A" | "B"; text: string; startSec: number; endSec: number; key: string }[] = [];
      let cursor = 0;
      for (let i = 0; i < script.turns.length; i++) {
        if (await cancelRequested()) return;
        const t = script.turns[i];
        const voice = t.host === "A" ? TTS_VOICES.A : TTS_VOICES.B;
        let buf: Buffer | null = null;
        for (let attempt = 0; attempt < 2 && !buf; attempt++) {
          try {
            buf = await synthesizeWav(t.text, voice);
          } catch {
            buf = null;
          }
        }
        if (!buf) continue; // skip this turn
        const key = `nbtmp-${artifactId}-t${okTurns.length}.wav`;
        await saveUpload(key, buf);
        tempKeys.add(key);
        const dur = await probeDurationSec(key);
        if (dur <= 0.05) continue;
        okTurns.push({ host: t.host, text: t.text, startSec: round1(cursor), endSec: round1(cursor + dur), key });
        cursor += dur;
        await update({ progress: 15 + Math.round((65 * (i + 1)) / script.turns.length) });
      }
      if (okTurns.length < 4) return await fail("Audio generation kept failing — please retry.");
      if (await cancelRequested()) return;
      await update({ progress: 82 });
      const allWav = `nbtmp-${artifactId}-all.wav`;
      tempKeys.add(allWav);
      await concatWavs(
        okTurns.map((t) => t.key),
        allWav
      );
      await update({ progress: 90 });
      const finalKey = `nbart-${artifactId}.mp3`;
      await wavToMp3(allWav, finalKey);
      const durationSec = await probeDurationSec(finalKey);
      if (!durationSec) return await fail("Rendered audio came out empty — please retry.");
      const content: AudioOverviewContent = {
        title: script.title,
        format: String(config.format || "deepdive"),
        lang,
        hostA: TTS_VOICES.A,
        hostB: TTS_VOICES.B,
        turns: okTurns.map(({ host, text, startSec, endSec }) => ({ host, text, startSec, endSec })),
        durationSec: round1(durationSec),
        citations,
      };
      await markReady(JSON.stringify(content), { fileKey: finalKey });
      await notify("🎧 Audio overview ready", `"${script.title}" is ready to play.`);
    };

    const runVideo = async () => {
      const board = await generateStoryboard({
        topic,
        audience: cfgStr(config.audience, 60),
        lang,
        evidenceText,
        citations,
        sceneCount: Number(config.scenes) || 5,
      });
      await update({ progress: 8 });
      const sharp = (await import("sharp")).default;
      const scenes: VideoOverviewContent["scenes"] = [];
      const keys: string[] = [];
      let cursor = 0;
      for (let i = 0; i < board.scenes.length; i++) {
        if (await cancelRequested()) return;
        const sc = board.scenes[i];
        const svg = renderSlideSVG({
          title: sc.heading,
          bullets: sc.bullets,
          quote: sc.quote,
          index: i + 1,
          total: board.scenes.length,
          deckTitle: artifact0.title,
        });
        const pngBuf = await sharp(Buffer.from(svg)).png().toBuffer();
        const pngKey = `nbtmp-${artifactId}-s${i}.png`;
        const wavKey = `nbtmp-${artifactId}-s${i}.wav`;
        const mp4Key = `nbtmp-${artifactId}-s${i}.mp4`;
        tempKeys.add(pngKey);
        tempKeys.add(wavKey);
        tempKeys.add(mp4Key);
        let wavBuf: Buffer | null = null;
        for (let attempt = 0; attempt < 2 && !wavBuf; attempt++) {
          try {
            wavBuf = await synthesizeWav(sc.narration, TTS_VOICES.narrator);
          } catch {
            wavBuf = null;
          }
        }
        if (!wavBuf) return await fail("Narration audio generation kept failing — please retry.");
        await saveUpload(pngKey, pngBuf);
        await saveUpload(wavKey, wavBuf);
        await runFfmpeg([
          "-y",
          "-loop", "1",
          "-i", ff(pngKey),
          "-i", ff(wavKey),
          "-c:v", "libx264",
          "-tune", "stillimage",
          "-c:a", "aac",
          "-b:a", "96k",
          "-ar", "24000",
          "-pix_fmt", "yuv420p",
          "-shortest",
          "-r", "24",
          ff(mp4Key),
        ]);
        const dur = await probeDurationSec(mp4Key);
        if (dur <= 0.1) return await fail("Video scene rendering failed — please retry.");
        scenes.push({
          heading: sc.heading,
          bullets: sc.bullets,
          narration: sc.narration,
          quote: sc.quote ?? null,
          startSec: round1(cursor),
          endSec: round1(cursor + dur),
        });
        keys.push(mp4Key);
        cursor += dur;
        await update({ progress: 10 + Math.round((75 * (i + 1)) / board.scenes.length) });
      }
      if (await cancelRequested()) return;
      await update({ progress: 88 });
      const finalKey = `nbart-${artifactId}.mp4`;
      await concatMp4s(keys, finalKey);
      const durationSec = await probeDurationSec(finalKey);
      if (!durationSec) return await fail("Rendered video came out empty — please retry.");
      const content: VideoOverviewContent = {
        title: board.title,
        lang,
        scenes,
        durationSec: round1(durationSec),
        citations,
      };
      await markReady(JSON.stringify(content), { fileKey: finalKey });
      await notify("🎬 Video overview ready", `"${board.title}" is ready to watch.`);
    };

    const runMindMap = async () => {
      await update({ progress: 10 });
      const content: MindMapContent = await generateMindMap({ topic, lang, evidenceText, citations });
      await update({ progress: 60 });
      await markReady(JSON.stringify(content));
    };

    const runReport = async () => {
      await update({ progress: 10 });
      const content: ReportContent = await generateReport({
        type: String(config.type || "study-guide"),
        customInstructions: cfgStr(config.customInstructions, 500),
        lang,
        evidenceText,
        citations,
      });
      await update({ progress: 60 });
      await markReady(JSON.stringify(content));
    };

    const runFlashcards = async () => {
      await update({ progress: 10 });
      const gen = await generateFlashcardCards({
        topic,
        count: Number(config.count) || 10,
        lang,
        evidenceText,
        citations,
      });
      await update({ progress: 60 });
      const deckTitle = `Notebook — ${artifact0.title}`.slice(0, 90);
      // replace-on-regenerate: the deck for THIS artifact is keyed by artifact id
      await db.flashcard.deleteMany({ where: { userId, sourceType: "notebook", sourceId: artifactId } });
      await db.flashcard.createMany({
        data: gen.cards.map((c) => ({
          userId,
          deckTitle,
          sourceType: "notebook",
          sourceId: artifactId,
          front: c.front,
          back: c.back,
          lang,
          box: 1,
          streak: 0,
          dueAt: new Date(),
        })),
      });
      const content: FlashcardsContent = {
        deckKey: `notebook:${artifactId}`,
        cards: gen.cards.map((c) => ({ front: c.front, back: c.back, citation: citAt(c.evidenceIndex) ?? null })),
        lang,
      };
      await markReady(JSON.stringify(content), { refType: "deck", refId: artifactId });
      await recordActivity(userId, "flashcards").catch(() => {});
    };

    const runQuiz = async () => {
      await update({ progress: 10 });
      const gen = await generateQuizArtifact({
        topic,
        subject: cfgStr(config.subject, 40),
        difficulty: String(config.difficulty || "medium"),
        count: Number(config.count) || 5,
        lang,
        evidenceText,
        citations,
      });
      await update({ progress: 60 });
      // regeneration: keep the old quiz if it has attempts (user history), else replace it
      if (artifact0.refId) {
        const old = await db.quiz.findFirst({ where: { id: artifact0.refId, userId } });
        if (old) {
          const attempts = await db.quizAttempt.count({ where: { quizId: old.id } });
          if (attempts === 0) await db.quiz.delete({ where: { id: old.id } }).catch(() => {});
        }
      }
      const subject = (SUBJECTS as readonly string[]).includes(String(config.subject)) ? String(config.subject) : "General";
      const difficulty = ["easy", "medium", "hard"].includes(String(config.difficulty)) ? String(config.difficulty) : "medium";
      const quiz = await db.quiz.create({
        data: {
          userId,
          title: (gen.title || artifact0.title).slice(0, 90),
          subject,
          difficulty,
          source: "notebook",
          sourceRef: artifactId,
        },
      });
      const questions = gen.questions as QuizArtifactQuestion[];
      await db.quizQuestion.createMany({
        data: questions.map((q, idx) => {
          const cit = citAt(q.evidenceIndex) ?? null;
          const src = cit
            ? `\n\nSource: ${cit.sourceTitle}${
                cit.page != null
                  ? ` (page ${cit.page})`
                  : cit.startSec != null
                    ? ` (at ${Math.floor(cit.startSec / 60)}:${String(Math.floor(cit.startSec % 60)).padStart(2, "0")})`
                    : ""
              }`
            : "";
          return {
            quizId: quiz.id,
            idx,
            type: q.type,
            question: q.question,
            options: JSON.stringify(q.options),
            correctIndex: q.correctIndex,
            answerText: q.answerText,
            explanation: `${q.explanation}${src}`,
            keywords: JSON.stringify(q.keywords || []),
          };
        }),
      });
      const content: QuizContent = {
        quizId: quiz.id,
        title: quiz.title,
        questions: questions.map((q) => ({
          type: q.type,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          answerText: q.answerText,
          explanation: q.explanation,
          citation: citAt(q.evidenceIndex) ?? null,
        })),
      };
      await markReady(JSON.stringify(content), { refType: "quiz", refId: quiz.id });
    };

    const runInfographic = async () => {
      await update({ progress: 10 });
      const content: InfographicContent = await generateInfographic({
        topic,
        lang,
        aspect: String(config.aspect || "4:5"),
        evidenceText,
        citations,
      });
      await update({ progress: 60 });
      await markReady(JSON.stringify(content));
    };

    const runSlides = async () => {
      await update({ progress: 10 });
      const content: SlidesContent = await generateSlides({
        topic,
        audience: cfgStr(config.audience, 60),
        lang,
        slideCount: Number(config.slideCount) || 6,
        evidenceText,
        citations,
      });
      await update({ progress: 60 });
      await markReady(JSON.stringify(content));
    };

    const runTable = async () => {
      await update({ progress: 10 });
      const content: TableContent = await generateTable({ topic, lang, evidenceText, citations });
      await update({ progress: 60 });
      await markReady(JSON.stringify(content));
    };

    const handlers: Record<string, () => Promise<void>> = {
      "audio-overview": runAudio,
      "video-overview": runVideo,
      mindmap: runMindMap,
      report: runReport,
      flashcards: runFlashcards,
      quiz: runQuiz,
      infographic: runInfographic,
      slides: runSlides,
      table: runTable,
    };
    const handler = handlers[artifact0.kind];
    if (!handler) return await fail(`Unknown artifact kind "${artifact0.kind}".`);
    try {
      await handler();
    } catch (e) {
      await fail((e as Error).message || "Generation failed — please retry.");
    }
  } finally {
    active.delete(artifactId);
    for (const k of tempKeys) await deleteUpload(k);
  }
}
