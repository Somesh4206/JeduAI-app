// /api/jeduai/notebook/[id]/sources/[sourceId] — inspect / select / rename /
// retry / delete a single source. Every handler is scoped to the owner
// notebook ({notebookId, userId}).
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/jeduai/auth";
import { deleteUpload } from "@/lib/jeduai/files";
import { isProcessing, processSource } from "@/lib/jeduai/notebook/ingest";
import type { ChunkDTO, SourceDTO, SourceKind, SourceStatus } from "@/lib/jeduai/notebook/types";

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

async function loadSource(id: string, sourceId: string, userId: string) {
  return db.notebookSource.findFirst({
    where: { id: sourceId, notebookId: id, userId },
  });
}

// GET: source detail + paginated chunks (optional ?q= text filter)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; sourceId: string }> }) {
  try {
    const { id, sourceId } = await ctx.params;
    const user = await requireUser();
    const source = await loadSource(id, sourceId, user.id);
    if (!source) return bad("Source not found.", 404);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || "20", 10) || 20));
    const q = (sp.get("q") || "").trim().slice(0, 200);

    const where: Prisma.SourceChunkWhereInput = { sourceId: source.id };
    if (q) where.text = { contains: q };

    const total = await db.sourceChunk.count({ where });
    const chunks = await db.sourceChunk.findMany({
      where,
      orderBy: { idx: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const chunkDTOs: ChunkDTO[] = chunks.map((c) => ({
      id: c.id,
      idx: c.idx,
      page: c.page ?? null,
      heading: c.heading ?? null,
      startSec: c.startSec ?? null,
      endSec: c.endSec ?? null,
      text: c.text,
    }));
    return NextResponse.json({ source: toSourceDTO(source), chunks: chunkDTOs, total, page, pageSize });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Failed to load the source", 500);
  }
}

// PATCH: {selected} toggle · {title} rename · {action:"retry"} for failed sources
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; sourceId: string }> }) {
  try {
    const { id, sourceId } = await ctx.params;
    const user = await requireUser();
    const source = await loadSource(id, sourceId, user.id);
    if (!source) return bad("Source not found.", 404);

    const body = await req.json().catch(() => null);

    if (body?.action === "retry") {
      // "failed" always retries; "processing" retries only when no worker is
      // actually running (covers crash-stuck rows — never mid-flight ones).
      if (source.status !== "failed" && !(source.status === "processing" && !isProcessing(source.id))) {
        return bad(
          source.status === "processing"
            ? "This source is still processing — please wait."
            : "Retry is only available for failed sources."
        );
      }
      await db.sourceChunk.deleteMany({ where: { sourceId: source.id } });
      await db.notebookSource.update({
        where: { id: source.id },
        data: { status: "queued", progress: 1, error: null, chunkCount: 0, wordCount: 0, updatedAt: new Date() },
      });
      after(async () => {
        await processSource(source.id);
      });
      const fresh = await db.notebookSource.findUnique({ where: { id: source.id } });
      return NextResponse.json({ source: toSourceDTO(fresh ?? source) });
    }

    if (body?.selected !== undefined) {
      if (typeof body.selected !== "boolean") return bad("selected must be true or false.");
      await db.notebookSource.update({ where: { id: source.id }, data: { selected: body.selected } });
      const fresh = await db.notebookSource.findUnique({ where: { id: source.id } });
      return NextResponse.json({ source: toSourceDTO(fresh ?? source) });
    }

    if (body?.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 90) : "";
      if (!title) return bad("Title must be 1–90 characters.");
      await db.notebookSource.update({ where: { id: source.id }, data: { title } });
      const fresh = await db.notebookSource.findUnique({ where: { id: source.id } });
      return NextResponse.json({ source: toSourceDTO(fresh ?? source) });
    }

    return bad("Send {selected}, {title} or {action:\"retry\"}.");
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Could not update the source", 500);
  }
}

// DELETE: remove the source (chunks cascade) + its stored uploads
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; sourceId: string }> }) {
  try {
    const { id, sourceId } = await ctx.params;
    const user = await requireUser();
    const source = await loadSource(id, sourceId, user.id);
    if (!source) return bad("Source not found.", 404);

    if (source.fileKey) {
      await deleteUpload(source.fileKey);
      await deleteUpload(`${source.fileKey}.wav`); // temp ASR wav, if any
    }
    await db.notebookSource.delete({ where: { id: source.id } }); // chunks cascade
    // artifacts keep their own provenance snapshot (citations) — by design
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Could not delete the source", 500);
  }
}
