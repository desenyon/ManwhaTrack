// The tracking layer: decides what to persist from detection observations.
// Adapters/detectors only observe; this module is the single writer for automatic tracking.

import type { Chapter, CompletionSource, CoverAsset, ReadingPosition, Series, SeriesSource } from "../shared/types/models";
import type { DetectedChapterLink, DetectedSeries, PageObservation } from "../detection/types";
import { recordTimedActivityTx } from "./repositories/analytics";
import { WriteRevokedError, write, type Tx } from "./db";
import { createChapter, createSeries, createSource, titleKeysFor } from "./schema";
import { getSeriesTx, putSeriesTx, refreshSeriesTx } from "./repositories/series";
import { addEventTx, updateReadingPosition } from "./repositories/chapters";
import { chapterLabelFromUrl, correctJoinedChapterLabel, parseChapterLabel } from "../detection/normalization/chapter";
import { canonicalizeUrl, isSafeHttpUrl, sourceHost, toUrl } from "../detection/normalization/url";
import { normalizeTitle } from "../detection/normalization/title";

const REVISIT_WINDOW_MS = 30 * 60_000;
const MAX_PROGRESS_DELTA_MS = 15 * 60_000;
const MAX_LIST = 3000;
const TRACK_STORES = ["series", "sources", "chapters", "events"] as const;

export interface TrackResult {
  seriesId: string;
  sourceId: string;
  seriesTitle: string;
  chapterId?: string;
  chapterLabel?: string;
  chapterProgressRevision?: number;
  chapterProgress?: number;
  created: boolean;
  restored: boolean;
  /** Cover the caller should download and cache (outside the DB transaction). */
  coverUrl?: string;
  /** Another series that looks like the same work (suggest merging, never auto-merge). */
  possibleDuplicateOf?: string;
}

interface Resolved {
  series: Series;
  source: SeriesSource;
  created: boolean;
  restored: boolean;
  possibleDuplicateOf?: string;
}

// ---------------------------------------------------------------- resolution

async function findSourceByUrl(t: Tx, canonical: string): Promise<SeriesSource | undefined> {
  return (
    (await t.firstByIndex<SeriesSource>("sources", "canonicalSeriesUrl", canonical)) ??
    (await t.firstByIndex<SeriesSource>("sources", "previousUrls", canonical))
  );
}

async function seriesByTitleKeys(t: Tx, keys: string[]): Promise<Series[]> {
  const out = new Map<string, Series>();
  for (const k of keys) for (const s of await t.byIndex<Series>("series", "titleKeys", k)) out.set(s.id, s);
  return [...out.values()];
}

/** Moves a source to a new URL, remembering the old one for recovery. */
function relocateSource(src: SeriesSource, detected: DetectedSeries): void {
  if (src.canonicalSeriesUrl === detected.canonicalSeriesUrl) return;
  if (!src.previousUrls.includes(src.canonicalSeriesUrl)) src.previousUrls.push(src.canonicalSeriesUrl);
  src.previousUrls = src.previousUrls.filter((u) => u !== detected.canonicalSeriesUrl).slice(-10);
  src.seriesUrl = detected.seriesUrl;
  src.canonicalSeriesUrl = detected.canonicalSeriesUrl;
  src.seriesUrlInferred = !!detected.seriesUrlInferred;
}

