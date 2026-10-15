"use client";
// JeduAI Notebook Studio — main screen (notebook list + workspace + desktop portal)
import React from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { NotebookPen, Plus, ChevronRight, MoreVertical, Pencil, Trash2, X, Layers, Sparkles, Headphones } from "lucide-react";
import { api, useJedu, timeAgo } from "../store";
import { Card, EmptyState, ErrorState, Loader, Segmented, Sheet, SkeletonList, TopBar, toast } from "../ui";
import { isBusyStatus, SourceViewerSheet, useIsDesktop } from "../notebook/shared";
import { SourcesPanel } from "../notebook/sources-panel";
import { ChatPanel } from "../notebook/chat-panel";
import { StudioPanel } from "../notebook/studio-panel";
import { ArtifactViewer } from "../notebook/artifact-views";
import type { ArtifactDTO, Citation, NotebookDTO, SourceDTO } from "@/lib/jeduai/notebook/types";

type Tab = "sources" | "chat" | "studio";

export default function NotebookStudioScreen({ notebookId, openArtifactId }: { notebookId?: string; openArtifactId?: string }) {
  const pop = useJedu((s) => s.pop);
  const [openId, setOpenId] = React.useState<string | null>(notebookId ?? null);
  // deep-linked (pushed with an id): back should pop the whole screen; otherwise back = list
  const [deepLinked] = React.useState(!!notebookId);
  const [listTick, setListTick] = React.useState(0);

  return openId ? (
    <NotebookWorkspace
      key={openId}
      notebookId={openId}
      openArtifactId={openArtifactId}
      deepLinked={deepLinked}
      onExit={() => {
        setOpenId(null);
        setListTick((t) => t + 1);
      }}
    />
  ) : (
    <NotebookList tick={listTick} onOpen={(id) => setOpenId(id)} onBack={pop} />
  );
}

