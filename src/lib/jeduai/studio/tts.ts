// JeduAI Notebook Studio — TTS + audio assembly.
// Per-turn TTS (WAV only — the provider rejects mp3 with error 1214), sentence
// chunking under the 1024-char input cap, WAV concat via the ffmpeg concat
// demuxer, and WAV→MP3 transcode for the final artifact file.
import "server-only";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { randomBytes } from "crypto";
import ZAI from "z-ai-web-dev-sdk";
import { UPLOAD_DIR } from "@/lib/jeduai/files";

const exec = promisify(execFile);

export const TTS_VOICES = {
  A: "xiaochen", // calm guide
  B: "chuichui", // lively co-host
  narrator: "tongtong",
} as const;

function ff(key: string) {
  return path.join(UPLOAD_DIR, key);
}

/** promisified ffmpeg used by this module and the studio worker (video scenes).
 *  -nostats/-loglevel error keep the buffered stderr tiny (long encodes would
 *  otherwise stream a progress line per frame into the exec buffer). */
export async function runFfmpeg(args: string[], opts?: { cwd?: string; maxBuffer?: number }) {
  return exec("ffmpeg", ["-nostats", "-loglevel", "error", ...args], { cwd: opts?.cwd, maxBuffer: opts?.maxBuffer ?? 1 << 24 });
}

// ---------------- sentence chunking ----------------

/**
 * Split text into ≤1000-char chunks at sentence boundaries (keeping the
 * punctuation). Sentence markers: . ! ? 。 ！ ？ । ॥ — anything longer is
 * hard-split. TTS input cap is 1024 chars per call.
 */
export function splitForTts(text: string, maxLen = 1000): string[] {
  const clean = String(text ?? "").trim();
  if (!clean) return [];
  const pieces = clean.match(/[^.!?。！？।॥]+[.!?。！？।॥]*\s*/g) || [clean];
  const chunks: string[] = [];
  let cur = "";
  for (const p of pieces) {
    const part = p.trim();
    if (!part) continue;
    if (part.length > maxLen) {
      if (cur) {
        chunks.push(cur);
        cur = "";
      }
      for (let i = 0; i < part.length; i += maxLen) chunks.push(part.slice(i, i + maxLen));
      continue;
    }
    if ((cur + " " + part).trim().length > maxLen) {
      if (cur) chunks.push(cur);
      cur = part;
    } else {
      cur = (cur + " " + part).trim();
    }
  }
  if (cur) chunks.push(cur);
  return chunks.filter((c) => c.length > 0);
}

// ---------------- TTS ----------------

async function ttsWavChunk(text: string, voice: string, speed: number): Promise<Buffer> {
  const zai = await ZAI.create();
  const res = await zai.audio.tts.create({
    input: text,
    voice,
    speed,
    response_format: "wav", // mp3 is rejected by the provider (error 1214)
    stream: false,
  });
  const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
  if (!buf.length) throw new Error("TTS returned empty audio");
  return buf;
}

/**
 * Synthesize a whole text as a single WAV buffer (24kHz mono). Long texts are
 * split at sentence boundaries, synthesized per chunk and concatenated with the
 * ffmpeg concat demuxer.
 */
export async function synthesizeWav(text: string, voice: string, speed = 1.0): Promise<Buffer> {
  const chunks = splitForTts(text, 1000);
  if (!chunks.length) throw new Error("Nothing to synthesize");
  if (chunks.length === 1) {
    return ttsWavChunk(chunks[0], voice, speed);
  }
  const tag = `nbtmp-tts-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const keys: string[] = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const k = `${tag}-${i}.wav`;
      await fs.writeFile(ff(k), await ttsWavChunk(chunks[i], voice, speed));
      keys.push(k);
    }
    const outKey = `${tag}-all.wav`;
    await concatWavs(keys, outKey);
    return await fs.readFile(ff(outKey));
  } finally {
    for (const k of [...keys, `${tag}-all.wav`]) {
      await fs.unlink(ff(k)).catch(() => {});
    }
  }
}

// ---------------- audio assembly ----------------

/** Concatenate WAV files (same format) with the ffmpeg concat demuxer. */
export async function concatWavs(keys: string[], outKey: string): Promise<void> {
  if (!keys.length) throw new Error("No inputs to concatenate");
  const listKey = `${outKey}.list.txt`;
  const list = keys.map((k) => `file '${ff(k).replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  await fs.writeFile(ff(listKey), list, "utf-8");
  try {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", ff(listKey), "-c", "copy", ff(outKey)]);
  } finally {
    await fs.unlink(ff(listKey)).catch(() => {});
  }
}

/** Concatenate MP4 files (same codec settings) with the concat demuxer, stream copy. */
export async function concatMp4s(keys: string[], outKey: string): Promise<void> {
  if (!keys.length) throw new Error("No inputs to concatenate");
  const listKey = `${outKey}.list.txt`;
  const list = keys.map((k) => `file '${ff(k).replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  await fs.writeFile(ff(listKey), list, "utf-8");
  try {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", ff(listKey), "-c", "copy", "-movflags", "+faststart", ff(outKey)]);
  } finally {
    await fs.unlink(ff(listKey)).catch(() => {});
  }
}

/** WAV → MP3 (48kbps mono 24kHz) for final artifact delivery. */
export async function wavToMp3(inKey: string, outKey: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    ff(inKey),
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "48k",
    "-ar",
    "24000",
    "-ac",
    "1",
    ff(outKey),
  ]);
}