async function resolveTx(t: Tx, detected: DetectedSeries, fromSeriesPage: boolean, now: number): Promise<Resolved> {
  const host = sourceHost(detected.canonicalSeriesUrl);
  const keys = titleKeysFor(detected.title, detected.alternateTitles);

  // 1. Exact source URL (or a URL the source used to have).
  let source = await findSourceByUrl(t, detected.canonicalSeriesUrl);

  // 2. Same host + same title: the same source, possibly moved or previously inferred.
  if (!source) {
    for (const s of await seriesByTitleKeys(t, keys)) {
      if (detected.format && (s.format ?? "manhwa") !== detected.format) continue;
      const sameHost = (await t.byIndex<SeriesSource>("sources", "seriesId", s.id)).find((x) => x.hostname === host);
      if (sameHost) {
        const trustNew = !detected.seriesUrlInferred && (fromSeriesPage || sameHost.seriesUrlInferred);
        if (trustNew) relocateSource(sameHost, detected);
        source = sameHost;
        break;
      }
    }
  } else if (source.seriesUrlInferred && !detected.seriesUrlInferred) {
    relocateSource(source, detected);
  }

  if (source) {
    const series = await getSeriesTx(t, source.seriesId);
    if (series) {
      const restored = !!series.removedAt;
      if (restored) series.removedAt = undefined;
      return { series, source, created: false, restored };
    }
    // Orphaned source (should not happen): fall through and recreate its series.
  }

  // 3. Same work on another site? Attach only when identity is essentially certain:
  //    exact title match plus at least one additional matching alias.
  const normalized = normalizeTitle(detected.title);
  let possibleDuplicateOf: string | undefined;
  let attachTo: Series | undefined;
  for (const s of await seriesByTitleKeys(t, keys)) {
    if (s.removedAt || (detected.format && (s.format ?? "manhwa") !== detected.format)) continue;
    const shared = s.titleKeys.filter((k) => keys.includes(k));
    if (s.normalizedTitle === normalized && shared.length >= 2) {
      attachTo = s;
      break;
    }
    possibleDuplicateOf ??= s.id;
  }

  const series = attachTo ?? createSeries({ title: detected.title, status: fromSeriesPage ? "planning" : "reading", now });
  const newSource = source ?? createSource({ seriesId: series.id, seriesUrl: detected.seriesUrl, inferred: detected.seriesUrlInferred, now });
  newSource.seriesId = series.id;
  newSource.canonicalSeriesUrl = detected.canonicalSeriesUrl;
  if (!series.sourceIds.includes(newSource.id)) series.sourceIds.push(newSource.id);
  series.preferredSourceId ??= newSource.id;
  return { series, source: newSource, created: !attachTo, restored: false, possibleDuplicateOf: attachTo ? undefined : possibleDuplicateOf };
}

/** Updates detected metadata without touching anything the user owns. */
function applyDetectedMetadata(series: Series, source: SeriesSource, detected: DetectedSeries, fromSeriesPage: boolean, adapterId: string, now: number): void {
  series.detectedTitle = detected.title;
  if (detected.format && !series.userFields.includes("format")) series.format = detected.format;
  if (detected.genres?.length && !series.userFields.includes("genres")) series.genres = [...new Set(detected.genres)].slice(0, 20);
  if (!series.userFields.includes("title") && (fromSeriesPage || !series.title)) series.title = detected.title;
  if (!series.userFields.includes("alternateTitles")) {
    const extra = [...detected.alternateTitles, ...(series.title !== detected.title ? [detected.title] : [])];
    const known = new Set([series.title, ...series.alternateTitles].map((x) => x.toLowerCase()));
    for (const a of extra) if (!known.has(a.toLowerCase())) series.alternateTitles.push(a);
    series.alternateTitles = series.alternateTitles.slice(0, 30);
  }
  series.titleKeys = titleKeysFor(series.title, series.alternateTitles);

  if (fromSeriesPage || !source.sourceTitle) source.sourceTitle = detected.title;
  const covers = detected.coverCandidates.filter(isSafeHttpUrl);
  if (detected.coverUrl && isSafeHttpUrl(detected.coverUrl) && (fromSeriesPage || !source.coverUrl)) source.coverUrl = detected.coverUrl;
  if (covers.length && (fromSeriesPage || !source.coverCandidates.length)) source.coverCandidates = covers;
  if (detected.storyEnded !== undefined) source.storyEnded = detected.storyEnded;
  source.adapterId = adapterId;
  source.updatedAt = now;
}

// ---------------------------------------------------------------- chapter lists

