"use client";
// JeduAI — print-to-PDF export helpers (client side)
// Renders a clean, print-styled A4 document in a hidden iframe and opens the
// browser print dialog ("Save as PDF"). Uses system fonts, so every one of the
// 23 supported scripts (Devanagari, Tamil, Chinese, Arabic…) renders correctly
// without shipping font files.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Crude markdown → HTML for print (bold, headings, lists, paragraphs). */
function mdToHtml(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      continue;
    }
    const inline = escapeHtml(line)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.+?)\*/g, "<i>$1</i>");
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(`<h3 class="jh">${escapeHtml(h[2])}</h3>`);
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul class="jul">');
        inList = true;
      }
      out.push(`<li>${inline.replace(/^[-*•]\s+/, "")}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    out.push(`<p>${inline}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function baseCss(): string {
  return `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #202343;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari",
      "Noto Sans Tamil", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Malayalam", "Noto Sans Bengali",
      "Noto Sans Gujarati", "Noto Sans Gurmukhi", "Noto Nastaliq Urdu", "Noto Sans Oriya", "Noto Sans Arabic",
      "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "Noto Sans Thai", "Noto Sans Hebrew", "Noto Sans Cyrillic",
      "Noto Sans Ethiopic", sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { padding: 14mm 13mm 18mm; }
  .brand { display: flex; align-items: center; gap: 10px; border-bottom: 2.5px solid #5B5FEF; padding-bottom: 10px; margin-bottom: 14px; }
  .logo { width: 34px; height: 34px; border-radius: 9px; background: linear-gradient(135deg, #5B5FEF 0%, #773DE8 100%);
    color: #fff; font-weight: 900; font-size: 20px; display: flex; align-items: center; justify-content: center; }
  .brand h1 { font-size: 17px; margin: 0; letter-spacing: -0.02em; }
  .brand .sub { font-size: 10.5px; color: #6E7091; margin-top: 2px; font-weight: 600; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 4px; }
  .pill { border: 1px solid #E4E6F1; background: #F6F7FF; color: #3C3F66; border-radius: 999px;
    padding: 3px 11px; font-size: 10.5px; font-weight: 800; }
  .pill.acc { background: #5B5FEF; color: #fff; border-color: #5B5FEF; }
  h2.sec { font-size: 13.5px; color: #5B5FEF; margin: 16px 0 6px; letter-spacing: -0.01em; }
  .jh { font-size: 13px; color: #5B5FEF; margin: 12px 0 4px; }
  p { font-size: 11.5px; line-height: 1.62; margin: 0 0 7px; }
  .jul { margin: 2px 0 8px; padding-left: 16px; }
  .jul li { font-size: 11.5px; line-height: 1.6; margin-bottom: 3px; }
  .secblock { border: 1px solid #ECEEF7; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
  .src { font-size: 10px; color: #8B8DA7; line-height: 1.5; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #E4E6F1; }
  .tr { font-size: 11.5px; color: #202343; }
  .vocab { display: flex; gap: 8px; font-size: 10.5px; border-left: 3px solid #39C6F4; padding: 4px 8px; margin-bottom: 5px; break-inside: avoid; }
  .vocab b { color: #5B5FEF; }
  .trow { display: flex; gap: 10px; font-size: 11px; line-height: 1.6; border-left: 3px solid #E4E6F1; padding: 4px 10px; margin-bottom: 6px; break-inside: avoid; }
  .tt { color: #5B5FEF; font-weight: 800; min-width: 40px; white-space: nowrap; }
  .note { background: #F6F7FF; border: 1px solid #E4E6F1; border-radius: 10px; padding: 9px 12px; margin: 10px 0; }
  .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #E4E6F1; color: #9B9DB8; font-size: 9.5px;
    display: flex; justify-content: space-between; }
  @page { size: A4; margin: 0; }
  @media print { .page { padding: 12mm 12mm 14mm; } }
  `;
}

function page(title: string, sub: string, pills: string[], bodyHtml: string): string {
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${baseCss()}</style></head><body><div class="page">
<div class="brand"><div class="logo">J</div><div><h1>${escapeHtml(title)}</h1><div class="sub">${escapeHtml(sub)}</div></div></div>
<div class="meta">${pills.map((p, i) => `<span class="pill${i === 0 ? " acc" : ""}">${escapeHtml(p)}</span>`).join("")}</div>
${bodyHtml}
<div class="foot"><span>Exported from JeduAI · Learn in Your Language</span><span>${escapeHtml(date)}</span></div>
</div></body></html>`;
}

/** Opens the browser print dialog on a hidden iframe with the given HTML. */
export function printHTML(html: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("title", "Print export");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const cleanup = () => {
      try {
        frame.remove();
      } catch {}
    };
    const win = frame.contentWindow;
    if (win) {
      win.addEventListener("afterprint", cleanup);
      setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch {}
        setTimeout(cleanup, 90_000);
      }, 200);
    } else {
      cleanup();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------- View builders ----------------

export function translationPrintView(r: {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  mode: string;
  explanation?: string | null;
  vocabulary?: { word: string; meaning: string }[];
}): string {
  const body = `
  <h2 class="sec">🌐 Translation · ${escapeHtml(r.targetLang)}</h2>
  <p class="tr" style="font-size:13px; line-height:1.7;">${escapeHtml(r.translatedText).replace(/\n/g, "<br/>")}</p>
  ${r.explanation ? `<div class="note"><b>💡 Simple-language explanation</b><br/>${escapeHtml(r.explanation).replace(/\n/g, "<br/>")}</div>` : ""}
  ${r.vocabulary?.length ? `<h2 class="sec">📖 Key vocabulary</h2>${r.vocabulary
      .map((v) => `<div class="vocab"><b>${escapeHtml(v.word)}</b><span>${escapeHtml(v.meaning)}</span></div>`)
      .join("")}` : ""}
  <h2 class="sec">📄 Original · ${escapeHtml(r.sourceLang)}</h2>
  <p class="src" style="font-size:10.5px;">${escapeHtml(r.sourceText).replace(/\n/g, "<br/>")}</p>`;
  return page(
    "Translation",
    "JeduAI Translation Center",
    [`${r.sourceLang} → ${r.targetLang}`, r.mode === "learning" ? "Learning mode" : "Direct mode"],
    body
  );
}

export function documentPrintView(d: {
  title: string;
  sourceLang: string;
  targetLang: string;
  pageRange?: string | null;
  sections: { heading: string | null; original: string; translated: string | null }[];
}): string {
  const body = d.sections
    .map((s) => {
      const h = s.heading ? `<h2 class="sec">${escapeHtml(s.heading)}</h2>` : "";
      const tr = s.translated
        ? `<p class="tr" style="font-size:12.5px;">${escapeHtml(s.translated).replace(/\n/g, "<br/>")}</p>`
        : `<p class="src">(section not translated yet)</p>`;
      const src = `<p class="src">${escapeHtml(s.original).replace(/\n/g, "<br/>")}</p>`;
      return `${h}<div class="secblock">${tr}${src}</div>`;
    })
    .join("\n");
  return page(
    d.title,
    "JeduAI Document Translation",
    [`${d.sourceLang} → ${d.targetLang}`, `${d.sections.length} sections${d.pageRange ? ` · pages ${d.pageRange.replace("-", "–")}` : ""}`],
    body
  );
}

export function videoPrintView(v: {
  title: string;
  sourceLang: string;
  targetLang: string;
  kind: string;
  durationSec: number;
  segments: { start: number; end: number; original: string; translated: string | null }[];
  summary?: string | null;
  chapters?: { title: string; start: number }[];
}): string {
  const parts: string[] = [];
  if (v.summary) parts.push(`<h2 class="sec">✨ Summary</h2>${mdToHtml(v.summary)}`);
  if (v.chapters?.length)
    parts.push(
      `<h2 class="sec">📑 Chapters</h2>${v.chapters
        .map((c) => `<div class="vocab"><b style="min-width:40px;">${fmtClock(c.start)}</b><span>${escapeHtml(c.title)}</span></div>`)
        .join("")}`
    );
  parts.push(
    `<h2 class="sec">📝 Transcript · ${escapeHtml(v.targetLang)}</h2>${v.segments
      .map(
        (s) =>
          `<div class="trow"><span class="tt">${fmtClock(s.start)}–${fmtClock(s.end)}</span><span>${
            s.translated ? escapeHtml(s.translated) : escapeHtml(s.original)
          }</span></div>`
      )
      .join("")}`
  );
  return page(
    v.title,
    `JeduAI Media Translation · ${v.kind}`,
    [`${v.sourceLang} → ${v.targetLang}`, v.durationSec ? `${fmtClock(v.durationSec)} long` : v.kind],
    parts.join("\n")
  );
}
