// Record factories and repair functions. Repair is applied when reading or importing
// records so that older or partially written data is filled in rather than discarded.

import type { Chapter, ReadingEvent, Series, SeriesSource, SeriesSummary, SeriesStatus } from "../shared/types/models";
import { SERIES_STATUSES } from "../shared/types/models";
import { sanitizeReadingPosition } from "../shared/reading-position";
import { normalizeTitle } from "../detection/normalization/title";
import { parseChapterLabel } from "../detection/normalization/chapter";
import { canonicalizeUrl, sourceHost } from "../detection/normalization/url";

export function newId(): string {
  return crypto.randomUUID();
}

export const EMPTY_SUMMARY: SeriesSummary = {
  newCount: 0,
  caughtUp: false,
  chaptersRead: 0,
  chaptersKnown: 0,
  continueKind: "none",
};

export function titleKeysFor(title: string, alternateTitles: string[]): string[] {
  const keys = new Set<string>();
  for (const t of [title, ...alternateTitles]) {
    const n = normalizeTitle(t);
    if (n) keys.add(n);
  }
  return [...keys];
}

export function createSeries(init: { title: string; status?: SeriesStatus; now?: number }): Series {
  const now = init.now ?? Date.now();
  return {
    id: newId(),
    title: init.title,
    detectedTitle: init.title,
    normalizedTitle: normalizeTitle(init.title),
    alternateTitles: [],
    titleKeys: titleKeysFor(init.title, []),
    status: init.status ?? "reading",
    favorite: false,
    pinned: false,
    tags: [],
    sourceIds: [],
    discoveredAt: now,
    updatedAt: now,
    totalReadingTimeMs: 0,
    userFields: [],
    keptSeparateFrom: [],
    summary: { ...EMPTY_SUMMARY },
  };
}

export function createSource(init: { seriesId: string; seriesUrl: string; inferred?: boolean; now?: number }): SeriesSource {
  const now = init.now ?? Date.now();
  return {
    id: newId(),
    seriesId: init.seriesId,
    hostname: sourceHost(init.seriesUrl),
    seriesUrl: init.seriesUrl,
    canonicalSeriesUrl: canonicalizeUrl(init.seriesUrl),
    seriesUrlInferred: init.inferred ?? false,
    previousUrls: [],
    coverCandidates: [],
    consecutiveFailures: 0,
    disabled: false,
    discoveredAt: now,
    updatedAt: now,
  };
}

export function createChapter(init: { seriesId: string; sourceId: string; label: string; url: string; now?: number }): Chapter {
  const p = parseChapterLabel(init.label);
  return {
    id: newId(),
    seriesId: init.seriesId,
    sourceId: init.sourceId,
    key: p.key,
    title: p.label,
    chapterLabel: p.label,
    chapterNumber: p.number,
    volumeNumber: p.volume,
    seasonNumber: p.season,
    ordinal: p.ordinal,
    url: init.url,
    canonicalUrl: canonicalizeUrl(init.url),
    progressRevision: 0,
    visitCount: 0,
    maxProgress: 0,
    readingTimeMs: 0,
    discoveredAt: init.now ?? Date.now(),
    userFields: [],
  };
}