export async function upsertChapterListTx(
  t: Tx,
  series: Series,
  source: SeriesSource,
  links: DetectedChapterLink[],
  now: number,
  opts: { inferred?: boolean } = {},
): Promise<Chapter[]> {
  const added: Chapter[] = [];
  const seen = new Set<string>();
  for (const link of links.slice(0, MAX_LIST)) {
    if (!isSafeHttpUrl(link.url)) continue;
    const parsed = parseChapterLabel(link.label || chapterLabelFromUrl(new URL(link.url)) || "");
    if (!parsed.label || seen.has(parsed.key)) continue;
    seen.add(parsed.key);
    const urlMatches = await t.byIndex<Chapter>("chapters", "canonicalUrl", canonicalizeUrl(link.url));
    if (urlMatches.some(c => c.associationOverridden)) continue;
    const existing = urlMatches.find((c) => c.sourceId === source.id) ?? await t.firstByIndex<Chapter>("chapters", "sourceKey", [source.id, parsed.key]);
    if (existing) {
      const canon = canonicalizeUrl(link.url);
      let changed = false;
      const corrected = correctJoinedChapterLabel(existing.chapterLabel, link.url);
      if (corrected && parsed.key === parseChapterLabel(corrected).key && !existing.userFields.some(f => f === "label" || f === "number")) {
        Object.assign(existing, { chapterLabel: parsed.label, chapterNumber: parsed.number, ordinal: parsed.ordinal, key: parsed.key, seasonNumber: parsed.season, volumeNumber: parsed.volume });
        changed = true;
      }
      if (!existing.lastOpenedAt && existing.canonicalUrl !== canon) {
        existing.url = link.url;
        existing.canonicalUrl = canon;
        changed = true;
      }
      if (existing.inferred && !opts.inferred) {
        existing.inferred = undefined;
        if (source.latestKnownChapter?.ordinal !== undefined && parsed.ordinal !== undefined && parsed.ordinal > source.latestKnownChapter.ordinal) existing.observedReleaseAt ??= now;
        changed = true;
      }
      if (changed) await t.put("chapters", existing);
      continue;
    }
    const c = createChapter({ seriesId: series.id, sourceId: source.id, label: parsed.label, url: link.url, now });
    if (opts.inferred) c.inferred = true;
    else if (source.latestKnownChapter?.ordinal !== undefined && parsed.ordinal !== undefined && parsed.ordinal > source.latestKnownChapter.ordinal) c.observedReleaseAt = now;
    await t.put("chapters", c);
    added.push(c);
  }
  if (opts.inferred) return added;
  const latest = links
    .map((l) => ({ l, p: parseChapterLabel(l.label) }))
    .filter((x) => x.p.ordinal !== undefined)
    .sort((a, b) => b.p.ordinal! - a.p.ordinal!)[0];
  const prior = source.latestKnownChapter;
  const correction = prior?.url && correctJoinedChapterLabel(prior.label, prior.url);
  if (correction && prior) {
    const p = parseChapterLabel(correction);
    source.latestKnownChapter = { ...prior, label: p.label, key: p.key, ordinal: p.ordinal };
  }
  if (latest && (!source.latestKnownChapter?.ordinal || latest.p.ordinal! >= source.latestKnownChapter.ordinal)) {
    source.latestKnownChapter = { key: latest.p.key, label: latest.p.label, ordinal: latest.p.ordinal, url: latest.l.url };
  }
  return added;
}

// ---------------------------------------------------------------- series pages

export async function trackSeriesPage(obs: PageObservation, now = Date.now(), shouldWrite?: () => boolean): Promise<TrackResult | null> {
  const detected = obs.series;
  if (!detected || !isSafeHttpUrl(detected.seriesUrl)) return null;
  return write([...TRACK_STORES, "covers"], async (t) => {
    const r = await resolveTx(t, detected, true, now);
    applyDetectedMetadata(r.series, r.source, detected, true, obs.adapterId, now);
    await putSeriesTx(t, r.series);
    await upsertChapterListTx(t, r.series, r.source, detected.chapterList, now);
    await t.put("sources", r.source);
    const s = await refreshSeriesTx(t, r.series.id, undefined, now);
    return result(r, s ?? r.series, await coverToFetchTx(t, s ?? r.series, detected));
  }, shouldWrite).catch(err => { if (err instanceof WriteRevokedError) return null; throw err; });
}

async function coverToFetchTx(t: Tx, series: Series, detected: DetectedSeries): Promise<string | undefined> {
  const url = detected.coverUrl && isSafeHttpUrl(detected.coverUrl) ? detected.coverUrl : undefined;
  if (!url) return undefined;
  if (!series.detectedCoverId) return url;
  // Refresh when the series page now offers a different image (ignoring CDN query tokens).
  const cached = await t.get<CoverAsset>("covers", series.detectedCoverId);
  const strip = (u?: string) => (u ?? "").split("?")[0];
  return !cached || strip(cached.sourceUrl) !== strip(url) ? url : undefined;
}

