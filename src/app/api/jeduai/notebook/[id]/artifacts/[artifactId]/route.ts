import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { deleteUpload } from "@/lib/jeduai/files";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { runArtifact, isArtifactRunning, toArtifactDTO } from "@/lib/jeduai/studio/worker";
import { gatherEvidence, generateSlides, UNUSABLE } from "@/lib/jeduai/studio/generators";
import { extractCitations } from "@/lib/jeduai/notebook/retrieval";
import type { Citation, SlidesContent } from "@/lib/jeduai/notebook/types";

type Ctx = { params: Promise<{ id: string; artifactId: string }> };

async function loadArtifact(ctx: Ctx, userId: string) {
  const { id, artifactId } = await ctx.params;
  return db.notebookArtifact.findFirst({ where: { id: artifactId, notebookId: id, userId } });
}

// GET — full artifact detail (content parsed regardless of size)
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const a = await loadArtifact(ctx, user.id);
    if (!a) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    return NextResponse.json({ artifact: toArtifactDTO(a, true) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Failed to load artifact" }, { status: 401 });
  }
}

const EDITABLE_KINDS = ["mindmap", "report", "infographic", "slides", "table"];

function contentShapeError(kind: string, content: unknown): string | null {
  // content is user-supplied JSON validated below — typed loosely on purpose
  const c = content as Record<string, any>;
  switch (kind) {
    case "mindmap":
      if (!c || typeof c !== "object" || Array.isArray(c)) return "Invalid mind map payload.";
      if (!c.root || typeof c.root.label !== "string" || !c.root.label.trim()) return "The mind map needs a root node with a label.";
      return null;
    case "report":
      if (typeof c?.markdown !== "string" || !c.markdown.trim()) return "The report needs markdown content.";
      return null;
    case "infographic":
      if (!Array.isArray(c?.blocks) || !c.blocks.length) return "The infographic needs at least one block.";
      if (!c.blocks.every((b: unknown) => !!b && typeof (b as { type?: unknown }).type === "string")) {
        return "One of the infographic blocks is invalid.";
      }
      return null;
    case "slides":
      if (!Array.isArray(c?.slides) || !c.slides.length) return "The deck needs at least one slide.";
      if (
        !c.slides.every(
          (s: unknown) =>
            !!s &&
            typeof (s as { title?: unknown }).title === "string" &&
            Array.isArray((s as { bullets?: unknown }).bullets)
        )
      ) {
        return "One of the slides is invalid (title + bullets are required).";
      }
      return null;
    case "table":
      if (!Array.isArray(c?.columns) || c.columns.length < 2) return "The table needs at least 2 columns.";
      if (!Array.isArray(c?.rows) || !c.rows.length) return "The table needs at least one row.";
      return null;
    default:
      return "This artifact kind cannot be edited here.";
  }
}

