"use client";
// JeduAI — Document reader: comparison view, bookmarks, notes, font size, export
import React from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Bookmark as BookmarkIcon,
  Copy,
  Download,
  FileDown,
  Layers,
  Minus,
  Plus,
  ScanText,
  Search,
  Star,
  Trash2,
  X,
  RefreshCcw,
  ChevronDown,
} from "lucide-react";
import { api, useJedu } from "../store";
import { Card, Chip, EmptyState, ErrorState, Loader, MarkdownBody, ProgressBar, Segmented, StatusPill, TopBar, toast } from "../ui";
import { printHTML, documentPrintView } from "../export";
import { cn } from "@/lib/utils";
import { HelpCircle, Send } from "lucide-react";

type Section = {
  id: string;
  idx: number;
  heading: string | null;
  original: string;
  translated: string | null;
  status: "pending" | "done" | "failed";
};
type Bookmark = {
  id: string;
  label: string;
  note: string | null;
  sectionIdx: number | null;
  kind: string;
  createdAt: string;
};
type Detail = {
  document: {
    id: string;
    title: string;
    fileName: string;
    fileType: string;
    pageRange: string | null;
    sourceLang: string;
    targetLang: string;
    status: string;
    progress: number;
    error: string | null;
  };
  sections: Section[];
  bookmarks: Bookmark[];
};

