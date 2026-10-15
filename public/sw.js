/* JeduAI service worker — installable PWA shell + offline fallback.
   Strategy: NETWORK-FIRST everywhere (dev-friendly, always fresh when online),
   falling back to cache when offline. Never intercepts /api/* (SSE, auth, media
   tokens) or /downloads/* (large files). */
const VERSION = "jeduai-sw-v2";
const SHELL = `${VERSION}-shell`;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/offline.html", "/icons/icon-192.png", "/manifest.webmanifest"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // auth, SSE, media — always live
  if (url.pathname.startsWith("/downloads/")) return; // never cache large downloads

  // Navigations: network-first, fall back to cached shell, then offline page.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(SHELL)
            .then((c) => c.put("/", copy))
            .catch(() => {});
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || caches.match("/offline.html")))
    );
    return;
  }

  // Static assets: network-first with cache fallback (fresh when online,
  // instant offline recovery for previously seen assets).
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/offline.html" ||
    /\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/.test(url.pathname);

  if (isStatic) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(SHELL)
            .then((c) => c.put(req, copy))
            .catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
