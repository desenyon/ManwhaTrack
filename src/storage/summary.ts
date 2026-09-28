// Derives a series' reading position, update count and Continue destination from its
// chapters. Pure: easy to test and safe to recompute any time.

import type { Chapter, Series, SeriesSource, SeriesSummary } from "../shared/types/models";
import { compareChapters } from "../detection/normalization/chapter";

export interface SeriesState {
  summary: SeriesSummary;
  lastOpenedChapterId?: string;
  lastCompletedChapterId?: string;
  currentChapterId?: string;
  lastReadAt?: number;
}

/** Rounds ordinals so that 12.5 from two sources is recognised as the same chapter. */
const ordKey = (o: number) => Math.round(o * 1000);

export function computeSeriesState(series: Series, chapters: Chapter[], sources: SeriesSource[]): SeriesState {
  const activeSources = new Set(sources.map((s) => s.id));
  const preferred = series.preferredSourceId && activeSources.has(series.preferredSourceId) ? series.preferredSourceId : sources[0]?.id;

  let lastOpened: Chapter | undefined;
  let frontier: Chapter | undefined; // highest-ordered completed chapter
  let lastCompletedAny: Chapter | undefined; // most recently completed, for unordered libraries
  const completedKeys = new Set<string>();
  const knownKeys = new Set<string>();
  let latestKnown: Chapter | undefined;

  // Chapters seen only as a next/prev link don't prove the chapter exists yet.
  const confirmed = (c: Chapter) => !c.inferred || !!c.lastOpenedAt || !!c.completedAt;
  for (const c of chapters) {
    if (!confirmed(c)) continue;
    knownKeys.add(c.ordinal !== undefined ? `o${ordKey(c.ordinal)}` : `k${c.key}`);
    if (c.lastOpenedAt && (!lastOpened || c.lastOpenedAt > (lastOpened.lastOpenedAt ?? 0))) lastOpened = c;
    if (c.completedAt) {
      completedKeys.add(c.ordinal !== undefined ? `o${ordKey(c.ordinal)}` : `k${c.key}`);
      if (c.ordinal !== undefined && (!frontier || c.ordinal > (frontier.ordinal ?? -Infinity))) frontier = c;
      if (!lastCompletedAny || c.completedAt > (lastCompletedAny.completedAt ?? 0)) lastCompletedAny = c;
    }
    if (c.ordinal !== undefined && (!latestKnown || c.ordinal > (latestKnown.ordinal ?? -Infinity))) latestKnown = c;
  }
  // A source may report a newer chapter than any chapter record we hold.
  let virtual: { label: string; ordinal: number } | undefined;
  for (const s of sources) {
    const lk = s.latestKnownChapter;
    const best = virtual?.ordinal ?? latestKnown?.ordinal ?? -Infinity;
    if (lk?.ordinal !== undefined && lk.ordinal > best) virtual = { label: lk.label, ordinal: lk.ordinal };
  }

  const lastCompleted = frontier ?? lastCompletedAny;
  const current = chapters.find((c) => c.id === series.currentChapterId) ?? lastOpened;

  const frontierOrd = frontier?.ordinal;
  const currentOrd = current?.ordinal;
  const baseline = maxDefined(frontierOrd, currentOrd);

  // Distinct main-sequence chapters beyond the reading position.
  const newer = new Set<number>();
  if (baseline !== undefined) {
    for (const c of chapters) if (confirmed(c) && c.ordinal !== undefined && c.ordinal > baseline && !c.completedAt) newer.add(ordKey(c.ordinal));
    if (virtual && virtual.ordinal > baseline && !newer.has(ordKey(virtual.ordinal))) {
      // Count at least the reported chapter even if intermediate ones are unknown.
      newer.add(ordKey(virtual.ordinal));
    }
  }

  const latestOrd = virtual?.ordinal ?? latestKnown?.ordinal;
  const latestLabel = virtual?.label ?? latestKnown?.chapterLabel;

  // ---- Continue destination ----
  let continueKind: SeriesSummary["continueKind"] = "none";
  let target: Chapter | undefined;
  if (frontierOrd !== undefined) {
    target = pickNext(chapters, frontierOrd, preferred);
    if (target) continueKind = target.lastOpenedAt && !target.completedAt ? "resume" : "next";
  }
  let continueUrlOverride: string | undefined;
  if (!target && frontier?.nextUrl && frontier.id === lastOpened?.id) {
    // The next chapter's label is unknown, but its URL was seen on the last chapter read.
    continueUrlOverride = frontier.nextUrl;
    continueKind = "next";
  }
  if (!target && !continueUrlOverride && current && !current.completedAt) {
    target = current;
    continueKind = "resume";
  }
  if (!target && !continueUrlOverride && lastOpened && !lastOpened.completedAt) {
    target = lastOpened;
    continueKind = "resume";
  }
  if (!target && !continueUrlOverride && lastOpened) {
    target = lastOpened;
    continueKind = "last";
  }
  let continueUrl = target?.url ?? continueUrlOverride;
  if (!continueUrl) {
    const src = sources.find((s) => s.id === preferred) ?? sources[0];
    if (src) {
      continueUrl = src.seriesUrl;
      continueKind = "series";
    }
  }

  const summary: SeriesSummary = {
    currentLabel: current?.chapterLabel,
    currentOrdinal: current?.ordinal,
    currentProgress: current ? current.maxProgress : undefined,
    currentCompleted: current ? !!current.completedAt : undefined,
    lastCompletedLabel: lastCompleted?.chapterLabel,
    lastCompletedOrdinal: lastCompleted?.ordinal,
    latestKnownLabel: latestLabel,
    latestKnownOrdinal: latestOrd,
    newCount: newer.size,
    caughtUp: frontierOrd !== undefined && latestOrd !== undefined && frontierOrd >= latestOrd,
    chaptersRead: completedKeys.size,
    chaptersKnown: knownKeys.size + (virtual && !knownKeys.has(`o${ordKey(virtual.ordinal)}`) ? 1 : 0),
    continueKind,
    continueUrl,
    continueLabel: target?.chapterLabel ?? (continueUrlOverride ? "Next chapter" : undefined),
    continueChapterId: target?.id,
    newestChapterDiscoveredAt: latestKnown?.discoveredAt ?? series.summary?.newestChapterDiscoveredAt,
  };

  return {
    summary,
    lastOpenedChapterId: lastOpened?.id,
    lastCompletedChapterId: lastCompleted?.id,
    currentChapterId: current?.id,
    lastReadAt: maxDefined(lastOpened?.lastOpenedAt, lastCompletedAny?.completedAt, series.lastReadAt),
  };
}

function pickNext(chapters: Chapter[], after: number, preferredSourceId: string | undefined): Chapter | undefined {
  let bestOrd: number | undefined;
  for (const c of chapters) {
    if (c.ordinal !== undefined && c.ordinal > after && (bestOrd === undefined || c.ordinal < bestOrd)) bestOrd = c.ordinal;
  }
  if (bestOrd === undefined) return undefined;
  const same = chapters.filter((c) => c.ordinal !== undefined && ordKey(c.ordinal) === ordKey(bestOrd!));
  return (
    same.find((c) => c.lastOpenedAt && !c.completedAt) ??
    same.find((c) => c.sourceId === preferredSourceId) ??
    same.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0]
  );
}

function maxDefined(...xs: (number | undefined)[]): number | undefined {
  let m: number | undefined;
  for (const x of xs) if (x !== undefined && (m === undefined || x > m)) m = x;
  return m;
}

/** Chapters in reading order (ascending). */
export function sortChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort(compareChapters);
}
