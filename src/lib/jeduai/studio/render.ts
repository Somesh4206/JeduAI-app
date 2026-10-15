// JeduAI Notebook Studio — shared SVG renderers (PURE module).
// Importable from BOTH client (interactive mindmap preview, slide thumbnails)
// and server (video frames, PNG/PDF export). No "server-only", no db imports,
// no node built-ins — string in, string out.
import type { InfographicBlock, InfographicContent, MindMapContent, MindMapNode } from "../notebook/types";

// ---------------- basic helpers ----------------

export function escapeXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const FONT_STACK = "Noto Sans, DejaVu Sans, sans-serif";

/** Combining marks (Devanagari matras, Arabic diacritics, …) add no advance width. */
function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x0483 && cp <= 0x0489) ||
    (cp >= 0x0591 && cp <= 0x05bd) ||
    (cp >= 0x064b && cp <= 0x065f) ||
    (cp >= 0x0670 && cp <= 0x0670) ||
    (cp >= 0x093a && cp <= 0x094f) ||
    (cp >= 0x0951 && cp <= 0x0957) ||
    (cp >= 0x0962 && cp <= 0x0963) ||
    (cp >= 0x0e31 && cp <= 0x0e31) ||
    (cp >= 0x0e34 && cp <= 0x0e3a) ||
    (cp >= 0x0e47 && cp <= 0x0e4e) ||
    (cp >= 0xfe00 && cp <= 0xfe0f)
  );
}

function charWidth(ch: string, fs: number): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0x20) return fs * 0.28;
  if (isZeroWidth(cp)) return 0;
  if (
    (cp >= 0x0900 && cp <= 0x0d7f) || // Indic scripts (Devanagari, Tamil, …)
    (cp >= 0x2e80 && cp <= 0x9fff) || // CJK
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x3000 && cp <= 0x303f)
  ) {
    return fs * 0.95; // wide scripts — measure conservatively
  }
  if (cp >= 0x00c0 && cp <= 0x024f) return fs * 0.55; // Latin extended / diacritics
  if (/[A-Z0-9@#%&$]/.test(ch)) return fs * 0.66;
  if (/[a-z]/.test(ch)) return fs * 0.52;
  if (/[.,:;'!|()\/\-\u2019\u201c\u201d]/.test(ch)) return fs * 0.3;
  return fs * 0.56;
}

/** Estimated rendered width of a single-line string (no external deps). */
export function textWidth(s: string, fs: number): number {
  let w = 0;
  for (const ch of String(s ?? "")) w += charWidth(ch, fs);
  return w;
}

function wrapUnlimited(text: string, maxWidth: number, fs: number): string[] {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const lines: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) lines.push(cur);
    cur = "";
  };
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (textWidth(cand, fs) <= maxWidth) {
      cur = cand;
      continue;
    }
    if (!cur) {
      // single word longer than the line — hard-split it
      let piece = "";
      let hardDone = false;
      for (const ch of w) {
        if (textWidth(piece + ch, fs) > maxWidth && piece) {
          lines.push(piece);
          piece = ch;
          if (lines.length > 200) break; // sanity cap
        } else {
          piece += ch;
        }
      }
      cur = piece;
      if (piece) hardDone = true;
      if (hardDone) continue;
      continue;
    }
    flush();
    cur = w;
  }
  flush();
  return lines;
}

/** Greedy word wrap with a hard line cap; the last kept line gets an ellipsis. */
export function wrapText(text: string, maxWidth: number, fs: number, maxLines: number): string[] {
  const lines = wrapUnlimited(text, maxWidth, fs);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, Math.max(1, maxLines));
  let last = out[out.length - 1];
  while (last.length > 1 && textWidth(last + "…", fs) > maxWidth) last = last.slice(0, -1);
  out[out.length - 1] = last + "…";
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

// ---------------- slides ----------------

export const SLIDE_SIZE = { width: 1280, height: 720 } as const;

/**
 * Beautiful fixed-light 16:9 educational slide:
 * gradient header band (#5B5FEF → #773DE8) with big white title (≤2 lines,
 * auto font-size 54→40), primary-dot bullets (≤5, wrapped ≤2 lines each),
 * optional italic quote with accent bar, muted footer (deck title + index)
 * and a slide-number badge on the band. Text can never overflow the canvas —
 * the layout degrades font-size/line-height before ever truncating content.
 */