export default function DocumentReader({ id, jumpToSection }: { id: string; jumpToSection?: number }) {
  const pop = useJedu((s) => s.pop);
  const push = useJedu((s) => s.push);
  const [data, setData] = React.useState<Detail | null>(null);
  const [err, setErr] = React.useState("");
  const [view, setView] = React.useState<"translated" | "original" | "compare">("translated");
  const [fontSize, setFontSize] = React.useState(15);
  const [q, setQ] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [onlySections, setOnlySections] = React.useState<number[] | null>(null);
  const [bmSheet, setBmSheet] = React.useState(false);
  const [bmSection, setBmSection] = React.useState<Section | null>(null);
  const [bmLabel, setBmLabel] = React.useState("");
  const [bmNote, setBmNote] = React.useState("");
  const [renaming, setRenaming] = React.useState(false);
  const [titleVal, setTitleVal] = React.useState("");
  const [fcBusy, setFcBusy] = React.useState(false);
  const [askOpen, setAskOpen] = React.useState(false);
  const [askQ, setAskQ] = React.useState("");
  const [askA, setAskA] = React.useState<string | null>(null);
  const [askBusy, setAskBusy] = React.useState(false);
  const jumped = React.useRef(false);

  // retry path: editable page range for scanned PDFs
  const [pgOpen, setPgOpen] = React.useState(false);
  const [pgFrom, setPgFrom] = React.useState("");
  const [pgTo, setPgTo] = React.useState("");
  function openPagePicker(current: string | null) {
    const m = /^(\d+)-(\d+)$/.exec(current || "");
    setPgFrom(m ? m[1] : "1");
    setPgTo(m ? m[2] : "8");
    setPgOpen((v) => !v);
  }
  function pickedPages(): string | null {
    const f = parseInt(pgFrom, 10);
    const t = parseInt(pgTo, 10);
    if (!f || f < 1 || !t || t < f) return null;
    return `${f}-${t}`;
  }

  async function retryOcr(pages?: string) {
    if (!data) return;
    try {
      const r = await api<{ ok: boolean; pageRange?: string }>(`/api/jeduai/documents/${data.document.id}`, {
        method: "PATCH",
        json: { action: "ocr-retry", ...(pages ? { pages } : {}) },
      });
      toast.info(r.pageRange ? `Reading pages ${r.pageRange.replace("-", "–")} with AI vision…` : "Reading your document with AI vision…");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const load = React.useCallback(() => {
    return api<Detail>(`/api/jeduai/documents/${id}`)
      .then((r) => {
        setData(r);
        setTitleVal(r.document.title);
        // one-time jump from a library bookmark
        if (jumpToSection !== undefined && !jumped.current) {
          jumped.current = true;
          if (r.sections.some((s) => s.idx === jumpToSection)) {
            setOnlySections([jumpToSection]);
            toast.info(`Jumped to section ${jumpToSection + 1} · from your bookmark`);
          }
        }
      })
      .catch((e) => setErr((e as Error).message));
  }, [id, jumpToSection]);

  React.useEffect(() => {
    load();
  }, [load]);

  // poll while translating or being read by AI vision (OCR)
  React.useEffect(() => {
    if (data?.document.status === "translating" || data?.document.status === "ocr") {
      const t = setInterval(() => {
        load();
      }, 2200);
      return () => clearInterval(t);
    }
  }, [data?.document.status, load]);

  async function retrySection(s: Section) {
    try {
      await api(`/api/jeduai/documents/${id}`, { method: "PATCH", json: { action: "retry", sectionIdx: s.idx } });
      toast.success("Retrying that section…");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveBookmark() {
    if (!bmSection) return;
    try {
      await api(`/api/jeduai/documents/${id}`, {
        method: "PATCH",
        json: {
          action: "bookmark",
          sectionIdx: bmSection.idx,
          label: bmLabel.trim() || (bmSection.heading || `Section ${bmSection.idx + 1}`),
          note: bmNote.trim() || null,
        },
      });
      toast.success("Bookmarked");
      setBmSheet(false);
      setBmSection(null);
      setBmLabel("");
      setBmNote("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteDoc() {
    if (!data) return;
    if (!confirm(`Delete "${data.document.title}"? This removes the translation too.`)) return;
    try {
      await api(`/api/jeduai/documents/${id}`, { method: "DELETE" });
      toast.success("Document deleted");
      pop();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function rename() {
    if (!titleVal.trim()) return;
    try {
      await api(`/api/jeduai/documents/${id}`, { method: "PATCH", json: { title: titleVal.trim() } });
      toast.success("Renamed");
      setRenaming(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function exportTxt() {
    if (!data) return;
    const lines = [
      `${data.document.title}`,
      `${data.document.sourceLang} → ${data.document.targetLang} · translated by JeduAI`,
      "".padEnd(50, "="),
      "",
      ...data.sections.map(
        (s) =>
          `${s.heading ? `## ${s.heading}` : `[Section ${s.idx + 1}]`}\n\n${s.translated || "(not translated yet)"}\n`
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.document.title.slice(0, 60)} (${data.document.targetLang}).txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Exported as .txt");
  }

  function exportPdf() {
    if (!data) return;
    const ok = printHTML(
      documentPrintView({
        title: data.document.title,
        sourceLang: data.document.sourceLang,
        targetLang: data.document.targetLang,
        pageRange: data.document.pageRange,
        sections: data.sections.map((s) => ({ heading: s.heading, original: s.original, translated: s.translated })),
      })
    );
    if (ok) toast.success("Opening print dialog — choose “Save as PDF”");
    else toast.error("Couldn't open the print dialog");
  }

  async function makeFlashcards() {
    if (!data || fcBusy) return;
    setFcBusy(true);
    try {
      const r = await api<{ created: number; gamified?: { gained: number } }>("/api/jeduai/flashcards", {
        method: "POST",
        json: { sourceType: "doc", sourceId: id, count: 10, lang: data.document.targetLang },
      });
      toast.success(`${r.created} flashcards created · +${r.gamified?.gained || 0} XP 🃏`);
      push({ name: "flashcards", deck: `doc:${id}` });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFcBusy(false);
    }
  }

  async function askDoc() {
    const q = askQ.trim();
    if (!q || askBusy) return;
    setAskBusy(true);
    setAskA(null);
    try {
      const r = await api<{ answer: string }>(`/api/jeduai/documents/${id}`, {
        method: "PATCH",
        json: { action: "ask", question: q },
      });
      setAskA(r.answer);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAskBusy(false);
    }
  }

  const filtered = React.useMemo(() => {
    if (!data) return [];
    if (onlySections) return data.sections.filter((s) => onlySections.includes(s.idx));
    if (q.trim()) {
      const needle = q.toLowerCase();
      return data.sections.filter(
        (s) =>
          (s.original || "").toLowerCase().includes(needle) ||
          (s.translated || "").toLowerCase().includes(needle) ||
          (s.heading || "").toLowerCase().includes(needle)
      );
    }
    return data.sections;
  }, [data, q, onlySections]);

  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Document" />
        <div className="p-4">
          <ErrorState message={err} onRetry={load} />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar onBack={pop} title="Document" />
        <Loader label="Opening document…" />
      </div>
    );
  }

  const d = data.document;
  const done = data.sections.filter((s) => s.status === "done").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        onBack={pop}
        title={
          renaming ? (
            <span className="flex items-center gap-2">
              <input
                value={titleVal}
                onChange={(e) => setTitleVal(e.target.value)}
                autoFocus
                onBlur={rename}
                onKeyDown={(e) => e.key === "Enter" && rename()}
                className="w-44 rounded-lg border border-primary/40 px-2 text-[15px] font-bold outline-none"
              />
            </span>
          ) : (
            <button onClick={() => setRenaming(true)} className="max-w-full truncate text-left">
              {d.title} <span className="text-[11px] font-normal text-muted-foreground">✎</span>
            </button>
          )
        }
        subtitle={`${d.sourceLang} → ${d.targetLang} · ${done}/${data.sections.length} sections${d.pageRange ? ` · pages ${d.pageRange.replace("-", "–")}` : ""}`}
        right={
          <>
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              aria-label="Search in document"
              className="grid size-10 place-items-center rounded-full text-foreground/80 transition hover:bg-muted"
            >
              {searchOpen ? <X className="size-5" /> : <Search className="size-5" />}
            </button>
            <button
              onClick={() => setBmSheet(true)}
              aria-label="Bookmarks"
              className="relative grid size-10 place-items-center rounded-full text-foreground/80 transition hover:bg-muted"
            >
              <BookmarkIcon className="size-5" />
              {data.bookmarks.length ? (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-j-warning px-1 text-[9px] font-black text-white">
                  {data.bookmarks.length}
                </span>
              ) : null}
            </button>
            <button
              onClick={deleteDoc}
              aria-label="Delete document"
              className="grid size-10 place-items-center rounded-full text-foreground/80 transition hover:bg-j-error/10 hover:text-j-error"
            >
              <Trash2 className="size-5" />
            </button>
          </>
        }
      />

      {/* progress area */}
      <div className="border-b border-border/70 bg-card/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <StatusPill status={d.status} />
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] font-bold text-muted-foreground">{d.progress}%</span>
            <div className="flex items-center gap-0.5 rounded-full border border-border px-1">
              <button
                onClick={() => setFontSize(Math.max(12, fontSize - 1))}
                aria-label="Smaller text"
                className="grid size-7 place-items-center text-muted-foreground hover:text-foreground"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="w-6 text-center text-[11px] font-black text-foreground">{fontSize}</span>
              <button
                onClick={() => setFontSize(Math.min(22, fontSize + 1))}
                aria-label="Larger text"
                className="grid size-7 place-items-center text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
        {d.status === "translating" ? (
          <div className="mt-2.5">
            <ProgressBar value={d.progress} />
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">
              Translating section {Math.min(done + 1, data.sections.length)} of {data.sections.length} — you can read
              finished sections below while the rest complete.
            </div>
          </div>
        ) : null}
        {d.status === "ocr" ? (
          <div className="mt-2.5">
            <ProgressBar value={d.progress} />
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-j-cyan">
              <ScanText className="size-3.5 animate-pulse" />
              AI vision is reading your scanned page{d.progress > 50 ? "s" : ""}… it will translate automatically next.
            </div>
          </div>
        ) : null}
        {d.status === "needs_ocr" ? (
          <div className="mt-2.5 rounded-2xl bg-j-warning/10 p-3 text-[12.5px] leading-relaxed text-j-warning">
            ⚠️ <b>No selectable text found.</b> This looks like a scanned/image document. Tap the button below to read it
            with AI vision (OCR).
            <button
              onClick={() => retryOcr()}
              className="mt-2 flex min-h-10 items-center gap-1.5 rounded-xl bg-j-warning/15 px-3.5 text-[12.5px] font-black text-j-warning transition active:scale-95"
            >
              <ScanText className="size-4" /> Read with AI vision
              {d.pageRange ? <span className="opacity-80">· pages {d.pageRange.replace("-", "–")}</span> : null}
            </button>
            {d.fileType === "pdf" ? (
              <PageRangeEditor
                open={pgOpen}
                onToggle={() => openPagePicker(d.pageRange)}
                from={pgFrom}
                to={pgTo}
                setFrom={setPgFrom}
                setTo={setPgTo}
                current={d.pageRange}
                onRetry={() => {
                  const p = pickedPages();
                  if (!p) {
                    toast.error("Enter a valid range — e.g. 3 to 10.");
                    return;
                  }
                  retryOcr(p);
                }}
              />
            ) : null}
          </div>
        ) : null}
        {d.status === "failed" && data.sections.length === 0 ? (
          <div className="mt-2.5 rounded-2xl bg-j-error/10 p-3 text-[12.5px] leading-relaxed text-j-error">
            ⚠️ {d.error || "The document could not be processed."}
            <button
              onClick={() => retryOcr()}
              className="mt-2 flex min-h-10 items-center gap-1.5 rounded-xl bg-j-error/10 px-3.5 text-[12.5px] font-black text-j-error transition active:scale-95"
            >
              <RefreshCcw className="size-4" /> Try again
            </button>
            {d.fileType === "pdf" ? (
              <PageRangeEditor
                open={pgOpen}
                onToggle={() => openPagePicker(d.pageRange)}
                from={pgFrom}
                to={pgTo}
                setFrom={setPgFrom}
                setTo={setPgTo}
                current={d.pageRange}
                tone="error"
                onRetry={() => {
                  const p = pickedPages();
                  if (!p) {
                    toast.error("Enter a valid range — e.g. 3 to 10.");
                    return;
                  }
                  retryOcr(p);
                }}
              />
            ) : null}
          </div>
        ) : null}
        {d.status === "failed" && data.sections.length > 0 ? (
          <div className="mt-2.5 rounded-2xl bg-j-error/10 p-3 text-[12.5px] leading-relaxed text-j-error">
            ⚠️ {d.error || "Some sections failed."} Tap “Retry” on a failed section.
          </div>
        ) : null}
      </div>

      {searchOpen ? (
        <div className="border-b border-border/70 bg-card px-4 py-2.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search in this document…"
            className="min-h-10 w-full rounded-xl border border-border bg-background px-3 text-[14px] outline-none focus:border-primary/50"
          />
          {q ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {filtered.length} matching {filtered.length === 1 ? "section" : "sections"}
            </div>
          ) : null}
        </div>
      ) : null}

      {d.status !== "needs_ocr" && d.status !== "ocr" ? (
        <div className="border-b border-border/70 bg-card/50 px-4 py-2.5">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "translated", label: `📖 ${d.targetLang}` },
              { value: "original", label: `📄 ${d.sourceLang}` },
              { value: "compare", label: "⇄ Compare" },
            ]}
          />
        </div>
      ) : null}

      {/* body */}
      <div className="j-app-scroll flex-1 overflow-y-auto px-4 py-4">
        {onlySections ? (
          <div className="mb-3 flex items-center gap-2">
            <Chip tone="primary" onClick={() => setOnlySections(null)}>
              <X className="size-3.5" /> Clear filter ({onlySections.length})
            </Chip>
          </div>
        ) : null}

        {!filtered.length && q ? (
          <EmptyState icon="🔍" title="No matching sections" body={`Nothing found for “${q}”.`} />
        ) : null}

        {!q && !onlySections && d.status === "completed" ? (
          <div className="mb-3 flex gap-2 overflow-x-auto j-app-scroll pb-1">
            <Chip onClick={exportTxt} tone="success" className="shrink-0">
              <Download className="size-3.5" /> Export .txt
            </Chip>
            <Chip onClick={exportPdf} tone="primary" className="shrink-0">
              <FileDown className="size-3.5" /> Export PDF
            </Chip>
            <Chip onClick={makeFlashcards} tone="violet" className="shrink-0">
              {fcBusy ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-j-violet/40 border-t-j-violet" />
              ) : (
                <Layers className="size-3.5" />
              )}
              {fcBusy ? "Making…" : "Flashcards"}
            </Chip>
            <Chip
              onClick={() => {
                setAskOpen((o) => !o);
                setAskA(null);
              }}
              tone={askOpen ? "primary" : "cyan"}
              className="shrink-0"
            >
              <HelpCircle className="size-3.5" /> {askOpen ? "Close Ask AI" : "Ask AI"}
            </Chip>
            {data.bookmarks.slice(0, 4).map((b) => (
              <Chip
                key={b.id}
                onClick={() => b.sectionIdx !== null && setOnlySections([b.sectionIdx])}
                className="shrink-0"
              >
                <Star className="size-3.5 text-j-warning" /> {(b.label || "Bookmark").slice(0, 18)}
              </Chip>
            ))}
          </div>
        ) : null}

        {askOpen && d.status === "completed" ? (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
            <Card className="border-primary/25 bg-primary/[0.03] p-4">
              <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-primary">❓ Ask about this document</div>
              <div className="flex gap-2">
                <input
                  value={askQ}
                  onChange={(e) => setAskQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && askDoc()}
                  placeholder={`Ask anything — answered in ${d.targetLang}…`}
                  className="min-h-11 flex-1 rounded-xl border border-border bg-background px-3.5 text-[13.5px] outline-none focus:border-primary/50"
                />
                <button
                  onClick={askDoc}
                  disabled={askBusy || !askQ.trim()}
                  aria-label="Ask"
                  className="j-grad-primary grid size-11 shrink-0 place-items-center rounded-xl text-white shadow-md shadow-primary/25 transition active:scale-95 disabled:opacity-50"
                >
                  {askBusy ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <Send className="size-4.5" />
                  )}
                </button>
              </div>
              {askBusy ? (
                <div className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
                  <span className="size-3.5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                  Searching the document for the answer…
                </div>
              ) : null}
              {askA ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 rounded-2xl bg-card p-3.5 ring-1 ring-border">
                  <MarkdownBody text={askA} />
                </motion.div>
              ) : null}
            </Card>
          </motion.div>
        ) : null}

        <div className="space-y-4">
          {filtered.map((s) => (
            <SectionCard
              key={s.id}
              s={s}
              view={view}
              fontSize={fontSize}
              targetLang={d.targetLang}
              sourceLang={d.sourceLang}
              onBookmark={() => {
                setBmSection(s);
                setBmLabel(s.heading || `Section ${s.idx + 1}`);
                setBmSheet(true);
              }}
              onRetry={() => retrySection(s)}
            />
          ))}
        </div>

        {d.status === "completed" && !q ? (
          <div className="mt-5 rounded-3xl border border-dashed border-border p-5 text-center">
            <div className="text-2xl">🎉</div>
            <div className="mt-1 text-[15px] font-black text-foreground">You reached the end</div>
            <div className="text-[12.5px] text-muted-foreground">
              Full document translated {d.sourceLang} → {d.targetLang}
            </div>
            <button onClick={exportPdf} className="j-grad-primary mt-3 rounded-full px-5 py-2.5 text-[13px] font-black text-white shadow-lg shadow-primary/25">
              <FileDown className="mr-1 inline size-4" /> Export as PDF
            </button>
          </div>
        ) : null}
      </div>

      {/* bookmark create sheet */}
      {bmSheet && bmSection ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 z-50 flex items-end"
        >
          <button className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={() => setBmSheet(false)} />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            className="relative w-full rounded-t-[28px] border-t border-border bg-card p-5 pb-[max(env(safe-area-inset-bottom),20px)]"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
            <h3 className="text-base font-black text-foreground">
              Bookmark · Section {bmSection.idx + 1}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
              {(bmSection.heading ? bmSection.heading + " — " : "") +
                (bmSection.translated || bmSection.original).slice(0, 90)}
              …
            </p>
            <input
              value={bmLabel}
              onChange={(e) => setBmLabel(e.target.value)}
              placeholder="Label (e.g. Key theorem)"
              className="mt-3 min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-[14px] outline-none focus:border-primary/50"
            />
            <textarea
              value={bmNote}
              onChange={(e) => setBmNote(e.target.value)}
              placeholder="Optional note to future you…"
              rows={3}
              className="mt-2 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-[14px] outline-none focus:border-primary/50"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setBmSheet(false)}
                className="min-h-12 flex-1 rounded-2xl border border-border text-[14px] font-bold text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={saveBookmark}
                className="j-grad-primary min-h-12 flex-1 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25"
              >
                Save bookmark
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}

      {/* bookmarks list sheet */}
      <BmListSheet
        open={bmSheet && !bmSection}
        onClose={() => setBmSheet(false)}
        bookmarks={data.bookmarks}
        onJump={(idx) => {
          setOnlySections([idx]);
          setBmSheet(false);
        }}
      />
    </div>
  );
}

