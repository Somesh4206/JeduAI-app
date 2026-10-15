"use client";
// JeduAI — "Get the app": Android APK download + PWA install
import React from "react";
import { Smartphone, Download, QrCode, ShieldCheck, MonitorDown, Check } from "lucide-react";
import QRCode from "qrcode";
import { Card, Sheet, toast } from "./ui";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Tracks Chrome's beforeinstallprompt so we can offer one-tap PWA install. */
export function usePwaInstall() {
  const [deferred, setDeferred] = React.useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = React.useState(false);

  React.useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = React.useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
    } catch {
      /* user dismissed */
    }
    setDeferred(null);
  }, [deferred]);

  return { canInstall: !!deferred, installed, install };
}

export default function GetAppSection() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Card onClick={() => setOpen(true)} className="flex items-center gap-3 p-4 transition active:scale-[0.99]">
        <div className="j-grad-primary grid size-11 place-items-center rounded-2xl text-white">
          <Smartphone className="size-5" />
        </div>
        <div className="flex-1">
          <div className="text-[14.5px] font-bold text-foreground">Get JeduAI on your phone</div>
          <div className="text-[11.5px] text-muted-foreground">Android app (.apk) · or install as a web app</div>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-primary">New</span>
      </Card>
      <GetAppSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function GetAppSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { canInstall, installed, install } = usePwaInstall();
  const [qr, setQr] = React.useState("");
  const [origin, setOrigin] = React.useState("");
  const [ua, setUa] = React.useState({ android: false, ios: false });

  React.useEffect(() => {
    if (!open) return;
    setOrigin(window.location.origin);
    setUa({
      android: /android/i.test(navigator.userAgent),
      ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
    });
    QRCode.toDataURL(`${window.location.origin}/downloads/jeduai.apk`, {
      margin: 1,
      width: 440,
      errorCorrectionLevel: "M",
      color: { dark: "#202343", light: "#FFFFFF" },
    })
      .then(setQr)
      .catch(() => setQr(""));
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Get JeduAI on your phone">
      <div className="space-y-4 pb-2">
        {/* hero */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-border/80 bg-gradient-to-br from-primary/10 via-card to-card p-4">
          <div className="j-grad-primary grid size-14 shrink-0 place-items-center rounded-[18px] text-2xl font-black text-white shadow-lg shadow-primary/25">
            J
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-black leading-tight text-foreground">JeduAI for Android</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
              v1.2 · 42 KB · Android 7.0+ · connects to this server automatically
            </div>
          </div>
        </div>

        {/* download button */}
        <a
          href="/downloads/jeduai.apk"
          download="jeduai-1.2.apk"
          onClick={() => toast.success("Downloading JeduAI v1.2 — open it once the download finishes")}
          className="j-grad-primary flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14.5px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-[0.99]"
        >
          <Download className="size-4.5" /> Download Android app (.apk)
        </a>

        {/* steps */}
        <div className="rounded-2xl border border-border/80 bg-muted/30 p-4">
          <div className="mb-2.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
            Install in 3 steps
          </div>
          <ol className="space-y-2.5">
            {[
              <>Tap <b>Download</b> above and wait for the file.</>,
              <>Open the file (from the notification or your Downloads folder) and allow <b>&quot;Install unknown apps&quot;</b> if asked — it&apos;s a direct download, not from the Play Store.</>,
              <>Open <b>JeduAI</b> — it connects to this server automatically, so just <b>sign in</b> (or create an account) and start learning.</>,
            ].map((t, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-foreground/90">
                <span className="j-grad-primary mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-black text-white">
                  {i + 1}
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* pre-configured server */}
        <div className="rounded-2xl border border-j-success/30 bg-j-success/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-j-success">
            <ShieldCheck className="size-3.5" /> Pre-configured server
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-muted/60 px-3 py-2.5 text-[12px] font-bold text-foreground">
              {origin || "…"}
            </code>
            <div
              aria-label="Server verified"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-j-success/15 text-j-success"
            >
              <Check className="size-4.5" />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            No address to type — the app is locked to this server, connects on first launch, and your account and data
            stay right here.
          </p>
        </div>

        {/* QR */}
        <div className="flex items-center gap-4 rounded-2xl border border-border/80 bg-card p-4">
          {qr ? (
            <img
              src={qr}
              alt="QR code that downloads the JeduAI Android app"
              className="size-24 shrink-0 rounded-xl border border-border/60"
            />
          ) : (
            <div className="size-24 shrink-0 animate-pulse rounded-xl bg-muted" aria-hidden />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-black text-foreground">
              <QrCode className="size-4 text-primary" /> Scan to download
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              Point another phone&apos;s camera at this code to download the .apk directly.
            </p>
          </div>
        </div>

        <p className="px-1 text-[10.5px] leading-relaxed text-muted-foreground">
          This build is self-signed, so Android will ask you to allow installs from this source once. For Play Store
          distribution, re-sign with a Play upload key.
        </p>

        {/* divider */}
        <div className="flex items-center gap-3 pt-1">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10.5px] font-black uppercase tracking-wider text-muted-foreground">
            Prefer no download?
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* PWA */}
        {installed ? (
          <div className="flex items-center gap-3 rounded-2xl border border-j-success/30 bg-j-success/10 p-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-j-success/15 text-j-success">
              <Check className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-black text-foreground">JeduAI is installed</div>
              <div className="text-[11.5px] text-muted-foreground">Find it on your home screen or app list.</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/80 bg-card p-4">
            <div className="flex items-center gap-2 text-[13px] font-black text-foreground">
              <MonitorDown className="size-4 text-primary" /> Install as a web app
            </div>
            {canInstall ? (
              <>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  Full-screen experience with a home-screen icon and offline shell — no download needed.
                </p>
                <button
                  onClick={install}
                  className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[13.5px] font-black text-white shadow-lg shadow-primary/25 transition active:scale-[0.99]"
                >
                  <MonitorDown className="size-4" /> Install now
                </button>
              </>
            ) : (
              <div className="mt-2.5 space-y-2 text-[12px] leading-relaxed text-foreground/90">
                {ua.android ? (
                  <p>
                    On Android: open the <b>⋮ menu</b> in Chrome and tap <b>Install app</b> (or &quot;Add to Home
                    screen&quot;).
                  </p>
                ) : ua.ios ? (
                  <p>
                    On iPhone/iPad: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>.
                  </p>
                ) : (
                  <p>
                    In Chrome or Edge on desktop: click the <b>install icon</b> in the address bar.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