export function renderSlideSVG(opts: {
  title: string;
  bullets: string[];
  quote?: string | null;
  index: number;
  total: number;
  deckTitle: string;
  width?: number;
  height?: number;
}): string {
  const W = opts.width && opts.width > 0 ? opts.width : SLIDE_SIZE.width;
  const H = opts.height && opts.height > 0 ? opts.height : Math.round((W * SLIDE_SIZE.height) / SLIDE_SIZE.width);
  const s = W / SLIDE_SIZE.width; // horizontal scale
  const vs = H / SLIDE_SIZE.height; // vertical scale

  const title = String(opts.title ?? "").trim() || "Untitled slide";
  const bullets = (Array.isArray(opts.bullets) ? opts.bullets : [])
    .filter((b) => typeof b === "string" && b.trim())
    .map((b) => b.trim())
    .slice(0, 5);
  const quote = typeof opts.quote === "string" && opts.quote.trim() ? opts.quote.trim() : null;

  const mx = 72 * s;
  // title: auto font-size by length, wrapped to ≤2 lines
  const tfs = (title.length <= 36 ? 54 : title.length <= 72 ? 46 : 40) * s;
  const titleMaxW = W - mx * 2 - 108 * s; // reserve badge space on the right
  const tLines = wrapText(title, titleMaxW, tfs, 2);
  const bandH = (tLines.length > 1 ? 198 : 152) * vs;

  // ----- bullets: fit inside [band + 52, footerTop] -----
  const footerTop = H - 64 * vs;
  const bulletTextX = 116 * s;
  const bulletMaxW = W - bulletTextX - 72 * s;
  const quoteMaxW = W - 104 * s - 72 * s;
  const quoteLines = quote ? wrapText(quote, quoteMaxW, 21 * s, 3) : [];
  const quoteH = quoteLines.length ? quoteLines.length * 29 * vs + 22 * vs : 0;
  const quoteBlockH = quoteH ? quoteH + 30 * vs : 0;
  const top = bandH + 52 * vs;
  const avail = Math.max(120 * vs, footerTop - top - quoteBlockH);

  const measure = (fs: number, lh: number, gap: number) => {
    const ls = bullets.map((b) => wrapText(b, bulletMaxW, fs, 2));
    const h = ls.reduce((a, x) => a + x.length * lh, 0) + gap * Math.max(0, bullets.length - 1);
    return { ls, h };
  };
  let bfs = 26 * s;
  let lineH = 38 * vs;
  let gapB = 18 * vs;
  let m = measure(bfs, lineH, gapB);
  if (m.h > avail) {
    bfs = 23 * s;
    lineH = 31 * vs;
    gapB = 10 * vs;
    m = measure(bfs, lineH, gapB);
  }
  if (m.h > avail) {
    // final safety: one line per bullet
    m = { ls: bullets.map((b) => wrapText(b, bulletMaxW, bfs, 1)), h: 0 };
    m.h = m.ls.reduce((a, x) => a + x.length * lineH, 0) + gapB * Math.max(0, bullets.length - 1);
  }

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_STACK}">`);
  parts.push(
    `<defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B5FEF"/><stop offset="1" stop-color="#773DE8"/></linearGradient></defs>`
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#FFFFFF"/>`);
  // header band
  parts.push(`<rect width="${W}" height="${round(bandH)}" fill="url(#hg)"/>`);
  parts.push(`<circle cx="${round(W - 250 * s)}" cy="${round(bandH)}" r="${round(120 * s)}" fill="#FFFFFF" opacity="0.07"/>`);
  parts.push(`<circle cx="${round(W - 60 * s)}" cy="${round(bandH - 20 * vs)}" r="${round(80 * s)}" fill="#FFFFFF" opacity="0.06"/>`);

  // title (white bold, ≤2 lines, vertically centered in the band)
  const tLineH = tfs * 1.16 * vs;
  let ty = bandH / 2 - ((tLines.length - 1) * tLineH) / 2 + tfs * 0.35 * vs;
  const titleTspans = tLines
    .map((l, i) => {
      const y = i === 0 ? round(ty) : round(ty + i * tLineH);
      return `<tspan x="${round(mx)}" y="${y}">${escapeXml(l)}</tspan>`;
    })
    .join("");
  parts.push(
    `<text x="${round(mx)}" y="${round(ty)}" fill="#FFFFFF" font-size="${round(tfs)}" font-weight="700" letter-spacing="${round(-0.2 * s)}">${titleTspans}</text>`
  );

  // slide number badge (top-right of the band)
  parts.push(`<circle cx="${round(W - 64 * s)}" cy="${round(62 * vs)}" r="${round(25 * s)}" fill="#FFFFFF" opacity="0.22"/>`);
  parts.push(
    `<text x="${round(W - 64 * s)}" y="${round(62 * vs + 6 * s)}" text-anchor="middle" fill="#FFFFFF" font-size="${round(17 * s)}" font-weight="700">${escapeXml(String(opts.index ?? 1))}</text>`
  );

  // bullets with primary dot markers
  let by = top;
  const gapBetween = 10 * vs;
  m.ls.forEach((lines, bi) => {
    if (bi > 0) by += gapB;
    const firstBaseline = by + bfs * 0.78 * vs;
    parts.push(`<circle cx="${round(90 * s)}" cy="${round(by + lineH / 2)}" r="${round(6.5 * s)}" fill="#5B5FEF"/>`);
    const tspans = lines
      .map((l, i) => `<tspan x="${round(bulletTextX)}" y="${round(by + bfs * 0.78 * vs + i * lineH)}">${escapeXml(l)}</tspan>`)
      .join("");
    parts.push(
      `<text x="${round(bulletTextX)}" y="${round(firstBaseline)}" fill="#272B3A" font-size="${round(bfs)}" font-weight="400">${tspans}</text>`
    );
    by += lines.length * lineH;
  });

  // optional quote block (italic, left accent bar)
  if (quoteLines.length) {
    const qy = by + 30 * vs;
    const qTextX = 104 * s;
    const qBase = qy + 21 * s * 0.78; // first baseline
    parts.push(`<rect x="${round(72 * s)}" y="${round(qy - 6 * vs)}" width="${round(6 * s)}" height="${round(quoteH - 10 * vs)}" rx="${round(3 * s)}" fill="#5B5FEF"/>`);
    const qTspans = quoteLines
      .map((l, i) => `<tspan x="${round(qTextX)}" y="${round(qBase + i * 29 * vs)}">${escapeXml(l)}</tspan>`)
      .join("");
    parts.push(
      `<text x="${round(qTextX)}" y="${round(qBase)}" fill="#4B5563" font-size="${round(21 * s)}" font-style="italic">${qTspans}</text>`
    );
  }

  // footer: deck title left + index/total right
  const fy = H - 34 * vs;
  parts.push(`<line x1="${round(72 * s)}" y1="${round(footerTop)}" x2="${round(W - 72 * s)}" y2="${round(footerTop)}" stroke="#EDEFF4" stroke-width="${round(1 * s)}"/>`);
  const deckLine = wrapText(String(opts.deckTitle ?? ""), W - mx * 2 - 140 * s, 17 * s, 1);
  parts.push(
    `<text x="${round(72 * s)}" y="${round(fy)}" fill="#8A90A3" font-size="${round(17 * s)}" font-weight="500">${escapeXml(deckLine[0] || "JeduAI Notebook Studio")}</text>`
  );
  parts.push(
    `<text x="${round(W - 72 * s)}" y="${round(fy)}" text-anchor="end" fill="#9CA3AF" font-size="${round(16 * s)}">${escapeXml(`${opts.index ?? 1} / ${opts.total || 1}`)}</text>`
  );
  parts.push(`</svg>`);
  return parts.join("\n");
}

