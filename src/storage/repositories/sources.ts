import { remapCollectionSeriesTx } from "./collections";
import type { Chapter, ReadingEvent, Series, SeriesSource, SourceHealth } from "../../shared/types/models";
import { read, write, type Tx } from "../db";
import { createSeries, repairSource } from "../schema";
import { getSeriesTx, putSeriesTx, refreshSeriesTx } from "./series";
import { sanitizeReadingPosition } from "../../shared/reading-position";

const DAY = 86_400_000;

export function sourceHealth(s: SeriesSource, now = Date.now()): SourceHealth {
  if (s.consecutiveFailures >= 3) return "failing";
  if (!s.lastCheckedAt) return "unknown";
  if (s.consecutiveFailures > 0) return "stale";
  if (s.lastSuccessfulCheckAt && now - s.lastSuccessfulCheckAt > 14 * DAY) return "stale";
  return "healthy";
}

export async function listSources(seriesId?: string): Promise<SeriesSource[]> {
  const raw = await read(["sources"], (t) => (seriesId ? t.byIndex<SeriesSource>("sources", "seriesId", seriesId) : t.getAll<SeriesSource>("sources")));
  return raw.map((s) => repairSource(s as SeriesSource & Record<string, unknown>)).filter((s): s is SeriesSource => !!s && !s.removedAt);
}

export async function updateSource(id: string, patch: Partial<Pick<SeriesSource, "disabled" | "seriesUrl">>): Promise<void> {
  await write(["sources"], async (t) => {
    const s = await t.get<SeriesSource>("sources", id);
    if (!s) return;
    Object.assign(s, patch, { updatedAt: Date.now() });
    await t.put("sources", s);
  });
}

/** Folds chapter `from` into `into` (same chapter, different record), keeping all progress. */
export function mergeChapterInto(into: Chapter, from: Chapter, snapshot = false): void {
  const positions = [sanitizeReadingPosition(into.readingPosition),
    into.canonicalUrl === from.canonicalUrl ? sanitizeReadingPosition(from.readingPosition) : undefined]
    .filter(p => p && p.progressRevision === Math.max(into.progressRevision ?? 0, from.progressRevision ?? 0))
    .sort((a, b) => b!.capturedAt - a!.capturedAt);
  into.associationOverridden ||= from.associationOverridden;
  if (from.userFields.includes("label") && !into.userFields.includes("label")) {
    into.chapterLabel = from.chapterLabel;
    into.title = from.title;
    if (!into.userFields.includes("number")) {
      into.chapterNumber = from.chapterNumber;
      into.ordinal = from.ordinal;
    }
  }
  if (from.userFields.includes("number") && !into.userFields.includes("number")) {
    into.chapterNumber = from.chapterNumber;
    into.ordinal = from.ordinal;
  }
  into.userFields = [...new Set([...into.userFields, ...from.userFields])];
  into.observedReleaseAt = minDefined(into.observedReleaseAt, from.observedReleaseAt);
  into.firstOpenedAt = minDefined(into.firstOpenedAt, from.firstOpenedAt);
  into.lastOpenedAt = maxDefined(into.lastOpenedAt, from.lastOpenedAt);
  if (from.completedAt && (!into.completedAt || from.completedAt < into.completedAt)) {
    into.completedAt = from.completedAt;
    into.completionSource = from.completionSource;
  }
  into.visitCount = snapshot ? Math.max(into.visitCount, from.visitCount) : into.visitCount + from.visitCount;
  into.maxProgress = Math.max(into.maxProgress, from.maxProgress);
  into.readingTimeMs = snapshot ? Math.max(into.readingTimeMs, from.readingTimeMs) : into.readingTimeMs + from.readingTimeMs;
  into.progressRevision = Math.max(into.progressRevision ?? 0, from.progressRevision ?? 0);
  into.readingPosition = positions[0];
  into.discoveredAt = Math.min(into.discoveredAt, from.discoveredAt);
  if (!into.lastOpenedAt && from.url) into.url = from.url;
}

/** Moves all chapters of one source to another, merging duplicates by chapter key. */
async function moveChaptersTx(t: Tx, fromSourceId: string, to: SeriesSource): Promise<void> {
  const moving = await t.byIndex<Chapter>("chapters", "sourceId", fromSourceId);
  for (const c of moving) {
    const existing = await t.firstByIndex<Chapter>("chapters", "sourceKey", [to.id, c.key]);
    if (existing && existing.id !== c.id) {
      mergeChapterInto(existing, c);
      await t.put("chapters", existing);
      for (const e of await t.byIndex<ReadingEvent>("events", "chapterId", c.id)) {
        e.chapterId = existing.id;
        e.seriesId = to.seriesId;
        await t.put("events", e);
      }
      await t.delete("chapters", c.id);
    } else {
      c.sourceId = to.id;
      c.seriesId = to.seriesId;
      await t.put("chapters", c);
    }
  }
}

/** Removes an active source while retaining its chapters, URLs and history. */
export async function removeSource(sourceId: string): Promise<void> {
  await write(["series", "sources", "chapters", "events"], async (t) => {
    const src = await t.get<SeriesSource>("sources", sourceId);
    if (!src) return;
    const siblings = (await t.byIndex<SeriesSource>("sources", "seriesId", src.seriesId)).filter((s) => s.id !== sourceId && !s.removedAt);
    const target = siblings[0];
    if (!target) throw new Error("A series needs at least one source. Remove the series instead.");
    src.removedAt = Date.now();
    src.disabled = true;
    await t.put("sources", src);
    await refreshSeriesTx(t, src.seriesId, (s) => {
      if (s.preferredSourceId === src.id) s.preferredSourceId = target.id;
    });
  });
}

