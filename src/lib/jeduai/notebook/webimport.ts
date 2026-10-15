// JeduAI Notebook — web page & YouTube importers (SSRF-safe).
// fetchWebPage: validates + DNS-checks the URL (rejecting private/loopback
// targets), fetches with a 5 MB body cap, and falls back to the SDK page
// reader when the direct fetch is blocked. importYouTube: extracts
// ytInitialPlayerResponse from the watch page and downloads json3 captions.
import "server-only";
import { lookup } from "dns/promises";

// ---------------- SSRF protection ----------------

/** Hard "no" — never retried via the SDK fallback (policy violation). */
class UnsafeUrlError extends Error {}

function ipv4Private(ip: string): boolean {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // 0/8, 10/8, 127/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // 169.254/16 (link-local / cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
  return false;
}

function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  if (!a.includes(":")) return ipv4Private(a);
  if (a === "::1" || a === "::") return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a); // IPv4-mapped IPv6
  if (mapped) return ipv4Private(mapped[1]);
  if (/^f[cd]/.test(a)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(a)) return true; // fe80::/10 link-local
  return false;
}

/**
 * Parse + validate a URL and require that DNS only resolves to public
 * addresses. Throws UnsafeUrlError (a hard, non-fallback rejection).
 */
async function validateUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new UnsafeUrlError("This URL is not allowed.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("This URL is not allowed.");
  if (u.username || u.password) throw new UnsafeUrlError("This URL is not allowed.");
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h) throw new UnsafeUrlError("This URL is not allowed.");
  if (h === "localhost" || h.endsWith(".localhost")) throw new UnsafeUrlError("This URL is not allowed.");
  if (/^127\./.test(h)) throw new UnsafeUrlError("This URL is not allowed.");
  if (h === "::1") throw new UnsafeUrlError("This URL is not allowed.");
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".example")) {
    throw new UnsafeUrlError("This URL is not allowed.");
  }
  let addrs: { address: string }[];
  try {
    const r = await lookup(h, { all: true });
    addrs = (Array.isArray(r) ? r : [r]) as { address: string }[];
  } catch {
    // fail closed: we cannot verify where this resolves — do not fetch it
    throw new UnsafeUrlError("This URL could not be resolved.");
  }
  if (!addrs.length) throw new UnsafeUrlError("This URL could not be resolved.");
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new UnsafeUrlError("This URL is not allowed.");
  }
  return u;
}

// ---------------- HTML → text ----------------

function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  let out = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
  out = out.replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(parseInt(d, 10)));
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, hx: string) => safeCodePoint(parseInt(hx, 16)));
  out = out.replace(/&amp;/g, "&"); // ampersand last (avoids double-decoding)
  return out;
}

