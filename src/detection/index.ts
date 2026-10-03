// Detection pipeline: local site rules → known-site adapters → theme adapters → generic.
// Produces a PageObservation. Persistence decisions happen in the service worker.

import type { SiteRule } from "../shared/types/settings";
import type { DetectedSeries, DetectionEvidence, PageObservation, SiteAdapter } from "./types";
import { detectGeneric } from "./generic/detector";
import { findReaderContainer } from "./generic/reader";
import { coverCandidates } from "./generic/cover";
import { cssPath, qs, qsa } from "./metadata/dom";
import { canonicalizeUrl, hostMatches, sourceHost } from "./normalization/url";
import { webtoonsAdapter } from "./adapters/webtoons";
import { madaraAdapter } from "./adapters/madara";
import { mangaThemesiaAdapter } from "./adapters/mangathemesia";
import { ruleAdapter } from "./adapters/rules";
import { mangadexAdapter } from "./adapters/mangadex";
import { mangaPlusAdapter } from "./adapters/mangaplus";
import { novelsAdapter } from "./adapters/novels";
import { tapasAdapter } from "./adapters/tapas";

export const HOST_ADAPTERS: SiteAdapter[] = [webtoonsAdapter, mangadexAdapter, mangaPlusAdapter, tapasAdapter, novelsAdapter];
export const THEME_ADAPTERS: SiteAdapter[] = [madaraAdapter, mangaThemesiaAdapter];
export const ALL_ADAPTERS: SiteAdapter[] = [...HOST_ADAPTERS, ...THEME_ADAPTERS];

const ADAPTER_CONFIDENCE = 0.92;

export interface DetectOptions {
  siteRules?: SiteRule[];
}

export function pickAdapter(doc: Document, url: URL, rules: SiteRule[] = []): SiteAdapter | null {
  const host = sourceHost(url);
  const rule = rules.find((r) => r.enabled && hostMatches(host, r.host));
  if (rule) return ruleAdapter(rule);
  for (const a of HOST_ADAPTERS) if (a.hosts.some((h) => hostMatches(host, h))) return a;
  for (const a of THEME_ADAPTERS) if (a.matches?.(doc, url)) return a;
  return null;
}

export function adapterById(id: string | undefined): SiteAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}

/** Sites that only render with JavaScript can't be checked for new chapters from fetched HTML. */
export function updatesSupported(src: { adapterId?: string }): boolean {
  return adapterById(src.adapterId)?.updates !== "none";
}

/** Cheap pre-check so ordinary pages (search engines, mail, docs) never pay for detection. */
export function mightBeReadingPage(doc: Document, url: URL, rules: SiteRule[] = []): boolean {
  if (pickAdapterCheap(url, rules)) return true;
  const hay = `${url.pathname} ${url.search} ${doc.title}`.toLowerCase();
  if (/(?:chapter|chap|episode|manhwa|manhua|manga|webtoon|comic|novel|fiction|book|scans?|toon|\bch[-._/ ]?\d|\bep[-._/ ]?\d)/.test(hay)) return true;
  const og = qs(doc, 'meta[property="og:type"]')?.getAttribute("content") ?? "";
  if (/book|comic/i.test(og)) return true;
  return qsa(doc, 'a[href*="chapter"], a[href*="episode"], a[href*="/ch-"], a[href*="/ch/"]', 5).length >= 3;
}

function pickAdapterCheap(url: URL, rules: SiteRule[]): boolean {
  const host = sourceHost(url);
  return rules.some((r) => r.enabled && hostMatches(host, r.host)) || HOST_ADAPTERS.some((a) => a.hosts.some((h) => hostMatches(host, h)));
}

export function detectPage(doc: Document, url: URL, opts: DetectOptions = {}): PageObservation {
  const adapter = pickAdapter(doc, url, opts.siteRules);
  if (adapter) {
    const obs = detectWithAdapter(adapter, doc, url);
    if (obs) return obs;
    // A known site whose page isn't ready yet (client-rendered apps): don't let the generic
    // detector guess from a half-rendered page; the DOM observer will re-run detection.
    if (HOST_ADAPTERS.includes(adapter)) {
      const kind = adapter.detectPageKind(doc, url);
      if (kind === "series" || kind === "chapter") {
        return { url: url.href, hostname: sourceHost(url), kind: "unknown", confidence: 0.2, evidence: [{ signal: "adapter-waiting", weight: 0.2, detail: `${adapter.id}: ${kind} page not rendered yet` }], adapterId: adapter.id, detectedAt: Date.now() };
      }
    }
  }
  return detectGeneric(doc, url);
}

