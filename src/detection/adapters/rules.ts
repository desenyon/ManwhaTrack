// Adapter built from a user's local site rule (Settings → Site rules).

import type { SiteRule } from "../../shared/types/settings";
import type { SiteAdapter } from "../types";
import { hrefOf, imgSrc, qs, text } from "../metadata/dom";
import { chapterLinksFrom, seriesRecord, titleFrom } from "./helpers";
import { chapterLabelFromUrl, parseChapterLabel } from "../normalization/chapter";
import { canonicalizeUrl, inferSeriesUrlFromChapterUrl } from "../normalization/url";
import { cleanSeriesTitle, isPlausibleTitle } from "../normalization/title";
import { siteName } from "../generic/detector";

function safeRegex(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

export function ruleAdapter(rule: SiteRule): SiteAdapter {
  const s = rule.selectors;
  const chapterPath = safeRegex(rule.chapterPathPattern);

  return {
    id: `rule:${rule.host}`,
    hosts: [rule.host],

    detectPageKind(doc, url) {
      if (chapterPath?.test(url.pathname + url.search)) return "chapter";
      if (s.readerContainer && qs(doc, s.readerContainer)) return "chapter";
      if ((s.chapterList && qs(doc, s.chapterList)) || (s.seriesTitle && qs(doc, s.seriesTitle) && !chapterLabelFromUrl(url))) return "series";
      return "unknown";
    },

    extractSeries(doc, url) {
      const title = s.seriesTitle ? titleFrom(qs(doc, s.seriesTitle), siteName(doc, url)) : "";
      if (!title) return null;
      const cover = s.cover ? imgSrc(qs(doc, s.cover), url.href) : undefined;
      return seriesRecord({
        title,
        seriesUrl: url.href,
        coverUrl: cover,
        chapterList: this.extractChapterList?.(doc, url) ?? [],
      });
    },

    extractChapterList(doc, url) {
      if (!s.chapterList) return [];
      const sel = /\ba\b|a\[/.test(s.chapterList) ? s.chapterList : `${s.chapterList} a`;
      return chapterLinksFrom(doc, sel, url.href);
    },

    extractChapter(doc, url) {
      const site = siteName(doc, url);
      const heading = s.chapterTitle ? text(qs(doc, s.chapterTitle), 250) : "";
      const parsed = heading ? parseChapterLabel(heading) : undefined;
      const label = parsed && parsed.kind !== "special" ? parsed.label : chapterLabelFromUrl(url) ?? (heading || undefined);
      if (!label) return null;
      const seriesEl = s.seriesUrl ? qs(doc, s.seriesUrl) : null;
      const seriesUrl = hrefOf(seriesEl, url.href) ?? inferSeriesUrlFromChapterUrl(url.href);
      let title = s.seriesTitle ? titleFrom(qs(doc, s.seriesTitle), site) : "";
      if (!title && seriesEl) title = titleFrom(seriesEl, site);
      if (!title && heading) title = cleanSeriesTitle(heading, site);
      const nav = (sel?: string) => {
        const h = sel ? hrefOf(qs(doc, sel), url.href) : undefined;
        return h ? canonicalizeUrl(h) : undefined;
      };
      return {
        chapter: {
          label,
          title: heading || undefined,
          url: url.href,
          canonicalUrl: canonicalizeUrl(url.href),
          nextUrl: nav(s.nextChapter),
          prevUrl: nav(s.prevChapter),
        },
        series: isPlausibleTitle(title) && seriesUrl ? seriesRecord({ title, seriesUrl, seriesUrlInferred: !seriesEl }) : null,
      };
    },

    getReaderContainer(doc) {
      return s.readerContainer ? qs<HTMLElement>(doc, s.readerContainer) : null;
    },
  };
}