/** Strip markup and produce readable plain text with paragraph breaks. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<!DOCTYPE[^>]*>/gi, " ");
  // non-content blocks removed entirely
  s = s.replace(/<(script|style|noscript|svg|template|nav|footer|header|aside|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(script|style|noscript|svg|template|nav|footer|header|aside|iframe)\b[^>]*\/>/gi, " ");
  // structural tags → newlines (paragraph breaks matter: the chunker splits on \n\n)
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|section|article|blockquote|ul|ol|dl|dd|figure|figcaption|pre)\s*>/gi, "\n\n");
  s = s.replace(/<li\b[^>]*>/gi, "• ");
  s = s.replace(/<\/(li|tr|dt)\s*>/gi, "\n");
  s = s.replace(/<(td|th)\b[^>]*>/gi, " ");
  s = s.replace(/<\/tr\s*>/gi, "\n");
  // everything else (opening tags, unclosed leftovers) → space
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

function metaContent(html: string, property: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
    "i"
  );
  const m = re.exec(html) || re2.exec(html);
  return m ? decodeEntities(m[1].replace(/\s+/g, " ").trim()) : "";
}

function extractTitle(html: string): string {
  const t = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (t) {
    const v = decodeEntities(t[1].replace(/\s+/g, " ").trim());
    if (v) return v.slice(0, 120);
  }
  const og = metaContent(html, "og:title");
  return og ? og.slice(0, 120) : "Web page";
}

// ---------------- web page import ----------------

const MAX_TEXT_CHARS = 300_000;

export async function fetchWebPage(url: string): Promise<{ title: string; text: string; siteName?: string }> {
  // Policy validation must succeed before anything is fetched. An
  // UnsafeUrlError is never retried through the SDK fallback.
  const u = await validateUrl(url);

  let firstError: Error;
  try {
    const res = await fetch(u, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain",
        "User-Agent": "Mozilla/5.0 (compatible; JeduAI/1.0)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    // A redirect may point at an address our checks would reject — re-validate
    // the final URL before reading the body.
    if (res.url && res.url !== u.toString()) await validateUrl(res.url);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`The site responded with HTTP ${res.status}.`);
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct && !(ct.includes("text/html") || ct.includes("text/plain") || ct.includes("application/xhtml") || ct.includes("xml"))) {
      await res.body?.cancel().catch(() => {});
      throw new Error("This URL does not return a readable web page.");
    }
    if (!res.body) throw new Error("The site returned an empty response.");

    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    const CAP = 5 * 1024 * 1024;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > CAP) {
        await reader.cancel().catch(() => {});
        throw new Error("This page is too large to import (over 5 MB).");
      }
      parts.push(value);
    }
    const merged = new Uint8Array(size);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.byteLength;
    }
    const html = new TextDecoder().decode(merged);
    const text = htmlToText(html);
    if (text.length < 200) throw new Error("No readable text found at this URL.");
    const siteName = metaContent(html, "og:site_name");
    return {
      title: extractTitle(html),
      text: text.slice(0, MAX_TEXT_CHARS),
      ...(siteName ? { siteName } : {}),
    };
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err; // hard policy rejection — no fallback
    firstError = normalizeFetchError(err);
  }

  // Fallback: the SDK page reader fetches from the provider's infrastructure —
  // useful for sites that block plain server fetches (403 / bot walls).
  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    const r = await zai.functions.invoke("page_reader", { url });
    const data = (r as { data?: { html?: string; title?: string } })?.data;
    const html = data?.html || "";
    if (!html) throw new Error("page reader returned no content");
    const text = htmlToText(html);
    if (text.length < 200) throw new Error("No readable text found at this URL.");
    const siteName = metaContent(html, "og:site_name");
    return {
      title: (data?.title || extractTitle(html) || "Web page").slice(0, 120),
      text: text.slice(0, MAX_TEXT_CHARS),
      ...(siteName ? { siteName } : {}),
    };
  } catch {
    throw firstError; // the original, clear error
  }
}

function normalizeFetchError(err: unknown): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  const msg = (e?.name || "") + (e?.message || "");
  if (/timeout|abort/i.test(msg)) return new Error("The site took too long to respond.");
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(msg)) {
    return new Error("Could not reach this site.");
  }
  return e instanceof Error ? e : new Error("Could not fetch this page.");
}

// ---------------- YouTube import ----------------

export type YouTubeSegment = { startSec: number; endSec: number; text: string };

const YT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml",
};

function extractVideoId(raw: string): string {
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error("That does not look like a YouTube video link.");
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = u.pathname.split("/").filter(Boolean)[0] || null;
  } else if (host === "youtube.com") {
    if (u.pathname === "/watch") {
      id = u.searchParams.get("v");
    } else {
      const seg = u.pathname.split("/").filter(Boolean);
      if (seg[0] === "shorts" || seg[0] === "embed") id = seg[1] || null;
    }
  }
  if (!id || !/^[\w-]{6,12}$/.test(id)) throw new Error("That does not look like a YouTube video link.");
  return id;
}

/** Balanced-brace JSON object extraction that is string-aware. */
function extractJsonAfter(html: string, marker: string): unknown | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf("{", idx + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function importYouTube(url: string): Promise<{
  title: string;
  author?: string;
  durationSec: number;
  segments: YouTubeSegment[];
}> {
  const id = extractVideoId(url);
  const maxSec = 40 * 60;
  const maxSegments = 400;

  const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    headers: YT_HEADERS,
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);

  let playerResponse: unknown = null;
  if (res && res.ok) {
    const html = await res.text().catch(() => "");
    playerResponse = extractJsonAfter(html, "ytInitialPlayerResponse");
  }
  if (!playerResponse) {
    throw new Error("Could not read this YouTube page. The video may be private, age-restricted, or region-blocked.");
  }

  const pr = playerResponse as {
    playabilityStatus?: { status?: string; reason?: string };
    videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[];
      };
    };
  };
  // Bot walls / private / age-restricted videos return a playerResponse with
  // no playable payload — report that honestly instead of "no captions".
  const playability = pr.playabilityStatus?.status || "";
  if (playability && playability !== "OK") {
    throw new Error("Could not read this YouTube page. The video may be private, age-restricted, or region-blocked.");
  }
  const details = pr.videoDetails || {};
  const title = String(details.title || "").trim();
  if (!title) {
    throw new Error("Could not read this YouTube page. The video may be private, age-restricted, or region-blocked.");
  }
  const durationSec = parseInt(String(details.lengthSeconds || "0"), 10) || 0;
  if (durationSec > maxSec) throw new Error("Video is too long for notebook import (max 40 minutes).");

  const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track =
    tracks.find((t) => (t.languageCode || "").toLowerCase().startsWith("en")) || tracks[0];
  if (!track || !track.baseUrl) throw new Error("This video has no accessible captions/transcript.");

  const capUrl = track.baseUrl.includes("?") ? `${track.baseUrl}&fmt=json3` : `${track.baseUrl}?fmt=json3`;
  const capRes = await fetch(capUrl, {
    headers: YT_HEADERS,
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!capRes || !capRes.ok) throw new Error("YouTube captions could not be downloaded for this video.");
  const capData = (await capRes.json().catch(() => null)) as {
    events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
  } | null;
  if (!capData || !Array.isArray(capData.events)) {
    throw new Error("YouTube captions could not be downloaded for this video.");
  }

  const segments: YouTubeSegment[] = [];
  for (const ev of capData.events) {
    if (!ev.segs || !Array.isArray(ev.segs)) continue;
    const text = ev.segs
      .map((sg) => sg?.utf8 || "")
      .join("")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const startSec = (ev.tStartMs || 0) / 1000;
    const endSec = startSec + (ev.dDurationMs || 5000) / 1000;
    segments.push({ startSec, endSec, text });
  }
  if (segments.length > maxSegments) throw new Error("Video is too long for notebook import (max 40 minutes).");
  if (!segments.length) throw new Error("This video has no accessible captions/transcript.");

  const author = String(details.author || "").trim();
  return {
    title: title || "YouTube video",
    durationSec: durationSec || Math.ceil(segments[segments.length - 1].endSec),
    ...(author ? { author } : {}),
    segments,
  };
}
