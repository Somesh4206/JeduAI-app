// /api/jeduai/notebook/[id]/sources — list & add sources to a notebook.
// POST accepts:
//  - multipart file uploads (pdf, docx, txt, md, image, audio)
//  - JSON {kind:"web"|"youtube", url}
//  - JSON {kind:"pasted", title?, text}
//  - JSON {kind:"document"|"videoproject", refId} (import from My Learning)
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/jeduai/auth";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { DOC_LIMITS, MEDIA_LIMITS, OCR_LIMITS } from "@/lib/jeduai/constants";
import { saveUpload } from "@/lib/jeduai/files";
import { isImageFile } from "@/lib/jeduai/files";
import { isAudioExt, isVideoExt } from "@/lib/jeduai/media";
import { processSource } from "@/lib/jeduai/notebook/ingest";
import type { SourceDTO, SourceKind, SourceStatus } from "@/lib/jeduai/notebook/types";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type SourceRow = {
  id: string;
  notebookId: string;
  title: string;
  kind: string;
  status: string;
  progress: number;
  error: string | null;
  originUrl: string | null;
  refId: string | null;
  refKind: string | null;
  selected: boolean;
  chunkCount: number;
  wordCount: number;
  meta: string;
  createdAt: Date;
  updatedAt: Date;
};

function toSourceDTO(s: SourceRow): SourceDTO {
  let meta: SourceDTO["meta"] = {};
  try {
    const v = JSON.parse(s.meta || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) meta = v as SourceDTO["meta"];
  } catch {
    meta = {};
  }
  return {
    id: s.id,
    notebookId: s.notebookId,
    title: s.title,
    kind: s.kind as SourceKind,
    status: s.status as SourceStatus,
    progress: s.progress,
    error: s.error,
    originUrl: s.originUrl,
    refId: s.refId,
    refKind: (s.refKind as SourceDTO["refKind"]) ?? null,
    selected: s.selected,
    chunkCount: s.chunkCount,
    wordCount: s.wordCount,
    meta,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const FILE_CAPS_MB: Partial<Record<SourceKind, number>> = {
  pdf: DOC_LIMITS.maxMB, // 15
  docx: 10,
  txt: 10,
  md: 10,
  image: OCR_LIMITS.imageMaxKB / 1024, // 8
  audio: MEDIA_LIMITS.maxMB, // 60
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const nb = await db.notebook.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!nb) return bad("Notebook not found.", 404);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || "50", 10) || 50));

    const total = await db.notebookSource.count({ where: { notebookId: nb.id, userId: user.id } });
    const rows = await db.notebookSource.findMany({
      where: { notebookId: nb.id, userId: user.id },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return NextResponse.json({ sources: rows.map(toSourceDTO), total, page, pageSize });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Failed to list sources", 500);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const rl = rateLimit(`nbsrc:${user.id}`, 15, 10 * 60_000);
    if (!rl.ok) return bad("Too many source additions. Please wait a few minutes.", 429);

    const nb = await db.notebook.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!nb) return bad("Notebook not found.", 404);

    const ctype = (req.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("multipart/form-data")) {
      return await postMultipart(req, nb.id, user.id);
    }
    return await postJson(req, nb.id, user.id);
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Could not add the source", 500);
  }
}

// ---------- multipart: uploaded files ----------

