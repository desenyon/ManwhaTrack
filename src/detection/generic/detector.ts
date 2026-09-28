// Generic detector for sites without an adapter. Combines many weak signals into a
// confidence score; nothing here depends on a specific hostname.

import type { DetectedChapter, DetectedChapterLink, DetectedSeries, DetectionEvidence, PageKind, PageObservation } from "../types";
import { breadcrumbs, canonicalLink, cssPath, hrefOf, jsonLd, labelledValue, ldString, ldTypes, meta, qsa, text } from "../metadata/dom";
import { chapterLabelFromUrl, parseChapterLabel } from "../normalization/chapter";
import { cleanSeriesTitle, isPlausibleTitle } from "../normalization/title";
import { canonicalizeUrl, inferSeriesUrlFromChapterUrl, sourceHost, toUrl } from "../normalization/url";
import { findReaderContainer } from "./reader";
import { scanLinks } from "./links";
import { coverCandidates } from "./cover";

const SERIES_PATH = /\/(?:manga|manhwa|manhua|series|comic|comics|webtoon|webtoons|title|titles|novel|read|serie|obra)\/[^/]+/i;
const LISTING_PATH = /\/(?:search|genres?|tags?|categor(?:y|ies)|latest|popular|trending|ranking|list|directory|az-list|page\/\d+)(?:\/|$)|[?&](?:s|q|query|keyword|search)=/i;
const CHAPTER_TEXT = /\b(?:chapter|chap|ch|episode|ep)\.?\s*#?\d+(?:\.\d+)?\b/i;
const META_LABELS = /^(?:author|authors|artist|artists|status|genres?|type|alternative|alt(?:ernative)? names?|released|serialization|publisher)\s*:?$/i;
const ALT_LABELS = /^(?:alternative(?: titles?)?|alt(?:ernative)? names?|other names?|also known as|associated names?|synonyms?)\s*:?/i;
const STATUS_LABELS = /^(?:status|publication status|comic status)\s*:?/i;

export interface GenericOptions {
  /** Called with evidence for diagnostics. */
  debug?: boolean;
}

export function siteName(doc: Document, url: URL): string | undefined {
  return meta(doc, "og:site_name") ?? sourceHost(url).split(".")[0];
}

function firstHeading(doc: Document): Element | null {
  for (const h of qsa(doc, "main h1, article h1, h1, .entry-title, .post-title h1, .series-title, .manga-title", 20)) {
    const t = text(h, 200);
    if (t && isPlausibleTitle(t)) return h;
  }
  return null;
}

