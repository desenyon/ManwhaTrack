// Canonical persisted data model. Every change here needs a migration in
// src/storage/migrations.ts and, if exported, an export-format migration.

export type SeriesStatus = "reading" | "completed" | "planning" | "on-hold" | "dropped";

export const SERIES_STATUSES: readonly SeriesStatus[] = ["reading", "planning", "on-hold", "completed", "dropped"];

/** Fields a user can explicitly own. Automatic detection never overwrites these once set. */
export type SeriesUserField = "title" | "alternateTitles" | "cover" | "status";
export type ChapterUserField = "label" | "number";

export interface ChapterIdentity {
  key: string;
  label: string;
  ordinal?: number;
  url?: string;
}

export type ContinueKind = "next" | "resume" | "last" | "series" | "none";

/** Denormalized view of a series' chapters, recomputed whenever its chapters change. */
export interface SeriesSummary {
  currentLabel?: string;
  currentOrdinal?: number;
  currentProgress?: number;
  currentCompleted?: boolean;
  lastCompletedLabel?: string;
  lastCompletedOrdinal?: number;
  latestKnownLabel?: string;
  latestKnownOrdinal?: number;
  /** Distinct main-sequence chapters known to exist beyond the last completed one. */
  newCount: number;
  caughtUp: boolean;
  chaptersRead: number;
  chaptersKnown: number;
  continueKind: ContinueKind;
  continueUrl?: string;
  continueLabel?: string;
  continueChapterId?: string;
  /** When a chapter newer than anything previously known was last discovered. */
  newestChapterDiscoveredAt?: number;
}

export interface Series {
  id: string;

  title: string;
  /** Last title produced by detection. `title` equals this unless the user owns "title". */
  detectedTitle?: string;
  normalizedTitle: string;
  alternateTitles: string[];
  /** Normalized title + alternate titles, indexed for duplicate and source matching. */
  titleKeys: string[];

  coverId?: string;
  detectedCoverId?: string;

  status: SeriesStatus;
  favorite: boolean;
  pinned: boolean;
  personalRating?: number;
  tags: string[];
  notes?: string;

  sourceIds: string[];
  preferredSourceId?: string;

  lastOpenedChapterId?: string;
  lastCompletedChapterId?: string;
  currentChapterId?: string;

  discoveredAt: number;
  lastReadAt?: number;
  updatedAt: number;
  totalReadingTimeMs: number;

  hidden?: boolean;
  /** Soft-delete marker. Removed series stay restorable until purged. */
  removedAt?: number;
  userFields: SeriesUserField[];
  /** Series ids the user explicitly chose to keep separate from this one. */
  keptSeparateFrom: string[];

  summary: SeriesSummary;
}

export type SourceHealth = "healthy" | "stale" | "failing" | "unknown";

export interface SeriesSource {
  id: string;
  seriesId: string;

  hostname: string;
  seriesUrl: string;
  canonicalSeriesUrl: string;
  /** True when the series URL was inferred from a chapter URL rather than observed. */
  seriesUrlInferred: boolean;
  /** Earlier URLs for this source, kept for recovery after site moves. */
  previousUrls: string[];

  sourceTitle?: string;
  coverUrl?: string;
  coverCandidates: string[];

  latestKnownChapter?: ChapterIdentity;
  storyEnded?: boolean;

  lastCheckedAt?: number;
  lastSuccessfulCheckAt?: number;
  consecutiveFailures: number;
  lastError?: string;

  adapterId?: string;
  /** Removed from active reading, retained for historical identity. */
  removedAt?: number;
  /** Disables update checks for this source only. */
  disabled: boolean;

  discoveredAt: number;
  updatedAt: number;
}

export type CompletionSource = "progress" | "next-link" | "manual" | "import";

/** Latest viewport position, independent of furthest progress and completion. */
export interface ReadingPosition {
  version: 1;
  capturedAt: number;
  progressRevision: number;
  readerOffset: number;
  readerHeight: number;
  viewportHeight: number;
  imageIndex?: number;
  imageOffset?: number;
}

export interface Chapter {
  id: string;
  seriesId: string;
  sourceId: string;
  /** Explicit series/source correction; detection must preserve this association. */
  associationOverridden?: boolean;
  /** Stable per-source identity: derived from the parsed chapter label. */
  key: string;

  title: string;
  chapterLabel: string;
  chapterNumber?: number;
  volumeNumber?: number;
  seasonNumber?: number;
  /** Sort position in the main sequence. Undefined for specials / unparseable labels. */
  ordinal?: number;

  url: string;
  canonicalUrl: string;
  prevUrl?: string;
  nextUrl?: string;

  firstOpenedAt?: number;
  lastOpenedAt?: number;
  completedAt?: number;
  completionSource?: CompletionSource;

  /** Invalidates automatic observations after manual progress changes. Legacy value is 0. */
  progressRevision?: number;
  readingPosition?: ReadingPosition;
  visitCount: number;
  maxProgress: number;
  readingTimeMs: number;

  discoveredAt: number;
  userFields: ChapterUserField[];
  /**
   * Known only from a previous/next link, not from a chapter list or a visit. Usable as a
   * Continue target but not counted as "new" (sites sometimes link past their latest chapter).
   */
  inferred?: boolean;
}

export type ReadingEventType = "opened" | "progress" | "completed" | "manual-read" | "manual-unread";

export interface ReadingEvent {
  id: string;
  seriesId: string;
  chapterId?: string;
  type: ReadingEventType;
  timestamp: number;
  progress?: number;
  /** Denormalized so history stays readable if the chapter record is later removed. */
  chapterLabel?: string;
  hostname?: string;
}

export interface CoverAsset {
  id: string;
  blob: Blob;
  mimeType: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  origin: "detected" | "custom";
  capturedAt: number;
}

export interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}
