import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { MEDIA_LIMITS, LANG_NAMES } from "@/lib/jeduai/constants";
import { parseSubtitles, saveUpload, fmtTime } from "@/lib/jeduai/files";
import { isAudioExt, isVideoExt, probeDurationSec, makeFileKey } from "@/lib/jeduai/media";
import { processVideo } from "@/lib/jeduai/mediaworker";

export async function GET() {
  try {
    const user = await requireUser();
    const videos = await db.videoProject.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 60,
      include: { segments: { select: { id: true, translated: true, original: true } } },
    });
    return NextResponse.json({
      videos: videos.map((v) => ({
        id: v.id,
        title: v.title,
        kind: v.kind,
        sourceLang: v.sourceLang,
        targetLang: v.targetLang,
        status: v.status,
        progress: v.progress,
        durationSec: v.durationSec,
        hasFile: !!v.fileKey,
        segments: v.segments.filter((s) => s.original).length,
        segmentsTranslated: v.segments.filter((s) => s.translated).length,
        error: v.error,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`videoupload:${user.id}`, 6, 10 * 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many uploads. Please wait a few minutes." }, { status: 429 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const transcriptRaw = String(form.get("transcript") || "").slice(0, 200_000);
    const sourceLang = String(form.get("sourceLang") || "English");
    const targetLang = String(form.get("targetLang") || user.explanationLang || "Hindi");
    const title = String(form.get("title") || "").trim().slice(0, 90);
    if (!LANG_NAMES.includes(sourceLang) || !LANG_NAMES.includes(targetLang)) {
      return NextResponse.json({ error: "Pick valid source and target languages" }, { status: 400 });
    }
    // No-op guard: same as documents — translating into the source language
    // would burn the whole ffmpeg/ASR pipeline to return identical text.
    if (sourceLang === targetLang) {
      const suggestion =
        user.interfaceLang !== targetLang && LANG_NAMES.includes(user.interfaceLang)
          ? user.interfaceLang
          : "Hindi" !== targetLang
            ? "Hindi"
            : LANG_NAMES.find((l) => l !== targetLang) || "English";
      return NextResponse.json(
        {
          error: `Source and target are both ${targetLang} — the media would come back unchanged. Pick a different target language.`,
          suggestion,
        },
        { status: 422 }
      );
    }
    if (!file && !transcriptRaw.trim()) {
      return NextResponse.json({ error: "Upload a media file, or paste/upload a transcript." }, { status: 400 });
    }

    if (file) {
      const name = file.name || "upload";
      const isMedia = isAudioExt(name) || isVideoExt(name);
      if (!isMedia) {
        return NextResponse.json(
          { error: "Media translation supports audio (mp3, wav, m4a, aac, ogg, flac) and video (mp4, webm, mov, mkv, avi). For subtitles use the transcript tab." },
          { status: 400 }
        );
      }
      if (file.size > MEDIA_LIMITS.maxMB * 1024 * 1024) {
        return NextResponse.json({ error: `File too large. Maximum ${MEDIA_LIMITS.maxMB} MB.` }, { status: 400 });
      }
      const kind = isVideoExt(name) ? "video" : "audio";
      const proj = await db.videoProject.create({
        data: {
          userId: user.id,
          title: title || name,
          kind,
          fileName: name,
          sourceLang,
          targetLang,
          status: "extracting",
          progress: 5,
          sizeKB: Math.round(file.size / 1024),
        },
      });
      const key = await makeFileKey(proj.id, name.split(".").pop() || "bin");
      await saveUpload(key, Buffer.from(await file.arrayBuffer()));
      const dur = await probeDurationSec(key);
      await db.videoProject.update({ where: { id: proj.id }, data: { fileKey: key, durationSec: dur } });
      after(async () => {
        await processVideo(proj.id);
      });
      return NextResponse.json({ video: { id: proj.id, status: "extracting" } }, { status: 201 });
    }

    // transcript path
    const subs = parseSubtitles(transcriptRaw);
    const timed = subs.length >= 2 && subs.length <= 400;
    let segments: { start: number; end: number; text: string }[];
    if (timed) {
      segments = subs.slice(0, MEDIA_LIMITS.maxSegments);
    } else {
      const paras = transcriptRaw
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter((p) => p.length > 1)
        .slice(0, MEDIA_LIMITS.maxSegments);
      segments = paras.map((t) => ({ start: -1, end: -1, text: t }));
    }
    if (!segments.length) return NextResponse.json({ error: "Transcript looks empty." }, { status: 400 });

    const proj = await db.videoProject.create({
      data: {
        userId: user.id,
        title: title || (timed ? "Subtitle translation" : "Transcript translation"),
        kind: "transcript",
        sourceLang,
        targetLang,
        status: "translating",
        progress: 55,
        durationSec: timed ? Math.max(...subs.map((s) => s.end)) : 0,
      },
    });
    await db.videoSegment.createMany({
      data: segments.map((s, i) => ({
        videoId: proj.id,
        idx: i,
        startSec: s.start,
        endSec: s.end,
        original: s.text,
      })),
    });
    after(async () => {
      await processVideo(proj.id);
    });
    return NextResponse.json({ video: { id: proj.id, status: "translating", untimed: !timed } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Upload failed" }, { status: 500 });
  }
}
