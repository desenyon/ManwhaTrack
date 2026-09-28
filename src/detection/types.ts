export type PageKind = "series" | "chapter" | "search" | "listing" | "unknown";

export interface DetectionEvidence {
  signal: string;
  weight: number;
  detail?: string;
}

export interface DetectionResult<T> {
  value: T;
  confidence: number;
  evidence: DetectionEvidence[];
}

export interface DetectedChapterLink {
  label: string;
  url: string;
  title?: string;
}

export interface DetectedSeries {
  title: string;
  alternateTitles: string[];
  seriesUrl: string;
  canonicalSeriesUrl: string;
  /** True when the series URL was guessed rather than read from the page. */
  seriesUrlInferred?: boolean;
  coverUrl?: string;
  coverCandidates: string[];
  storyEnded?: boolean;
  chapterList: DetectedChapterLink[];
}

export interface DetectedChapter {
  label: string;
  title?: string;
  url: string;
  canonicalUrl: string;
  prevUrl?: string;
  nextUrl?: string;
}

/** Everything the content script learned about one page. Adapters produce these; they never persist. */
export interface PageObservation {
  url: string;
  hostname: string;
  kind: PageKind;
  confidence: number;
  evidence: DetectionEvidence[];
  adapterId: string;
  series?: DetectedSeries;
  chapter?: DetectedChapter;
  readerSelector?: string;
  detectedAt: number;
}

export interface SiteAdapter {
  id: string;
  /** Hostnames this adapter owns ("example.com" also matches subdomains). */
  hosts: string[];
  /** Optional DOM signature check for theme adapters that work across many hosts. */
  matches?(document: Document, url: URL): boolean;

  detectPageKind(document: Document, url: URL): PageKind;
  extractSeries(document: Document, url: URL): DetectedSeries | null;
  extractChapter(document: Document, url: URL): { chapter: DetectedChapter; series: DetectedSeries | null } | null;
  getReaderContainer?(document: Document): HTMLElement | null;
  extractChapterList?(document: Document, url: URL): DetectedChapterLink[];
  normalizeSeriesUrl?(url: URL): string;
  normalizeChapterUrl?(url: URL): string;
  /** Progress for paged readers (one page on screen at a time), in [0, 1]. */
  readingProgress?(document: Document): number | null;
  /** How new chapters are found for this site. Defaults to fetching the series page HTML. */
  updates?: "html" | "mangadex-api" | "none";
}

export const CONFIDENCE = {
  track: 0.8,
  observe: 0.55,
} as const;

export function confidenceLabel(c: number): "High" | "Medium" | "Low" {
  if (c >= CONFIDENCE.track) return "High";
  if (c >= CONFIDENCE.observe) return "Medium";
  return "Low";
}
