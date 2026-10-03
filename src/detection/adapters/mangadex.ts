// mangadex.org — a client-rendered app. Series and chapters are identified by UUID, so
// chapter numbers come from the page text. The reader is paged ("Pg. 3 / 18").

import type { DetectedChapterLink, SiteAdapter } from "../types";
import { hrefOf, imgSrc, meta, qs, qsa, text } from "../metadata/dom";
import { seriesRecord } from "./helpers";
import { parseChapterLabel } from "../normalization/chapter";
import { isPlausibleTitle } from "../normalization/title";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SERIES_PATH = new RegExp(`^/title/(${UUID})`, "i");
const CHAPTER_PATH = new RegExp(`^/chapter/(${UUID})`, "i");

const seriesUrlFor = (id: string) => `https://mangadex.org/title/${id}`;
const chapterUrlFor = (id: string) => `https://mangadex.org/chapter/${id}`;

function stripSite(t: string): string {
  return t.replace(/\s*-\s*MangaDex\s*$/i, "").trim();
}

/** "Page 3 of 18" style indicator → 3/18. */
export function pageIndicatorProgress(s: string): number | null {
  const m = /(?:pg\.?|page)?\s*(\d{1,4})\s*(?:\/|of)\s*(\d{1,4})/i.exec(s);
  if (!m) return null;
  const cur = Number(m[1]);
  const total = Number(m[2]);
  return total > 0 && cur <= total ? cur / total : null;
}

export const mangadexAdapter: SiteAdapter = {
  id: "mangadex",
  format: "manhwa",
  hosts: ["mangadex.org"],
  updates: "mangadex-api",

  detectPageKind(_doc, url) {
    if (CHAPTER_PATH.test(url.pathname)) return "chapter";
    if (SERIES_PATH.test(url.pathname)) return "series";
    if (/^\/titles?(?:\/|$)|^\/search/.test(url.pathname)) return url.searchParams.has("q") ? "search" : "listing";
    return "unknown";
  },

  extractSeries(doc, url) {
    const id = SERIES_PATH.exec(url.pathname)?.[1];
    // The app renders asynchronously; wait until the title block exists.
    if (!id || !qs(doc, ".title, .manga-container")) return null;
    const title = stripSite(doc.title) || stripSite(meta(doc, "og:title") ?? "");
    if (!isPlausibleTitle(title) || /^mangadex$/i.test(title)) return null;
    const alts = [...new Set(qsa(doc, ".alt-title", 30).map((e) => text(e, 150)))].filter((a) => a && a !== title).slice(0, 12);
    const cover = imgSrc(qs(doc, `img[src*="/covers/${id}/"]`), url.href);
    return seriesRecord({
      title,
      alternateTitles: alts,
      seriesUrl: seriesUrlFor(id),
      coverUrl: cover,
      chapterList: this.extractChapterList?.(doc, url) ?? [],
    });
  },

  extractChapterList(doc) {
    const out: DetectedChapterLink[] = [];
    const seen = new Set<string>();
    for (const a of qsa(doc, 'a.chapter-grid[href^="/chapter/"], .chapter a[href^="/chapter/"]', 3000)) {
      const cid = CHAPTER_PATH.exec(a.getAttribute("href") ?? "")?.[1];
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      const label = text(qs(a, ".chapter-link") ?? a, 160);
      const parsed = parseChapterLabel(label);
      if (parsed.kind === "special" && !/oneshot/i.test(label)) continue;
      out.push({ label: parsed.label, url: chapterUrlFor(cid) });
    }
    return out;
  },

  extractChapter(doc, url) {
    const cid = CHAPTER_PATH.exec(url.pathname)?.[1];
    if (!cid) return null;
    const metaText = text(qs(doc, ".reader--meta.chapter"), 80);
    const og = meta(doc, "og:title") ?? "";
    const fromOg = /\b(?:Vol\.\s*\d+\s*)?Ch\.\s*\d+(?:\.\d+)?/i.exec(og)?.[0];
    const labelSource = metaText || fromOg || (/oneshot/i.test(og) ? "Oneshot" : "");
    if (!labelSource) return null;
    const label = parseChapterLabel(labelSource.replace(/^Vol\.\s*\d+,?\s*/i, "")).label;
    const seriesLink = qs(doc, "a.reader--header-manga") ?? qs(doc, 'a[href^="/title/"]:not([href="/title/random"])');
    const seriesHref = hrefOf(seriesLink, url.href);
    const sid = seriesHref ? SERIES_PATH.exec(new URL(seriesHref).pathname)?.[1] : undefined;
    const title = text(seriesLink, 200) || og.split(/\s+-\s+(?:Vol\.|Ch\.)/i)[0]?.trim() || "";
    return {
      chapter: {
        label,
        title: text(qs(doc, ".reader--header-title"), 200) || undefined,
        url: url.href,
        canonicalUrl: chapterUrlFor(cid),
      },
      series: sid && isPlausibleTitle(title) ? seriesRecord({ title, seriesUrl: seriesUrlFor(sid) }) : null,
    };
  },

  getReaderContainer(doc) {
    return qs<HTMLElement>(doc, ".md--reader-pages") ?? qs<HTMLElement>(doc, ".md--reader-chapter");
  },

  readingProgress(doc) {
    return pageIndicatorProgress(text(qs(doc, ".reader--meta.page"), 40));
  },

  normalizeSeriesUrl(url) {
    const id = SERIES_PATH.exec(url.pathname)?.[1];
    return id ? seriesUrlFor(id) : url.href;
  },

  normalizeChapterUrl(url) {
    const id = CHAPTER_PATH.exec(url.pathname)?.[1];
    return id ? chapterUrlFor(id) : url.href;
  },
};

/** Builds a chapter list from MangaDex's public API feed response (used by update checks). */
export function chaptersFromMangadexFeed(json: unknown): DetectedChapterLink[] {
  const data = (json as { data?: { id?: string; attributes?: { chapter?: string | null; title?: string | null; externalUrl?: string | null } }[] })?.data;
  if (!Array.isArray(data)) return [];
  const out: DetectedChapterLink[] = [];
  for (const c of data) {
    const a = c.attributes;
    if (!c.id || !a || a.externalUrl) continue;
    const label = a.chapter ? `Ch. ${a.chapter}${a.title ? ` - ${a.title}` : ""}` : "Oneshot";
    out.push({ label, url: chapterUrlFor(c.id) });
  }
  return out;
}

export function mangadexSeriesId(seriesUrl: string): string | undefined {
  try {
    return SERIES_PATH.exec(new URL(seriesUrl).pathname)?.[1];
  } catch {
    return undefined;
  }
}
