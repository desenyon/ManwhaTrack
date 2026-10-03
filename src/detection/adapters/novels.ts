// Novel platforms use opaque chapter IDs. Prefer visible chapter identities and
// an explicit parent-book link; IDs in their routes are never chapter numbers.
import type { DetectedSeries, SiteAdapter } from "../types";
import { canonicalizeUrl } from "../normalization/url";
import { hrefOf, meta, qs, qsa, text } from "../metadata/dom";
import { parseChapterLabel } from "../normalization/chapter";
import { findTextReader } from "../generic/reader";
import { extractAltTitles, extractGenres, extractStoryEnded } from "../generic/detector";

const PARENT = /^\/(?:fiction\/\d+\/[^/]+|book\/[^/]+|novel\/[^/]+)\/?$/i;
const CHAPTER = /\/(?:chapter\/\d+|book\/[^/]+\/[^/]+_\d+|novel\/[^/]+\/chapter[^/]+)/i;
const NUMBERED_TITLE = /(?:\b(?:(?:season|s)\s*\d+\s*[-,:]?\s*)?chapter\s*\d+(?:\.\d+)?(?:\s*part\s*\d+)?|\bprologue\b|\bepilogue\b|\bside story\s*\d*)/i;
function visibleLabel(title: string): string | undefined {
  const full = NUMBERED_TITLE.exec(title)?.[0];
  if (full) return parseChapterLabel(full).label;
  const bare = /^(\d{1,5}(?:\.\d{1,3})?)(?=\s*[.:–—-]\s+\S)/.exec(title);
  return bare ? `Chapter ${bare[1]}` : undefined;
}

function series(doc: Document, url: URL, chapter: boolean): DetectedSeries | null {
  const parent = chapter ? qsa<HTMLAnchorElement>(doc, "a[href]", 3000).find(a => {
    const href = hrefOf(a, url.href); return href && new URL(href).origin === url.origin && PARENT.test(new URL(href).pathname) && text(a).length > 2;
  }) : null;
  const title = chapter ? text(parent, 200) : text(qs(doc, "h1, .book-name"), 200);
  const seriesUrl = chapter ? hrefOf(parent, url.href) : url.href;
  if (!title || !seriesUrl) return null;
  const chapterList = chapter ? [] : qsa<HTMLAnchorElement>(doc, "a[href]", 4000).flatMap(a => {
    const href = hrefOf(a, url.href); const label = text(a, 160);
    if (!href || new URL(href).origin !== url.origin || !CHAPTER.test(new URL(href).pathname) || !visibleLabel(label)) return [];
    return [{ url: href, label: visibleLabel(label)!, title:label }];
  });
  const cover = meta(doc, "og:image");
  return { title, format: "novel", genres: extractGenres(doc), alternateTitles: extractAltTitles(doc),
    seriesUrl, canonicalSeriesUrl: canonicalizeUrl(seriesUrl), coverUrl: chapter ? undefined : cover,
    coverCandidates: !chapter && cover ? [cover] : [], storyEnded: extractStoryEnded(doc), chapterList };
}

export const novelsAdapter: SiteAdapter = {
  id: "novel-platforms", hosts: ["royalroad.com", "webnovel.com"], updates: "html",
  detectPageKind(doc, url) { return CHAPTER.test(url.pathname) ? "chapter" : PARENT.test(url.pathname) ? "series" : "unknown"; },
  extractSeries(doc, url) { return series(doc, url, false); },
  extractChapter(doc, url) {
    const reader = findTextReader(doc);
    const s = series(doc, url, true);
    const headings = qsa(doc, "h1, h2, .chapter-title, .cha-tit", 30).map(el => text(el, 200));
    const heading = headings.find(t => NUMBERED_TITLE.test(t)) ?? headings.find(t => visibleLabel(t));
    const label = heading && visibleLabel(heading);
    if (!reader || !s || !heading || !label) return null;
    const nav = (direction: "next" | "prev") => {
      const a = qsa<HTMLAnchorElement>(doc, "a[href]", 3000).find(a => {
        const h = hrefOf(a, url.href); return h && new URL(h).origin === url.origin && CHAPTER.test(new URL(h).pathname) && new RegExp(direction === "next" ? "next" : "previous|prev", "i").test(`${text(a)} ${a.rel} ${a.getAttribute("aria-label") ?? ""}`);
      }); return hrefOf(a, url.href);
    };
    return { series: s, chapter: { label, title: heading, url: url.href,
      canonicalUrl: canonicalizeUrl(url.href), nextUrl: nav("next"), prevUrl: nav("prev") } };
  },
  getReaderContainer: findTextReader,
};
