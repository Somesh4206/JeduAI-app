// /api/jeduai/notebook/[id] — get / rename / delete a single notebook.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/jeduai/auth";
import { deleteUpload } from "@/lib/jeduai/files";
import type { NotebookDTO } from "@/lib/jeduai/notebook/types";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function toNotebookDTO(id: string, userId: string): Promise<NotebookDTO | null> {
  const nb = await db.notebook.findFirst({
    where: { id, userId },
    include: { _count: { select: { sources: true, conversations: true, artifacts: true } } },
  });
  if (!nb) return null;
  const ready = await db.notebookSource.count({ where: { notebookId: nb.id, userId, status: "ready" } });
  return {
    id: nb.id,
    title: nb.title,
    description: nb.description,
    sourceCount: nb._count.sources,
    readySources: ready,
    conversationCount: nb._count.conversations,
    artifactCount: nb._count.artifacts,
    createdAt: nb.createdAt.toISOString(),
    updatedAt: nb.updatedAt.toISOString(),
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const dto = await toNotebookDTO(id, user.id);
    if (!dto) return bad("Notebook not found.", 404);
    return NextResponse.json({ notebook: dto });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Failed to load the notebook", 500);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const nb = await db.notebook.findFirst({ where: { id, userId: user.id } });
    if (!nb) return bad("Notebook not found.", 404);

    const body = await req.json().catch(() => null);
    const data: { title?: string; description?: string | null } = {};
    if (body?.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
      if (!title) return bad("Title must be 1–80 characters.");
      data.title = title;
    }
    if (body?.description !== undefined) {
      if (body.description === null) {
        data.description = null;
      } else if (typeof body.description === "string") {
        data.description = body.description.trim().slice(0, 200) || null;
      } else {
        return bad("Description must be text.");
      }
    }
    if (!Object.keys(data).length) return bad("Nothing to update — send title and/or description.");

    await db.notebook.update({ where: { id: nb.id }, data });
    const dto = await toNotebookDTO(nb.id, user.id);
    return NextResponse.json({ notebook: dto });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Could not update the notebook", 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const nb = await db.notebook.findFirst({ where: { id, userId: user.id } });
    if (!nb) return bad("Notebook not found.", 404);

    // collect stored files before the cascade wipes the rows that reference them
    const sources = await db.notebookSource.findMany({
      where: { notebookId: nb.id },
      select: { fileKey: true },
    });
    const artifacts = await db.notebookArtifact.findMany({
      where: { notebookId: nb.id },
      select: { fileKey: true },
    });
    for (const s of sources) {
      if (s.fileKey) {
        await deleteUpload(s.fileKey);
        await deleteUpload(`${s.fileKey}.wav`); // temp ASR wav, if any
      }
    }
    for (const a of artifacts) {
      if (a.fileKey) await deleteUpload(a.fileKey);
    }

    await db.notebook.delete({ where: { id: nb.id } }); // cascades sources/chunks/conversations/messages/artifacts
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Could not delete the notebook", 500);
  }
}