// ---------------- mind map ----------------

export type MMLayoutNode = {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hasChildren: boolean;
  collapsed: boolean;
  citationIndex?: number;
  explanation?: string;
};

export type MMLayout = {
  nodes: MMLayoutNode[];
  edges: { from: string; to: string }[];
  width: number;
  height: number;
};

const MM_GAP_X = 260; // lane width per depth level
const MM_GAP_Y = 22; // vertical gap between sibling subtrees
const MM_MAX_NODES = 60;

function mmNodeWidth(label: string): number {
  return clamp(60 + label.length * 8.5, 90, 230);
}

/**
 * Horizontal left→right tidy tree.
 * Depth-d nodes sit on lane x = d*260; the canvas width is derived from the
 * measured label widths (right edge of the widest node). Subtree heights are
 * computed bottom-up, then y is assigned top-down, children stacked around the
 * parent's center. Collapsed nodes hide their whole subtree (and get a +/−
 * indicator from the renderer). Deep trees are clamped at 60 nodes.
 */
export function layoutMindMap(root: MindMapNode, collapsed: Set<string>): MMLayout {
  type Work = { src: MindMapNode; depth: number };
  const nodes: MMLayoutNode[] = [];
  const edges: { from: string; to: string }[] = [];
  let count = 0;

  // 1) collect visible nodes breadth-first, capped at MM_MAX_NODES
  const queue: Work[] = [{ src: root, depth: 0 }];
  const kept: { src: MindMapNode; depth: number }[] = [];
  while (queue.length) {
    const { src, depth } = queue.shift()!;
    if (count >= MM_MAX_NODES) break;
    count++;
    kept.push({ src, depth });
    if (!collapsed.has(src.id)) {
      for (const c of src.children || []) queue.push({ src: c, depth: depth + 1 });
    }
  }

  const byId = new Map<string, MMLayoutNode>();
  for (const { src, depth } of kept) {
    const label = String(src.label ?? "").trim() || "…";
    const n: MMLayoutNode = {
      id: src.id,
      label,
      depth,
      x: depth * MM_GAP_X,
      y: 0,
      w: mmNodeWidth(label),
      h: 44,
      hasChildren: (src.children?.length ?? 0) > 0,
      collapsed: collapsed.has(src.id) && (src.children?.length ?? 0) > 0,
      citationIndex: typeof src.citationIndex === "number" && src.citationIndex >= 1 ? src.citationIndex : undefined,
      explanation: src.explanation ? String(src.explanation) : undefined,
    };
    byId.set(n.id, n);
    nodes.push(n);
  }

  // 2) edges between kept parent→child (parent must be kept & expanded)
  for (const { src } of kept) {
    const p = byId.get(src.id);
    if (!p || p.collapsed) continue;
    for (const c of src.children || []) {
      if (byId.has(c.id)) edges.push({ from: src.id, to: c.id });
    }
  }

  // 3) subtree heights bottom-up
  const subtreeH = new Map<string, number>();
  const heightOf = (src: MindMapNode): number => {
    const n = byId.get(src.id);
    if (!n) return 0;
    const cached = subtreeH.get(src.id);
    if (cached != null) return cached;
    let h = n.h;
    if (!n.collapsed) {
      const kids = (src.children || []).filter((c) => byId.has(c.id));
      if (kids.length) {
        const sum = kids.reduce((a, c, i) => a + heightOf(c) + (i < kids.length - 1 ? MM_GAP_Y : 0), 0);
        h = Math.max(n.h, sum);
      }
    }
    subtreeH.set(src.id, h);
    return h;
  };
  heightOf(root);

  // 4) assign y top-down: children block centered on parent's center
  const place = (src: MindMapNode) => {
    const n = byId.get(src.id);
    if (!n || n.collapsed) return;
    const kids = (src.children || []).filter((c) => byId.has(c.id));
    if (!kids.length) return;
    const sum = kids.reduce((a, c, i) => a + heightOf(c) + (i < kids.length - 1 ? MM_GAP_Y : 0), 0);
    let cy = n.y + n.h / 2 - sum / 2;
    for (const c of kids) {
      const cn = byId.get(c.id)!;
      const ch = heightOf(c);
      cn.y = cy + (ch - cn.h) / 2;
      place(c);
      cy += ch + MM_GAP_Y;
    }
  };
  const rootN = byId.get(root.id);
  if (rootN) {
    const total = heightOf(root);
    rootN.y = Math.max(0, (total - rootN.h) / 2);
    place(root);
  }

  let width = 420;
  let height = 240;
  for (const n of nodes) {
    width = Math.max(width, n.x + n.w + 24); // measured label widths adjust the canvas
    height = Math.max(height, n.y + n.h + 24);
  }
  return { nodes, edges, width: Math.ceil(width), height: Math.ceil(height) };
}

