import type { DetectedChapterLink, PageObservation } from "../../src/detection/types";
import { canonicalizeUrl, sourceHost } from "../../src/detection/normalization/url";
import { useDatabase } from "../../src/storage/db";

export function freshDb(): string {
  const name = `test-${crypto.randomUUID()}`;
  useDatabase(name);
  return name;
}

export function seriesObs(o: {
  title: string;
  url: string;
  cover?: string;
  chapters?: DetectedChapterLink[];
  alts?: string[];
  inferred?: boolean;
}): PageObservation {
  return {
    url: o.url,
    hostname: sourceHost(o.url),
    kind: "series",
    confidence: 0.9,
    evidence: [],
    adapterId: "test",
    detectedAt: Date.now(),
    series: {
      title: o.title,
      alternateTitles: o.alts ?? [],
      seriesUrl: o.url,
      canonicalSeriesUrl: canonicalizeUrl(o.url),
      seriesUrlInferred: o.inferred,
      coverUrl: o.cover,
      coverCandidates: o.cover ? [o.cover] : [],
      chapterList: o.chapters ?? [],
    },
  };
}

export function chapterObs(o: {
  title: string;
  seriesUrl: string;
  label: string;
  url: string;
  next?: string;
  prev?: string;
  inferred?: boolean;
  alts?: string[];
}): PageObservation {
  return {
    url: o.url,
    hostname: sourceHost(o.url),
    kind: "chapter",
    confidence: 0.9,
    evidence: [],
    adapterId: "test",
    detectedAt: Date.now(),
    chapter: { label: o.label, url: o.url, canonicalUrl: canonicalizeUrl(o.url), nextUrl: o.next, prevUrl: o.prev },
    series: {
      title: o.title,
      alternateTitles: o.alts ?? [],
      seriesUrl: o.seriesUrl,
      canonicalSeriesUrl: canonicalizeUrl(o.seriesUrl),
      seriesUrlInferred: o.inferred,
      coverCandidates: [],
      chapterList: [],
    },
  };
}

export const SL = "https://example-scans.com/manga/solo-leveling/";
export const slChapter = (n: number | string) => `https://example-scans.com/manga/solo-leveling/chapter-${n}/`;
