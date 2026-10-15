import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";

export async function GET() {
  try {
    const user = await requireUser();
    const [notes, bookmarks] = await Promise.all([
      db.note.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      db.bookmark.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    return NextResponse.json({
      notes: notes.map((n) => ({
        id: n.id,
        content: n.content,
        sourceType: n.sourceType,
        sourceId: n.sourceId,
        createdAt: n.createdAt,
      })),
      bookmarks: bookmarks.map((b) => ({
        id: b.id,
        label: b.label,
        note: b.note,
        kind: b.kind,
        sourceType: b.sourceType,
        sourceId: b.sourceId,
        sectionIdx: b.sectionIdx,
        createdAt: b.createdAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const content = String(body?.content || "").trim().slice(0, 2000);
    if (!content) return NextResponse.json({ error: "Note is empty" }, { status: 400 });
    const note = await db.note.create({
      data: {
        userId: user.id,
        content,
        sourceType: body?.sourceType ? String(body.sourceType).slice(0, 20) : null,
        sourceId: body?.sourceId ? String(body.sourceId) : null,
      },
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = req.nextUrl.searchParams.get("id");
    const note = await db.note.findFirst({ where: { id: String(id || ""), userId: user.id } });
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    await db.note.delete({ where: { id: note.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