function mmDepthStyle(depth: number): { fill: string; stroke: string; text: string; fs: number; weight: number } {
  if (depth === 0) return { fill: "#5B5FEF", stroke: "#5B5FEF", text: "#FFFFFF", fs: 16, weight: 700 };
  if (depth === 1) return { fill: "#EFEEFF", stroke: "#5B5FEF", text: "#2B2F44", fs: 14, weight: 600 };
  return { fill: "#F4F2FB", stroke: "#E4E1F5", text: "#3A3F55", fs: 13, weight: 500 };
}

function citationBadge(cx: number, cy: number, index: number, r = 9): string {
  return (
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="#5B5FEF" stroke="#FFFFFF" stroke-width="2"/>` +
    `<text x="${round(cx)}" y="${round(cy + 3.4)}" text-anchor="middle" fill="#FFFFFF" font-size="10" font-weight="700">${escapeXml(String(index))}</text>`
  );
}

/** Standalone mindmap SVG: rounded nodes with depth tints, curved bezier edges,
 *  citation badges, collapse +/− toggles and a topic header. */
export function renderMindMapSVG(content: MindMapContent, opts?: { collapsed?: Set<string>; width?: number; height?: number }): string {
  const collapsed = opts?.collapsed ?? new Set<string>();
  const layout = layoutMindMap(content.root, collapsed);
  const padX = 80;
  const padTop = 108;
  const padBottom = 72;
  const vw = layout.width + padX * 2;
  const vh = layout.height + padTop + padBottom;
  const ox = padX; // layout → svg origin
  const oy = padTop;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}" font-family="${FONT_STACK}">`);
  parts.push(`<rect width="${vw}" height="${vh}" fill="#FFFFFF"/>`);

  const topic = wrapText(String(content.topic ?? "Mind map"), vw - padX * 2, 25, 1)[0] || "Mind map";
  parts.push(`<text x="${padX}" y="42" fill="#8A90A3" font-size="12" font-weight="700" letter-spacing="2">MIND MAP</text>`);
  parts.push(`<text x="${padX}" y="72" fill="#1F2430" font-size="25" font-weight="700">${escapeXml(topic)}</text>`);
  parts.push(`<line x1="${padX}" y1="86" x2="${vw - padX}" y2="86" stroke="#EDEFF4" stroke-width="1.5"/>`);

  // edges under nodes
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const e of layout.edges) {
    const f = byId.get(e.from);
    const t = byId.get(e.to);
    if (!f || !t) continue;
    const x1 = f.x + f.w + ox;
    const y1 = f.y + f.h / 2 + oy;
    const x2 = t.x + ox - (t.collapsed ? 14 : 0);
    const y2 = t.y + t.h / 2 + oy;
    parts.push(
      `<path d="M ${round(x1)} ${round(y1)} C ${round(x1 + 48)} ${round(y1)}, ${round(x2 - 48)} ${round(y2)}, ${round(x2)} ${round(y2)}" fill="none" stroke="#5B5FEF55" stroke-width="2"/>`
    );
  }

  // nodes (deepest first so parents overlap children)
  const ordered = [...layout.nodes].sort((a, b) => b.depth - a.depth);
  for (const n of ordered) {
    const style = mmDepthStyle(n.depth);
    const x = n.x + ox;
    const y = n.y + oy;
    const tooltip = `${n.label}${n.explanation ? ` — ${n.explanation}` : ""}`;
    parts.push(`<g><title>${escapeXml(tooltip).slice(0, 300)}</title>`);
    parts.push(
      `<rect x="${round(x)}" y="${round(y)}" width="${round(n.w)}" height="${n.h}" rx="${n.depth === 0 ? 14 : 10}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${n.depth === 0 ? 0 : n.depth === 1 ? 1.6 : 1}"/>`
    );
    // label (≤2 lines, centered)
    const labelLines = wrapText(n.label, n.w - 22, style.fs, 2);
    const fs = labelLines.length > 1 ? Math.min(style.fs, 12.5) : style.fs;
    const lh = fs * 1.2;
    const firstY = y + n.h / 2 - ((labelLines.length - 1) * lh) / 2 + fs * 0.35;
    const tspans = labelLines
      .map((l, i) => `<tspan x="${round(x + n.w / 2)}" y="${round(firstY + i * lh)}">${escapeXml(l)}</tspan>`)
      .join("");
    parts.push(
      `<text x="${round(x + n.w / 2)}" y="${round(firstY)}" text-anchor="middle" fill="${style.text}" font-size="${round(fs)}" font-weight="${style.weight}">${tspans}</text>`
    );
    // citation badge on the top-right corner
    if (n.citationIndex) parts.push(citationBadge(x + n.w - 2, y + 2, n.citationIndex));
    // collapse toggle on the right edge (on the edge start point)
    if (n.hasChildren) {
      const cx = x + n.w;
      const cy = y + n.h / 2;
      parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="9" fill="#FFFFFF" stroke="#5B5FEF" stroke-width="1.6"/>`);
      parts.push(
        `<text x="${round(cx)}" y="${round(cy + 3.6)}" text-anchor="middle" fill="#5B5FEF" font-size="12" font-weight="700">${n.collapsed ? "+" : "−"}</text>`
      );
    }
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ---------------- infographics ----------------

export const INFOGRAPHIC_SIZES: Record<"4:5" | "1:1" | "16:9", { width: number; height: number }> = {
  "4:5": { width: 800, height: 1000 },
  "1:1": { width: 900, height: 900 },
  "16:9": { width: 1080, height: 608 },
};

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function igHeader(title: string, subtitle: string | undefined, W: number): { svg: string[]; h: number } {
  const mx = Math.round(W * 0.06);
  const maxW = W - mx * 2 - 40;
  const tfs = title.length <= 26 ? 36 : title.length <= 44 ? 31 : 27;
  const tLines = wrapText(title, maxW, tfs, 2);
  const h = tLines.length > 1 ? (subtitle ? 150 : 128) : subtitle ? 118 : 96;
  const out: string[] = [];
  out.push(`<rect width="${W}" height="${h}" fill="url(#igg)"/>`);
  out.push(`<circle cx="${W - 80}" cy="${h - 10}" r="70" fill="#FFFFFF" opacity="0.07"/>`);
  out.push(`<circle cx="${W * 0.55}" cy="${h + 6}" r="46" fill="#FFFFFF" opacity="0.05"/>`);
  const lh = tfs * 1.16;
  const firstY = h / 2 - ((tLines.length - 1) * lh) / 2 - (subtitle ? 12 : 0) + tfs * 0.35;
  const tspans = tLines
    .map((l, i) => `<tspan x="${mx}" y="${round(firstY + i * lh)}">${escapeXml(l)}</tspan>`)
    .join("");
  out.push(`<text x="${mx}" y="${round(firstY)}" fill="#FFFFFF" font-size="${tfs}" font-weight="800">${tspans}</text>`);
  if (subtitle) {
    const subLine = wrapText(subtitle, maxW, 16, 1)[0] || "";
    out.push(
      `<text x="${mx}" y="${round(firstY + (tLines.length - 1) * lh + 34)}" fill="#FFFFFF" opacity="0.85" font-size="16" font-weight="400">${escapeXml(subLine)}</text>`
    );
  }
  return { svg: out, h };
}

/** Standalone infographic poster SVG (light fixed design). The width comes from
 *  the aspect ratio (or opts.width); the height grows with the content but never
 *  below the aspect's height, so short posters still fill their frame. */
export function renderInfographicSVG(content: InfographicContent, opts?: { width?: number }): string {
  const aspect = (["4:5", "1:1", "16:9"] as const).includes(content.aspect as "4:5" | "1:1" | "16:9")
    ? (content.aspect as "4:5" | "1:1" | "16:9")
    : "4:5";
  const W = opts?.width && opts.width > 0 ? opts.width : INFOGRAPHIC_SIZES[aspect].width;
  const targetH = Math.round((W / INFOGRAPHIC_SIZES[aspect].width) * INFOGRAPHIC_SIZES[aspect].height);
  const mx = Math.round(W * 0.06);
  const innerW = W - mx * 2;
  const blocks = (Array.isArray(content.blocks) ? content.blocks : []).slice(0, 8);
  const title = String(content.title ?? "").trim() || "Infographic";
  const subtitle = content.subtitle ? String(content.subtitle).trim().slice(0, 120) : "";

  type Block = { svg: string[]; h: number };
  const renderBlock = (b: InfographicBlock, topY: number): Block => {
    const out: string[] = [];
    if (b.type === "stat") {
      const value = String(b.value ?? "").slice(0, 14);
      const label = String(b.label ?? "").slice(0, 60);
      const sub = b.sub ? String(b.sub).slice(0, 80) : null;
      const vfs = value.length <= 6 ? 64 : value.length <= 9 ? 56 : 48;
      const labelLines = wrapText(label, innerW - 40, 19, 2);
      const subLines = sub ? wrapText(sub, innerW - 60, 14.5, 2) : [];
      const h = vfs + 10 + labelLines.length * 26 + subLines.length * 20 + 8;
      out.push(`<text x="${mx}" y="${round(topY + vfs * 0.78)}" fill="#5B5FEF" font-size="${vfs}" font-weight="800">${escapeXml(value)}</text>`);
      if (b.citationIndex) out.push(citationBadge(mx + textWidth(value, vfs) + 18, topY + 8, b.citationIndex, 10));
      let ly = topY + vfs + 6;
      const lT = labelLines
        .map((l, i) => `<tspan x="${mx}" y="${round(ly + i * 26)}">${escapeXml(l)}</tspan>`)
        .join("");
      out.push(`<text x="${mx}" y="${round(ly)}" fill="#272B3A" font-size="19" font-weight="600">${lT}</text>`);
      ly += labelLines.length * 26;
      if (subLines.length) {
        const sT = subLines.map((l, i) => `<tspan x="${mx}" y="${round(ly + 4 + i * 20)}">${escapeXml(l)}</tspan>`).join("");
        out.push(`<text x="${mx}" y="${round(ly + 4)}" fill="#6B7280" font-size="14.5">${sT}</text>`);
      }
      return { svg: out, h };
    }

    if (b.type === "timeline") {
      const steps = (b.steps || []).filter((s) => s && s.label).slice(0, 8);
      const rows = steps.map((s) => ({
        label: wrapText(String(s.label).slice(0, 60), innerW - 120, 15.5, 1)[0] || "",
        text: wrapText(String(s.text ?? "").slice(0, 220), innerW - 120, 13.5, 2),
      }));
      const stepH = rows.map((r) => 26 + r.text.length * 19 + 8);
      const h = 34 + stepH.reduce((a, x) => a + x, 0);
      out.push(`<text x="${mx}" y="${round(topY + 18)}" fill="#1F2430" font-size="17" font-weight="700">${escapeXml(String(b.title ?? "Timeline").slice(0, 60))}</text>`);
      const lineX = mx + 10;
      let y = topY + 44;
      const firstDot = y + 8;
      rows.forEach((r, i) => {
        out.push(`<circle cx="${lineX}" cy="${round(y + 8)}" r="7" fill="${i === 0 ? "#5B5FEF" : "#773DE8"}" stroke="#FFFFFF" stroke-width="2"/>`);
        out.push(`<text x="${round(mx + 34)}" y="${round(y + 13)}" fill="#2B2F44" font-size="15.5" font-weight="600">${escapeXml(r.label)}</text>`);
        r.text.forEach((l, j) => {
          out.push(
            `<text x="${round(mx + 34)}" y="${round(y + 34 + j * 19)}" fill="#4B5563" font-size="13.5">${escapeXml(l)}</text>`
          );
        });
        y += stepH[i];
      });
      const lastDot = y - stepH[stepH.length - 1] + 8;
      if (rows.length > 1) out.push(`<line x1="${lineX}" y1="${round(firstDot)}" x2="${lineX}" y2="${round(lastDot)}" stroke="#5B5FEF44" stroke-width="3"/>`);
      return { svg: out, h };
    }

    if (b.type === "compare") {
      const columns = (b.columns || []).map((c) => String(c).slice(0, 24)).slice(0, 3);
      const rows = (b.rows || []).slice(0, 5).map((r) => ({
        label: String(r.label ?? "").slice(0, 40),
        cells: columns.map((_, ci) => String(r.cells?.[ci] ?? "").slice(0, 60)),
      }));
      const colW = innerW / Math.max(2, columns.length);
      const headerH = 36;
      const cellLines = rows.map((r) => Math.max(1, ...r.cells.map((c) => wrapText(c, colW - 20, 13, 2).length)));
      const rowHs = rows.map((_, i) => 14 + cellLines[i] * 18);
      const h = 34 + headerH + rowHs.reduce((a, x) => a + x, 0) + 6;
      out.push(`<text x="${mx}" y="${round(topY + 18)}" fill="#1F2430" font-size="17" font-weight="700">${escapeXml(String(b.title ?? "Comparison").slice(0, 60))}</text>`);
      let y = topY + 44;
      // header row
      columns.forEach((c, ci) => {
        out.push(`<rect x="${round(mx + ci * colW)}" y="${round(y)}" width="${round(colW)}" height="${headerH}" fill="#EFEEFF"/>`);
        out.push(
          `<text x="${round(mx + ci * colW + colW / 2)}" y="${round(y + 23)}" text-anchor="middle" fill="#5B5FEF" font-size="13.5" font-weight="700">${escapeXml(wrapText(c, colW - 16, 13.5, 1)[0] || "")}</text>`
        );
      });
      y += headerH;
      rows.forEach((r, ri) => {
        r.cells.forEach((cell, ci) => {
          const zebra = ri % 2 === 0 ? "#FAFAFC" : "#FFFFFF";
          out.push(`<rect x="${round(mx + ci * colW)}" y="${round(y)}" width="${round(colW)}" height="${round(rowHs[ri])}" fill="${zebra}" stroke="#EDEFF4" stroke-width="1"/>`);
          const lines = wrapText(cell, colW - 20, 13, 2);
          const tT = lines
            .map((l, j) => `<tspan x="${round(mx + ci * colW + 10)}" y="${round(y + 20 + j * 18)}">${escapeXml(l)}</tspan>`)
            .join("");
          out.push(
            `<text x="${round(mx + ci * colW + 10)}" y="${round(y + 20)}" fill="#374151" font-size="13" font-weight="${ci === 0 ? 600 : 400}">${tT}</text>`
          );
        });
        y += rowHs[ri];
      });
      return { svg: out, h };
    }

    if (b.type === "facts") {
      const items = (b.items || []).map((i) => String(i).slice(0, 120)).slice(0, 6);
      const citIdxs = Array.isArray(b.citationIndexes) ? b.citationIndexes : [];
      const rows = items.map((it) => wrapText(it, innerW - 60, 14.5, 2));
      const h = 34 + rows.reduce((a, r) => a + r.length * 21 + 10, 0);
      out.push(`<text x="${mx}" y="${round(topY + 18)}" fill="#1F2430" font-size="17" font-weight="700">${escapeXml(String(b.title ?? "Key facts").slice(0, 60))}</text>`);
      let y = topY + 48;
      rows.forEach((r, i) => {
        out.push(`<circle cx="${round(mx + 6)}" cy="${round(y + 6)}" r="4" fill="#5B5FEF"/>`);
        r.forEach((l, j) => {
          out.push(`<text x="${round(mx + 24)}" y="${round(y + 11 + j * 21)}" fill="#3A3F55" font-size="14.5">${escapeXml(l)}</text>`);
        });
        const ci = citIdxs[i];
        if (ci) {
          const lastW = textWidth(r[r.length - 1] ?? "", 14.5);
          out.push(citationBadge(mx + 24 + Math.min(innerW - 40, lastW + 12), y + 2, ci, 8.5));
        }
        y += r.length * 21 + 10;
      });
      return { svg: out, h };
    }

    if (b.type === "quote") {
      const text = String(b.text ?? "").slice(0, 320);
      const attribution = b.attribution ? String(b.attribution).slice(0, 80) : null;
      const qLines = wrapText(`“${text}”`, innerW - 64, 20, 4);
      const h = qLines.length * 30 + (attribution ? 30 : 0) + 16;
      const qT = qLines
        .map((l, i) => `<tspan x="${round(mx + 30)}" y="${round(topY + 24 + i * 30)}">${escapeXml(l)}</tspan>`)
        .join("");
      out.push(`<rect x="${round(mx)}" y="${round(topY)}" width="6" height="${round(h - 10)}" rx="3" fill="#5B5FEF"/>`);
      out.push(`<text x="${round(mx + 30)}" y="${round(topY + 24)}" fill="#1F2430" font-size="20" font-style="italic" font-weight="500">${qT}</text>`);
      if (attribution) {
        out.push(
          `<text x="${round(mx + 30)}" y="${round(topY + 24 + qLines.length * 30 + 10)}" fill="#6B7280" font-size="14.5">— ${escapeXml(attribution)}</text>`
        );
      }
      if (b.citationIndex) out.push(citationBadge(mx + 12, topY + 6, b.citationIndex, 9));
      return { svg: out, h };
    }

    // flow
    const steps = (b.steps || []).map((s) => String(s).slice(0, 40)).slice(0, 6);
    const fs = 14;
    const pillH = 36;
    const rowsPills: { label: string; w: number }[][] = [];
    let curRow: { label: string; w: number }[] = [];
    let curW = 0;
    for (const s of steps) {
      const w = Math.max(60, textWidth(s, fs) + 34);
      if (curRow.length && curW + w + 34 > innerW) {
        rowsPills.push(curRow);
        curRow = [];
        curW = 0;
      }
      curRow.push({ label: s, w });
      curW += w + 34;
    }
    if (curRow.length) rowsPills.push(curRow);
    const h = 34 + rowsPills.length * (pillH + 14);
    out.push(`<text x="${mx}" y="${round(topY + 18)}" fill="#1F2430" font-size="17" font-weight="700">${escapeXml(String(b.title ?? "Process").slice(0, 60))}</text>`);
    let y = topY + 48;
    for (const row of rowsPills) {
      const total = row.reduce((a, p) => a + p.w, 0) + (row.length - 1) * 34;
      let x = mx + Math.max(0, (innerW - total) / 2);
      row.forEach((p, i) => {
        out.push(`<rect x="${round(x)}" y="${round(y)}" width="${round(p.w)}" height="${pillH}" rx="${round(pillH / 2)}" fill="#EFEEFF"/>`);
        out.push(
          `<text x="${round(x + p.w / 2)}" y="${round(y + pillH / 2 + 5)}" text-anchor="middle" fill="#4F46B8" font-size="${fs}" font-weight="600">${escapeXml(p.label)}</text>`
        );
        x += p.w;
        if (i < row.length - 1) {
          out.push(`<text x="${round(x + 17)}" y="${round(y + pillH / 2 + 6)}" text-anchor="middle" fill="#9CA3AF" font-size="18">→</text>`);
          x += 34;
        }
      });
      y += pillH + 14;
    }
    return { svg: out, h };
  };

  // first pass: measure with a 24px inter-block gap
  const GAP = 24;
  const header = igHeader(title, subtitle, W);
  let y = header.h + 30;
  const rendered = blocks.map((b) => {
    const r = renderBlock(b, y);
    y += r.h + GAP;
    return r;
  });
  const footerH = 56;
  let contentH = y - GAP + footerH;

  // fit the aspect: grow the canvas if content is taller, stretch gaps if shorter
  let H = targetH;
  let extra = 0;
  if (contentH < targetH) {
    extra = targetH - contentH;
    contentH = targetH;
  }
  H = contentH;
  const gaps = blocks.length + 1; // header→first + between blocks
  const addGap = blocks.length ? Math.min(40, extra / gaps) : 0;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${round(H)}" viewBox="0 0 ${W} ${round(H)}" font-family="${FONT_STACK}">`);
  parts.push(`<rect width="${W}" height="${round(H)}" fill="#FFFFFF"/>`);
  parts.push(
    `<defs><linearGradient id="igg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B5FEF"/><stop offset="1" stop-color="#773DE8"/></linearGradient></defs>`
  );
  parts.push(...header.svg);
  let by = header.h + 30 + Math.round(addGap / 2);
  for (let i = 0; i < blocks.length; i++) {
    parts.push(...renderBlock(blocks[i], by).svg);
    by += rendered[i].h + GAP + (i < blocks.length - 1 ? addGap : 0);
  }
  // footer
  const nCits = Array.isArray(content.citations) ? content.citations.length : 0;
  const footY = H - 24;
  parts.push(`<line x1="${mx}" y1="${round(H - footerH + 18)}" x2="${round(W - mx)}" y2="${round(H - footerH + 18)}" stroke="#EDEFF4" stroke-width="1.5"/>`);
  parts.push(
    `<text x="${round(W / 2)}" y="${round(footY)}" text-anchor="middle" fill="#9CA3AF" font-size="13.5"><tspan fill="#6D72F0" font-weight="700">Made with JeduAI</tspan><tspan fill="#C7CBD8">  ·  </tspan>${escapeXml(`${nCits} source citation${nCits === 1 ? "" : "s"}`)}</text>`
  );
  parts.push(`</svg>`);
  return parts.join("\n");
}
