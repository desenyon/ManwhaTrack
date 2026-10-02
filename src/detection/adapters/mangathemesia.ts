// MangaThemesia WordPress theme (the "#readerarea" reader), matched by DOM signature.

import type { SiteAdapter } from "../types";
import { hrefOf, meta, qs, qsa, text } from "../metadata/dom";
import { chapterLinksFrom, coverFrom, seriesRecord, titleFrom } from "./helpers";
import { chapterLabelFromUrl, parseChapterLabel } from "../normalization/chapter";
import { canonicalizeUrl, inferSeriesUrlFromChapterUrl } from "../normalization/url";
import { cleanSeriesTitle, isPlausibleTitle } from "../normalization/title";
import { extractAltTitles, siteName } from "../generic/detector";

export const mangaThemesiaAdapter: SiteAdapter = {
  id: "mangathemesia",
  hosts: [],

  matches(doc) {
    return !!qs(doc, "#readerarea, #chapterlist, .eplister, .seriestucontent, .bigcontent .thumbook");
  },

  detectPageKind(doc) {
    if (qs(doc, "#readerarea")) return "chapter";
    if (qs(doc, "#chapterlist, .eplister, .seriestucontent, .bigcontent")) return "series";
    return "unknown";
  },

  extractSeries(doc, url) {
    const title = titleFrom(qs(doc, "h1.entry-title, .seriestuheader h1, .infox h1"), siteName(doc, url));
    if (!title) return null;
    const altRaw = text(qs(doc, ".alternative, .seriestualt, .wd-full .alter"), 400);
    const statusText = qsa(doc, ".imptdt, .tsinfo .imptdt, .infotable tr", 30)
      .map((e) => text(e, 80))
      .find((t) => /^status/i.test(t));
    return seriesRecord({
      title,
      alternateTitles: altRaw
        ? altRaw.split(/\s*[,;/|]\s*/).map((s) => s.trim()).filter((s) => isPlausibleTitle(s) && s !== title).slice(0, 12)
        : extractAltTitles(doc),
      seriesUrl: url.href,
      coverUrl: coverFrom(doc, [".thumb img", ".thumbook img", ".bigcontent .thumb img"], url.href) ?? meta(doc, "og:image"),
      storyEnded: statusText ? /completed|finished|ended/i.test(statusText) : undefined,
      chapterList: this.extractChapterList?.(doc, url) ?? [],
    });
  },

  extractChapterList(doc, url) {
    const list = qs(doc, "#chapterlist") ?? qs(doc, ".seriestucontent .eplister") ?? qs(doc, ".eplister") ?? doc;
    return chapterLinksFrom(list, "li a", url.href, ".chapternum");
  },

  extractChapter(doc, url) {
    const site = siteName(doc, url);
    const heading = text(qs(doc, "h1.entry-title, .headpost h1"), 250);
    const urlLabel = chapterLabelFromUrl(url);
    const m = /\b(?:chapter|ch|episode|ep)\.?\s*\d+(?:\.\d+)?.*$/i.exec(heading);
    const parsed = m ? parseChapterLabel(m[0]) : undefined;
    const label = parsed && parsed.kind !== "special" && (!urlLabel || parsed.number === parseChapterLabel(urlLabel).number) ? parsed.label : urlLabel;
    if (!label) return null;

    const allc = qs(doc, ".allc a, .headpost .allc a");
    const crumbLinks = qsa(doc, ".ts-breadcrumb a, [itemtype*='BreadcrumbList'] a", 10);
    const seriesLink = allc ?? crumbLinks[crumbLinks.length - 2] ?? null;
    let title = titleFrom(seriesLink, site);
    if (!title) title = cleanSeriesTitle(heading, site);
    const seriesUrl = hrefOf(seriesLink, url.href) ?? inferSeriesUrlFromChapterUrl(url.href);

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
        nextUrl: nav("a.ch-next-btn, .nextprev a[rel='next']"),
        prevUrl: nav("a.ch-prev-btn, .nextprev a[rel='prev']"),
      },
      series: isPlausibleTitle(title) && seriesUrl ? seriesRecord({ title, seriesUrl, seriesUrlInferred: !seriesLink }) : null,
    };
  },

  getReaderContainer(doc) {
    return qs<HTMLElement>(doc, "#readerarea");
  },
};