function detectWithAdapter(adapter: SiteAdapter, doc: Document, url: URL): PageObservation | null {
  const kind = adapter.detectPageKind(doc, url);
  const evidence: DetectionEvidence[] = [{ signal: "adapter", weight: ADAPTER_CONFIDENCE, detail: adapter.id }];
  const baseObs = {
    url: url.href,
    hostname: sourceHost(url),
    adapterId: adapter.id,
    detectedAt: Date.now(),
    evidence,
  };

  if (kind === "search" || kind === "listing") return { ...baseObs, kind, confidence: 0.9 };

  if (kind === "series") {
    const series = adapter.extractSeries(doc, url);
    if (!series) return null;
    const generic = lazyGeneric(doc, url);
    return {
      ...baseObs,
      kind,
      confidence: ADAPTER_CONFIDENCE,
      series: fillSeriesGaps(series, generic().series, doc, url, adapter),
    };
  }

  if (kind === "chapter") {
    const res = adapter.extractChapter(doc, url);
    if (!res) return null;
    const generic = lazyGeneric(doc, url);
    let series = res.series;
    if (!series) {
      series = generic().series ?? null;
      if (!series) evidence.push({ signal: "no-series-title", weight: -0.3 });
    }
    if (series && !series.coverCandidates.length) {
      const og = generic().series?.coverCandidates[0];
      if (og) series = { ...series, coverCandidates: [og] };
    }
    if (series) { series.format ??= generic().series?.format; series.genres ??= generic().series?.genres; }
    const chapter = { ...res.chapter };
    if (adapter.normalizeChapterUrl) chapter.canonicalUrl = canonicalizeUrl(adapter.normalizeChapterUrl(url));
    if (!chapter.nextUrl || !chapter.prevUrl) {
      const g = generic().chapter;
      chapter.nextUrl ??= g?.nextUrl;
      chapter.prevUrl ??= g?.prevUrl;
    }
    const reader = adapter.getReaderContainer?.(doc) ?? findReaderContainer(doc)?.element ?? null;
    return {
      ...baseObs,
      kind,
      confidence: series ? ADAPTER_CONFIDENCE : ADAPTER_CONFIDENCE - 0.3,
      chapter,
      series: series ?? undefined,
      readerSelector: cssPath(reader),
    };
  }
  return null;
}

function lazyGeneric(doc: Document, url: URL): () => PageObservation {
  let cached: PageObservation | undefined;
  return () => (cached ??= detectGeneric(doc, url));
}

function fillSeriesGaps(series: DetectedSeries, generic: DetectedSeries | undefined, doc: Document, url: URL, adapter: SiteAdapter): DetectedSeries {
  const out: DetectedSeries = { ...series };
  const seriesUrl = adapter.normalizeSeriesUrl ? adapter.normalizeSeriesUrl(url) : series.seriesUrl;
  out.canonicalSeriesUrl = canonicalizeUrl(seriesUrl);
  if (!out.chapterList.length && generic?.chapterList.length) out.chapterList = generic.chapterList;
  const covers = coverCandidates(doc, url.href, null, series.coverUrl ? [series.coverUrl] : []);
  out.coverCandidates = [...new Set([...series.coverCandidates, ...covers])].slice(0, 6);
  out.coverUrl ??= out.coverCandidates[0];
  if (!out.alternateTitles.length && generic?.alternateTitles.length) out.alternateTitles = generic.alternateTitles;
  out.storyEnded ??= generic?.storyEnded;
  out.format ??= generic?.format;
  out.genres ??= generic?.genres;
  return out;
}

/** Page-count progress for paged readers, when the site's adapter can report it. */
export function pagedProgressFor(doc: Document, url: URL, opts: DetectOptions = {}): number | null {
  return pickAdapter(doc, url, opts.siteRules)?.readingProgress?.(doc) ?? null;
}

export function readerContainerFor(doc: Document, url: URL, opts: DetectOptions = {}): HTMLElement | null {
  const adapter = pickAdapter(doc, url, opts.siteRules);
  return adapter?.getReaderContainer?.(doc) ?? findReaderContainer(doc)?.element ?? null;
}