// =====================================================================
// Notebook list (in-shell)
// =====================================================================
function NotebookList({ tick, onOpen, onBack }: { tick: number; onOpen: (id: string) => void; onBack?: () => void }) {
  const [notebooks, setNotebooks] = React.useState<NotebookDTO[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [menuFor, setMenuFor] = React.useState<NotebookDTO | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");

  const pageSize = 20;
  const load = React.useCallback(
    (append: boolean) => {
      const page = append ? Math.floor((notebooks?.length || 0) / pageSize) + 1 : 1;
      setLoading(true);
      if (!append) setErr("");
      api<{ notebooks: NotebookDTO[]; total: number }>(`/api/jeduai/notebook?page=${page}&pageSize=${pageSize}`)
        .then((r) => {
          setNotebooks((prev) => {
            const next = r.notebooks || [];
            if (!append) return next;
            const ids = new Set((prev || []).map((n) => n.id));
            return [...(prev || []), ...next.filter((n) => !ids.has(n.id))];
          });
          setTotal(r.total || 0);
        })
        .catch((e) => setErr((e as Error).message))
        .finally(() => setLoading(false));
    },
    [notebooks]
  );

  React.useEffect(() => {
    setNotebooks(null);
    setTotal(0);
    load(false);
  }, [tick]);

  async function create() {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const r = await api<{ notebook: NotebookDTO }>("/api/jeduai/notebook", {
        method: "POST",
        json: { title: title.trim(), ...(desc.trim() ? { description: desc.trim() } : {}) },
      });
      toast.success("Notebook created — add your first sources");
      setCreateOpen(false);
      onOpen(r.notebook.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function rename() {
    if (!menuFor || !renameVal.trim()) return;
    try {
      await api(`/api/jeduai/notebook/${menuFor.id}`, { method: "PATCH", json: { title: renameVal.trim() } });
      toast.success("Renamed");
      setRenameOpen(false);
      setMenuFor(null);
      load(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(nb: NotebookDTO) {
    if (!confirm(`Delete notebook "${nb.title}"? All its sources, chats and artifacts will be removed.`)) return;
    try {
      await api(`/api/jeduai/notebook/${nb.id}`, { method: "DELETE" });
      toast.success("Notebook deleted");
      setMenuFor(null);
      load(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <TopBar gradient title="AI Notebook Studio" subtitle="Research workspace with grounded AI" onBack={onBack} />

      <div className="j-app-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {/* create banner */}
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => {
            setTitle("");
            setDesc("");
            setCreateOpen(true);
          }}
          className="relative w-full overflow-hidden rounded-3xl bg-gradient-to-br from-j-violet via-j-violet/85 to-primary/70 p-5 text-left text-white shadow-xl shadow-j-violet/25 transition active:scale-[0.98]"
          aria-label="Create a new notebook"
        >
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-14 size-40 rounded-full bg-white/12" />
          <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-8 size-36 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/18 backdrop-blur">
              <NotebookPen className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-black leading-tight">New notebook</div>
              <div className="mt-0.5 text-[12px] leading-snug text-white/85">Add sources, ask grounded questions, generate study artifacts</div>
            </div>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-j-violet shadow-lg">
              <Plus className="size-5" />
            </span>
          </div>
          <div className="relative mt-3 flex flex-wrap gap-1.5">
            {[
              { icon: Headphones, label: "Audio" },
              { icon: Sparkles, label: "Chat" },
              { icon: Layers, label: "Flashcards" },
            ].map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10.5px] font-bold backdrop-blur">
                <c.icon className="size-3" /> {c.label}
              </span>
            ))}
          </div>
        </motion.button>

        {/* list */}
        <div className="mb-2 mt-5 flex items-end justify-between px-1">
          <h2 className="text-[15px] font-bold tracking-tight text-foreground">Your notebooks</h2>
          {total > 0 ? <span className="text-[11.5px] font-bold text-muted-foreground">{total} total</span> : null}
        </div>
        {err && !notebooks?.length ? (
          <ErrorState message={err} onRetry={() => load(false)} />
        ) : notebooks === null ? (
          <SkeletonList rows={3} />
        ) : !notebooks.length ? (
          <EmptyState
            icon="📓"
            title="No notebooks yet"
            body="Create your first research notebook — bring PDFs, videos, links and notes together, then let AI do the studying with you."
            action={
              <button
                onClick={() => setCreateOpen(true)}
                className="j-grad-violet flex min-h-11 items-center gap-2 rounded-full px-5 text-[13.5px] font-black text-white shadow-lg shadow-j-violet/25 transition active:scale-95"
              >
                <Plus className="size-4" /> New notebook
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {notebooks.map((nb, i) => (
              <motion.div key={nb.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
                <Card className="overflow-hidden p-0">
                  <div className="flex w-full items-center gap-3 p-3.5">
                    <button onClick={() => onOpen(nb.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left transition hover:bg-muted/30 active:scale-[0.99]">
                      <span className="j-grad-violet grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-md shadow-j-violet/20">
                        <NotebookPen className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold text-foreground">{nb.title}</span>
                        {nb.description ? <span className="block truncate text-[11.5px] text-muted-foreground">{nb.description}</span> : null}
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {nb.sourceCount} source{nb.sourceCount === 1 ? "" : "s"} · {nb.readySources} ready · {nb.artifactCount} artifact{nb.artifactCount === 1 ? "" : "s"} · {timeAgo(nb.updatedAt)}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => {
                        setRenameVal(nb.title);
                        setMenuFor(nb);
                      }}
                      aria-label={`Options for ${nb.title}`}
                      className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                  </div>
                </Card>
              </motion.div>
            ))}
            {notebooks.length < total ? (
              <button
                onClick={() => load(true)}
                disabled={loading}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border text-[13px] font-bold text-primary transition hover:bg-primary/5 disabled:opacity-50"
              >
                {loading ? <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : null}
                Load more ({notebooks.length} of {total})
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* create sheet */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen} title="New notebook">
        <div className="space-y-3 pb-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={90}
            placeholder="Notebook title (e.g. Biology — Chapter 4)"
            aria-label="Notebook title"
            className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="What's this notebook for? (optional)"
            aria-label="Notebook description"
            className="j-app-scroll min-h-20 w-full resize-none rounded-2xl border border-border bg-background p-3.5 text-[13.5px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
          />
          <button
            onClick={create}
            disabled={!title.trim() || creating}
            className="j-grad-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-[0.99] disabled:opacity-40"
          >
            {creating ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Plus className="size-4" />}
            {creating ? "Creating…" : "Create notebook"}
          </button>
        </div>
      </Sheet>

      {/* per-notebook menu */}
      <Sheet open={!!menuFor} onOpenChange={(v) => !v && setMenuFor(null)} title={menuFor?.title}>
        <div className="space-y-1.5 pb-2">
          {menuFor ? (
            <>
              <button
                onClick={() => setRenameOpen(true)}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold text-foreground transition hover:bg-muted"
              >
                <Pencil className="size-4.5" /> Rename
              </button>
              <button
                onClick={() => remove(menuFor)}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-bold text-j-error transition hover:bg-j-error/8"
              >
                <Trash2 className="size-4.5" /> Delete notebook
              </button>
            </>
          ) : null}
        </div>
      </Sheet>

      <Sheet open={renameOpen} onOpenChange={setRenameOpen} title="Rename notebook">
        <div className="space-y-3 pb-2">
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            maxLength={90}
            aria-label="Notebook title"
            className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
          />
          <button onClick={rename} className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25">
            Save
          </button>
        </div>
      </Sheet>
    </div>
  );
}

// =====================================================================
// Notebook workspace (mobile tabs / desktop 3-column portal)
// =====================================================================
function NotebookWorkspace({
  notebookId,
  openArtifactId,
  deepLinked,
  onExit,
}: {
  notebookId: string;
  openArtifactId?: string;
  deepLinked: boolean;
  onExit: () => void;
}) {
  const pop = useJedu((s) => s.pop);
  const isDesktop = useIsDesktop();
  const [nb, setNb] = React.useState<NotebookDTO | null>(null);
  const [nbErr, setNbErr] = React.useState("");
  const [tab, setTab] = React.useState<Tab>("sources");
  const [sources, setSources] = React.useState<SourceDTO[] | null>(null);
  const [sourcesLoading, setSourcesLoading] = React.useState(false);
  const [sourcesErr, setSourcesErr] = React.useState("");
  const [artifacts, setArtifacts] = React.useState<ArtifactDTO[]>([]);
  const [artifactsTotal, setArtifactsTotal] = React.useState(0);
  const [artifactsLoading, setArtifactsLoading] = React.useState(false);
  const [artifactsErr, setArtifactsErr] = React.useState("");
  const [viewArtifactId, setViewArtifactId] = React.useState<string | null>(null);
  const [viewSource, setViewSource] = React.useState<SourceDTO | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");
  const deepLinkHandled = React.useRef(false);

  // Switching tabs while a viewer overlay is open would leave the dialog
  // dangling above the newly selected panel — dismiss overlays on tab change.
  const changeTab = React.useCallback((t: Tab) => {
    setTab(t);
    setViewArtifactId(null);
    setViewSource(null);
  }, []);

  const loadNb = React.useCallback(async () => {
    try {
      const r = await api<{ notebook: NotebookDTO }>(`/api/jeduai/notebook/${notebookId}`);
      setNb(r.notebook);
      setNbErr("");
    } catch (e) {
      setNbErr((e as Error).message);
    }
  }, [notebookId]);

  const loadSources = React.useCallback(async () => {
    setSourcesLoading(true);
    try {
      const r = await api<{ sources: SourceDTO[]; total: number }>(`/api/jeduai/notebook/${notebookId}/sources?page=1&pageSize=100`);
      setSources(r.sources || []);
      setSourcesErr("");
    } catch (e) {
      setSourcesErr((e as Error).message);
    } finally {
      setSourcesLoading(false);
    }
  }, [notebookId]);

  const artLenRef = React.useRef(0);
  React.useEffect(() => {
    artLenRef.current = artifacts.length;
  }, [artifacts]);

  const loadArtifacts = React.useCallback(async () => {
    const pageSize = Math.max(20, artLenRef.current);
    setArtifactsLoading(true);
    try {
      const r = await api<{ artifacts: ArtifactDTO[]; total: number }>(`/api/jeduai/notebook/${notebookId}/artifacts?page=1&pageSize=${pageSize}`);
      setArtifacts(r.artifacts || []);
      setArtifactsTotal(r.total || 0);
      setArtifactsErr("");
    } catch (e) {
      setArtifactsErr((e as Error).message);
    } finally {
      setArtifactsLoading(false);
    }
  }, [notebookId]);

  const loadMoreArtifacts = React.useCallback(async () => {
    const page = Math.floor(artLenRef.current / 20) + 1;
    setArtifactsLoading(true);
    try {
      const r = await api<{ artifacts: ArtifactDTO[]; total: number }>(`/api/jeduai/notebook/${notebookId}/artifacts?page=${page}&pageSize=20`);
      setArtifacts((prev) => {
        const ids = new Set(prev.map((x) => x.id));
        return [...prev, ...(r.artifacts || []).filter((x) => !ids.has(x.id))];
      });
      setArtifactsTotal(r.total || 0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setArtifactsLoading(false);
    }
  }, [notebookId]);

  React.useEffect(() => {
    loadNb();
    loadSources();
    loadArtifacts();
  }, [loadNb, loadSources, loadArtifacts]);

  // deep-link: open a specific artifact right away
  React.useEffect(() => {
    if (deepLinkHandled.current || !openArtifactId || !nb) return;
    deepLinkHandled.current = true;
    setViewArtifactId(openArtifactId);
  }, [openArtifactId, nb]);

  // single gated polling interval: sources or artifacts still processing
  const sourceBusy = (sources || []).some((s) => isBusyStatus(s.status));
  const artifactBusy = artifacts.some((a) => isBusyStatus(a.status));
  React.useEffect(() => {
    if (!sourceBusy && !artifactBusy) return;
    const t = setInterval(() => {
      loadSources();
      loadArtifacts();
    }, 2500);
    return () => clearInterval(t);
  }, [sourceBusy, artifactBusy, loadSources, loadArtifacts]);

  function changed() {
    loadSources();
    loadArtifacts();
    loadNb();
  }

  const openSourceByCitation = React.useCallback(
    (c: Citation) => {
      const s = (sources || []).find((x) => x.id === c.sourceId);
      if (s) setViewSource(s);
      else toast.info("That source is no longer in this notebook.");
    },
    [sources]
  );

  async function renameNotebook() {
    if (!nb || !renameVal.trim()) return;
    try {
      await api(`/api/jeduai/notebook/${nb.id}`, { method: "PATCH", json: { title: renameVal.trim() } });
      toast.success("Renamed");
      setRenameOpen(false);
      setNb({ ...nb, title: renameVal.trim() });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (nbErr && !nb) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <TopBar title="Notebook" onBack={() => (deepLinked ? pop() : onExit())} />
        <div className="px-4 pt-6">
          <ErrorState message={nbErr} onRetry={loadNb} />
        </div>
      </div>
    );
  }

  if (!nb) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar title="Notebook" onBack={() => (deepLinked ? pop() : onExit())} />
        <Loader label="Opening notebook…" />
      </div>
    );
  }

  const sourceCount = sources?.length ?? nb.sourceCount;
  const artifactCount = artifactsTotal || nb.artifactCount;
  const back = () => (deepLinked ? pop() : onExit());

  const panels = {
    sources: (
      <SourcesPanel
        notebookId={notebookId}
        sources={sources}
        loading={sourcesLoading}
        err={sourcesErr}
        onRetry={loadSources}
        onChanged={changed}
        onOpenSource={(s) => setViewSource(s)}
      />
    ),
    chat: (
      <ChatPanel
        notebookId={notebookId}
        notebookTitle={nb.title}
        sources={sources}
        onOpenSource={openSourceByCitation}
        onGoSources={() => setTab("sources")}
      />
    ),
    studio: (
      <StudioPanel
        notebookId={notebookId}
        sources={sources}
        artifacts={artifacts}
        total={artifactsTotal}
        loading={artifactsLoading}
        err={artifactsErr}
        onRetry={loadArtifacts}
        onChanged={changed}
        onLoadMore={loadMoreArtifacts}
        onOpenArtifact={(a) => setViewArtifactId(a.id)}
      />
    ),
  };

  const overlays = (
    <>
      {viewArtifactId ? (
        <ArtifactViewer
          notebookId={notebookId}
          artifactId={viewArtifactId}
          onClose={() => setViewArtifactId(null)}
          onChanged={changed}
          onDeleted={() => {
            setViewArtifactId(null);
            changed();
          }}
          sources={sources || []}
          onOpenSource={openSourceByCitation}
        />
      ) : null}
      <SourceViewerSheet
        notebookId={notebookId}
        source={viewSource}
        open={!!viewSource}
        onOpenChange={(v) => {
          if (!v) setViewSource(null);
        }}
        onChanged={changed}
      />
      <Sheet open={renameOpen} onOpenChange={setRenameOpen} title="Rename notebook">
        <div className="space-y-3 pb-2">
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            maxLength={90}
            aria-label="Notebook title"
            className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary/50"
          />
          <button onClick={renameNotebook} className="j-grad-primary min-h-12 w-full rounded-2xl text-[14px] font-black text-white shadow-lg shadow-primary/25">
            Save
          </button>
        </div>
      </Sheet>
    </>
  );

  // ---------- desktop: NotebookLM-style workspace via portal ----------
  if (isDesktop) {
    return createPortal(
      <div className="fixed inset-0 z-[90] flex flex-col bg-background" role="dialog" aria-label={`${nb.title} — Notebook Studio`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-card/85 px-5 py-3 backdrop-blur">
          <span className="j-grad-primary grid size-9 shrink-0 place-items-center rounded-xl text-[15px] font-black text-white shadow-md shadow-primary/25">J</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[16px] font-black leading-tight text-foreground">{nb.title}</span>
              <button
                onClick={() => {
                  setRenameVal(nb.title);
                  setRenameOpen(true);
                }}
                aria-label="Rename notebook"
                className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              Notebook Studio · {sourceCount} source{sourceCount === 1 ? "" : "s"} · {artifactCount} artifact{artifactCount === 1 ? "" : "s"}
            </div>
          </div>
          <button
            onClick={back}
            aria-label="Close workspace"
            className="grid size-10 shrink-0 place-items-center rounded-full border border-border text-foreground/80 transition hover:bg-muted active:scale-95"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_340px]">
          <div className="flex min-h-0 flex-col border-r border-border/60">{panels.sources}</div>
          <div className="flex min-h-0 flex-col">{panels.chat}</div>
          <div className="flex min-h-0 flex-col border-l border-border/60">{panels.studio}</div>
        </div>
        {overlays}
      </div>,
      document.body
    );
  }

  // ---------- mobile: tabs in the app shell ----------
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <TopBar
        gradient
        onBack={back}
        title={nb.title}
        subtitle={`${sourceCount} source${sourceCount === 1 ? "" : "s"} · ${artifactCount} artifact${artifactCount === 1 ? "" : "s"}`}
        right={
          <button
            onClick={() => {
              setRenameVal(nb.title);
              setRenameOpen(true);
            }}
            aria-label="Rename notebook"
            className="grid size-10 place-items-center rounded-full text-foreground/80 transition hover:bg-muted active:scale-95"
          >
            <Pencil className="size-4.5" />
          </button>
        }
      />
      <div className="shrink-0 border-b border-border/60 bg-card/70 px-3.5 py-2.5 backdrop-blur">
        <Segmented<Tab>
          value={tab}
          onChange={changeTab}
          options={[
            { value: "sources", label: `Sources${sourceCount ? ` (${sourceCount})` : ""}` },
            { value: "chat", label: "Chat" },
            { value: "studio", label: `Studio${artifactCount ? ` (${artifactCount})` : ""}` },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1">{panels[tab]}</div>
      {overlays}
    </div>
  );
}