/** Splits one source (with its chapters and their history) into a new, separate series. */
export async function splitSource(sourceId: string): Promise<string | undefined> {
  return write(["series", "sources", "chapters", "events", "meta"], async (t) => {
    const src = await t.get<SeriesSource>("sources", sourceId);
    if (!src) return undefined;
    const original = await getSeriesTx(t, src.seriesId);
    if (!original) return undefined;
    if (original.sourceIds.length <= 1) throw new Error("This series only has one source.");
    const created = createSeries({ title: src.sourceTitle ?? original.title, status: original.status });
    created.coverId = undefined;
    created.keptSeparateFrom = [original.id];
    created.sourceIds = [src.id];
    created.preferredSourceId = src.id;
    await putSeriesTx(t, created);

    const chapters = await t.byIndex<Chapter>("chapters", "sourceId", sourceId);
    for (const c of chapters) {
      for (const e of await t.byIndex<ReadingEvent>("events", "chapterId", c.id)) {
        e.seriesId = created.id;
        await t.put("events", e);
      }
      c.seriesId = created.id;
      await t.put("chapters", c);
    }
    src.seriesId = created.id;
    await t.put("sources", src);

    await refreshSeriesTx(t, original.id, (s) => {
      if (!s.keptSeparateFrom.includes(created.id)) s.keptSeparateFrom.push(created.id);
    });
    await refreshSeriesTx(t, created.id);
    await remapCollectionSeriesTx(t, original.id, created.id, true);
    return created.id;
  });
}

/**
 * Merges series `fromId` into `intoId`. Preserves every source, chapter, history event,
 * note, tag, alias, the earliest discovery date, covers and progress.
 */
export async function mergeSeries(intoId: string, fromId: string): Promise<void> {
  if (intoId === fromId) return;
  await write(["series", "sources", "chapters", "events", "meta"], async (t) => {
    const into = await getSeriesTx(t, intoId);
    const from = await getSeriesTx(t, fromId);
    if (!into || !from) throw new Error("Series not found");

    for (const src of await t.byIndex<SeriesSource>("sources", "seriesId", fromId)) {
      const sameUrl = (await t.byIndex<SeriesSource>("sources", "seriesId", intoId)).find((s) => s.canonicalSeriesUrl === src.canonicalSeriesUrl);
      if (sameUrl) {
        await moveChaptersTx(t, src.id, sameUrl);
        sameUrl.previousUrls = unique([...sameUrl.previousUrls, ...src.previousUrls]);
        await t.put("sources", sameUrl);
        await t.delete("sources", src.id);
      } else {
        src.seriesId = intoId;
        await t.put("sources", src);
        for (const c of await t.byIndex<Chapter>("chapters", "sourceId", src.id)) {
          c.seriesId = intoId;
          await t.put("chapters", c);
        }
      }
    }
    for (const e of await t.byIndex<ReadingEvent>("events", "seriesId", fromId)) {
      e.seriesId = intoId;
      await t.put("events", e);
    }

    const queue = await t.get<{ key: string; value: string[] }>("meta", "queue");
    if (queue?.value.includes(fromId)) {
      const q = queue.value.map((id) => (id === fromId ? intoId : id));
      await t.put("meta", { key: "queue", value: unique(q) });
    }

    await remapCollectionSeriesTx(t, fromId, intoId);
    await t.delete("series", fromId);
    await refreshSeriesTx(t, intoId, (s) => mergeSeriesFields(s, from));
  });
}

export function mergeSeriesFields(into: Series, from: Series): void {
  into.alternateTitles = unique([...into.alternateTitles, ...(from.title !== into.title ? [from.title] : []), ...from.alternateTitles]).filter(
    (a) => a !== into.title,
  );
  into.tags = unique([...into.tags, ...from.tags]);
  into.genres = unique([...(into.genres ?? []), ...(from.genres ?? [])]);
  if (from.userFields.includes("format") && !into.userFields.includes("format")) into.format = from.format;
  if (from.notes && from.notes !== into.notes) into.notes = into.notes ? `${into.notes}\n\n${from.notes}` : from.notes;
  into.favorite ||= from.favorite;
  into.pinned ||= from.pinned;
  into.personalRating ??= from.personalRating;
  into.discoveredAt = Math.min(into.discoveredAt, from.discoveredAt);
  into.coverId ??= from.coverId;
  into.detectedCoverId ??= from.detectedCoverId;
  into.keptSeparateFrom = unique([...into.keptSeparateFrom, ...from.keptSeparateFrom]).filter((id) => id !== into.id && id !== from.id);
  into.preferredSourceId ??= from.preferredSourceId;
  into.userFields = unique([...into.userFields, ...from.userFields]);
}

export async function keepSeparate(a: string, b: string): Promise<void> {
  await write(["series"], async (t) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const s = await getSeriesTx(t, x);
      if (s && !s.keptSeparateFrom.includes(y)) {
        s.keptSeparateFrom.push(y);
        await putSeriesTx(t, s);
      }
    }
  });
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function minDefined(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function maxDefined(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}