function result(r: Resolved, s: Series, coverUrl?: string, chapter?: Chapter): TrackResult {
  return {
    seriesId: s.id,
    sourceId: r.source.id,
    seriesTitle: s.title,
    chapterId: chapter?.id,
    chapterLabel: chapter?.chapterLabel,
    chapterProgressRevision: chapter ? chapter.progressRevision ?? 0 : undefined,
    chapterProgress: chapter?.maxProgress,
    created: r.created,
    restored: r.restored,
    coverUrl,
    possibleDuplicateOf: r.possibleDuplicateOf,
  };
}

// ---------------------------------------------------------------- chapters

export interface OpenOptions {
  now?: number;
  shouldWrite?: () => boolean;
  /** Chapter the user left by clicking its detected "next chapter" link. */
  completedViaNext?: string;
  completedViaNextRevision?: number;
}

export async function trackChapterOpened(obs: PageObservation, opts: OpenOptions = {}): Promise<TrackResult | null> {
  const detected = obs.series;
  const ch = obs.chapter;
  if (!detected || !ch || !isSafeHttpUrl(detected.seriesUrl) || !isSafeHttpUrl(ch.url)) return null;
  const now = opts.now ?? Date.now();

  return write([...TRACK_STORES], async (t) => {
    if (opts.completedViaNext) await completeTx(t, opts.completedViaNext, "next-link", now, opts.completedViaNextRevision);

    const owned = (await t.byIndex<Chapter>("chapters", "canonicalUrl", ch.canonicalUrl)).find(c => c.associationOverridden);
    const ownedSeries = owned ? await getSeriesTx(t, owned.seriesId) : undefined;
    const ownedSource = owned ? await t.get<SeriesSource>("sources", owned.sourceId) : undefined;
    const restoredOwned = !!ownedSeries?.removedAt;
    if (ownedSeries) ownedSeries.removedAt = undefined;
    const r: Resolved = ownedSeries && ownedSource
      ? { series: ownedSeries, source: ownedSource, created: false, restored: restoredOwned }
      : await resolveTx(t, detected, false, now);
    if (!owned) applyDetectedMetadata(r.series, r.source, detected, false, obs.adapterId, now);

    const parsed = parseChapterLabel(ch.label);
    let chapter =
      (await t.byIndex<Chapter>("chapters", "canonicalUrl", ch.canonicalUrl)).find((c) => c.sourceId === r.source.id) ??
      (await t.firstByIndex<Chapter>("chapters", "sourceKey", [r.source.id, parsed.key]));
    if (!chapter) chapter = createChapter({ seriesId: r.series.id, sourceId: r.source.id, label: ch.label, url: ch.url, now });

    const corrected = correctJoinedChapterLabel(chapter.chapterLabel, ch.canonicalUrl);
    if (corrected && parsed.key === parseChapterLabel(corrected).key && !chapter.userFields.some(f => f === "label" || f === "number")) {
      Object.assign(chapter, { key: parsed.key, chapterNumber: parsed.number, ordinal: parsed.ordinal, seasonNumber: parsed.season, volumeNumber: parsed.volume });
    }
    // A chapter first learned from a link or list gets the site's own label once opened.
    if (!chapter.userFields.includes("label") && parsed.key === chapter.key) {
      if (chapter.title === chapter.chapterLabel) chapter.title = parsed.label;
      chapter.chapterLabel = parsed.label;
    }
    const isRevisit = chapter.lastOpenedAt !== undefined && now - chapter.lastOpenedAt < REVISIT_WINDOW_MS && r.series.currentChapterId === chapter.id;
    chapter.url = ch.url;
    chapter.canonicalUrl = ch.canonicalUrl;
    if (ch.title && !chapter.userFields.includes("label")) chapter.title = ch.title.slice(0, 200);
    if (ch.nextUrl && isSafeHttpUrl(ch.nextUrl)) chapter.nextUrl = ch.nextUrl;
    if (ch.prevUrl && isSafeHttpUrl(ch.prevUrl)) chapter.prevUrl = ch.prevUrl;
    chapter.inferred = undefined;
    chapter.firstOpenedAt ??= now;
    chapter.lastOpenedAt = now;
    if (!isRevisit) chapter.visitCount += 1;
    await t.put("chapters", chapter);

    // Learn neighbouring chapters from navigation links so Continue can point past this one.
    const neighbours: DetectedChapterLink[] = [];
    for (const u of [ch.nextUrl, ch.prevUrl]) {
      const url = u ? toUrl(u) : null;
      const label = url ? chapterLabelFromUrl(url) : undefined;
      if (url && label && obs.adapterId !== "novel-platforms") neighbours.push({ label, url: url.href });
    }
    if (neighbours.length) await upsertChapterListTx(t, r.series, r.source, neighbours, now, { inferred: true });

    r.series.currentChapterId = chapter.id;
    if (!r.series.userFields.includes("status") && r.series.status === "planning") r.series.status = "reading";
    r.series.lastReadAt = now;
    await putSeriesTx(t, r.series);
    await t.put("sources", r.source);

    if (!isRevisit) {
      await addEventTx(t, { seriesId: r.series.id, chapterId: chapter.id, type: "opened", timestamp: now, chapterLabel: chapter.chapterLabel, hostname: r.source.hostname });
    }
    const s = await refreshSeriesTx(t, r.series.id, undefined, now);
    // Chapter pages rarely name a cover; use their share image only until the series page is seen.
    const fallback = detected.coverUrl ?? detected.coverCandidates[0];
    const cover = !owned && !s?.detectedCoverId && fallback && isSafeHttpUrl(fallback) ? fallback : undefined;
    return result(r, s ?? r.series, cover, chapter);
  }, opts.shouldWrite).catch(err => { if (err instanceof WriteRevokedError) return null; throw err; });
}

