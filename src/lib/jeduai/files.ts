// JeduAI — document & subtitle parsing + text chunking (server-side)
import "server-only";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { DOC_LIMITS, OCR_LIMITS } from "./constants";

const execFileP = promisify(execFile);

export const UPLOAD_DIR = path.join(process.cwd(), "db", "uploads");

export async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function saveUpload(key: string, data: Buffer) {
  await ensureUploadDir();
  await fs.writeFile(path.join(UPLOAD_DIR, key), data);
}

export async function readUpload(key: string) {
  return fs.readFile(path.join(UPLOAD_DIR, key));
}

export async function uploadExists(key: string) {
  try {
    await fs.access(path.join(UPLOAD_DIR, key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteUpload(key: string) {
  try {
    await fs.unlink(path.join(UPLOAD_DIR, key));
  } catch {}
}

// ---------- Text extraction ----------

export type ExtractResult = { text: string; needsOcr: boolean; meta: Record<string, string> };

export async function extractDocumentText(
  fileName: string,
  buf: Buffer,
  mime: string
): Promise<ExtractResult> {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  if (ext === "txt" || ext === "md" || mime.startsWith("text/")) {
    return { text: buf.toString("utf-8"), needsOcr: false, meta: {} };
  }
  if (ext === "docx") {
    const mammoth = (await import("mammoth")).default;
    const r = await mammoth.extractRawText({ buffer: buf });
    return { text: r.value, needsOcr: false, meta: {} };
  }
  if (ext === "pdf" || mime === "application/pdf") {
    const pdfParseMod = await import("pdf-parse");
    const pdfParse = (pdfParseMod as unknown as { default: (b: Buffer) => Promise<{ text: string; numpages?: number }> })
      .default ?? (pdfParseMod as unknown as { default?: never });
    try {
      const data = await (pdfParseMod as any).default(buf);
      const text = (data?.text || "").trim();
      if (text.replace(/\s/g, "").length < 40) {
        return {
          text: "",
          needsOcr: true,
          meta: {},
        };
      }
      return { text, needsOcr: false, meta: { pages: String(data?.numpages ?? "") } };
    } catch (e) {
      return { text: "", needsOcr: true, meta: {} };
    }
  }
  throw new Error("Unsupported file type. Upload PDF, TXT, DOCX, MD or an image (PNG/JPG/WEBP).");
}

// ---------- OCR helpers (scanned PDFs & images) ----------

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

export function isImageFile(fileName: string, mime: string) {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  return IMAGE_EXTS.has(ext) || mime.startsWith("image/");
}

export function imageExtOf(fileName: string) {
  return (fileName.toLowerCase().split(".").pop() || "png") as "png" | "jpg" | "jpeg" | "webp";
}

// Normalize any image buffer to a compressed JPEG payload for the vision model.
export async function imageToJpegBase64(buf: Buffer): Promise<{ base64: string; mime: "image/jpeg" }> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(buf, { failOn: "none" })
    .rotate() // respect EXIF orientation
    .resize({ width: OCR_LIMITS.pageMaxWidth, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { base64: out.toString("base64"), mime: "image/jpeg" };
}

// Rasterize a page range of a PDF into JPEG page images (poppler pdftoppm).
// from/to are 1-based inclusive; defaults to the first OCR_LIMITS.maxPages pages.
export async function rasterizePdfPages(buf: Buffer, from = 1, to = OCR_LIMITS.maxPages): Promise<{ base64: string }[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jeduai-ocr-"));
  const pdfPath = path.join(dir, "in.pdf");
  await fs.writeFile(pdfPath, buf);
  try {
    const first = Math.max(1, Math.floor(from));
    const last = Math.max(first, Math.floor(to));
    await execFileP("pdftoppm", [
      "-png",
      "-r",
      String(OCR_LIMITS.pageDpi),
      "-f",
      String(first),
      "-l",
      String(last),
      pdfPath,
      path.join(dir, "page"),
    ]);
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
    const pages: { base64: string }[] = [];
    for (const f of files) {
      const raw = await fs.readFile(path.join(dir, f));
      const { base64 } = await imageToJpegBase64(raw);
      pages.push({ base64 });
    }
    return pages;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Total page count of a PDF via pdfinfo (poppler). Returns 0 when unknown.
export async function pdfPageCount(buf: Buffer): Promise<number> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jeduai-pdfinfo-"));
  const pdfPath = path.join(dir, "in.pdf");
  try {
    await fs.writeFile(pdfPath, buf);
    const { stdout } = await execFileP("pdfinfo", [pdfPath]);
    const m = /Pages:\s+(\d+)/.exec(stdout);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Split raw text into readable sections with heading detection.
// Tries paragraph boundaries; falls back to hard char split.
export function chunkIntoSections(raw: string, target = DOC_LIMITS.sectionChars, maxSections = DOC_LIMITS.maxSections) {
  const clean = raw.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [] as { heading: string | null; text: string }[];

  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sections: { heading: string | null; text: string }[] = [];
  let current = "";
  let currentHeading: string | null = null;

  const looksHeading = (p: string) => {
    const lines = p.split("\n");
    if (lines.length > 2) return false;
    const t = p.trim();
    if (t.length === 0 || t.length > 80) return false;
    if (/^(chapter|unit|part|section|lesson|module|appendix)\b/i.test(t)) return true;
    if (/^\d+(\.\d+)*[\s.:-]/.test(t) && lines.length === 1) return true;
    if (t === t.toUpperCase() && /[A-Z]{3}/.test(t) && !/[.:;]$/.test(t)) return true;
    return false;
  };

  for (const p of paras) {
    if (sections.length >= maxSections - 1 && current) {
      current += "\n\n" + p; // absorb into last section
      continue;
    }
    const isHeading = looksHeading(p);
    if (isHeading && current.length > target * 0.5) {
      sections.push({ heading: currentHeading, text: current.trim() });
      current = "";
      currentHeading = p.replace(/\n/g, " ");
      continue;
    }
    if (isHeading && !currentHeading) {
      currentHeading = p.replace(/\n/g, " ");
      continue;
    }
    if (current.length + p.length > target && current.length > target * 0.4) {
      sections.push({ heading: currentHeading, text: current.trim() });
      current = p;
      continue;
    }
    current += (current ? "\n\n" : "") + p;
  }
  if (current.trim()) sections.push({ heading: currentHeading, text: current.trim() });
  return sections.slice(0, maxSections);
}

// ---------- Subtitles ----------

export type SubSegment = { start: number; end: number; text: string };

function tsToSec(ts: string): number {
  const m = ts.trim().replace(",", ".").match(/(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return 0;
  const h = m[1] ? parseInt(m[1]) : 0;
  return h * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
}

export function parseSubtitles(content: string): SubSegment[] {
  const body = content.replace(/\r\n/g, "\n").trim();
  const isVtt = /^WEBVTT/i.test(body);
  const blocks = (isVtt ? body.replace(/^WEBVTT.*\n/, "") : body)
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const out: SubSegment[] = [];
  for (const b of blocks) {
    const lines = b.split("\n");
    const tl = lines.find((l) => l.includes("-->"));
    if (!tl) continue;
    const [a, bb] = tl.split("-->");
    const text = lines
      .slice(lines.indexOf(tl) + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!text) continue;
    out.push({ start: tsToSec(a), end: tsToSec(bb), text });
  }
  return out;
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
