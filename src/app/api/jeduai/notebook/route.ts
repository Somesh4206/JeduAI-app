// /api/jeduai/notebook — list & create notebooks.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/jeduai/auth";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import type { NotebookDTO } from "@/lib/jeduai/notebook/types";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const pageSize = Math.min(60, Math.max(1, parseInt(sp.get("pageSize") || "30", 10) || 30));

    const total = await db.notebook.count({ where: { userId: user.id } });
    const notebooks = await db.notebook.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { sources: true, conversations: true, artifacts: true } } },
    });

    const readyRows = await db.notebookSource.groupBy({
      by: ["notebookId"],
      where: { notebookId: { in: notebooks.map((n) => n.id) }, status: "ready" },
      _count: { _all: true },
    });
    const readyBy = new Map(readyRows.map((r) => [r.notebookId, r._count._all]));

    const dtos: NotebookDTO[] = notebooks.map((n) => ({
      id: n.id,
      title: n.title,
      description: n.description,
      sourceCount: n._count.sources,
      readySources: readyBy.get(n.id) || 0,
      conversationCount: n._count.conversations,
      artifactCount: n._count.artifacts,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));
    return NextResponse.json({ notebooks: dtos, total, page, pageSize });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Failed to list notebooks", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`nbcreate:${user.id}`, 10, 3600_000);
    if (!rl.ok) return bad("That's a lot of new notebooks — please wait a bit.", 429);

    const body = await req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 80) : "";
    if (!title) return bad("Give your notebook a title (1–80 characters).");
    let description: string | null = null;
    if (body?.description != null) {
      if (typeof body.description !== "string") return bad("Description must be text.");
      description = body.description.trim().slice(0, 200) || null;
    }

    const nb = await db.notebook.create({ data: { userId: user.id, title, description } });
    const dto: NotebookDTO = {
      id: nb.id,
      title: nb.title,
      description: nb.description,
      sourceCount: 0,
      readySources: 0,
      conversationCount: 0,
      artifactCount: 0,
      createdAt: nb.createdAt.toISOString(),
      updatedAt: nb.updatedAt.toISOString(),
    };
    return NextResponse.json({ notebook: dto }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return bad("Not signed in", 401);
    return bad((e as Error).message || "Could not create the notebook", 500);
  }
}