export function detectGeneric(doc: Document, url: URL): PageObservation {
  const href = url.href;
  const site = siteName(doc, url);
  const docTitle = (doc.title ?? "").trim();
  const ogTitle = meta(doc, "og:title");
  const heading = firstHeading(doc);
  const headingText = text(heading, 200);
  const ld = jsonLd(doc);
  const ldKinds = ld.flatMap(ldTypes);

  const urlChapterLabel = chapterLabelFromUrl(url);
  const reader = findReaderContainer(doc);
  const links = scanLinks(doc, url, urlChapterLabel ? href : undefined);
  const crumbs = breadcrumbs(doc, href);

  // ---- chapter score ----
  const ce: DetectionEvidence[] = [];
  if (urlChapterLabel) ce.push({ signal: "chapter-url", weight: 0.35, detail: urlChapterLabel });
  if (reader) ce.push({ signal: "reader-container", weight: reader.imageCount >= 8 ? 0.35 : 0.25, detail: `${reader.imageCount} images` });
  if (links.nextUrl || links.prevUrl) ce.push({ signal: "chapter-navigation", weight: 0.15 });
  const titleChapter = [headingText, ogTitle ?? "", docTitle].find((t) => CHAPTER_TEXT.test(t) || (reader !== null && SPECIAL_LABEL.test(t)));
  if (titleChapter) ce.push({ signal: "chapter-title", weight: 0.15, detail: titleChapter.slice(0, 80) });
  if (ldKinds.some((t) => /Chapter|ComicIssue|Episode/i.test(t))) ce.push({ signal: "structured-chapter", weight: 0.2 });
  if (!reader && links.chapterList.length >= 10 && !links.nextUrl) ce.push({ signal: "has-chapter-list", weight: -0.3 });

  // ---- series score ----
  const se: DetectionEvidence[] = [];
  const listLen = links.chapterList.length;
  if (listLen >= 3) se.push({ signal: "chapter-list", weight: listLen >= 10 ? 0.45 : 0.35, detail: `${listLen} links` });
  if (heading) se.push({ signal: "heading", weight: 0.1, detail: headingText.slice(0, 80) });
  if (SERIES_PATH.test(url.pathname)) se.push({ signal: "series-url", weight: 0.15 });
  if (ldKinds.some((t) => /^(?:Book|ComicSeries|CreativeWorkSeries|Manga|BookSeries)$/i.test(t))) se.push({ signal: "structured-series", weight: 0.2 });
  const metaLabels = qsa(doc, "dt, th, b, strong, h5, .summary-heading, .imptdt, span", 1500).filter((e) => META_LABELS.test(text(e, 40))).length;
  if (metaLabels >= 2) se.push({ signal: "metadata-labels", weight: 0.1, detail: `${metaLabels} labels` });
  if (urlChapterLabel) se.push({ signal: "chapter-url", weight: -0.35 });
  if (reader && reader.imageCount >= 5) se.push({ signal: "reader-container", weight: -0.3 });
  if (links.groups >= 4 && links.dominantShare < 0.5) se.push({ signal: "many-series", weight: -0.4, detail: `${links.groups} groups` });

  const chapterScore = clamp(sum(ce));
  const seriesScore = clamp(sum(se) + (listLen >= 3 && heading ? 0.1 : 0));

  if (LISTING_PATH.test(url.pathname + url.search) && Math.max(chapterScore, seriesScore) < 0.8) {
    const kind: PageKind = /search|[?&](?:s|q|query|keyword)=/i.test(url.pathname + url.search) ? "search" : "listing";
    return base(url, kind, 0.6, [{ signal: "listing-url", weight: 0.6 }]);
  }

  if (chapterScore >= seriesScore && chapterScore > 0.2) {
    const label =
      pickChapterLabel(urlChapterLabel, [headingText, ogTitle ?? "", docTitle]) ??
      pickSpecialLabel([crumbs[crumbs.length - 1]?.text ?? "", headingText, ogTitle ?? "", docTitle]);
    if (!label) return base(url, "unknown", chapterScore * 0.5, ce);
    const canonical = canonicalLink(doc, href);
    const chapterUrl = canonicalizeUrl(canonical && chapterLabelFromUrl(new URL(canonical)) ? canonical : href);
    const chapter: DetectedChapter = {
      label,
      title: titleChapter?.slice(0, 200),
      url: href,
      canonicalUrl: chapterUrl,
      nextUrl: links.nextUrl,
      prevUrl: links.prevUrl,
    };
    const series = seriesFromChapterPage(doc, url, crumbs, headingText, ogTitle, docTitle, site, links.chapterList);
    if (!series) ce.push({ signal: "no-series-title", weight: -0.25 });
    else ce.push({ signal: "series-identified", weight: 0.05, detail: series.title });
    return {
      ...base(url, "chapter", clamp(sum(ce)), ce),
      chapter,
      series: series ?? undefined,
      readerSelector: cssPath(reader?.element ?? null),
    };
  }

  if (seriesScore > 0.2) {
    const series = extractSeriesGeneric(doc, url, heading, headingText, ogTitle, docTitle, site, links.chapterList);
    if (!series) return base(url, "unknown", seriesScore * 0.5, se);
    if (series.coverUrl) se.push({ signal: "cover", weight: 0.1 });
    return { ...base(url, "series", clamp(sum(se)), se), series };
  }

  return base(url, "unknown", Math.max(chapterScore, seriesScore), [...ce, ...se]);
}

