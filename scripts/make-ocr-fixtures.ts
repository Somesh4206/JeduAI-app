// Generates demo "scanned" study pages for testing JeduAI's OCR pipeline.
// 1) sharp renders text onto a paper-like PNG (slight rotation = realistic scan)
// 2) pdf-lib wraps the PNGs into a scanned-style PDF (no selectable text)
// Usage: bun scripts/make-ocr-fixtures.ts [outdir]
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

const outDir = process.argv[2] || path.join(process.cwd(), "download", "ocr-test");
await fs.mkdir(outDir, { recursive: true });

const PAGES = [
  {
    heading: "Chapter 3 — Photosynthesis",
    lines: [
      "Photosynthesis is the process by which green plants make their own food.",
      "Plants use sunlight, water and carbon dioxide to produce glucose.",
      "The reaction takes place inside chloroplasts, which contain a green",
      "pigment called chlorophyll that captures light energy.",
      "",
      "The overall equation is:",
      "   6CO2 + 6H2O + light energy -> C6H12O6 + 6O2",
      "",
      "Factors that affect the rate of photosynthesis include light intensity,",
      "carbon dioxide concentration and temperature. In very hot conditions",
      "enzymes can denature and the rate falls sharply.",
    ],
  },
  {
    heading: "Chapter 4 — Respiration",
    lines: [
      "Respiration releases energy from glucose inside every living cell.",
      "Aerobic respiration uses oxygen and produces carbon dioxide and water.",
      "   C6H12O6 + 6O2 -> 6CO2 + 6H2O + energy (ATP)",
      "",
      "Anaerobic respiration happens without oxygen. In muscles it produces",
      "lactic acid, which causes cramps and oxygen debt after hard exercise.",
      "In yeast cells, anaerobic respiration is called fermentation and",
      "produces ethanol and carbon dioxide, which is used in making bread.",
    ],
  },
];

async function pagePng(p: (typeof PAGES)[number], pageNo: number) {
  const body = p.lines
    .map(
      (l, i) =>
        `<text x="80" y="${230 + i * 34}" font-family="Georgia, serif" font-size="19" fill="#1a1a1a">${l
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</text>`
    )
    .join("");
  const svg = `<svg width="1240" height="1754" xmlns="http://www.w3.org/2000/svg">
  <rect width="1240" height="1754" fill="#f7f4ec"/>
  <rect x="40" y="40" width="1160" height="1674" fill="none" stroke="#d8d2c2" stroke-width="2"/>
  <text x="90" y="130" font-family="Georgia, serif" font-size="30" font-weight="bold" fill="#111">${p.heading.replace(/&/g, "&amp;")}</text>
  <line x1="90" y1="160" x2="500" y2="160" stroke="#8a8270" stroke-width="3"/>
  ${body}
  <text x="90" y="1680" font-family="Georgia, serif" font-size="15" fill="#777">Biology Notes — page ${pageNo}</text>
</svg>`;
  // slight rotation + noise to mimic a real scan
  return sharp(Buffer.from(svg))
    .rotate(pageNo % 2 === 1 ? -0.8 : 0.9, { background: "#f7f4ec" })
    .png()
    .toBuffer();
}

const pngs: Buffer[] = [];
for (let i = 0; i < PAGES.length; i++) pngs.push(await pagePng(PAGES[i], i + 1));

// single-page photo-style image (for direct image upload)
await fs.writeFile(path.join(outDir, "page-photo.png"), pngs[0]);

// scanned-style PDF (images only -> no extractable text layer)
const pdf = await PDFDocument.create();
for (const png of pngs) {
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([595, 842]); // A4
  page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
}
const pdfBytes = await pdf.save();
await fs.writeFile(path.join(outDir, "scanned-notes.pdf"), pdfBytes);

// ---- long scanned PDF (12 pages, unique topic per page) for page-range picker tests ----
const LONG_TOPICS = [
  "Unit 1 — Cell Structure",
  "Unit 2 — Cell Division",
  "Unit 3 — Transport in Plants",
  "Unit 4 — Human Digestion",
  "Unit 5 — The Circulatory System",
  "Unit 6 — The Respiratory System",
  "Unit 7 — The Nervous System",
  "Unit 8 — Hormones",
  "Unit 9 — Genetics and DNA",
  "Unit 10 — Evolution",
  "Unit 11 — Ecosystems",
  "Unit 12 — Conservation Biology",
];
const longPngs: Buffer[] = [];
for (let i = 0; i < LONG_TOPICS.length; i++) {
  longPngs.push(
    await pagePng(
      {
        heading: LONG_TOPICS[i],
        lines: [
          `${LONG_TOPICS[i].replace(/^Unit \d+ — /, "")} is a core idea in this chapter.`,
          "Each page of this long scanned booklet covers a different topic so",
          "that page-range selection can be verified end to end: only the",
          "requested pages should appear in the extracted text.",
          "",
          `Keyword marker for page ${i + 1}: biosignal-${String(i + 1).padStart(2, "0")}.`,
          "The marker words below are unique per page by design.",
          `Unique flower on this page: flower-${String.fromCharCode(97 + i)}${String.fromCharCode(97 + i)}${String.fromCharCode(97 + i)}.`,
        ],
      },
      i + 1
    )
  );
}
const longPdf = await PDFDocument.create();
for (const png of longPngs) {
  const img = await longPdf.embedPng(png);
  const page = longPdf.addPage([595, 842]);
  page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
}
await fs.writeFile(path.join(outDir, "scanned-booklet-12p.pdf"), await longPdf.save());

console.log("Fixtures written to", outDir);
console.log("  scanned-notes.pdf        — 2-page image-only PDF (triggers OCR)");
console.log("  page-photo.png           — single page photo (image upload -> OCR)");
console.log("  scanned-booklet-12p.pdf  — 12-page scanned PDF (page-range picker)");
