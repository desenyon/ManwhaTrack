// URL safety and canonicalization. Query parameters are only removed when they are
// known tracking parameters; anything else may identify the chapter (e.g. ?episode_no=5).

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref_src",
  "twclid",
  "ttclid",
]);

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

export function toUrl(value: string, base?: string): URL | null {
  try {
    const u = new URL(value, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Resolves a possibly-relative href against a base and returns a safe absolute URL string. */
export function absoluteUrl(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || /^(?:javascript|data|mailto|tel|blob):/i.test(trimmed)) return undefined;
  const u = toUrl(trimmed, base);
  return u ? u.href : undefined;
}

export function canonicalizeUrl(value: string): string {
  const u = toUrl(value);
  if (!u) return value;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  const keep: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    const lk = k.toLowerCase();
    if (lk.startsWith("utm_") || TRACKING_PARAMS.has(lk)) continue;
    keep.push([k, v]);
  }
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  u.pathname = path;
  return u.href;
}

/** Hostname without "www." — the identity of a source website. */
export function sourceHost(value: string | URL): string {
  try {
    const u = typeof value === "string" ? new URL(value) : value;
    return u.hostname.toLowerCase().replace(/^www\d?\./, "");
  } catch {
    return "";
  }
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/^www\d?\./, "");
  const p = pattern.toLowerCase().trim().replace(/^www\d?\./, "");
  if (!p) return false;
  if (p.startsWith("*.")) {
    const base = p.slice(2);
    return h === base || h.endsWith(`.${base}`);
  }
  return h === p || h.endsWith(`.${p}`);
}

/**
 * Guesses the series URL from a chapter URL by removing the chapter segment:
 *   /manga/solo-leveling/chapter-5/  → /manga/solo-leveling/
 *   /series/abc/ch/5                 → /series/abc
 * Returns undefined when no confident guess is possible.
 */
export function inferSeriesUrlFromChapterUrl(chapterUrl: string): string | undefined {
  const u = toUrl(chapterUrl);
  if (!u) return undefined;
  const segs = u.pathname.split("/").filter(Boolean);
  const idx = segs.findIndex((s) => /^(?:chapter|chap|ch|episode|ep)(?:[-_.]?\d.*)?$/i.test(s));
  if (idx > 0) {
    const out = new URL(u.origin);
    out.pathname = `/${segs.slice(0, idx).join("/")}/`;
    return out.href;
  }
  return undefined;
}

export function truncateUrlForDisplay(value: string, max = 60): string {
  try {
    const u = new URL(value);
    const s = `${sourceHost(u)}${u.pathname}`;
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  } catch {
    return value.slice(0, max);
  }
}