function BmListSheet({
  open,
  onClose,
  bookmarks,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  onJump: (idx: number) => void;
}) {
  if (!open) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-50 flex items-end">
      <button className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        className="relative max-h-[70%] w-full overflow-hidden rounded-t-[28px] border-t border-border bg-card"
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
        <h3 className="px-5 pt-2 text-base font-black text-foreground">Bookmarks & highlights</h3>
        <div className="j-app-scroll max-h-[52vh] overflow-y-auto px-4 py-3">
          {!bookmarks.length ? (
            <EmptyState icon="🔖" title="No bookmarks yet" body="Tap the bookmark icon on a section to save it." />
          ) : (
            <div className="space-y-2">
              {bookmarks.map((b) => (
                <Card key={b.id} className="p-3.5" onClick={() => b.sectionIdx !== null && onJump(b.sectionIdx)}>
                  <div className="flex items-center gap-2">
                    <Star className="size-4 shrink-0 fill-j-warning text-j-warning" />
                    <div className="truncate text-[13.5px] font-bold text-foreground">{b.label}</div>
                  </div>
                  {b.note ? <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{b.note}</div> : null}
                  {b.sectionIdx !== null ? (
                    <div className="mt-1 text-[11px] font-bold text-primary">Section {b.sectionIdx + 1} ↗</div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function SectionCard({
  s,
  view,
  fontSize,
  targetLang,
  sourceLang,
  onBookmark,
  onRetry,
}: {
  s: Section;
  view: "translated" | "original" | "compare";
  fontSize: number;
  targetLang: string;
  sourceLang: string;
  onBookmark: () => void;
  onRetry: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  if (s.status === "pending") {
    return (
      <Card className="flex items-center gap-3 p-4">
        <div className="size-5 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
        <div className="flex-1 text-[13px] font-semibold text-muted-foreground">
          Translating section {s.idx + 1}…
        </div>
      </Card>
    );
  }
  if (s.status === "failed") {
    return (
      <Card className="border-j-error/30 bg-j-error/5 p-4">
        <div className="text-[13px] font-bold text-j-error">Section {s.idx + 1} failed to translate</div>
        <button
          onClick={onRetry}
          className="mt-2 flex items-center gap-1.5 rounded-full bg-j-error/15 px-4 py-2 text-[12.5px] font-black text-j-error"
        >
          <RefreshCcw className="size-3.5" /> Retry section
        </button>
      </Card>
    );
  }
  const showT = view !== "original";
  const showO = view !== "translated";
  return (
    <motion.section layout className="j-shadow-soft overflow-hidden rounded-2xl border border-border/80 bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/40 px-4 py-2">
        <div className="min-w-0">
          {s.heading ? (
            <div className="truncate text-[13px] font-black text-foreground">{s.heading}</div>
          ) : (
            <div className="text-[12px] font-bold text-muted-foreground">Section {s.idx + 1}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => {
              navigator.clipboard
                .writeText((showT ? s.translated || "" : "") + (showT && showO ? "\n\n" : "") + (showO ? s.original : ""))
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
            }}
            aria-label="Copy section"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
          >
            {copied ? <span className="text-[11px] font-black text-j-success">✓</span> : <Copy className="size-4" />}
          </button>
          <button
            onClick={onBookmark}
            aria-label="Bookmark section"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-j-warning/10 hover:text-j-warning"
          >
            <BookmarkIcon className="size-4" />
          </button>
        </div>
      </header>
      {view === "compare" ? (
        <div className="divide-y divide-border/70">
          <div className="px-4 py-3">
            <div className="mb-1 text-[10.5px] font-black uppercase tracking-wider text-primary">📖 {targetLang}</div>
            <p style={{ fontSize }} className="whitespace-pre-wrap leading-relaxed text-foreground">
              {s.translated}
            </p>
          </div>
          <div className="bg-muted/30 px-4 py-3">
            <div className="mb-1 text-[10.5px] font-black uppercase tracking-wider text-muted-foreground">📄 {sourceLang} (original)</div>
            <p style={{ fontSize: fontSize - 1 }} className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {s.original}
            </p>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3.5">
          <div className="mb-1 text-[10.5px] font-black uppercase tracking-wider text-primary">
            {showO ? `📄 ${sourceLang}` : `📖 ${targetLang}`}
          </div>
          <p style={{ fontSize }} className="whitespace-pre-wrap leading-relaxed text-foreground">
            {showO ? s.original : s.translated}
          </p>
        </div>
      )}
    </motion.section>
  );
}

// Retry-path page-range picker for scanned PDFs: collapsible row under the
// OCR retry button — FROM/TO inputs (initialised from the stored range),
// the 8-page AI-vision budget is enforced server-side and hinted here.
function PageRangeEditor({
  open,
  onToggle,
  from,
  to,
  setFrom,
  setTo,
  current,
  onRetry,
  tone = "warning",
}: {
  open: boolean;
  onToggle: () => void;
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  current: string | null;
  onRetry: () => void;
  tone?: "warning" | "error";
}) {
  const f = parseInt(from, 10);
  const t = parseInt(to, 10);
  const span = f && t && t >= f ? t - f + 1 : 0;
  const tooWide = span > 8;
  return (
    <div className={cn("mt-2 rounded-xl border border-dashed p-2.5", tone === "warning" ? "border-j-warning/30" : "border-j-error/30")}>
      <button
        onClick={onToggle}
        className="flex min-h-9 w-full items-center gap-1.5 text-[11.5px] font-black"
        aria-expanded={open}
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {current ? `Reading pages ${current.replace("-", "–")}` : "Reading the first 8 pages"}
        <span className="ml-auto font-bold opacity-70">{open ? "hide" : "choose pages"}</span>
      </button>
      {open ? (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <label className="text-[10.5px] font-black uppercase tracking-wide opacity-70" htmlFor="pg-from">
              From
            </label>
            <input
              id="pg-from"
              type="number"
              min={1}
              inputMode="numeric"
              value={from}
              onChange={(e) => setFrom(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="min-h-10 w-16 rounded-lg border border-border bg-background px-2 text-center text-[13px] font-bold text-foreground outline-none focus:border-primary/50"
            />
            <span className="text-[12px] font-black opacity-60">–</span>
            <label className="text-[10.5px] font-black uppercase tracking-wide opacity-70" htmlFor="pg-to">
              To
            </label>
            <input
              id="pg-to"
              type="number"
              min={1}
              inputMode="numeric"
              value={to}
              onChange={(e) => setTo(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="min-h-10 w-16 rounded-lg border border-border bg-background px-2 text-center text-[13px] font-bold text-foreground outline-none focus:border-primary/50"
            />
            <button
              onClick={onRetry}
              disabled={!span || tooWide}
              className={cn(
                "ml-auto min-h-10 rounded-lg px-3.5 text-[12px] font-black text-white transition active:scale-95 disabled:opacity-50",
                tone === "warning" ? "bg-j-warning" : "bg-j-error"
              )}
            >
              Retry {span && !tooWide ? `pages ${from}–${to}` : "with range"}
            </button>
          </div>
          <p className={cn("mt-1.5 text-[10.5px] font-semibold", tooWide ? "font-black" : "opacity-70")}>
            {tooWide
              ? `AI vision reads at most 8 pages — ${span} is too wide. The server would trim it to ${from}–${parseInt(from, 10) + 7}.`
              : "PDF page numbers · the server trims the range to the real page count."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
