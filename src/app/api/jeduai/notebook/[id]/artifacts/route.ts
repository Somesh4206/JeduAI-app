import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/jeduai/auth";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { LANG_NAMES, SUBJECTS } from "@/lib/jeduai/constants";
import { runArtifact, toArtifactDTO } from "@/lib/jeduai/studio/worker";
import { suggestTitle } from "@/lib/jeduai/studio/generators";
import type { ArtifactKind } from "@/lib/jeduai/notebook/types";

const KINDS: ArtifactKind[] = [
  "audio-overview",
  "video-overview",
  "mindmap",
  "report",
  "flashcards",
  "quiz",
  "infographic",
  "slides",
  "table",
];
const AUDIO_FORMATS = ["deepdive", "brief", "critique", "debate"];
const REPORT_TYPES = [
  "study-guide",
  "briefing",
  "summary",
  "faq",
  "glossary",
  "essay-questions",
  "critical-analysis",
  "blog-post",
  "revision-sheet",
  "custom",
];
const ASPECTS = ["4:5", "1:1", "16:9"];
const DIFFICULTIES = ["easy", "medium", "hard"];

// GET /api/jeduai/notebook/[id]/artifacts?kind=&page=&pageSize=
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const nb = await db.notebook.findFirst({ where: { id, userId: user.id } });
    if (!nb) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

    const sp = req.nextUrl.searchParams;
    const kindParam = sp.get("kind") || "";
    const kind = KINDS.includes(kindParam as ArtifactKind) ? kindParam : undefined;
    const page = Math.min(Math.max(parseInt(sp.get("page") || "1", 10) || 1, 1), 500);
    const pageSize = Math.min(Math.max(parseInt(sp.get("pageSize") || "30", 10) || 30, 1), 50);
    const where = { notebookId: id, userId: user.id, ...(kind ? { kind } : {}) };
    const [rows, total] = await Promise.all([
      db.notebookArtifact.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db.notebookArtifact.count({ where }),
    ]);
    return NextResponse.json({
      artifacts: rows.map((r) => toArtifactDTO(r)),
      total,
      page,
      pageSize,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Failed to load artifacts" }, { status: 401 });
  }
}

type ValidatedConfig = { ok: true; config: Record<string, unknown>; title: string } | { ok: false; error: string };

