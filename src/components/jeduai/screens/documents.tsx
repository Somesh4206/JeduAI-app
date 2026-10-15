"use client";
// JeduAI — Documents: upload + list
import React from "react";
import { motion } from "framer-motion";
import { FileUp, FileText, Trash2, BookOpen, Loader2, AlertTriangle, ImageIcon, ScanText, Files } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, Chip, EmptyState, ErrorState, LangButton, ProgressBar, StatusPillSpan, TopBar, toast } from "../ui";
import { DOC_LIMITS, LANGUAGES, OCR_LIMITS } from "@/lib/jeduai/constants";
import { cn } from "@/lib/utils";

type Doc = {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  sizeKB: number;
  sourceLang: string;
  targetLang: string;
  status: string;
  progress: number;
  error: string | null;
  pageRange: string | null;
  sections: number;
  sectionsDone: number;
  updatedAt: string;
};

export default function DocumentsScreen() {
  const push = useJedu((s) => s.push);
  const pop = useJedu((s) => s.pop);
  const user = useJedu((s) => s.user)!;
  const [docs, setDocs] = React.useState<Doc[] | null>(null);
  const [err, setErr] = React.useState("");
  const [reload, setReload] = React.useState(0);

  const [from, setFrom] = React.useState("English");
  const [to, setTo] = React.useState(user.explanationLang || "Hindi");
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState("");
  const [uploading, setUploading] = React.useState(false);

  // scanned-PDF page range: total pages (client-side pdf-lib) + chosen range
  const [pdfPages, setPdfPages] = React.useState<number | null>(null);
  const [range, setRange] = React.useState<{ from: number; to: number } | null>(null);

  async function onPickFile(f: File | null) {
    setFile(f);
    setRange(null);
    setPdfPages(null);
    if (!f || !/\.pdf$/i.test(f.name)) return;
    // count pages in the browser so long scans can pick which pages to read
    try {
      const { PDFDocument } = await import("pdf-lib");
      const bytes = await f.arrayBuffer();
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      const n = pdf.getPageCount();
      setPdfPages(n);
      if (n > OCR_LIMITS.maxPages) setRange({ from: 1, to: OCR_LIMITS.maxPages });
    } catch {
      /* encrypted/odd PDF — server pdfinfo will handle it; picker stays hidden */
    }
  }

  const load = React.useCallback(() => {
    api<{ documents: Doc[] }>("/api/jeduai/documents")
      .then((r) => setDocs(r.documents))
      .catch((e) => setErr((e as Error).message));
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(() => {
      // poll while any doc is actively translating or being read by AI vision
      setDocs((cur) => {
        if (cur?.some((d) => d.status === "translating" || d.status === "ocr")) load();
        return cur;
      });
    }, 2500);
    return () => clearInterval(t);
  }, [reload, load]);

  async function upload() {
    if (!file || uploading) return;
    if (file.size > DOC_LIMITS.maxMB * 1024 * 1024) {
      toast.error(`File is too large (max ${DOC_LIMITS.maxMB} MB).`);
      return;
    }
    if (from === to) {
      toast.warning(`Source and target are both ${to} — pick a different target language.`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("sourceLang", from);
      fd.set("targetLang", to);
      if (title.trim()) fd.set("title", title.trim());
      if (range && pdfPages && pdfPages > OCR_LIMITS.maxPages) fd.set("pages", `${range.from}-${range.to}`);
      const r = await api<{ document: { id: string; status: string }; note?: string }>("/api/jeduai/documents", {
        method: "POST",
        body: fd,
      });
      if (r.document.status === "needs_ocr") {
        toast.warning("This PDF looks scanned — OCR is needed. See the document entry for details.");
      } else if (r.document.status === "ocr") {
        toast.success(r.note || "Scanned pages detected — reading them with AI vision… 📖");
      } else {
        toast.success("Upload started — translating in sections…");
      }
      setFile(null);
      setTitle("");
      setRange(null);
      setPdfPages(null);
      setReload(reload + 1);
      push({ name: "document-reader", id: r.document.id });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove(d: Doc) {
    if (!confirm(`Delete "${d.title}" and its translation?`)) return;
    try {
      await api(`/api/jeduai/documents/${d.id}`, { method: "DELETE" });
      toast.success("Deleted");
      setDocs((cur) => (cur ? cur.filter((x) => x.id !== d.id) : cur));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const inputCls =
    "min-h-11 w-full rounded-2xl border border-border bg-card px-4 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-4 focus:ring-primary/10";

  function fmtSize(kb: number) {
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar onBack={pop} title="Documents & E-books" subtitle={`PDF · DOCX · TXT · MD · Photos — up to ${DOC_LIMITS.maxMB} MB`} />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {/* upload card */}
        <Card className="overflow-hidden p-0">
          <div className="j-grad-cyan flex items-center gap-3 px-4 py-3 text-white">
            <FileUp className="size-5" />
            <div className="leading-tight">
              <div className="text-[14.5px] font-black">Translate a document</div>
              <div className="text-[11.5px] text-white/85">Section-by-section AI translation with live progress</div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <label className="block">
              <input
                type="file"
                accept=".pdf,.txt,.md,.docx,image/png,image/jpeg,image/webp"
                className="hidden"
                id="doc-file"
                onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              />
              <div
                onClick={() => document.getElementById("doc-file")?.click()}
                className={cn(
                  "flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-4 text-center transition",
                  file ? "border-j-success/50 bg-j-success/5" : "border-border hover:border-primary/50 hover:bg-primary/5"
                )}
              >
                {file ? (
                  <>
                    {/^image\//.test(file.type) ? <ImageIcon className="size-6 text-j-success" /> : <FileText className="size-6 text-j-success" />}
                    <span className="text-[13px] font-bold text-foreground">{file.name}</span>
                    <span className="text-[11px] text-muted-foreground">{fmtSize(Math.round(file.size / 1024))} · tap to change</span>
                  </>
                ) : (
                  <>
                    <FileUp className="size-6 text-muted-foreground" />
                    <span className="text-[13px] font-bold text-foreground">Tap to choose a file</span>
                    <span className="text-[11px] text-muted-foreground">PDF, TXT, DOCX, Markdown — or a photo/scan of a page</span>
                  </>
                )}
              </div>
            </label>

            <div className="flex items-center gap-2.5 rounded-2xl border border-j-cyan/25 bg-j-cyan/8 px-3.5 py-2.5">
              <ScanText className="size-4 shrink-0 text-j-cyan" />
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                <b className="text-foreground">Scans & photos welcome.</b> Image-only PDFs and page photos are read with AI vision
                (OCR) — up to {OCR_LIMITS.maxPages} pages — then translated like any document.
              </p>
            </div>

            {/* page-range picker: only for PDFs longer than the OCR page budget */}
            {pdfPages && pdfPages > OCR_LIMITS.maxPages ? (
              <div className="rounded-2xl border border-j-violet/25 bg-j-violet/8 px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <Files className="size-4 shrink-0 text-j-violet" />
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    <b className="text-foreground">{pdfPages}-page PDF.</b> If it&rsquo;s a scan, AI vision reads at most{" "}
                    {OCR_LIMITS.maxPages} pages — choose which:
                  </p>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {["first", "last"].map((side) => {
                    const fr = side === "first" ? 1 : Math.max(1, pdfPages - OCR_LIMITS.maxPages + 1);
                    const tr = side === "first" ? Math.min(OCR_LIMITS.maxPages, pdfPages) : pdfPages;
                    const active = range?.from === fr && range?.to === tr;
                    return (
                      <button
                        key={side}
                        onClick={() => setRange({ from: fr, to: tr })}
                        className={cn(
                          "min-h-9 rounded-full px-3.5 text-[11.5px] font-black transition active:scale-95",
                          active ? "j-grad-violet text-white shadow-md shadow-j-violet/25" : "bg-card text-foreground ring-1 ring-border hover:ring-j-violet/40"
                        )}
                      >
                        {side === "first" ? "First" : "Last"} {tr - fr + 1} (p. {fr}–{tr})
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground/80">Custom</span>
                  <input
                    type="number"
                    min={1}
                    max={pdfPages}
                    value={range?.from ?? ""}
                    aria-label="First page to read"
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(pdfPages, parseInt(e.target.value, 10) || 1));
                      setRange((r) => ({ from: v, to: Math.max(r?.to ?? v, v) }));
                    }}
                    className="min-h-11 w-[4.5rem] rounded-xl border border-j-violet/30 bg-card px-2 text-center text-[13px] font-bold tabular-nums text-foreground shadow-sm outline-none transition focus:border-j-violet/60 focus:ring-4 focus:ring-j-violet/15 hover:border-j-violet/45"
                  />
                  <span className="px-0.5 text-[12px] font-bold text-muted-foreground">to</span>
                  <input
                    type="number"
                    min={1}
                    max={pdfPages}
                    value={range?.to ?? ""}
                    aria-label="Last page to read"
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(pdfPages, parseInt(e.target.value, 10) || 1));
                      setRange((r) => ({ from: Math.min(r?.from ?? v, v), to: v }));
                    }}
                    className="min-h-11 w-[4.5rem] rounded-xl border border-j-violet/30 bg-card px-2 text-center text-[13px] font-bold tabular-nums text-foreground shadow-sm outline-none transition focus:border-j-violet/60 focus:ring-4 focus:ring-j-violet/15 hover:border-j-violet/45"
                  />
                  {range ? (
                    <span className="ml-auto text-[11px] font-bold text-j-violet">
                      {Math.max(1, range.to - range.from + 1)} of {pdfPages} pages
                    </span>
                  ) : null}
                </div>
                {range && range.to - range.from + 1 > OCR_LIMITS.maxPages ? (
                  <p className="mt-2 text-[11px] font-bold text-j-warning">
                    ⚠️ Only the first {OCR_LIMITS.maxPages} pages of your range will be read (OCR budget).
                  </p>
                ) : null}
              </div>
            ) : null}

            <input
              className={inputCls}
              placeholder="Title (optional — defaults to file name)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={90}
            />

            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-[11px] font-black uppercase tracking-wider text-muted-foreground">From</div>
                <LangButton value={from} onChange={setFrom} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-right text-[11px] font-black uppercase tracking-wider text-muted-foreground">To</div>
                <div className="flex justify-end">
                  <LangButton value={to} onChange={setTo} />
                </div>
              </div>
            </div>

            {from === to ? (
              <div className="flex items-start gap-2.5 rounded-2xl border border-j-warning/30 bg-j-warning/10 px-3.5 py-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-j-warning" />
                <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-foreground">
                  <b>Same language selected.</b> Translation {from} → {to} would return the same text.
                  {(() => {
                    const alt = LANGUAGES.find((l) => l.name !== to && l.name === (user.interfaceLang !== to ? user.interfaceLang : null))?.name ||
                      LANGUAGES.find((l) => l.name !== to)?.name || "Hindi";
                    return (
                      <button
                        onClick={() => setTo(alt)}
                        className="mt-1.5 block font-black text-primary underline decoration-primary/40 underline-offset-2"
                      >
                        Translate to {alt} instead →
                      </button>
                    );
                  })()}
                </div>
              </div>
            ) : null}

            <button
              onClick={upload}
              disabled={!file || uploading}
              className="j-grad-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14.5px] font-black text-white shadow-lg shadow-primary/30 transition active:scale-[0.98] disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Extracting text…
                </>
              ) : (
                <>
                  <BookOpen className="size-4" /> Upload & translate
                </>
              )}
            </button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Documents are split into sections (≤ {DOC_LIMITS.maxSections}) and translated progressively — you can
              start reading as soon as the first sections finish. Text-based files translate fastest; scans and photos
              get an extra AI vision pass first.
            </p>
          </div>
        </Card>

        {/* list */}
        <h2 className="mb-2.5 mt-5 px-1 text-[15px] font-bold text-foreground">Your library</h2>
        {err ? <ErrorState message={err} onRetry={load} /> : null}
        {!docs && !err ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : !docs?.length ? (
          <EmptyState
            icon="📚"
            title="No documents yet"
            body="Upload a PDF e-book, lecture notes or any study document and read it in your language."
          />
        ) : (
          <div className="space-y-2.5">
            {docs.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className="p-0 overflow-hidden">
                  <button
                    onClick={() => push({ name: "document-reader", id: d.id })}
                    className="w-full p-4 text-left transition hover:bg-muted/30 active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div
                          className={cn(
                            "grid size-11 shrink-0 place-items-center rounded-2xl text-[11px] font-black text-white",
                            d.status === "completed"
                              ? "bg-j-success"
                              : d.status === "failed" || d.status === "needs_ocr"
                                ? "bg-j-error"
                                : d.status === "ocr"
                                  ? "bg-j-cyan"
                                  : "j-grad-primary"
                          )}
                        >
                          {d.fileType.toUpperCase().slice(0, 4)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-bold text-foreground">{d.title}</div>
                          <div className="text-[11.5px] text-muted-foreground">
                            {d.sourceLang} → {d.targetLang} · {fmtSize(d.sizeKB)}
                            {d.pageRange ? ` · pages ${d.pageRange.replace("-", "–")}` : ""}
                          </div>
                        </div>
                      </div>
                      <StatusPillSpan status={d.status} />
                    </div>

                    {d.status === "translating" || d.status === "ocr" ? (
                      <div className="mt-2.5 px-1">
                        <ProgressBar value={d.progress} />
                        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                          <span>{d.status === "ocr" ? "🤖 Reading pages with AI vision…" : `${d.sectionsDone}/${d.sections} sections`}</span>
                          <span className="font-bold text-primary">{d.progress}%</span>
                        </div>
                      </div>
                    ) : null}
                    {d.status === "completed" ? (
                      <div className="mt-2 text-[11.5px] font-bold text-j-success">✓ Ready to read — {timeAgo(d.updatedAt)}</div>
                    ) : null}
                    {d.status === "needs_ocr" ? (
                      <div className="mt-2 rounded-xl bg-j-warning/10 px-3 py-2 text-[11.5px] leading-snug text-j-warning">
                        ⚠️ Scanned PDF detected — no selectable text. Open it to retry OCR with AI vision.
                      </div>
                    ) : null}
                  </button>
                  <div className="flex border-t border-border/70">
                    <button
                      onClick={() => remove(d)}
                      className="flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold text-muted-foreground transition hover:text-j-error"
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
