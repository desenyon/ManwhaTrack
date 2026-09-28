// tapas.io — series live at /series/{slug}/info, episodes at /episode/{id}.
// /series/{slug} itself shows the first episode in the reader.

import type { SiteAdapter } from "../types";
import { canonicalLink, hrefOf, meta, qs, qsa, text } from "../metadata/dom";
import { chapterLinksFrom, seriesRecord } from "./helpers";
import { parseChapterLabel } from "../normalization/chapter";
import { absoluteUrl, canonicalizeUrl } from "../normalization/url";
import { isPlausibleTitle } from "../normalization/title";

const INFO_PATH = /^\/series\/([^/]+)\/info\/?$/;
const SERIES_ROOT = /^\/series\/([^/]+)\/?$/;
const EPISODE_PATH = /^\/episode\/(\d+)/;

export const tapasAdapter: SiteAdapter = {
  id: "tapas",
  hosts: ["tapas.io"],

  detectPageKind(doc, url) {
    if (EPISODE_PATH.test(url.pathname) || (SERIES_ROOT.test(url.pathname) && qs(doc, ".js-episode-article"))) return "chapter";
    if (INFO_PATH.test(url.pathname)) return "series";
    if (/^\/(?:comics|novels|menu|search|genre)/.test(url.pathname)) return url.pathname.startsWith("/search") ? "search" : "listing";
    return "unknown";
  },

  extractSeries(doc, url) {
    const slug = INFO_PATH.exec(url.pathname)?.[1];
    const title = text(qs(doc, ".title-wrapper .title, .title-wrapper"), 200) || (meta(doc, "og:title") ?? "").replace(/^Read\s+|\s*\|\s*Tapas.*$/g, "");
    if (!slug || !isPlausibleTitle(title)) return null;
    return seriesRecord({
      title,
      seriesUrl: `https://tapas.io/series/${slug}/info`,
      coverUrl: meta(doc, "og:image"),
      chapterList: this.extractChapterList?.(doc, url) ?? [],
    });
  },

  extractChapterList(doc, url) {
    return chapterLinksFrom(doc, 'a.episode-item[href^="/episode/"]', url.href, ".title__body");
  },

  extractChapter(doc, url) {
    const label = parseChapterLabel(text(qs(doc, ".js-ep-title"), 160)).label;
    const epUrl = canonicalLink(doc, url.href) ?? url.href;
    if (!label || !EPISODE_PATH.test(new URL(epUrl).pathname)) return null;
    const title = text(qs(doc, ".center-info__title--small"), 200);
    const infoHref = qsa(doc, 'a[href$="/info"]', 20).map((a) => hrefOf(a, url.href)).find((h) => h && INFO_PATH.test(new URL(h).pathname));
    const slug = SERIES_ROOT.exec(url.pathname)?.[1];
    const seriesUrl = infoHref ?? (slug ? `https://tapas.io/series/${slug}/info` : undefined);

    // The episode drawer lists neighbours; the selected item marks the current one.
    const selected = qs(doc, "li.body__item--selected[data-href]");
    const neighbour = (el: Element | null | undefined) => {
      const h = absoluteUrl(el?.getAttribute("data-href"), url.href);
      return h ? canonicalizeUrl(h) : undefined;
    };
    return {
      chapter: {
        label,
        url: url.href,
        canonicalUrl: canonicalizeUrl(epUrl),
        nextUrl: neighbour(selected?.nextElementSibling),
        prevUrl: neighbour(selected?.previousElementSibling),
      },
      series: seriesUrl && isPlausibleTitle(title) ? seriesRecord({ title, seriesUrl, coverUrl: meta(doc, "og:image") }) : null,
    };
  },

  getReaderContainer(doc) {
    return qs<HTMLElement>(doc, ".js-episode-article") ?? qs<HTMLElement>(doc, ".viewer__body");
  },
};