async function completeTx(t: Tx, chapterId: string, source: CompletionSource, now: number, progressRevision?: number): Promise<boolean> {
  const c = await t.get<Chapter>("chapters", chapterId);
  if (!c || c.completedAt || (progressRevision ?? 0) !== (c.progressRevision ?? 0)) return false;
  c.completedAt = now;
  c.completionSource = source;
  c.maxProgress = Math.max(c.maxProgress, source === "next-link" ? c.maxProgress : 1);
  await t.put("chapters", c);
  const src = await t.get<SeriesSource>("sources", c.sourceId);
  await addEventTx(t, { seriesId: c.seriesId, chapterId: c.id, type: "completed", timestamp: now, progress: c.maxProgress, chapterLabel: c.chapterLabel, hostname: src?.hostname });
  await refreshSeriesTx(t, c.seriesId, undefined, now);
  return true;
}

export async function completeChapter(chapterId: string, source: CompletionSource, now = Date.now(), progressRevision?: number, shouldWrite?: () => boolean): Promise<boolean> {
  return write([...TRACK_STORES], (t) => completeTx(t, chapterId, source, now, progressRevision), shouldWrite).catch(err => { if (err instanceof WriteRevokedError) return false; throw err; });
}

export interface ProgressUpdate {
  readingPosition?: ReadingPosition;
  shouldWrite?: () => boolean;
  progressRevision?: number;
  progress: number;
  readingTimeDeltaMs: number;
  threshold: number;
  /** Final update when leaving the chapter: records a progress event if unfinished. */
  final?: boolean;
}

export async function recordProgress(chapterId: string, u: ProgressUpdate, now = Date.now()): Promise<{ completed: boolean; progress: number; progressRevision?: number; stale?: boolean; blocked?: boolean; positionOnly?: boolean }> {
  return write([...TRACK_STORES], async (t) => {
    const c = await t.get<Chapter>("chapters", chapterId);
    if (!c) return { completed: false, progress: 0 };
    if ((u.progressRevision ?? 0) !== (c.progressRevision ?? 0)) return { completed: false, progress: c.maxProgress, progressRevision: c.progressRevision ?? 0, stale: true };
    const p = Math.max(0, Math.min(1, Number.isFinite(u.progress) ? u.progress : 0));
    const delta = Math.max(0, Math.min(MAX_PROGRESS_DELTA_MS, Number.isFinite(u.readingTimeDeltaMs) ? u.readingTimeDeltaMs : 0));
    const positionOnly = p <= c.maxProgress && delta === 0 && !u.final && !!u.readingPosition && (!!c.completedAt || c.maxProgress < u.threshold);
    c.maxProgress = Math.max(c.maxProgress, p);
    c.readingTimeMs += delta;
    if (delta > 0) await recordTimedActivityTx(t, c, delta, now);
    updateReadingPosition(c, u.readingPosition, now);
    await t.put("chapters", c);
    if (positionOnly) return { completed: false, progress: c.maxProgress, progressRevision: c.progressRevision ?? 0, positionOnly: true };
    let completed = false;
    if (!c.completedAt && c.maxProgress >= u.threshold) {
      completed = await completeTx(t, c.id, "progress", now, u.progressRevision);
    } else {
      if (u.final && !c.completedAt && c.maxProgress >= 0.05) {
        await addEventTx(t, { seriesId: c.seriesId, chapterId: c.id, type: "progress", timestamp: now, progress: c.maxProgress, chapterLabel: c.chapterLabel });
      }
      await refreshSeriesTx(t, c.seriesId, undefined, now);
    }
    return { completed, progress: c.maxProgress, progressRevision: c.progressRevision ?? 0 };
  }, u.shouldWrite).catch(err => { if (err instanceof WriteRevokedError) return { completed: false, progress: 0, blocked: true }; throw err; });
}