// PATCH — action-based: cancel | retry | rename | edit | edit-report | regenerate-slide
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const a = await loadArtifact(ctx, user.id);
    if (!a) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    const body = await req.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "cancel") {
      if (!["queued", "processing"].includes(a.status)) {
        return NextResponse.json({ error: "Only running generations can be cancelled." }, { status: 409 });
      }
      if (isArtifactRunning(a.id)) {
        // live worker: ask it to stop at the next checkpoint
        await db.notebookArtifact.update({ where: { id: a.id }, data: { cancelRequested: true } });
      } else {
        // no live worker (e.g. server crashed mid-generation) — resolve directly
        await db.notebookArtifact.update({ where: { id: a.id }, data: { status: "cancelled", cancelRequested: false } });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "retry") {
      if (a.status === "queued") {
        return NextResponse.json({ error: "This artifact is already queued." }, { status: 409 });
      }
      if (a.status === "ready") {
        return NextResponse.json({ error: "This artifact is already ready — create a new one to regenerate." }, { status: 409 });
      }
      if (a.status === "processing" && isArtifactRunning(a.id)) {
        return NextResponse.json({ error: "This artifact is still generating — cancel it first if you want to restart." }, { status: 409 });
      }
      // failed | cancelled | orphaned processing (crash recovery) — reset and run
      const rl = rateLimit(`nbartretry:${user.id}`, 8, 10 * 60_000);
      if (!rl.ok) return NextResponse.json({ error: "Too many retries — wait a few minutes." }, { status: 429 });
      const reset = await db.notebookArtifact.update({
        where: { id: a.id },
        data: { status: "queued", progress: 0, error: null, cancelRequested: false },
      });
      after(async () => {
        await runArtifact(a.id);
      });
      return NextResponse.json({ artifact: toArtifactDTO(reset, true) });
    }

    if (action === "rename") {
      const title = typeof body?.title === "string" ? body.title.trim().slice(0, 90) : "";
      if (!title) return NextResponse.json({ error: "Enter a title." }, { status: 400 });
      const updated = await db.notebookArtifact.update({ where: { id: a.id }, data: { title } });
      return NextResponse.json({ artifact: toArtifactDTO(updated, true) });
    }

    if (action === "edit") {
      if (a.status !== "ready") return NextResponse.json({ error: "Wait until generation finishes before editing." }, { status: 409 });
      if (!EDITABLE_KINDS.includes(a.kind)) {
        return NextResponse.json({ error: "This artifact kind cannot be edited here." }, { status: 400 });
      }
      const content = body?.content;
      if (!content || typeof content !== "object" || Array.isArray(content)) {
        return NextResponse.json({ error: "Invalid content payload." }, { status: 400 });
      }
      const serialized = JSON.stringify(content);
      if (serialized.length >= 300_000) {
        return NextResponse.json({ error: "Content is too large (limit 300,000 characters)." }, { status: 400 });
      }
      const shapeError = contentShapeError(a.kind, content);
      if (shapeError) return NextResponse.json({ error: shapeError }, { status: 400 });

      let old: Record<string, unknown> = {};
      try {
        const v = JSON.parse(a.content || "{}");
        if (v && typeof v === "object") old = v as Record<string, unknown>;
      } catch {}
      const merged: Record<string, unknown> = { ...old, ...content };
      if (a.kind === "report") {
        // markdown edits can change which citations are actually referenced
        const valid = Array.isArray(old.citations) ? (old.citations as Citation[]) : [];
        merged.citations = extractCitations(String(merged.markdown ?? ""), valid);
      }
      const updated = await db.notebookArtifact.update({
        where: { id: a.id },
        data: { content: JSON.stringify(merged), updatedAt: new Date() },
      });
      return NextResponse.json({ artifact: toArtifactDTO(updated, true) });
    }

    if (action === "edit-report") {
      if (a.status !== "ready" || a.kind !== "report") {
        return NextResponse.json({ error: "Only ready reports can be edited." }, { status: 409 });
      }
      const markdown = typeof body?.markdown === "string" ? body.markdown : "";
      if (!markdown.trim()) return NextResponse.json({ error: "The report needs markdown content." }, { status: 400 });
      if (markdown.length >= 300_000) {
        return NextResponse.json({ error: "Content is too large (limit 300,000 characters)." }, { status: 400 });
      }
      let old: Record<string, unknown> = {};
      try {
        const v = JSON.parse(a.content || "{}");
        if (v && typeof v === "object") old = v as Record<string, unknown>;
      } catch {}
      const valid = Array.isArray(old.citations) ? (old.citations as Citation[]) : [];
      const updated = await db.notebookArtifact.update({
        where: { id: a.id },
        data: {
          content: JSON.stringify({ ...old, markdown, citations: extractCitations(markdown, valid) }),
          updatedAt: new Date(),
        },
      });
      return NextResponse.json({ artifact: toArtifactDTO(updated, true) });
    }

    if (action === "regenerate-slide") {
      if (a.status !== "ready" || a.kind !== "slides") {
        return NextResponse.json({ error: "Only ready slide decks support slide regeneration." }, { status: 409 });
      }
      let oldContent: SlidesContent | null = null;
      try {
        oldContent = JSON.parse(a.content || "null");
      } catch {
        oldContent = null;
      }
      const slides = oldContent?.slides || [];
      const slideIndex = Math.round(Number(body?.slideIndex));
      if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slides.length) {
        return NextResponse.json({ error: "Invalid slide index." }, { status: 400 });
      }
      const instruction = typeof body?.instruction === "string" ? body.instruction.trim().slice(0, 400) : undefined;

      let sourceIds: string[] = [];
      try {
        const v = JSON.parse(a.sourceIds || "[]");
        if (Array.isArray(v)) sourceIds = v.filter((x): x is string => typeof x === "string");
      } catch {}
      let evidence;
      try {
        evidence = await gatherEvidence({
          notebookId: a.notebookId,
          userId: user.id,
          sourceIds,
          topic: typeof oldContent?.title === "string" ? oldContent.title : undefined,
        });
      } catch {
        return NextResponse.json({ error: "The sources for this deck are no longer available." }, { status: 409 });
      }
      let regenerated: SlidesContent;
      try {
        regenerated = await generateSlides({
          topic: typeof oldContent?.title === "string" ? oldContent.title : undefined,
          lang: oldContent?.lang || "English",
          slideCount: slides.length,
          evidenceText: evidence.evidenceText,
          citations: evidence.citations,
          regenerate: {
            existingSlides: slides.map((s) => ({ title: s.title, bullets: s.bullets, notes: s.notes, quote: s.quote ?? null })),
            slideIndex,
            instruction,
          },
        });
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message || UNUSABLE }, { status: 502 });
      }
      const replacement = regenerated.slides[0];
      if (!replacement) return NextResponse.json({ error: UNUSABLE }, { status: 502 });
      const nextSlides = slides.map((s, i) => (i === slideIndex ? { ...s, ...replacement } : s));
      const updated = await db.notebookArtifact.update({
        where: { id: a.id },
        data: {
          content: JSON.stringify({ ...oldContent, slides: nextSlides }),
          updatedAt: new Date(),
        },
      });
      return NextResponse.json({ artifact: toArtifactDTO(updated, true) });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Update failed" }, { status: 500 });
  }
}

// DELETE — remove the artifact (media file too). Imported decks/quizzes stay in
// their modules by design — flashcard rows keep sourceType "notebook".
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const a = await loadArtifact(ctx, user.id);
    if (!a) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    await db.notebookArtifact.delete({ where: { id: a.id } });
    if (a.fileKey) await deleteUpload(a.fileKey);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Delete failed" }, { status: 500 });
  }
}