// ---- repair ----

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean => v === true;
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function repairSeries(raw: Partial<Series> & Record<string, unknown>): Series | null {
  const id = str(raw.id);
  const title = str(raw.title)?.trim();
  if (!id || !title) return null;
  const now = Date.now();
  const alternateTitles = strArr(raw.alternateTitles);
  const status = SERIES_STATUSES.includes(raw.status as SeriesStatus) ? (raw.status as SeriesStatus) : "reading";
  const rating = num(raw.personalRating);
  return {
    ...(raw as Series),
    id,
    title,
    detectedTitle: str(raw.detectedTitle),
    normalizedTitle: normalizeTitle(title),
    alternateTitles,
    titleKeys: titleKeysFor(title, alternateTitles),
    status,
    favorite: bool(raw.favorite),
    pinned: bool(raw.pinned),
    personalRating: rating !== undefined ? Math.max(0, Math.min(10, rating)) : undefined,
    tags: strArr(raw.tags),
    notes: str(raw.notes),
    sourceIds: strArr(raw.sourceIds),
    discoveredAt: num(raw.discoveredAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
    lastReadAt: num(raw.lastReadAt),
    totalReadingTimeMs: num(raw.totalReadingTimeMs) ?? 0,
    userFields: strArr(raw.userFields) as Series["userFields"],
    keptSeparateFrom: strArr(raw.keptSeparateFrom),
    summary: { ...EMPTY_SUMMARY, ...(raw.summary && typeof raw.summary === "object" ? raw.summary : {}) },
  };
}

export function repairSource(raw: Partial<SeriesSource> & Record<string, unknown>): SeriesSource | null {
  const id = str(raw.id);
  const seriesId = str(raw.seriesId);
  const seriesUrl = str(raw.seriesUrl);
  if (!id || !seriesId || !seriesUrl) return null;
  const now = Date.now();
  return {
    ...(raw as SeriesSource),
    id,
    seriesId,
    seriesUrl,
    hostname: str(raw.hostname) ?? sourceHost(seriesUrl),
    canonicalSeriesUrl: str(raw.canonicalSeriesUrl) ?? canonicalizeUrl(seriesUrl),
    seriesUrlInferred: bool(raw.seriesUrlInferred),
    previousUrls: strArr(raw.previousUrls),
    coverCandidates: strArr(raw.coverCandidates),
    consecutiveFailures: num(raw.consecutiveFailures) ?? 0,
    disabled: bool(raw.disabled),
    removedAt: num(raw.removedAt),
    discoveredAt: num(raw.discoveredAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
  };
}

export function repairChapter(raw: Partial<Chapter> & Record<string, unknown>): Chapter | null {
  const id = str(raw.id);
  const seriesId = str(raw.seriesId);
  const sourceId = str(raw.sourceId);
  const label = str(raw.chapterLabel) ?? str(raw.title);
  const url = str(raw.url);
  if (!id || !seriesId || !sourceId || !label || !url) return null;
  const parsed = parseChapterLabel(label);
  const userFields = strArr(raw.userFields) as Chapter["userFields"];
  return {
    ...(raw as Chapter),
    id,
    seriesId,
    sourceId,
    chapterLabel: label,
    title: str(raw.title) ?? label,
    key: str(raw.key) ?? parsed.key,
    ordinal: userFields.includes("number") ? num(raw.ordinal) : num(raw.ordinal) ?? parsed.ordinal,
    chapterNumber: num(raw.chapterNumber) ?? parsed.number,
    url,
    canonicalUrl: str(raw.canonicalUrl) ?? canonicalizeUrl(url),
    progressRevision: Math.max(0, Math.floor(num(raw.progressRevision) ?? 0)),
    readingPosition: sanitizeReadingPosition(raw.readingPosition),
    visitCount: num(raw.visitCount) ?? 0,
    maxProgress: Math.max(0, Math.min(1, num(raw.maxProgress) ?? 0)),
    readingTimeMs: num(raw.readingTimeMs) ?? 0,
    discoveredAt: num(raw.discoveredAt) ?? num(raw.firstOpenedAt) ?? Date.now(),
    userFields,
    associationOverridden: bool(raw.associationOverridden),
  };
}

export function repairEvent(raw: Partial<ReadingEvent> & Record<string, unknown>): ReadingEvent | null {
  const id = str(raw.id);
  const seriesId = str(raw.seriesId);
  const timestamp = num(raw.timestamp);
  const types = ["opened", "progress", "completed", "manual-read", "manual-unread"];
  if (!id || !seriesId || timestamp === undefined || !types.includes(raw.type as string)) return null;
  return { ...(raw as ReadingEvent), id, seriesId, timestamp };
}
