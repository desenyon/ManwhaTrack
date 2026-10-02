import { linkLabel } from "../generic/links";
import type { DetectedChapterLink, DetectedSeries } from "../types";
import { hrefOf, imgSrc, qs, qsa, text } from "../metadata/dom";
import { canonicalizeUrl } from "../normalization/url";
import { cleanSeriesTitle, isPlausibleTitle } from "../normalization/title";

export function chapterLinksFrom(root: ParentNode, selector: string, base: string, labelSelector?: string): DetectedChapterLink[] {
  const out: DetectedChapterLink[] = [];
  const seen = new Set<string>();
  for (const a of qsa<HTMLAnchorElement>(root, selector, 5000)) {
    const href = hrefOf(a, base);
    if (!href) continue;
    const url = canonicalizeUrl(href);
    if (seen.has(url)) continue;
    seen.add(url);
    const label = linkLabel(labelSelector ? qs(a, labelSelector) ?? a : a, new URL(url));
    if (label) out.push({ label, url });
  }
  return out;
}

export function titleFrom(el: Element | null, site?: string): string {
  if (!el) return "";
  // Ignore decorative badges ("HOT", "NEW") nested in headings.
  const clone = el.cloneNode(true) as Element;
  for (const b of qsa(clone, ".manga-title-badges, .badge, .hot, .new, span.label", 10)) b.remove();
  const t = cleanSeriesTitle(text(clone, 250), site);
  return isPlausibleTitle(t) ? t : "";
}

export function coverFrom(doc: Document, selectors: string[], base: string): string | undefined {
  for (const sel of selectors) {
    const src = imgSrc(qs(doc, sel), base);
    if (src) return src;
  }
  return undefined;
}

export function seriesRecord(partial: Omit<DetectedSeries, "canonicalSeriesUrl" | "alternateTitles" | "coverCandidates" | "chapterList"> & Partial<DetectedSeries>): DetectedSeries {
  return {
    alternateTitles: [],
    coverCandidates: partial.coverUrl ? [partial.coverUrl] : [],
    chapterList: [],
    canonicalSeriesUrl: canonicalizeUrl(partial.seriesUrl),
    ...partial,
  };
}
