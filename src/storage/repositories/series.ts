import type { Series, SeriesStatus, SeriesUserField } from "../../shared/types/models";
import { read, write, type Tx } from "../db";
import { repairSeries, titleKeysFor } from "../schema";
import { normalizeTitle } from "../../detection/normalization/title";
import { computeSeriesState } from "../summary";
import type { Chapter, SeriesSource } from "../../shared/types/models";

export async function getSeriesTx(t: Tx, id: string): Promise<Series | undefined> {
  const raw = await t.get<Series>("series", id);
  return raw ? repairSeries(raw as Series & Record<string, unknown>) ?? undefined : undefined;
}

export async function putSeriesTx(t: Tx, s: Series): Promise<void> {
  s.normalizedTitle = normalizeTitle(s.title);
  s.titleKeys = titleKeysFor(s.title, s.alternateTitles);
  await t.put("series", s);
}

/** Recomputes derived reading state for one series from its chapters and sources. */
export async function refreshSeriesTx(t: Tx, seriesId: string, mutate?: (s: Series) => void): Promise<Series | undefined> {
  const s = await getSeriesTx(t, seriesId);
  if (!s) return undefined;
  mutate?.(s);
  const [chapters, sources] = await Promise.all([
    t.byIndex<Chapter>("chapters", "seriesId", seriesId),
    t.byIndex<SeriesSource>("sources", "seriesId", seriesId),
  ]);
  s.sourceIds = sources.map((x) => x.id);
  if (s.preferredSourceId && !s.sourceIds.includes(s.preferredSourceId)) s.preferredSourceId = undefined;
  const state = computeSeriesState(s, chapters, sources);
  s.summary = state.summary;
  s.lastOpenedChapterId = state.lastOpenedChapterId;
  s.lastCompletedChapterId = state.lastCompletedChapterId;
  s.currentChapterId = state.currentChapterId;
  s.lastReadAt = state.lastReadAt;
  s.totalReadingTimeMs = chapters.reduce((a, c) => a + (c.readingTimeMs || 0), 0);
  s.updatedAt = Date.now();
  await putSeriesTx(t, s);
  return s;
}

export async function getSeries(id: string): Promise<Series | undefined> {
  return read(["series"], (t) => getSeriesTx(t, id));
}

/** All series, including soft-removed ones only when asked. */
export async function listSeries(opts: { includeRemoved?: boolean } = {}): Promise<Series[]> {
  const all = await read(["series"], (t) => t.getAll<Series>("series"));
  const out: Series[] = [];
  for (const raw of all) {
    const s = repairSeries(raw as Series & Record<string, unknown>);
    if (s && (opts.includeRemoved || !s.removedAt)) out.push(s);
  }
  return out;
}

export interface SeriesEdit {
  title?: string;
  alternateTitles?: string[];
  status?: SeriesStatus;
  favorite?: boolean;
  pinned?: boolean;
  personalRating?: number | null;
  tags?: string[];
  notes?: string;
  preferredSourceId?: string;
  hidden?: boolean;
}

const USER_OWNED: Partial<Record<keyof SeriesEdit, SeriesUserField>> = {
  title: "title",
  alternateTitles: "alternateTitles",
  status: "status",
};

export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const v = t.replace(/\s+/g, " ").trim().slice(0, 40);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

/** Applies explicit user edits. Title/aliases/status become user-owned and survive re-detection. */
export async function editSeries(id: string, edit: SeriesEdit): Promise<Series | undefined> {
  return write(["series", "chapters", "sources"], async (t) => {
    const updated = await refreshSeriesTx(t, id, (s) => applyEdit(s, edit));
    return updated;
  });
}

export function applyEdit(s: Series, edit: SeriesEdit): void {
  if (edit.title !== undefined) {
    const title = edit.title.replace(/\s+/g, " ").trim().slice(0, 200);
    if (title) s.title = title;
  }
  if (edit.alternateTitles !== undefined) s.alternateTitles = cleanTags(edit.alternateTitles).filter((a) => a !== s.title);
  if (edit.status !== undefined) s.status = edit.status;
  if (edit.favorite !== undefined) s.favorite = edit.favorite;
  if (edit.pinned !== undefined) s.pinned = edit.pinned;
  if (edit.personalRating !== undefined) {
    s.personalRating = edit.personalRating === null ? undefined : Math.max(0, Math.min(10, Math.round(edit.personalRating * 2) / 2));
  }
  if (edit.tags !== undefined) s.tags = cleanTags(edit.tags);
  if (edit.notes !== undefined) s.notes = edit.notes.slice(0, 20000) || undefined;
  if (edit.preferredSourceId !== undefined) s.preferredSourceId = edit.preferredSourceId;
  if (edit.hidden !== undefined) s.hidden = edit.hidden;
  for (const [k, field] of Object.entries(USER_OWNED)) {
    if (edit[k as keyof SeriesEdit] !== undefined && field && !s.userFields.includes(field)) s.userFields.push(field);
  }
}

/** Drops a user override so detection may manage the field again. */
export async function resetUserField(id: string, field: SeriesUserField): Promise<Series | undefined> {
  return write(["series", "chapters", "sources"], (t) =>
    refreshSeriesTx(t, id, (s) => {
      s.userFields = s.userFields.filter((f) => f !== field);
      if (field === "title" && s.detectedTitle) s.title = s.detectedTitle;
      if (field === "cover") s.coverId = s.detectedCoverId;
    }),
  );
}

export async function batchEdit(ids: string[], edit: (s: Series) => SeriesEdit): Promise<void> {
  await write(["series", "chapters", "sources"], async (t) => {
    for (const id of ids) {
      const s = await getSeriesTx(t, id);
      if (s) await refreshSeriesTx(t, id, (x) => applyEdit(x, edit(s)));
    }
  });
}

/** Soft delete: the series disappears from views but stays restorable. */
export async function removeSeries(ids: string[]): Promise<void> {
  const now = Date.now();
  await write(["series"], async (t) => {
    for (const id of ids) {
      const s = await getSeriesTx(t, id);
      if (s) {
        s.removedAt = now;
        s.updatedAt = now;
        await putSeriesTx(t, s);
      }
    }
  });
}

export async function restoreSeries(ids: string[]): Promise<void> {
  await write(["series"], async (t) => {
    for (const id of ids) {
      const s = await getSeriesTx(t, id);
      if (s) {
        s.removedAt = undefined;
        s.updatedAt = Date.now();
        await putSeriesTx(t, s);
      }
    }
  });
}

/** Permanently deletes series, their sources, chapters and history. Covers are garbage-collected separately. */
export async function purgeSeriesTx(t: Tx, id: string): Promise<void> {
  for (const store of ["sources", "chapters", "events"] as const) {
    const keys = await t.keysByIndex(store, "seriesId", id);
    for (const k of keys) await t.delete(store, k);
  }
  await t.delete("series", id);
}

export async function purgeRemovedSeries(olderThanMs: number): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  return write(["series", "sources", "chapters", "events"], async (t) => {
    const all = await t.getAll<Series>("series");
    let n = 0;
    for (const s of all) {
      if (s.removedAt && s.removedAt < cutoff) {
        await purgeSeriesTx(t, s.id);
        n++;
      }
    }
    return n;
  });
}

export async function purgeSeriesNow(ids: string[]): Promise<void> {
  await write(["series", "sources", "chapters", "events"], async (t) => {
    for (const id of ids) await purgeSeriesTx(t, id);
  });
}
