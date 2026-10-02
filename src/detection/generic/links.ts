// Finds repeated chapter links (series pages) and previous/next navigation (chapter pages).

import type { DetectedChapterLink } from "../types";
import { hrefOf, qsa, text } from "../metadata/dom";
import { chapterLabelFromUrl, parseChapterLabel } from "../normalization/chapter";
import { canonicalizeUrl, sourceHost, toUrl } from "../normalization/url";

const CHAPTER_TOKEN = /(?:chapter|chap|ch|episode|ep)[-_/.]?\d.*$/i;

/** Identifies which series a chapter URL belongs to, from its path prefix and non-chapter query params. */
export function seriesGroupKey(u: URL): string {
  const path = u.pathname.toLowerCase().replace(CHAPTER_TOKEN, "").replace(/[-_/]+$/, "");
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !/^(?:episode_no|chapter|ch|ep|episode|page|chapter_no)$/i.test(k))
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("&");
  // Query-based readers (e.g. /series/viewer?title_no=1&episode_no=2) share a path per series.
  const base = params ? path.replace(/\/[^/]*$/, "") : path;
  return `${sourceHost(u)}${base}?${params}`;
}

export interface LinkScan {
  chapterList: DetectedChapterLink[];
  /** Distinct series groups among chapter-like links; many groups suggests a listing page. */
  groups: number;
  dominantShare: number;
  prevUrl?: string;
  nextUrl?: string;
}

const NEXT_RE = /\b(?:next|nxt|próximo|proximo|siguiente|suivant|weiter)\b|›|»|→|>>|next[_-]?(?:chap|page|ep)/i;
const PREV_RE = /\b(?:prev|previous|anterior|précédent|zurück)\b|‹|«|←|<<|prev[_-]?(?:chap|page|ep)/i;

export function linkLabel(a: Element, u: URL): string {
  const fromUrl = chapterLabelFromUrl(u);
  // Adjacent spans can concatenate "Chapter 324" and "105. TP" in textContent.
  // Read a dedicated identity before subtitle/date text, validating against the URL.
  for (const child of qsa(a, "span, strong, b", 30)) {
    const label = text(child, 160);
    if (/^(?:chapter|chap|ch|episode|ep)\.?\s*#?\s*\d+(?:[.,]\d+)?$/i.test(label) &&
        (!fromUrl || parseChapterLabel(label).number === parseChapterLabel(fromUrl).number)) return label;
  }
  const t = text(a, 160);
  const parsed = t ? parseChapterLabel(t) : undefined;
  if (fromUrl && parsed?.kind === "numbered" && parsed.number !== parseChapterLabel(fromUrl).number) return fromUrl;
  if (parsed && parsed.kind !== "special") return parsed.label;
  if (t && t.length <= 80 && !fromUrl) return t;
  return fromUrl ?? t;
}

export function scanLinks(doc: Document, pageUrl: URL, currentChapterUrl?: string): LinkScan {
  const host = sourceHost(pageUrl);
  const current = currentChapterUrl ? canonicalizeUrl(currentChapterUrl) : undefined;
  const groups = new Map<string, { links: Map<string, DetectedChapterLink> }>();
  const navCandidates: { dir: "next" | "prev"; url: string }[] = [];
  const currentGroup = current ? seriesGroupKey(new URL(current)) : undefined;

  for (const a of qsa<HTMLAnchorElement>(doc, "a[href]", 4000)) {
    const href = hrefOf(a, pageUrl.href);
    if (!href) continue;
    const u = toUrl(href);
    if (!u || sourceHost(u) !== host) continue;
    const canon = canonicalizeUrl(href);
    const fromUrl = chapterLabelFromUrl(u);
    const t = text(a, 160);
    const textParsed = t ? parseChapterLabel(t) : undefined;
    const chapterLike = !!fromUrl || (textParsed?.kind === "numbered" && /\b(?:ch|chap|chapter|ep|episode)\b|#\d/i.test(t));
    if (!chapterLike) continue;

    const hint = `${t} ${a.getAttribute("rel") ?? ""} ${a.getAttribute("aria-label") ?? ""} ${a.getAttribute("title") ?? ""} ${a.className}`;
    if (canon !== current) {
      if (/\bnext\b/i.test(a.getAttribute("rel") ?? "") || NEXT_RE.test(hint)) navCandidates.push({ dir: "next", url: canon });
      else if (/\bprev\b/i.test(a.getAttribute("rel") ?? "") || PREV_RE.test(hint)) navCandidates.push({ dir: "prev", url: canon });
    }

    const key = seriesGroupKey(u);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { links: new Map() }));
    if (!g.links.has(canon)) g.links.set(canon, { label: linkLabel(a, u), url: canon });
  }

  let dominant: DetectedChapterLink[] = [];
  let total = 0;
  let meaningfulGroups = 0;
  for (const [key, g] of groups) {
    total += g.links.size;
    if (g.links.size >= 2) meaningfulGroups++;
    const preferCurrent = currentGroup !== undefined && key === currentGroup;
    if (g.links.size > dominant.length || (preferCurrent && g.links.size >= dominant.length)) dominant = [...g.links.values()];
  }

  const inGroup = (url: string) => !currentGroup || seriesGroupKey(new URL(url)) === currentGroup;
  let nextUrl = navCandidates.find((c) => c.dir === "next" && inGroup(c.url))?.url;
  let prevUrl = navCandidates.find((c) => c.dir === "prev" && inGroup(c.url))?.url;

  if (current && (!nextUrl || !prevUrl)) {
    // Fall back to numeric neighbours inside the current series' chapter links.
    const cur = parseChapterLabel(chapterLabelFromUrl(new URL(current)) ?? "").ordinal;
    const same = currentGroup ? [...(groups.get(currentGroup)?.links.values() ?? [])] : [];
    if (cur !== undefined && same.length) {
      const withOrd = same
        .map((l) => ({ l, o: parseChapterLabel(l.label).ordinal }))
        .filter((x): x is { l: DetectedChapterLink; o: number } => x.o !== undefined && x.l.url !== current);
      const above = withOrd.filter((x) => x.o > cur && x.o - cur <= 2).sort((a, b) => a.o - b.o)[0];
      const below = withOrd.filter((x) => x.o < cur && cur - x.o <= 2).sort((a, b) => b.o - a.o)[0];
      nextUrl ??= above?.l.url;
      prevUrl ??= below?.l.url;
    }
  }

  return {
    chapterList: dominant,
    groups: meaningfulGroups,
    dominantShare: total ? dominant.length / total : 0,
    nextUrl,
    prevUrl,
  };
}