async function postMultipart(req: NextRequest, notebookId: string, userId: string): Promise<NextResponse> {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return bad("Choose a file to upload.");
  const titleRaw = String(form.get("title") || "").trim();

  const name = file.name || "upload";
  const ext = (name.toLowerCase().split(".").pop() || "").replace(/[^a-z0-9]/g, "");
  const mime = (file.type || "").toLowerCase();

  if (isVideoExt(name)) {
    return bad("Use Media Studio for videos, then import its transcript from My Learning.");
  }
  let kind: SourceKind;
  if (ext === "pdf" || mime === "application/pdf") kind = "pdf";
  else if (ext === "docx" || mime.includes("officedocument.wordprocessingml")) kind = "docx";
  else if (ext === "md") kind = "md";
  else if (ext === "txt" || mime.startsWith("text/")) kind = "txt";
  else if (isImageFile(name, file.type || "")) kind = "image";
  else if (isAudioExt(name) || mime.startsWith("audio/")) kind = "audio";
  else {
    return bad("Unsupported file type. Upload PDF, DOCX, TXT, MD, an image (PNG/JPG/WEBP) or an audio file.");
  }

  const capMB = FILE_CAPS_MB[kind] ?? 10;
  if (file.size > capMB * 1024 * 1024) {
    return bad(`File is too large. Maximum ${capMB} MB for ${kind.toUpperCase()} sources.`);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const fileKey = `nbsrc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await saveUpload(fileKey, buf);

  const title =
    (titleRaw || name.replace(/\.[^.]+$/, "").trim()).slice(0, 90) ||
    `${kind.toUpperCase()} source`;

  const created = await db.notebookSource.create({
    data: {
      notebookId,
      userId,
      title,
      kind,
      fileKey,
      status: "queued",
      progress: 1,
      meta: JSON.stringify({ fileName: name, sizeKB: Math.round(file.size / 1024) }),
      selected: true,
    },
  });
  after(async () => {
    await processSource(created.id);
  });
  return NextResponse.json({ source: toSourceDTO(created) }, { status: 201 });
}

// ---------- JSON: web / youtube / pasted / document / videoproject ----------

async function postJson(req: NextRequest, notebookId: string, userId: string): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("Invalid request body.");
  const kind = String(body.kind || "");

  // ---- web & youtube links ----
  if (kind === "web" || kind === "youtube") {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url || url.length > 500 || !/^https?:\/\//i.test(url)) {
      return bad("Enter a valid http(s) URL (max 500 characters).");
    }
    try {
      new URL(url);
    } catch {
      return bad("Enter a valid http(s) URL.");
    }
    if (kind === "youtube" && !/^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      return bad("That does not look like a YouTube video link.");
    }
    const created = await db.notebookSource.create({
      data: {
        notebookId,
        userId,
        title: "Importing…",
        kind,
        originUrl: url,
        status: "queued",
        progress: 1,
        selected: true,
      },
    });
    after(async () => {
      await processSource(created.id);
    });
    return NextResponse.json({ source: toSourceDTO(created) }, { status: 201 });
  }

  // ---- pasted text ----
  if (kind === "pasted") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 20) return bad("Paste at least 20 characters of text.");
    if (text.length > 200_000) return bad("Pasted notes are limited to 200,000 characters.");
    const title = (typeof body.title === "string" ? body.title.trim() : "").slice(0, 90) || "Pasted notes";

    const created = await db.notebookSource.create({
      data: {
        notebookId,
        userId,
        title,
        kind: "pasted",
        status: "queued",
        progress: 1,
        meta: JSON.stringify({ charCount: text.length }),
        selected: true,
      },
    });
    const fileKey = `nbsrc-${created.id}.txt`;
    await saveUpload(fileKey, Buffer.from(text, "utf-8"));
    await db.notebookSource.update({ where: { id: created.id }, data: { fileKey } });
    const fresh = await db.notebookSource.findUnique({ where: { id: created.id } });
    after(async () => {
      await processSource(created.id);
    });
    return NextResponse.json({ source: toSourceDTO(fresh ?? created) }, { status: 201 });
  }

  // ---- import from existing JeduAI modules ----
  if (kind === "document" || kind === "videoproject") {
    const refId = typeof body.refId === "string" ? body.refId.trim() : "";
    if (!refId) return bad("Missing refId.");

    const dup = await db.notebookSource.findFirst({
      where: { notebookId, refKind: kind, refId },
      select: { id: true },
    });
    if (dup) return bad("Already in this notebook.", 409);

    if (kind === "document") {
      const doc = await db.document.findFirst({ where: { id: refId, userId } });
      if (!doc) return bad("Document not found.", 404);
      const sections = await db.documentSection.findMany({
        where: { documentId: doc.id },
        select: { original: true, translated: true },
      });
      if (!sections.some((s) => (s.translated || s.original || "").trim())) {
        return bad("This document has no readable content yet.");
      }
      const created = await db.notebookSource.create({
        data: { notebookId, userId, title: doc.title.slice(0, 90), kind, refId, refKind: kind, status: "queued", progress: 1, selected: true },
      });
      after(async () => {
        await processSource(created.id);
      });
      return NextResponse.json({ source: toSourceDTO(created) }, { status: 201 });
    }

    const v = await db.videoProject.findFirst({ where: { id: refId, userId } });
    if (!v) return bad("Video project not found.", 404);
    const segs = await db.videoSegment.findMany({ where: { videoId: v.id }, select: { original: true } });
    if (!segs.some((s) => (s.original || "").trim())) {
      return bad("This video project has no transcript yet.");
    }
    const created = await db.notebookSource.create({
      data: { notebookId, userId, title: v.title.slice(0, 90), kind, refId, refKind: kind, status: "queued", progress: 1, selected: true },
    });
    after(async () => {
      await processSource(created.id);
    });
    return NextResponse.json({ source: toSourceDTO(created) }, { status: 201 });
  }

  return bad("Unknown source kind.");
}
