// Madara WordPress theme — used by a large number of manhwa sites, so this adapter
// matches by DOM signature rather than hostname.

import type { SiteAdapter } from "../types";
import { breadcrumbs, hrefOf, meta, qs, qsa, text } from "../metadata/dom";
import { chapterLinksFrom, coverFrom, seriesRecord, titleFrom } from "./helpers";
import { chapterLabelFromUrl, parseChapterLabel } from "../normalization/chapter";
import { canonicalizeUrl, inferSeriesUrlFromChapterUrl } from "../normalization/url";
import { cleanSeriesTitle, isPlausibleTitle } from "../normalization/title";
import { extractAltTitles, extractStoryEnded, siteName } from "../generic/detector";

function summaryValue(doc: Document, label: RegExp): string | undefined {
  for (const item of qsa(doc, ".post-content_item, .post-content .post-content_item", 40)) {
    if (label.test(text(qs(item, ".summary-heading"), 60))) return text(qs(item, ".summary-content"), 400) || undefined;
  }
  return undefined;
}

export const madaraAdapter: SiteAdapter = {
  id: "madara",
  hosts: [],

  matches(doc) {
    return !!(
      qs(doc, ".wp-manga-chapter, #manga-chapters-holder, .summary_image, .wp-manga-nav") ||
      (qs(doc, ".reading-content") && qs(doc, ".c-breadcrumb, .wp-manga-nav, .nav-links"))
    );
  },

  detectPageKind(doc) {
    if (qs(doc, ".reading-content") && qsa(doc, ".reading-content img, .reading-content .text-left", 5).length > 0) return "chapter";
    if (qs(doc, ".summary_image, #manga-chapters-holder, .wp-manga-chapter, .post-title h1")) return "series";
    return "unknown";
  },

  extractSeries(doc, url) {
    const title = titleFrom(qs(doc, ".post-title h1, .post-title h3, .post-title"), siteName(doc, url));
    if (!title) return null;
    const alt = summaryValue(doc, /alternative/i);
    const status = summaryValue(doc, /^status/i);
    const canonical = qs(doc, 'link[rel="canonical"]')?.getAttribute("href");
    return seriesRecord({
      title,
      alternateTitles: alt
        ? alt.split(/\s*[,;/|]\s*/).map((s) => s.trim()).filter((s) => isPlausibleTitle(s) && s !== title).slice(0, 12)
        : extractAltTitles(doc),
      seriesUrl: canonical && !chapterLabelFromUrl(new URL(canonical, url)) ? new URL(canonical, url).href : url.href,
      coverUrl: coverFrom(doc, [".summary_image img", ".tab-summary img"], url.href) ?? meta(doc, "og:image"),
      storyEnded: status ? /completed|finished|end/i.test(status) : extractStoryEnded(doc),
      chapterList: this.extractChapterList?.(doc, url) ?? [],
    });
  },

  extractChapterList(doc, url) {
    const list = qs(doc, "#manga-chapters-holder") ?? qs(doc, ".listing-chapters_wrap") ?? doc;
    return chapterLinksFrom(list, "li.wp-manga-chapter > a", url.href);
  },

  extractChapter(doc, url) {
    const site = siteName(doc, url);
    const heading = text(qs(doc, "#chapter-heading, .wp-manga-nav h1, h1#chapter-heading"), 250);
    const crumbs = breadcrumbs(doc, url.href);
    const activeCrumb = text(qs(doc, ".breadcrumb li.active, .c-breadcrumb .active"), 160);
    const urlLabel = chapterLabelFromUrl(url);

    let label: string | undefined;
    for (const t of [activeCrumb, heading, urlLabel ?? ""]) {
      const p = parseChapterLabel(t.replace(/^.*?(?=\b(?:chapter|ch|episode|ep)\b)/i, ""));
      if (t && p.kind !== "special") {
        label = urlLabel && p.number !== parseChapterLabel(urlLabel).number ? urlLabel : p.label;
        break;
      }
    }
    label ??= urlLabel;
    if (!label) return null;

    // Series is the breadcrumb immediately before the chapter.
    const chapterIdx = crumbs.findIndex((c) => !c.href || (c.href && chapterLabelFromUrl(new URL(c.href))));
    const seriesCrumb = chapterIdx > 0 ? crumbs[chapterIdx - 1] : [...crumbs].reverse().find((c) => c.href && new URL(c.href).pathname.length > 1);
    let title = seriesCrumb ? cleanSeriesTitle(seriesCrumb.text, site) : "";
    if (!isPlausibleTitle(title)) title = cleanSeriesTitle(heading, site);
    const seriesUrl = seriesCrumb?.href ?? inferSeriesUrlFromChapterUrl(url.href);

    const nav = (sel: string) => {
      const h = hrefOf(qs(doc, sel), url.href);
      return h ? canonicalizeUrl(h) : undefined;
    };
    return {
      chapter: {
        label,
        title: heading || undefined,
        url: url.href,
        canonicalUrl: canonicalizeUrl(url.href),
        nextUrl: nav(".nav-next a, a.next_page"),
        prevUrl: nav(".nav-previous a, a.prev_page"),
      },
      series: isPlausibleTitle(title) && seriesUrl ? seriesRecord({ title, seriesUrl, seriesUrlInferred: !seriesCrumb?.href }) : null,
    };
  },

  getReaderContainer(doc) {
    return qs<HTMLElement>(doc, ".reading-content");
  },
};
