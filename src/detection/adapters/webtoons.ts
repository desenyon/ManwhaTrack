// webtoons.com: query-parameter identified series (title_no) and episodes (episode_no).

import type { SiteAdapter } from "../types";
import { hrefOf, meta, qs, text } from "../metadata/dom";
import { chapterLinksFrom, coverFrom, seriesRecord, titleFrom } from "./helpers";
import { canonicalizeUrl } from "../normalization/url";

function seriesUrlFor(url: URL): string {
  const u = new URL(url.origin);
  const segs = url.pathname.split("/").filter(Boolean);
  // /{lang}/{genre}/{slug}/list  or  /{lang}/{genre}/{slug}/{episode-slug}/viewer
  u.pathname = `/${segs.slice(0, 3).join("/")}/list`;
  const titleNo = url.searchParams.get("title_no");
  if (titleNo) u.searchParams.set("title_no", titleNo);
  return u.href;
}

/** og:image is the series poster, served as a square crop; without the crop query it is the full 2:3 poster. */
function posterFromOgImage(doc: Document, base: string): string | undefined {
  const og = meta(doc, "og:image");
  if (!og) return undefined;
  try {
    const u = new URL(og, base);
    if (/^crop/i.test(u.searchParams.get("type") ?? "")) u.searchParams.delete("type");
    return u.href;
  } catch {
    return undefined;
  }
}

function chapterUrlFor(url: URL): string {
  const u = new URL(url.origin + url.pathname);
  for (const k of ["title_no", "episode_no"]) {
    const v = url.searchParams.get(k);
    if (v) u.searchParams.set(k, v);
  }
  return canonicalizeUrl(u.href);
}

export const webtoonsAdapter: SiteAdapter = {
  id: "webtoons",
  hosts: ["webtoons.com"],

  detectPageKind(_doc, url) {
    if (/\/viewer\/?$/.test(url.pathname) && url.searchParams.has("episode_no")) return "chapter";
    if (/\/list\/?$/.test(url.pathname) && url.searchParams.has("title_no")) return "series";
    if (/\/search/.test(url.pathname)) return "search";
    if (/\/(?:genres|originals|canvas|dailySchedule|ranking)/.test(url.pathname)) return "listing";
    return "unknown";
  },

  extractSeries(doc, url) {
    const title = titleFrom(qs(doc, ".detail_header .subj, .detail_header h1, h1.subj")) || titleFrom(qs(doc, "h1")) || (meta(doc, "og:title") ?? "");
    if (!title) return null;
    // The header image is often wide landing-page art, so the poster from og:image comes first.
    const cover = posterFromOgImage(doc, url.href) ?? coverFrom(doc, [".detail_header .thmb img", ".detail_body .thmb img"], url.href);
    const dayInfo = text(qs(doc, ".day_info, .detail_header .info .day_info"), 80);
    return seriesRecord({
      title,
      seriesUrl: seriesUrlFor(url),
      coverUrl: cover,
      storyEnded: /completed/i.test(dayInfo) ? true : dayInfo ? false : undefined,
      chapterList: this.extractChapterList?.(doc, url) ?? [],
    });
  },

  extractChapterList(doc, url) {
    return chapterLinksFrom(doc, "#_listUl li > a, ul#_listUl a", url.href, ".tx").map((l) => ({
      ...l,
      url: chapterUrlFor(new URL(l.url)),
      label: /^#?\d+$/.test(l.label.trim()) ? `Episode ${l.label.replace("#", "").trim()}` : l.label,
    }));
  },

  extractChapter(doc, url) {
    const ep = url.searchParams.get("episode_no");
    if (!ep) return null;
    const episodeTitle = text(qs(doc, ".subj_episode, h1.subj_episode"), 200);
    const seriesLink = qs(doc, ".subj_info a.subj, .subj_info .subj a, a.subj");
    const seriesTitle = titleFrom(seriesLink) || titleFrom(qs(doc, ".subj_info .subj"));
    const nav = (sel: string) => {
      const h = hrefOf(qs(doc, sel), url.href);
      return h ? chapterUrlFor(new URL(h)) : undefined;
    };
    const chapter = {
      label: `Episode ${Number(ep)}`,
      title: episodeTitle || undefined,
      url: url.href,
      canonicalUrl: chapterUrlFor(url),
      nextUrl: nav("a.pg_next, ._nextEpisode"),
      prevUrl: nav("a.pg_prev, ._prevEpisode"),
    };
    const seriesHref = hrefOf(seriesLink, url.href);
    const series = seriesTitle
      ? seriesRecord({ title: seriesTitle, seriesUrl: seriesUrlFor(seriesHref ? new URL(seriesHref) : url) })
      : null;
    return { chapter, series };
  },

  getReaderContainer(doc) {
    return qs<HTMLElement>(doc, "#_imageList") ?? qs<HTMLElement>(doc, ".viewer_img");
  },

  normalizeSeriesUrl: seriesUrlFor,
  normalizeChapterUrl: chapterUrlFor,
};
