// mangaplus.shueisha.co.jp — a client-rendered app with CSS-module class names
// (e.g. "TitleDetailHeader-module_title_Iy33M"), matched by stable prefixes. Chapter
// items are not links, so the series page contributes title and cover only.

import type { SiteAdapter } from "../types";
import { hrefOf, imgSrc, qs, qsa, text } from "../metadata/dom";
import { seriesRecord } from "./helpers";
import { parseChapterLabel } from "../normalization/chapter";
import { pageIndicatorProgress } from "./mangadex";
import { isPlausibleTitle } from "../normalization/title";

const SERIES_PATH = /^\/titles\/(\d+)/;
const CHAPTER_PATH = /^\/viewer\/(\d+)/;
const ORIGIN = "https://mangaplus.shueisha.co.jp";

const mod = (name: string) => `[class*="${name}"]`;

/** Fraction of pages reached, from whichever page is most visible in the viewport. */
export function visiblePageProgress(pages: Element[], viewportW: number, viewportH: number): number | null {
  if (pages.length < 2) return null;
  let best = -1;
  let bestArea = 0;
  pages.forEach((p, i) => {
    const r = p.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, viewportW) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, viewportH) - Math.max(r.top, 0));
    if (w * h > bestArea) {
      bestArea = w * h;
      best = i;
    }
  });
  return best < 0 ? null : (best + 1) / pages.length;
}

export const mangaPlusAdapter: SiteAdapter = {
  id: "mangaplus",
  hosts: ["mangaplus.shueisha.co.jp"],
  // Pages are empty until JavaScript runs, so fetched HTML can't be checked for updates.
  updates: "none",

  detectPageKind(_doc, url) {
    if (CHAPTER_PATH.test(url.pathname)) return "chapter";
    if (SERIES_PATH.test(url.pathname)) return "series";
    if (/^\/(?:updates|featured|manga_list|search)/.test(url.pathname)) return "listing";
    return "unknown";
  },

  extractSeries(doc, url) {
    const id = SERIES_PATH.exec(url.pathname)?.[1];
    const title = text(qs(doc, `h1${mod("TitleDetailHeader-module_title")}`), 200);
    if (!id || !isPlausibleTitle(title)) return null;
    return seriesRecord({
      title,
      seriesUrl: `${ORIGIN}/titles/${id}`,
      coverUrl: imgSrc(qs(doc, `img${mod("TitleDetailHeader-module_coverImage")}`), url.href),
    });
  },

  extractChapter(doc, url) {
    const cid = CHAPTER_PATH.exec(url.pathname)?.[1];
    if (!cid) return null;
    const raw = text(qs(doc, `p${mod("Navigation-module_chapterTitle")}`), 80) || /^\[([^\]]+)\]/.exec(doc.title)?.[1] || "";
    if (!raw) return null;
    const label = parseChapterLabel(raw).label;
    const link = qs(doc, 'a[href^="/titles/"]');
    const title = text(qs(doc, `h1${mod("Navigation-module_title")}`), 200) || text(link, 200);
    const sid = SERIES_PATH.exec(new URL(hrefOf(link, url.href) ?? url.href).pathname)?.[1];
    return {
      chapter: { label, url: url.href, canonicalUrl: `${ORIGIN}/viewer/${cid}` },
      series: sid && isPlausibleTitle(title) ? seriesRecord({ title, seriesUrl: `${ORIGIN}/titles/${sid}` }) : null,
    };
  },

  getReaderContainer(doc) {
    return qs<HTMLElement>(doc, ".zao-pages-container");
  },

  readingProgress(doc) {
    // The viewer shows "12 / 58"; page elements themselves are created lazily.
    const indicator = pageIndicatorProgress(text(qs(doc, mod("Viewer-module_pageNumber")), 30));
    if (indicator !== null) return indicator;
    const view = doc.defaultView;
    return view ? visiblePageProgress(qsa(doc, ".zao-page", 2000), view.innerWidth, view.innerHeight) : null;
  },
};