function lastNonRootCrumb(crumbs: { text: string; href?: string }[]): { text: string; href?: string } | undefined {
  for (let i = crumbs.length - 1; i > 0; i--) {
    const c = crumbs[i];
    if (c?.href && new URL(c.href).pathname.length > 1) return c;
  }
  return crumbs[crumbs.length - 2];
}

function base(url: URL, kind: PageKind, confidence: number, evidence: DetectionEvidence[]): PageObservation {
  return {
    url: url.href,
    hostname: sourceHost(url),
    kind,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    adapterId: "generic",
    detectedAt: Date.now(),
  };
}

function sum(e: DetectionEvidence[]): number {
  return e.reduce((a, x) => a + x.weight, 0);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function pickChapterLabel(fromUrl: string | undefined, texts: string[]): string | undefined {
  for (const t of texts) {
    const m = /\b(?:(?:season|s)\s*\d+\s*[-,:]?\s*)?(?:chapter|chap|ch|episode|ep)\.?\s*#?\d+(?:\.\d+)?(?:\s*(?:part|pt)\.?\s*\d+)?/i.exec(t);
    if (m) {
      const parsed = parseChapterLabel(m[0]);
      if (!fromUrl || parsed.number === parseChapterLabel(fromUrl).number) return parsed.label;
    }
  }
  return fromUrl;
}

const SPECIAL_LABEL = /\b(?:prologue|epilogue|side\s*story\s*\d*|special(?:\s+(?:chapter|episode))?\s*\d*|extra\s*\d*|bonus\s*(?:chapter|episode)?\s*\d*)\b/i;

function pickSpecialLabel(texts: string[]): string | undefined {
  for (const t of texts) {
    const m = SPECIAL_LABEL.exec(t);
    if (m) return parseChapterLabel(m[0].replace(/\b\w/g, (c) => c.toUpperCase())).label;
  }
  return undefined;
}

export function extractAltTitles(doc: Document): string[] {
  const raw = labelledValue(doc, ALT_LABELS);
  if (!raw) return [];
  return raw
    .split(/\s*[,;/|•、]\s*|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 150 && isPlausibleTitle(s))
    .slice(0, 12);
}

export function extractStoryEnded(doc: Document): boolean | undefined {
  const v = labelledValue(doc, STATUS_LABELS);
  if (!v) return undefined;
  if (/\b(?:completed|complete|finished|ended|concluded)\b/i.test(v)) return true;
  if (/\b(?:ongoing|on-going|releasing|publishing|hiatus|season end)\b/i.test(v)) return false;
  return undefined;
}

function extractSeriesGeneric(
  doc: Document,
  url: URL,
  heading: Element | null,
  headingText: string,
  ogTitle: string | undefined,
  docTitle: string,
  site: string | undefined,
  chapterList: DetectedChapterLink[],
): DetectedSeries | null {
  const ldName = jsonLd(doc)
    .filter((o) => ldTypes(o).some((t) => /Book|Comic|Series|Manga|CreativeWork/i.test(t)))
    .map((o) => ldString(o.name))
    .find((x): x is string => !!x);
  const candidates = [ldName, headingText, ogTitle, docTitle].map((t) => cleanSeriesTitle(t ?? "", site)).filter(isPlausibleTitle);
  const title = candidates[0];
  if (!title) return null;
  const canonical = canonicalLink(doc, url.href);
  const seriesUrl = canonicalizeUrl(canonical && !chapterLabelFromUrl(new URL(canonical)) ? canonical : url.href);
  const covers = coverCandidates(doc, url.href, heading);
  const alts = extractAltTitles(doc).filter((a) => a.toLowerCase() !== title.toLowerCase());
  return {
    title,
    alternateTitles: alts,
    seriesUrl: url.href,
    canonicalSeriesUrl: seriesUrl,
    coverUrl: covers[0],
    coverCandidates: covers,
    storyEnded: extractStoryEnded(doc),
    chapterList: chapterList.slice(0, 2000),
  };
}

function seriesFromChapterPage(
  doc: Document,
  url: URL,
  crumbs: { text: string; href?: string }[],
  headingText: string,
  ogTitle: string | undefined,
  docTitle: string,
  site: string | undefined,
  chapterLinks: { url: string }[],
): DetectedSeries | null {
  const inferredUrl = inferSeriesUrlFromChapterUrl(url.href);
  let seriesUrl: string | undefined;
  let title = "";

  // 1. Breadcrumb: the crumb before the chapter crumb is usually the series.
  if (crumbs.length >= 2) {
    const idx = crumbs.findIndex((c) => CHAPTER_TEXT.test(c.text) || (c.href && chapterLabelFromUrl(new URL(c.href))));
    const cand = idx > 0 ? crumbs[idx - 1] : lastNonRootCrumb(crumbs);
    if (cand) {
      const cleaned = cleanSeriesTitle(cand.text, site);
      if (isPlausibleTitle(cleaned) && !/^(?:home|manga|manhwa|comics?|series)$/i.test(cleaned)) {
        title = cleaned;
        seriesUrl = cand.href && !chapterLabelFromUrl(new URL(cand.href)) ? cand.href : undefined;
      }
    }
  }

  // 2. A link to the inferred series URL, or an "all chapters" link.
  if (!seriesUrl) {
    const target = inferredUrl ? canonicalizeUrl(inferredUrl) : undefined;
    for (const a of qsa<HTMLAnchorElement>(doc, "a[href]", 3000)) {
      const h = hrefOf(a, url.href);
      if (!h) continue;
      const t = text(a, 120);
      if ((target && canonicalizeUrl(h) === target) || /^(?:all chapters|chapter list|series page|back to (?:series|manga)|info)$/i.test(t)) {
        seriesUrl = h;
        if (!title) {
          const cleaned = cleanSeriesTitle(t, site);
          if (isPlausibleTitle(cleaned) && !/chapters?|info|series/i.test(cleaned)) title = cleaned;
        }
        break;
      }
    }
  }

  // 3. Title text with the chapter portion removed.
  if (!title) {
    for (const t of [headingText, ogTitle ?? "", docTitle]) {
      const cleaned = cleanSeriesTitle(t, site);
      if (isPlausibleTitle(cleaned) && cleaned !== t.trim()) {
        title = cleaned;
        break;
      }
    }
  }
  if (!title) return null;

  let inferred = false;
  if (!seriesUrl && inferredUrl) {
    seriesUrl = inferredUrl;
    inferred = true;
  }
  if (!seriesUrl) {
    // Last resort: a stable per-series key derived from the chapter URL group.
    const firstOther = chapterLinks.find((l) => l.url !== url.href);
    const stem = new URL(firstOther?.url ?? url.href).pathname
      .replace(/(?:chapter|chap|ch|episode|ep)[-_/.]?\d.*$/i, "")
      .replace(/[-_]+$/, "");
    seriesUrl = `${url.origin}${stem.endsWith("/") ? stem : `${stem}/`}`;
    inferred = true;
    if (!toUrl(seriesUrl)) return null;
  }

  // On chapter pages only og:image is trusted as a cover; page images are not covers.
  const og = meta(doc, "og:image");
  const ogAbs = og ? toUrl(og, url.href)?.href : undefined;
  const covers = ogAbs && !/logo|icon|banner/i.test(ogAbs) ? [ogAbs] : [];
  return {
    title,
    alternateTitles: [],
    seriesUrl,
    canonicalSeriesUrl: canonicalizeUrl(seriesUrl),
    seriesUrlInferred: inferred,
    coverUrl: undefined,
    coverCandidates: covers,
    chapterList: [],
  };
}