// ---------------------------------------------------------------- update checks

export type UpdateCheckOutcome =
  | { ok: true; chapters: DetectedChapterLink[]; title?: string; finalUrl?: string; storyEnded?: boolean }
  | { ok: false; error: string; notFound?: boolean };

export async function applyUpdateCheck(sourceId: string, outcome: UpdateCheckOutcome, now = Date.now()): Promise<{ series?: Series; newChapters: Chapter[] }> {
  return write([...TRACK_STORES], async (t) => {
    const source = await t.get<SeriesSource>("sources", sourceId);
    if (!source || source.removedAt) return { newChapters: [] };
    source.lastCheckedAt = now;
    if (!outcome.ok) {
      source.consecutiveFailures = (source.consecutiveFailures ?? 0) + 1;
      source.lastError = outcome.error.slice(0, 200);
      await t.put("sources", source);
      return { newChapters: [] };
    }
    const series = await getSeriesTx(t, source.seriesId);
    if (!series) return { newChapters: [] };

    const changedUrl = outcome.finalUrl !== undefined && (!isSafeHttpUrl(outcome.finalUrl) || canonicalizeUrl(outcome.finalUrl) !== source.canonicalSeriesUrl);
    const sameTitle = !!outcome.title && [...series.titleKeys, normalizeTitle(source.sourceTitle ?? ""), normalizeTitle(series.detectedTitle ?? "")].includes(normalizeTitle(outcome.title));
    if ((outcome.title && !sameTitle) || (changedUrl && (!sameTitle || !isSafeHttpUrl(outcome.finalUrl!) || sourceHost(outcome.finalUrl!) !== source.hostname))) {
      source.consecutiveFailures = (source.consecutiveFailures ?? 0) + 1;
      source.lastError = "Update page does not match the tracked series.";
      await t.put("sources", source);
      return { newChapters: [] };
    }

    // The page redirected: accept the new location only if it is still clearly this series.
    if (outcome.finalUrl && isSafeHttpUrl(outcome.finalUrl) && canonicalizeUrl(outcome.finalUrl) !== source.canonicalSeriesUrl) {
      if (sameTitle && sourceHost(outcome.finalUrl) === source.hostname) {
        relocateSource(source, { title: outcome.title!, alternateTitles: [], seriesUrl: outcome.finalUrl, canonicalSeriesUrl: canonicalizeUrl(outcome.finalUrl), coverCandidates: [], chapterList: [] });
      }
    }
    const prevLatest = source.latestKnownChapter?.ordinal;
    const added = await upsertChapterListTx(t, series, source, outcome.chapters, now);
    if (outcome.storyEnded !== undefined) source.storyEnded = outcome.storyEnded;
    source.consecutiveFailures = 0;
    source.lastError = undefined;
    source.lastSuccessfulCheckAt = now;
    await t.put("sources", source);
    const s = await refreshSeriesTx(t, series.id, undefined, now);
    const newChapters = added.filter((c) => c.ordinal !== undefined && (prevLatest === undefined || c.ordinal > prevLatest));
    return { series: s, newChapters };
  });
}

/** Records that a saved URL led to an error page, without deleting anything. */
export async function markSourceFailing(sourceId: string, error: string, shouldWrite?: () => boolean): Promise<void> {
  await write(["sources"], async (t) => {
    const s = await t.get<SeriesSource>("sources", sourceId);
    if (!s) return;
    s.consecutiveFailures = (s.consecutiveFailures ?? 0) + 1;
    s.lastError = error;
    s.lastCheckedAt = Date.now();
    await t.put("sources", s);
  }, shouldWrite).catch(err => { if (!(err instanceof WriteRevokedError)) throw err; });
}
