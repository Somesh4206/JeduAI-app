// JeduAI — media pipeline helpers (ffmpeg audio extraction + silence-based segmentation)
import "server-only";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { UPLOAD_DIR, readUpload, saveUpload, uploadExists } from "./files";

const exec = promisify(execFile);

function ff(key: string) {
  return path.join(UPLOAD_DIR, key);
}

export const AUDIO_EXTS = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];
export const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv", "avi"];

export function isAudioExt(name: string) {
  return AUDIO_EXTS.includes((name.toLowerCase().split(".").pop() || ""));
}
export function isVideoExt(name: string) {
  return VIDEO_EXTS.includes((name.toLowerCase().split(".").pop() || ""));
}

export async function probeDurationSec(key: string): Promise<number> {
  try {
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "json", ff(key),
    ]);
    return Math.max(0, parseFloat(JSON.parse(stdout)?.format?.duration || "0")) || 0;
  } catch {
    return 0;
  }
}

export function hasAudioStream(key: string): Promise<boolean> {
  return exec("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "json", ff(key)])
    .then(({ stdout }) => (JSON.parse(stdout)?.streams || []).length > 0)
    .catch(() => false);
}

// Extract mono 16k wav (what the ASR service prefers). Works for audio or video files.
export async function extractMonoWav(key: string, outKey: string): Promise<string> {
  const out = ff(outKey);
  await exec("ffmpeg", ["-y", "-i", ff(key), "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", out]);
  return outKey;
}

// Use ffmpeg silencedetect to split speech into timestamped chunks.
// Returns speech segments [{start,end}] capped at maxSegments.
export async function silenceSplit(
  wavKey: string,
  durationSec: number,
  opts: { noise?: string; minGap?: number; maxSegments: number; minSpeech?: number }
): Promise<{ start: number; end: number }[]> {
  const noise = opts.noise ?? "-35dB";
  const minGap = opts.minGap ?? 0.7;
  const minSpeech = opts.minSpeech ?? 0.9;
  let stderr = "";
  try {
    const r = await exec("ffmpeg", ["-i", ff(wavKey), "-af", `silencedetect=noise=${noise}:d=${minGap}`, "-f", "null", "-"], { maxBuffer: 1 << 26 });
    stderr = r.stderr;
  } catch (e: unknown) {
    stderr = (e as { stderr?: string })?.stderr || "";
  }
  const silences: { start: number; end: number }[] = [];
  let pendingStart: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): ([\d.-]+)/g)) {
    const tag = m[1];
    const val = parseFloat(m[2]);
    if (tag === "start" && pendingStart === null) pendingStart = Math.max(0, val);
    if (tag === "end" && pendingStart !== null) {
      silences.push({ start: pendingStart, end: val });
      pendingStart = null;
    }
  }
  if (pendingStart !== null) silences.push({ start: pendingStart, end: durationSec || pendingStart + 1 });

  // build speech segments as complement of silences
  const speech: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start - cursor >= minSpeech) speech.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (durationSec - cursor >= minSpeech) speech.push({ start: cursor, end: durationSec });

  // merge tiny fragments until we're under maxSegments
  let segs = speech;
  while (segs.length > opts.maxSegments) {
    segs.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    segs.pop();
    segs.sort((a, b) => a.start - b.start);
  }
  return segs;
}

export async function clipWav(wavKey: string, outKey: string, start: number, end: number) {
  const args = ["-y", "-i", ff(wavKey), "-ss", start.toFixed(2), "-to", end.toFixed(2), "-c", "copy", ff(outKey)];
  await exec("ffmpeg", args);
  return outKey;
}

export async function makeFileKey(id: string, ext: string) {
  const safe = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${id}.${safe}`;
}

export async function cleanupKeys(keys: string[]) {
  for (const k of keys) {
    try {
      await fs.unlink(ff(k));
    } catch {}
  }
}

export { readUpload, saveUpload, uploadExists };
