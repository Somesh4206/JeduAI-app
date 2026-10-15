"use client";
// JeduAI Notebook Studio — sources panel (list, select, add-source sheet)
import React from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Check,
  MoreVertical,
  Pencil,
  Trash2,
  RefreshCcw,
  FileUp,
  Link2,
  ClipboardList,
  GraduationCap,
  Eye,
  Youtube,
  Globe,
  FileText,
} from "lucide-react";
import { api, ApiError, timeAgo } from "../store";
import { Button } from "@/components/ui/button";
import { Card, Chip, EmptyState, ErrorState, Loader, PillSpan, ProgressBar, Segmented, Sheet, SkeletonList, toast } from "../ui";
import { cn } from "@/lib/utils";
import { kindMeta, sourceMetaLine } from "./shared";
import type { SourceDTO } from "@/lib/jeduai/notebook/types";

type AddTab = "upload" | "link" | "paste" | "mine";

export function SourcesPanel({
  notebookId,
  sources,
  loading,
  err,
  onRetry,
  onChanged,
  onOpenSource,
}: {
  notebookId: string;
  sources: SourceDTO[] | null;
  loading: boolean;
  err: string;
  onRetry: () => void;
  onChanged: () => void;
  onOpenSource: (s: SourceDTO) => void;
}) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [menuFor, setMenuFor] = React.useState<SourceDTO | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");
  const [toggleBusy, setToggleBusy] = React.useState<string | null>(null);

  const list = sources || [];
  const selectedCount = list.filter((s) => s.selected).length;

  async function toggleSelected(s: SourceDTO) {
    if (toggleBusy) return;
    setToggleBusy(s.id);
    const next = !s.selected;
    // optimistic flip handled by parent refetch; patch then reload
    try {
      await api(`/api/jeduai/notebook/${notebookId}/sources/${s.id}`, { method: "PATCH", json: { selected: next } });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToggleBusy(null);
    }
  }

  async function retrySource(s: SourceDTO) {
    try {
      await api(`/api/jeduai/notebook/${notebookId}/sources/${s.id}`, { method: "PATCH", json: { action: "retry" } });
      toast.success("Re-processing source…");
      setMenuFor(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteSource(s: SourceDTO) {
    if (!confirm(`Delete source "${s.title.slice(0, 50)}"?`)) return;
    try {
      await api(`/api/jeduai/notebook/${notebookId}/sources/${s.id}`, { method: "DELETE" });
      toast.success("Source removed");
      setMenuFor(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function renameSource(s: SourceDTO) {
    if (!renameVal.trim()) return;
    try {
      await api(`/api/jeduai/notebook/${notebookId}/sources/${s.id}`, { method: "PATCH", json: { title: renameVal.trim() } });
      toast.success("Renamed");
      setRenameOpen(false);
      setMenuFor(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/85 px-4 py-3 backdrop-blur">
        <h2 className="text-[15px] font-bold tracking-tight text-foreground">Sources</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{list.length}</span>
        {list.length ? (
          <span className="truncate text-[11px] font-semibold text-muted-foreground">· {selectedCount} of {list.length} selected for AI</span>
        ) : null}
        <Button size="sm" onClick={() => setAddOpen(true)} className="j-grad-primary ml-auto h-9 gap-1.5 rounded-full px-4 text-[12.5px] font-bold text-white shadow-md shadow-primary/25 hover:opacity-95">
          <Plus className="size-4" /> Add source
        </Button>
      </div>

      {/* list */}
      <div className="j-app-scroll flex-1 overflow-y-auto px-3.5 py-3 pb-8">
        {err && !list.length ? (
          <ErrorState message={err} onRetry={onRetry} />
        ) : loading && !list.length ? (
          <SkeletonList rows={4} />
        ) : !list.length ? (
          <EmptyState
            icon="📚"
            title="Add your first source"
            body="Upload PDFs, docs, images or audio, import web pages & YouTube videos, or pull in your translated JeduAI material."
            action={
              <Button size="sm" onClick={() => setAddOpen(true)} className="j-grad-primary h-10 rounded-full px-5 font-bold text-white shadow-md shadow-primary/25">
                <Plus className="size-4" /> Add source
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {err ? (
              <div className="rounded-2xl border border-j-warning/30 bg-j-warning/8 px-3.5 py-2 text-[12px] font-semibold text-j-warning">
                Couldn't refresh: {err}
              </div>
            ) : null}
            {list.map((s, i) => {
              const km = kindMeta(s.kind);
              const busy = s.status === "queued" || s.status === "processing";
              return (
                <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.025, 0.3) }}>
                  <Card className="overflow-hidden p-0">
                    <button onClick={() => onOpenSource(s)} className="flex w-full items-start gap-3 p-3.5 text-left transition hover:bg-muted/30 active:scale-[0.99]">
                      <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl", km.tint)}>
                        <km.icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-bold text-foreground">{s.title}</span>
                          <PillSpan
                            tone={s.status === "ready" ? "success" : s.status === "failed" ? "error" : "primary"}
                            className="shrink-0 px-2 py-0.5 text-[10.5px]"
                          >
                            {s.status === "ready" ? "Ready" : s.status === "failed" ? "Failed" : s.status === "processing" ? "Processing" : "Queued"}
                          </PillSpan>
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                          {km.label} · {sourceMetaLine(s) || "extracting…"} · {timeAgo(s.createdAt)}
                        </span>
                        {busy && s.progress > 0 ? (
                          <span className="mt-2 block">
                            <ProgressBar value={s.progress} />
                          </span>
                        ) : null}
                        {s.status === "failed" ? (
                          <span className="mt-1.5 block line-clamp-2 text-[11.5px] font-semibold leading-snug text-j-error">{s.error || "Processing failed"}</span>
                        ) : null}
                      </span>
                    </button>
                    <div className="flex border-t border-border/70">
                      <button
                        onClick={() => toggleSelected(s)}
                        disabled={toggleBusy === s.id || s.status !== "ready"}
                        aria-pressed={s.selected}
                        className={cn(
                          "flex min-h-10 flex-1 items-center justify-center gap-1.5 text-[12px] font-bold transition disabled:opacity-40",
                          s.selected ? "text-primary hover:bg-primary/5" : "text-muted-foreground hover:text-primary"
                        )}
                      >
                        {toggleBusy === s.id ? (
                          <span className="size-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                        ) : (
                          <span
                            className={cn(
                              "grid size-4 place-items-center rounded-[5px] border",
                              s.selected ? "j-grad-primary border-transparent text-white" : "border-border"
                            )}
                          >
                            {s.selected ? <Check className="size-3" /> : null}
                          </span>
                        )}
                        {s.selected ? "Selected" : "Select"}
                      </button>
                      <button
                        onClick={() => setMenuFor(s)}
                        aria-label={`Options for ${s.title}`}
                        className="grid min-h-10 w-12 place-items-center border-l border-border/70 text-muted-foreground transition hover:text-foreground"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* per-source menu */}
      <Sheet open={!!menuFor} onOpenChange={(v) => !v && setMenuFor(null)} title={menuFor?.title}>
        <div className="space-y-1.5 pb-2">
          {menuFor ? (
            <>
              <MenuRow
                icon={Eye}
                label="View passages"
                onClick={() => {
                  const s = menuFor;
                  setMenuFor(null);
                  onOpenSource(s);
                }}
              />
              <MenuRow
                icon={Pencil}
                label="Rename"
                onClick={() => {
                  setRenameVal(menuFor.title);
                  setRenameOpen(true);
                }}
              />
              {menuFor.status === "failed" ? (
                <MenuRow icon={RefreshCcw} label="Retry processing" onClick={() => retrySource(menuFor)} />
              ) : null}
              <MenuRow icon={Trash2} label="Delete source" danger onClick={() => deleteSource(menuFor)} />
            </>
          ) : null}
        </div>
      </Sheet>

      {/* rename */}
      <Sheet open={renameOpen} onOpenChange={setRenameOpen} title="Rename source">
        <div className="space-y-3 pb-2">
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            maxLength={90}
            aria-label="Source title"
            className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
          />
          <button
            onClick={() => renameSource(menuFor!)}
            className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25"
          >
            Save
          </button>
        </div>
      </Sheet>

      <AddSourceSheet notebookId={notebookId} open={addOpen} onOpenChange={setAddOpen} onAdded={onChanged} />
    </div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold transition active:scale-[0.99]",
        danger ? "text-j-error hover:bg-j-error/8" : "text-foreground hover:bg-muted"
      )}
    >
      <Icon className="size-4.5" /> {label}
    </button>
  );
}

// =====================================================================
// Add source sheet — 4 tabs
// =====================================================================
function AddSourceSheet({
  notebookId,
  open,
  onOpenChange,
  onAdded,
}: {
  notebookId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [tab, setTab] = React.useState<AddTab>("upload");
  const [busy, setBusy] = React.useState(false);

  // upload
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileTitle, setFileTitle] = React.useState("");
  // link
  const [url, setUrl] = React.useState("");
  const [linkKind, setLinkKind] = React.useState<"web" | "youtube">("web");
  // paste
  const [pasteTitle, setPasteTitle] = React.useState("");
  const [pasteText, setPasteText] = React.useState("");
  // my learning
  const [docs, setDocs] = React.useState<{ id: string; title: string; status: string; sections: number; sectionsDone: number }[] | null>(null);
  const [vids, setVids] = React.useState<{ id: string; title: string; status: string; segments: number; durationSec: number | null }[] | null>(null);
  const [mineBusy, setMineBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFile(null);
    setFileTitle("");
    setUrl("");
    setLinkKind("web");
    setPasteTitle("");
    setPasteText("");
    setBusy(false);
  }, [open]);

  React.useEffect(() => {
    if (!open || tab !== "mine" || docs || vids) return;
    api<{ documents: { id: string; title: string; status: string; sections: number; sectionsDone: number }[] }>("/api/jeduai/documents")
      .then((r) => setDocs(r.documents || []))
      .catch(() => setDocs([]));
    api<{ videos: { id: string; title: string; status: string; segments: number; durationSec: number | null }[] }>("/api/jeduai/video")
      .then((r) => setVids((r.videos || []).filter((v) => v.segments > 0)))
      .catch(() => setVids([]));
  }, [open, tab, docs, vids]);

  function onUrlChange(v: string) {
    setUrl(v);
    if (/youtu\.?be/i.test(v)) setLinkKind("youtube");
    else if (/^https?:\/\//i.test(v)) setLinkKind("web");
  }

  async function addUpload() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (fileTitle.trim()) fd.append("title", fileTitle.trim());
      await api(`/api/jeduai/notebook/${notebookId}/sources`, { method: "POST", body: fd });
      toast.success("Source added — processing…");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addLink() {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/sources`, {
        method: "POST",
        json: { kind: linkKind, url: url.trim() },
      });
      toast.success(linkKind === "youtube" ? "Importing YouTube video…" : "Importing web page…");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addPaste() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/sources`, {
        method: "POST",
        json: { kind: "pasted", title: pasteTitle.trim() || "Pasted note", text: pasteText },
      });
      toast.success("Pasted text added");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addMine(kind: "document" | "videoproject", refId: string) {
    if (mineBusy || busy) return;
    setMineBusy(refId);
    try {
      await api(`/api/jeduai/notebook/${notebookId}/sources`, { method: "POST", json: { kind, refId } });
      toast.success(kind === "document" ? "Document imported" : "Transcript imported");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast.info("Already in this notebook");
      else toast.error((e as Error).message);
    } finally {
      setMineBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add source">
      <div className="space-y-4 pb-2">
        <Segmented<AddTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "upload", label: "Upload" },
            { value: "link", label: "Link" },
            { value: "paste", label: "Paste" },
            { value: "mine", label: "My Learning" },
          ]}
        />

        {tab === "upload" ? (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,image/*,audio/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-border bg-muted/30 px-4 py-8 text-center transition hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99]"
            >
              <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <FileUp className="size-6" />
              </span>
              {file ? (
                <>
                  <span className="max-w-full truncate text-[13.5px] font-bold text-foreground">{file.name}</span>
                  <span className="text-[11.5px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB · tap to change</span>
                </>
              ) : (
                <>
                  <span className="text-[13.5px] font-bold text-foreground">Tap to choose a file</span>
                  <span className="max-w-[280px] text-[11.5px] leading-relaxed text-muted-foreground">
                    PDF ≤ 15MB · DOCX/TXT/MD ≤ 10MB · images ≤ 8MB (AI-OCR) · audio ≤ 60MB (transcribed)
                  </span>
                </>
              )}
            </button>
            <input
              value={fileTitle}
              onChange={(e) => setFileTitle(e.target.value)}
              maxLength={90}
              placeholder="Title (optional)"
              aria-label="Source title"
              className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
            />
            <AddBtn onClick={addUpload} disabled={!file} busy={busy} label="Add source" />
          </div>
        ) : null}

        {tab === "link" ? (
          <div className="space-y-3">
            <input
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://… or YouTube link"
              inputMode="url"
              aria-label="URL"
              className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
            />
            <div className="flex gap-2">
              <Chip active={linkKind === "web"} onClick={() => setLinkKind("web")} className="flex-1 justify-center">
                <Globe className="size-3.5" /> Web page
              </Chip>
              <Chip active={linkKind === "youtube"} onClick={() => setLinkKind("youtube")} className="flex-1 justify-center">
                <Youtube className="size-3.5" /> YouTube video
              </Chip>
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">Public pages and YouTube videos with captions.</p>
            <AddBtn onClick={addLink} disabled={!url.trim()} busy={busy} label="Import" />
          </div>
        ) : null}

        {tab === "paste" ? (
          <div className="space-y-3">
            <input
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              maxLength={90}
              placeholder="Title (e.g. Class notes — Chapter 4)"
              aria-label="Pasted text title"
              className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
            />
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={7}
              maxLength={50000}
              placeholder="Paste your notes, an article, or any study text (min 20 characters)…"
              aria-label="Pasted text"
              className="j-app-scroll min-h-36 w-full resize-none rounded-2xl border border-border bg-background p-3.5 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
            />
            <div className={cn("text-[11.5px]", pasteText.trim().length < 20 ? "text-muted-foreground" : "text-j-success")}>
              {pasteText.trim().length} characters {pasteText.trim().length < 20 ? "· at least 20 needed" : "· ready"}
            </div>
            <AddBtn onClick={addPaste} disabled={pasteText.trim().length < 20} busy={busy} label="Add text" />
          </div>
        ) : null}

        {tab === "mine" ? (
          <div className="space-y-4">
            {docs === null || vids === null ? (
              <Loader label="Loading your learning material…" />
            ) : (
              <>
                <div>
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-black uppercase tracking-wide text-muted-foreground">
                    <FileText className="size-3.5" /> Translated documents
                  </div>
                  {!docs.length ? (
                    <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-center text-[12.5px] text-muted-foreground">No documents yet</div>
                  ) : (
                    <div className="space-y-2">
                      {docs.map((d) => {
                        const ok = d.sectionsDone > 0;
                        return (
                          <div key={d.id} className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-3">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-bold text-foreground">{d.title}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {d.sectionsDone}/{d.sections} sections translated
                              </div>
                            </div>
                            {ok ? (
                              <button
                                onClick={() => addMine("document", d.id)}
                                disabled={mineBusy === d.id}
                                aria-label={`Import ${d.title}`}
                                className="j-grad-primary grid size-9 shrink-0 place-items-center rounded-full text-white shadow-md shadow-primary/25 transition active:scale-90 disabled:opacity-50"
                              >
                                {mineBusy === d.id ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Plus className="size-4.5" />}
                              </button>
                            ) : (
                              <PillSpan tone="muted" className="shrink-0 px-2 py-0.5 text-[10.5px]">
                                {d.status}
                              </PillSpan>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-black uppercase tracking-wide text-muted-foreground">
                    <GraduationCap className="size-3.5" /> Media transcripts
                  </div>
                  {!vids.length ? (
                    <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-center text-[12.5px] text-muted-foreground">No transcripts yet</div>
                  ) : (
                    <div className="space-y-2">
                      {vids.map((v) => (
                        <div key={v.id} className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-bold text-foreground">{v.title}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {v.segments} segments{v.durationSec ? ` · ${Math.round(v.durationSec / 60)} min` : ""}
                            </div>
                          </div>
                          <button
                            onClick={() => addMine("videoproject", v.id)}
                            disabled={mineBusy === v.id}
                            aria-label={`Import ${v.title}`}
                            className="j-grad-primary grid size-9 shrink-0 place-items-center rounded-full text-white shadow-md shadow-primary/25 transition active:scale-90 disabled:opacity-50"
                          >
                            {mineBusy === v.id ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Plus className="size-4.5" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="flex items-start gap-1.5 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  <Link2 className="mt-0.5 size-3.5 shrink-0" />
                  Imports stay linked — the notebook reads the translated text from your library.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function AddBtn({ onClick, disabled, busy, label }: { onClick: () => void; disabled?: boolean; busy?: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="j-grad-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-[0.99] disabled:opacity-40"
    >
      {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <ClipboardList className="size-4" />}
      {busy ? "Adding…" : label}
    </button>
  );
}
