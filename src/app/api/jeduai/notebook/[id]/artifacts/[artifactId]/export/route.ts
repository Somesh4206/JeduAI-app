import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/jeduai/auth";
import { renderInfographicSVG, renderMindMapSVG, renderSlideSVG, SLIDE_SIZE } from "@/lib/jeduai/studio/render";
import type { InfographicContent, MindMapContent, SlidesContent } from "@/lib/jeduai/notebook/types";

type Ctx = { params: Promise<{ id: string; artifactId: string }> };

const FORMATS_BY_KIND: Record<string, string[]> = {
  mindmap: ["png", "svg", "json"],
  infographic: ["png", "svg", "pdf"],
  slides: ["pdf", "pptx"],
};

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "artifact"
  );
}

async function svgToPng(svg: string, density = 144): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.from(svg), { density }).png().toBuffer();
}

// POST /api/jeduai/notebook/[id]/artifacts/[artifactId]/export — {format}
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    // getSessionUser handles both the session cookie and the Bearer header
    // (clients fetch exports with fetch + Authorization).
    const user = await getSessionUser();
    if (!user) return bad("Not signed in", 401);
    const { id, artifactId } = await ctx.params;
    const a = await db.notebookArtifact.findFirst({ where: { id: artifactId, notebookId: id, userId: user.id } });
    if (!a) return bad("Artifact not found", 404);

    const body = await req.json().catch(() => null);
    const format = typeof body?.format === "string" ? body.format : "";
    const allowed = FORMATS_BY_KIND[a.kind] || [];
    if (!allowed.length) {
      return bad("This artifact has no export formats — use the media download instead.");
    }
    if (!allowed.includes(format)) {
      return bad(`"${a.kind}" exports as: ${allowed.join(", ")}.`);
    }
    if (a.status !== "ready" || !a.content) {
      return bad("This artifact isn't ready yet.", 409);
    }
    let content: unknown;
    try {
      content = JSON.parse(a.content);
    } catch {
      return bad("This artifact isn't ready yet.", 409);
    }

    const slug = slugify(a.title);
    const file = (buf: Buffer | Uint8Array, mime: string, ext: string) =>
      new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(buf.length),
          "Content-Disposition": `attachment; filename="${slug}-${artifactId}.${ext}"`,
          "Cache-Control": "private, no-store",
        },
      });

    if (a.kind === "mindmap") {
      const mm = content as MindMapContent;
      if (!mm?.root) return bad("This artifact isn't ready yet.", 409);
      if (format === "json") return file(Buffer.from(JSON.stringify(mm, null, 2)), "application/json", "json");
      const svg = renderMindMapSVG(mm);
      if (format === "svg") return file(Buffer.from(svg, "utf-8"), "image/svg+xml", "svg");
      return file(await svgToPng(svg, 144), "image/png", "png");
    }

    if (a.kind === "infographic") {
      const ig = content as InfographicContent;
      if (!ig?.blocks) return bad("This artifact isn't ready yet.", 409);
      if (format === "svg") {
        return file(Buffer.from(renderInfographicSVG(ig), "utf-8"), "image/svg+xml", "svg");
      }
      const png = await svgToPng(renderInfographicSVG(ig), 144);
      if (format === "png") return file(png, "image/png", "png");
      // pdf: page = png pixel dims at 72dpi points (px * 72/96)
      const sharp = (await import("sharp")).default;
      const meta = await sharp(png).metadata();
      const w = Math.round(((meta.width || 800) * 72) / 96);
      const h = Math.round(((meta.height || 1000) * 72) / 96);
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      const img = await pdf.embedPng(png);
      const page = pdf.addPage([w, h]);
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
      return file(await pdf.save(), "application/pdf", "pdf");
    }

    if (a.kind === "slides") {
      const deck = content as SlidesContent;
      const slides = deck?.slides || [];
      if (!slides.length) return bad("This artifact isn't ready yet.", 409);

      if (format === "pdf") {
        const { PDFDocument } = await import("pdf-lib");
        const pdf = await PDFDocument.create();
        const pageW = Math.round((SLIDE_SIZE.width * 72) / 96); // 960pt
        const pageH = Math.round((SLIDE_SIZE.height * 72) / 96); // 540pt
        for (let i = 0; i < slides.length; i++) {
          const s = slides[i];
          const svg = renderSlideSVG({
            title: s.title,
            bullets: s.bullets,
            quote: s.quote ?? null,
            index: i + 1,
            total: slides.length,
            deckTitle: deck.title || a.title,
          });
          const png = await svgToPng(svg, 96); // 1280×720 raster
          const img = await pdf.embedPng(png);
          const page = pdf.addPage([pageW, pageH]);
          page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
        }
        return file(await pdf.save(), "application/pdf", "pdf");
      }

      // pptx — REAL editable text objects (title, bullets, quote, speaker notes)
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: "JEDU_WIDE", width: 10, height: 5.625 });
      pptx.layout = "JEDU_WIDE";
      for (const s of slides) {
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addText(s.title, { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 28, bold: true, color: "5B5FEF" });
        slide.addText(
          s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
          { x: 0.7, y: 1.4, w: 8.6, h: 3.4, fontSize: 16, color: "272B3A", lineSpacingMultiple: 1.2 }
        );
        if (s.quote) {
          slide.addText(`“${s.quote}”`, {
            x: 0.7, y: 4.75, w: 8.6, h: 0.65, fontSize: 13, italic: true, color: "6B7280",
          });
        }
        if (s.notes) slide.addNotes(s.notes);
      }
      const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
      return file(buf, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx");
    }

    return bad("This artifact has no export formats — use the media download instead.");
  } catch (e) {
    return bad((e as Error).message || "Export failed", 500);
  }
}