function validateConfig(kind: ArtifactKind, raw: unknown, user: { explanationLang: string }): ValidatedConfig {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lang =
    typeof c.lang === "string" && LANG_NAMES.includes(c.lang)
      ? c.lang
      : LANG_NAMES.includes(user.explanationLang)
        ? user.explanationLang
        : "English";
  const topic = typeof c.topic === "string" ? c.topic.trim().slice(0, 120) : "";
  const out: Record<string, unknown> = { lang };
  if (topic) out.topic = topic;
  const strField = (k: string, max: number) => {
    if (typeof c[k] === "string" && (c[k] as string).trim()) out[k] = (c[k] as string).trim().slice(0, max);
  };
  const intField = (k: string, min: number, max: number, dflt: number) => {
    const n = Math.round(Number(c[k]));
    out[k] = Number.isFinite(n) ? Math.min(Math.max(n, min), max) : dflt;
  };

  switch (kind) {
    case "audio-overview": {
      if (c.format === undefined) out.format = "deepdive";
      else if (typeof c.format !== "string" || !AUDIO_FORMATS.includes(c.format)) {
        return { ok: false, error: "Choose a valid audio format (deep dive, brief, critique or debate)." };
      } else out.format = c.format;
      strField("audience", 60);
      strField("goals", 200);
      break;
    }
    case "video-overview": {
      intField("scenes", 3, 8, 5);
      if (c.durationTarget !== undefined) {
        const d = Math.round(Number(c.durationTarget));
        out.durationTarget = Number.isFinite(d) ? Math.min(Math.max(d, 60), 180) : 90;
      }
      strField("audience", 60);
      break;
    }
    case "report": {
      const t = typeof c.type === "string" ? c.type : "study-guide";
      if (!REPORT_TYPES.includes(t)) return { ok: false, error: "Choose a valid report type." };
      out.type = t;
      if (t === "custom") {
        // frontend sends "instructions"; accept both spellings
        const custom = typeof c.customInstructions === "string" ? c.customInstructions : typeof c.instructions === "string" ? c.instructions : "";
        if (custom.trim()) out.customInstructions = custom.trim().slice(0, 500);
      }
      break;
    }
    case "flashcards": {
      intField("count", 4, 20, 10);
      break;
    }
    case "quiz": {
      intField("count", 3, 12, 5);
      const diff = typeof c.difficulty === "string" ? c.difficulty : "medium";
      if (!DIFFICULTIES.includes(diff)) return { ok: false, error: "Choose a valid difficulty." };
      out.difficulty = diff;
      if (c.subject !== undefined) {
        if (typeof c.subject !== "string" || !(SUBJECTS as readonly string[]).includes(c.subject)) {
          return { ok: false, error: "Choose a valid subject." };
        }
        out.subject = c.subject;
      }
      break;
    }
    case "infographic": {
      const a = typeof c.aspect === "string" ? c.aspect : "4:5";
      if (!ASPECTS.includes(a)) return { ok: false, error: "Choose a valid aspect ratio." };
      out.aspect = a;
      break;
    }
    case "slides": {
      // frontend sends "count"; accept both spellings
      const sc = c.slideCount !== undefined ? c.slideCount : c.count;
      const n = Math.round(Number(sc));
      out.slideCount = Number.isFinite(n) ? Math.min(Math.max(n, 4), 12) : 6;
      strField("audience", 60);
      break;
    }
    default:
      break; // mindmap / table: topic only
  }
  return { ok: true, config: out, title: suggestTitle(kind, topic || undefined) };
}

// POST /api/jeduai/notebook/[id]/artifacts — create + kick off generation
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const rl = rateLimit(`nbart:${user.id}`, 8, 10 * 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Too many Studio generations — wait a few minutes." }, { status: 429 });

    const body = await req.json().catch(() => null);
    const kind = body?.kind;
    if (typeof kind !== "string" || !KINDS.includes(kind as ArtifactKind)) {
      return NextResponse.json({ error: "Unknown artifact kind." }, { status: 400 });
    }
    const v = validateConfig(kind as ArtifactKind, body?.config, user);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

    const nb = await db.notebook.findFirst({ where: { id, userId: user.id } });
    if (!nb) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

    // resolve the source snapshot: explicit ids ∩ (selected + ready), or all selected ready
    let sourceIds: string[] = [];
    if (Array.isArray(body?.sourceIds) && body.sourceIds.length) {
      const ids = body.sourceIds.filter((s: unknown): s is string => typeof s === "string").slice(0, 20);
      const usable = await db.notebookSource.findMany({
        where: { notebookId: id, userId: user.id, status: "ready", selected: true, id: { in: ids } },
        select: { id: true },
      });
      sourceIds = usable.map((s) => s.id);
    } else {
      const usable = await db.notebookSource.findMany({
        where: { notebookId: id, userId: user.id, status: "ready", selected: true },
        select: { id: true },
      });
      sourceIds = usable.map((s) => s.id);
    }
    if (!sourceIds.length) {
      return NextResponse.json({ error: "Add and process at least one source first." }, { status: 400 });
    }

    const artifact = await db.notebookArtifact.create({
      data: {
        notebookId: id,
        userId: user.id,
        kind,
        title: v.title,
        status: "queued",
        progress: 0,
        config: JSON.stringify(v.config),
        sourceIds: JSON.stringify(sourceIds),
      },
    });
    after(async () => {
      await runArtifact(artifact.id);
    });
    return NextResponse.json({ artifact: toArtifactDTO(artifact) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Failed to create artifact" }, { status: 500 });
  }
}
