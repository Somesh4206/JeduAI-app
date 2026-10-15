"use client";
// JeduAI — design-system primitives (mobile app style)
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, MoreVertical, Inbox, RefreshCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LANGUAGES } from "@/lib/jeduai/constants";
import { useJedu } from "./store";

// ---------- layout ----------
export function TopBar({
  title,
  subtitle,
  onBack,
  right,
  gradient,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  right?: React.ReactNode;
  gradient?: boolean;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-30 flex items-center gap-2 border-b px-3 py-2.5 backdrop-blur-xl",
        "border-border/70",
        gradient ? "bg-gradient-to-r from-primary/10 via-transparent to-transparent" : "bg-card/80"
      )}
    >
      {onBack ? (
        <button
          onClick={onBack}
          aria-label="Go back"
          className="grid size-10 shrink-0 place-items-center rounded-full text-foreground/80 transition hover:bg-muted active:scale-95"
        >
          <ChevronLeft className="size-6" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-bold leading-tight text-foreground">{title}</div>
        {subtitle ? <div className="truncate text-xs text-muted-foreground">{subtitle}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">{right}</div>
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-5", className)}>
      {title ? (
        <div className="mb-2.5 flex items-end justify-between px-1">
          <h2 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Card({
  className,
  children,
  onClick,
  as,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { as?: "div" }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "j-shadow-soft rounded-2xl border border-border/80 bg-card text-card-foreground",
        onClick && "cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.99]",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

// ---------- buttons & chips ----------
export function Chip({
  children,
  active,
  onClick,
  className,
  tone,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  tone?: "primary" | "success" | "warning" | "error" | "muted" | "violet" | "cyan";
}) {
  const toneCls =
    tone === "success"
      ? "bg-j-success/12 text-j-success border-j-success/25"
      : tone === "warning"
        ? "bg-j-warning/12 text-j-warning border-j-warning/25"
        : tone === "error"
          ? "bg-j-error/12 text-j-error border-j-error/25"
          : tone === "muted"
            ? "bg-muted text-muted-foreground border-border"
            : tone === "violet"
              ? "bg-j-violet/12 text-j-violet border-j-violet/25"
              : tone === "cyan"
                ? "bg-j-cyan/12 text-j-cyan border-j-cyan/25"
                : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition active:scale-95",
        active
          ? "border-transparent j-grad-primary text-white shadow-md shadow-primary/25"
          : toneCls || "bg-muted/70 text-foreground/80 border-border hover:bg-muted",
        !onClick && "cursor-default",
        className
      )}
    >
      {children}
    </button>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: "primary" | "success" | "warning" | "error" | "muted" }> = {
    completed: { label: "Completed", tone: "success" },
    done: { label: "Done", tone: "success" },
    translating: { label: "Translating", tone: "primary" },
    extracting: { label: "Extracting audio", tone: "primary" },
    transcribing: { label: "Transcribing", tone: "primary" },
    ocr: { label: "AI-reading", tone: "primary" },
    queued: { label: "Queued", tone: "muted" },
    pending: { label: "Pending", tone: "muted" },
    failed: { label: "Failed", tone: "error" },
    needs_ocr: { label: "Needs OCR", tone: "warning" },
    scheduled: { label: "Scheduled", tone: "primary" },
    live: { label: "LIVE", tone: "error" },
    cancelled: { label: "Cancelled", tone: "muted" },
    published: { label: "Published", tone: "success" },
    draft: { label: "Draft", tone: "muted" },
  };
  const m = map[status] || { label: status, tone: "muted" as const };
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

// Non-interactive span variants — safe INSIDE other buttons (avoids nested-button hydration errors)
export function PillSpan({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone?: "primary" | "success" | "warning" | "error" | "muted";
  className?: string;
}) {
  const toneCls =
    tone === "success"
      ? "bg-j-success/12 text-j-success border-j-success/25"
      : tone === "warning"
        ? "bg-j-warning/12 text-j-warning border-j-warning/25"
        : tone === "error"
          ? "bg-j-error/12 text-j-error border-j-error/25"
          : tone === "muted"
            ? "bg-muted text-muted-foreground border-border"
            : "bg-primary/10 text-primary border-primary/25";
  return <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-bold", toneCls, className)}>{children}</span>;
}

export function StatusPillSpan({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: "primary" | "success" | "warning" | "error" | "muted" }> = {
    completed: { label: "Completed", tone: "success" },
    done: { label: "Done", tone: "success" },
    translating: { label: "Translating", tone: "primary" },
    extracting: { label: "Extracting", tone: "primary" },
    transcribing: { label: "Transcribing", tone: "primary" },
    ocr: { label: "AI-reading", tone: "primary" },
    queued: { label: "Queued", tone: "muted" },
    pending: { label: "Pending", tone: "muted" },
    failed: { label: "Failed", tone: "error" },
    needs_ocr: { label: "Needs OCR", tone: "warning" },
    scheduled: { label: "Scheduled", tone: "primary" },
    live: { label: "LIVE", tone: "error" },
    cancelled: { label: "Cancelled", tone: "muted" },
    published: { label: "Published", tone: "success" },
    draft: { label: "Draft", tone: "muted" },
  };
  const m = map[status] || { label: status, tone: "muted" as const };
  return <PillSpan tone={m.tone}>{m.label}</PillSpan>;
}

// ---------- states ----------
export function Loader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
      <div className="relative size-10">
        <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
      </div>
      <div className="text-sm">{label}</div>
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="j-shadow-soft flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-4">
          <div className="size-11 shrink-0 animate-pulse rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}
        className="grid size-16 place-items-center rounded-3xl bg-lavender text-3xl"
      >
        {icon || <Inbox className="size-7 text-primary" />}
      </motion.div>
      <div className="text-[15px] font-bold text-foreground">{title}</div>
      {body ? <p className="max-w-[260px] text-sm leading-relaxed text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-j-error/25 bg-j-error/5 px-6 py-10 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-j-error/15">
        <AlertTriangle className="size-7 text-j-error" />
      </div>
      <div className="text-sm font-semibold text-foreground">{message}</div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry} className="gap-2 rounded-full">
          <RefreshCcw className="size-4" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={value}>
      <motion.div
        className="h-full rounded-full j-grad-primary"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ type: "spring", stiffness: 90, damping: 20 }}
      />
    </div>
  );
}

// ---------- language picker ----------
export function LangButton({
  value,
  onChange,
  includeAuto,
  align = "start",
}: {
  value: string;
  onChange: (v: string) => void;
  includeAuto?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  const current = value === "Auto-detect" ? { name: "Auto-detect", native: "Detect language", flag: "✨" } : LANGUAGES.find((l) => l.name === value) || LANGUAGES[0];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-2 text-left transition hover:border-primary/40 active:scale-[0.98]"
      >
        <span className="text-lg leading-none">{current.flag}</span>
        <span className="leading-tight">
          <span className="block text-[13px] font-bold text-foreground">{current.name}</span>
          <span className="block text-[11px] text-muted-foreground">{current.native}</span>
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Choose language">
        <div className="grid gap-1 pb-2">
          {includeAuto && (
            <LangRow
              flag="✨"
              name="Auto-detect"
              native="Let AI detect the source language"
              active={value === "Auto-detect"}
              onClick={() => {
                onChange("Auto-detect");
                setOpen(false);
              }}
            />
          )}
          {LANGUAGES.map((l) => (
            <LangRow
              key={l.name}
              flag={l.flag}
              name={l.name}
              native={l.native}
              active={value === l.name}
              onClick={() => {
                onChange(l.name);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Sheet>
    </>
  );
}

function LangRow(p: { flag: string; name: string; native: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left transition",
        p.active ? "bg-primary/10" : "hover:bg-muted"
      )}
    >
      <span className="text-xl">{p.flag}</span>
      <span className="flex-1 leading-tight">
        <span className="block text-sm font-bold text-foreground">{p.name}</span>
        <span className="block text-xs text-muted-foreground">{p.native}</span>
      </span>
      {p.active ? <span className="text-primary text-sm font-black">✓</span> : null}
    </button>
  );
}

// ---------- bottom sheet ----------
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  trigger,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  children: React.ReactNode;
  trigger?: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="absolute inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            aria-label="Close sheet"
            className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            role="dialog"
            className="absolute inset-x-0 bottom-0 max-h-[78%] overflow-hidden rounded-t-[28px] border-t border-border bg-card shadow-2xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
            {title ? (
              <div className="flex items-center justify-between px-5 pt-3 pb-1">
                <h3 className="text-base font-bold text-foreground">{title}</h3>
                <button
                  onClick={() => onOpenChange(false)}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label="Close"
                >
                  <MoreVertical className="size-4 rotate-90" />
                </button>
              </div>
            ) : null}
            <div className="j-app-scroll max-h-[62vh] overflow-y-auto px-4 pb-5 pt-2">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------- segmented control ----------
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const uid = React.useId();
  return (
    <div className={cn("relative flex rounded-2xl bg-muted p-1", className)} role="tablist">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.value)}
            className="relative flex-1 min-h-9 rounded-xl px-2 text-[13px] font-bold transition-colors"
          >
            {active ? (
              <motion.span
                layoutId={`segmented-pill-${uid}`}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="j-grad-primary absolute inset-0 rounded-xl shadow-md shadow-primary/25"
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 block truncate py-2 transition-colors",
                active ? "text-white" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- avatar ----------
export function Avatar({ name, color, size = "md" }: { name: string; color?: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const sz = size === "sm" ? "size-8 text-xs" : size === "lg" ? "size-14 text-lg" : "size-10 text-sm";
  return (
    <div
      className={cn("grid shrink-0 place-items-center rounded-full font-black text-white", sz)}
      style={{ background: `linear-gradient(135deg, ${color || "#5B5FEF"}, #773DE8)` }}
      aria-hidden
    >
      {initials || "?"}
    </div>
  );
}

// ---------- screen transition ----------
export function ScreenMotion({ children, k }: { children: React.ReactNode; k: string }) {
  return (
    <motion.div
      key={k}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="flex h-full flex-col"
    >
      {children}
    </motion.div>
  );
}

// ---------- markdown body ----------
export function MarkdownBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("j-message-body text-[13.5px] leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

// ---------- toast helper re-export ----------
export { toast } from "sonner";

// ---------- unread badge ----------
export function UnreadBadge() {
  const unread = useJedu((s) => s.unread);
  if (!unread) return null;
  return (
    <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-j-error px-1 text-[10px] font-black text-white">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}
