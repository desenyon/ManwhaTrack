// Versioned, portable backups. Derived fields (summaries, search keys) are not exported;
// they are recomputed on import. Import validates everything before a single
// transaction writes it, so a bad file can never corrupt the current library.

import { sanitizeReadingPosition } from "../shared/reading-position";
import type { Collection } from "../shared/types/collections";
import { getCollectionsTx, putCollectionsTx, repairCollection } from "./repositories/collections";
import type { Chapter, CoverAsset, ReadingEvent, Series, SeriesSource } from "../shared/types/models";
import type { Settings } from "../shared/types/settings";
import { read, withTx, type Tx } from "./db";
import { SCHEMA_VERSION } from "./migrations";
import { newId, repairChapter, repairEvent, repairSeries, repairSource, titleKeysFor } from "./schema";
import { getSeriesTx, putSeriesTx, refreshSeriesTx } from "./repositories/series";
import { mergeChapterInto, mergeSeriesFields } from "./repositories/sources";
import { getSettings, repairSettings, saveSettings } from "./repositories/settings";
import { getQueue } from "./repositories/queue";
import { normalizeTitle } from "../detection/normalization/title";
import { canonicalizeUrl, isSafeHttpUrl } from "../detection/normalization/url";

export const EXPORT_VERSION = 5;
const APP = "ManwhaTrack";

type PortableSeries = Omit<Series, "summary" | "titleKeys" | "normalizedTitle">;

export interface PortableCover {
  id: string;
  mimeType: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  origin: CoverAsset["origin"];
  capturedAt: number;
  data: string; // base64
}

export interface BackupFile {
  application: typeof APP;
  exportVersion: number;
  exportedAt: string;
  schemaVersion: number;
  series: PortableSeries[];
  sources: SeriesSource[];
  chapters: Chapter[];
  history: ReadingEvent[];
  settings: Partial<Settings>;
  queue: string[];
  collections: Collection[];
  covers?: PortableCover[];
}

// ------------------------------------------------------------------ export

export async function exportLibrary(opts: { includeCovers?: boolean; seriesIds?: string[] } = {}): Promise<BackupFile> {
  const data = await read(["series", "sources", "chapters", "events", "covers", "meta"], async (t) => ({
    series: await t.getAll<Series>("series"),
    sources: await t.getAll<SeriesSource>("sources"),
    chapters: await t.getAll<Chapter>("chapters"),
    events: await t.getAll<ReadingEvent>("events"),
    covers: opts.includeCovers ? await t.getAll<CoverAsset>("covers") : [],
    collections: await getCollectionsTx(t),
  }));
  const only = opts.seriesIds ? new Set(opts.seriesIds) : null;
  const series = data.series.filter((s) => !s.removedAt && (!only || only.has(s.id)));
  const exportedIds = new Set(series.map((s) => s.id));
  const keep = <T extends { seriesId: string }>(x: T) => exportedIds.has(x.seriesId);
  const coverIds = new Set(series.flatMap((s) => [s.coverId, s.detectedCoverId]).filter(Boolean) as string[]);

  const covers: PortableCover[] = [];
  if (opts.includeCovers) {
    for (const c of data.covers) {
      if (!coverIds.has(c.id) || !c.blob) continue;
      covers.push({
        id: c.id,
        mimeType: c.mimeType,
        width: c.width,
        height: c.height,
        sourceUrl: c.sourceUrl,
        origin: c.origin,
        capturedAt: c.capturedAt,
        data: await blobToBase64(c.blob),
      });
    }
  }

  const settings = await getSettings();
  const queue = await getQueue();
  return {
    application: APP,
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    series: series.map(({ summary: _s, titleKeys: _t, normalizedTitle: _n, ...rest }) => rest),
    sources: data.sources.filter(keep),
    chapters: data.chapters.filter(keep),
    history: data.events.filter(keep),
    settings: only ? {} : settings,
    queue: queue.filter((id) => exportedIds.has(id)),
    collections: data.collections.filter(c => !only || c.seriesIds.some(id => exportedIds.has(id))).map(c => ({ ...c, seriesIds: c.seriesIds.filter(id => exportedIds.has(id)) })),
    ...(opts.includeCovers ? { covers } : {}),
  };
}

const CSV_FIELDS = ["Title", "Status", "Last Completed Chapter", "Last Opened Chapter", "Preferred Source", "Series URL", "Last Read", "Rating", "Tags", "Favorite"];

export function toCsv(file: BackupFile): string {
  const sources = new Map(file.sources.map((s) => [s.id, s]));
  const chapters = new Map(file.chapters.map((c) => [c.id, c]));
  const rows = file.series.map((s) => {
    const src = sources.get(s.preferredSourceId ?? s.sourceIds[0] ?? "");
    return [
      s.title,
      s.status,
      chapters.get(s.lastCompletedChapterId ?? "")?.chapterLabel ?? "",
      chapters.get(s.lastOpenedChapterId ?? "")?.chapterLabel ?? "",
      src?.hostname ?? "",
      src?.seriesUrl ?? "",
      s.lastReadAt ? new Date(s.lastReadAt).toISOString() : "",
      s.personalRating?.toString() ?? "",
      s.tags.join("; "),
      s.favorite ? "yes" : "",
    ];
  });
  return [CSV_FIELDS, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function csvCell(v: string): string {
  // Prevent spreadsheet formula injection from scraped titles.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// ------------------------------------------------------------------ parse + validate

/** Upgrades older export formats step by step. */
export const EXPORT_MIGRATIONS: Record<number, (f: Record<string, unknown>) => Record<string, unknown>> = {
  1: (f) => ({ ...f, exportVersion: 2, schemaVersion: 2 }),
  2: (f) => ({ ...f, exportVersion: 3, schemaVersion: 3 }),
  3: (f) => ({ ...f, exportVersion: 4, schemaVersion: 4, collections: [] }),
  4: (f) => ({ ...f, exportVersion: 5, schemaVersion: 6 }),
};

export type ParseResult = { ok: true; file: BackupFile; invalid: number } | { ok: false; error: string };

export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Import file is invalid: it is not valid JSON." };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "Import file is invalid." };
  let f = raw as Record<string, unknown>;
  if (f.application !== APP) return { ok: false, error: "Import file is invalid: this is not a ManwhaTrack backup." };
  let version = typeof f.exportVersion === "number" ? f.exportVersion : NaN;
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: "Import file is invalid: unknown backup version." };
  if (version > EXPORT_VERSION) return { ok: false, error: "This backup was made by a newer version of ManwhaTrack. Update the extension, then import again." };
  while (version < EXPORT_VERSION) {
    const step = EXPORT_MIGRATIONS[version];
    if (!step) return { ok: false, error: `Import file is invalid: cannot upgrade backup version ${version}.` };
    f = step(f);
    version++;
  }

  let invalid = 0;
  const arr = (k: string) => (Array.isArray(f[k]) ? (f[k] as Record<string, unknown>[]) : []);
  const clean = <T>(items: Record<string, unknown>[], repair: (x: never) => T | null): T[] => {
    const out: T[] = [];
    for (const it of items) {
      const r = it && typeof it === "object" ? repair(sanitize(it) as never) : null;
      if (r) out.push(r);
      else invalid++;
    }
    return out;
  };

  const series = clean(arr("series"), repairSeries);
  const seriesIds = new Set(series.map((s) => s.id));
  const sources = clean(arr("sources"), repairSource).filter((s) => {
    const ok = seriesIds.has(s.seriesId) && isSafeHttpUrl(s.seriesUrl);
    if (!ok) invalid++;
    return ok;
  });
  // Lists are user-authored organization. Reject ambiguous or dangling membership
  // rather than silently importing a different collection than the preview showed.
  if (f.collections !== undefined && !Array.isArray(f.collections)) return { ok: false, error: "Import file is invalid: lists must be an array." };
  const collections: Collection[] = [];
  const collectionIds = new Set<string>();
  const collectionNames = new Set<string>();
  for (const value of arr("collections")) {
    const c = repairCollection(value);
    if (!c || c.seriesIds.some(id => !seriesIds.has(id)) || collectionIds.has(c.id) || collectionNames.has(c.name.toLocaleLowerCase())) return { ok: false, error: "Import file is invalid: a list has an invalid name, duplicate identity, or missing series." };
    collections.push(c);
    collectionIds.add(c.id); collectionNames.add(c.name.toLocaleLowerCase());
  }
  const sourceIds = new Set(sources.map((s) => s.id));
  const chapters = clean(arr("chapters"), repairChapter).filter((c) => {
    const ok = seriesIds.has(c.seriesId) && sourceIds.has(c.sourceId) && isSafeHttpUrl(c.url);
    if (!ok) invalid++;
    return ok;
  });
  const history = clean(arr("history"), repairEvent).filter((e) => seriesIds.has(e.seriesId));
  const covers = arr("covers").filter((c): c is Record<string, unknown> & PortableCover => typeof c.id === "string" && typeof c.data === "string" && typeof c.mimeType === "string" && /^image\//.test(c.mimeType as string));

  return {
    ok: true,
    invalid,
    file: {
      application: APP,
      exportVersion: EXPORT_VERSION,
      exportedAt: typeof f.exportedAt === "string" ? f.exportedAt : "",
      schemaVersion: typeof f.schemaVersion === "number" ? f.schemaVersion : SCHEMA_VERSION,
      series,
      sources,
      chapters,
      history,
      settings: f.settings && typeof f.settings === "object" ? (f.settings as Partial<Settings>) : {},
      collections,
      queue: Array.isArray(f.queue) ? (f.queue as unknown[]).filter((x): x is string => typeof x === "string") : [],
      covers: covers.length ? covers : undefined,
    },
  };
}

/** Strips control characters from all strings in imported records. */
function sanitize(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 20000);
  if (Array.isArray(v)) return v.slice(0, 5000).map(sanitize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== "__proto__" && k !== "constructor") out[k] = sanitize(x);
    return out;
  }
  return v;
}

// ------------------------------------------------------------------ preview

export interface ImportPreview {
  series: number;
  newSeries: number;
  duplicates: { imported: string; existing: string }[];
  chapters: number;
  events: number;
  covers: number;
  collections: number;
  existingCollections: number;
  invalid: number;
  exportedAt: string;
}

async function matchExistingTx(t: Tx, s: PortableSeries, sources: SeriesSource[]): Promise<Series | undefined> {
  const byId = await getSeriesTx(t, s.id);
  if (byId) return byId;
  for (const src of sources) {
    const hit = await t.firstByIndex<SeriesSource>("sources", "canonicalSeriesUrl", src.canonicalSeriesUrl);
    if (hit) return getSeriesTx(t, hit.seriesId);
  }
  const hits = await t.byIndex<Series>("series", "normalizedTitle", normalizeTitle(s.title));
  const hit = hits.find(x => (x.format ?? "manhwa") === (s.format ?? "manhwa"));
  return hit ? getSeriesTx(t, hit.id) : undefined;
}

export async function previewImport(file: BackupFile, invalid = 0): Promise<ImportPreview> {
  const bySeries = groupBy(file.sources, (s) => s.seriesId);
  const duplicates = await read(["series", "sources"], async (t) => {
    const out: ImportPreview["duplicates"] = [];
    for (const s of file.series) {
      const hit = await matchExistingTx(t, s, bySeries.get(s.id) ?? []);
      if (hit) out.push({ imported: s.title, existing: hit.title });
    }
    return out;
  });
  const existingCollections = await read(["meta"], async t => {
    const local = await getCollectionsTx(t);
    return (file.collections ?? []).filter(c => local.some(other => other.id === c.id || other.name.toLocaleLowerCase() === c.name.toLocaleLowerCase())).length;
  });
  return {
    series: file.series.length,
    newSeries: file.series.length - duplicates.length,
    duplicates,
    chapters: file.chapters.length,
    events: file.history.length,
    covers: file.covers?.length ?? 0,
    collections: file.collections?.length ?? 0,
    existingCollections,
    invalid,
    exportedAt: file.exportedAt,
  };
}

// ------------------------------------------------------------------ apply

export type ConflictMode = "merge" | "keep" | "replace";

export interface ImportResult {
  added: number;
  merged: number;
  skipped: number;
  settingsWarning?: string;
}

export async function applyImport(file: BackupFile, mode: ConflictMode, opts: { importSettings?: boolean } = {}): Promise<ImportResult> {
  // Decode covers before the transaction (no non-IDB awaits allowed inside it).
  const coverBlobs = new Map<string, CoverAsset>();
  for (const c of file.covers ?? []) {
    try {
      coverBlobs.set(c.id, {
        id: newId(),
        blob: base64ToBlob(c.data, c.mimeType),
        mimeType: c.mimeType,
        width: c.width,
        height: c.height,
        sourceUrl: c.sourceUrl,
        origin: c.origin === "custom" ? "custom" : "detected",
        capturedAt: typeof c.capturedAt === "number" ? c.capturedAt : Date.now(),
      });
    } catch {
      // Skip unreadable cover data; the series can re-download it later.
    }
  }

  const sourcesBySeries = groupBy(file.sources, (s) => s.seriesId);
  const chaptersBySource = groupBy(file.chapters, (c) => c.sourceId);
  const eventsBySeries = groupBy(file.history, (e) => e.seriesId);
  const result: ImportResult = { added: 0, merged: 0, skipped: 0 };
  const progressChanged = new Set<string>();

  await withTx(["series", "sources", "chapters", "events", "covers", "meta"], "readwrite", async (t) => {
    const collections = await getCollectionsTx(t);
    const collectionTargets = new Map<string, Collection | undefined>();
    const consumedTargets = new Set<string>();
    for (const incoming of file.collections ?? []) {
      const byId = collections.find(c => c.id === incoming.id);
      const byName = collections.find(c => c.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase());
      const existing = byId ?? byName;
      if ((byId && byName && byId.id !== byName.id) || (existing && consumedTargets.has(existing.id))) {
        throw new Error(`List “${incoming.name}” matches different saved list identities. Rename the conflicting list in Your lists, then import again.`);
      }
      if (existing) consumedTargets.add(existing.id);
      collectionTargets.set(incoming.id, existing);
    }
    const idMap = new Map<string, string>();
    for (const incoming of file.series) {
      const srcs = sourcesBySeries.get(incoming.id) ?? [];
      const existing = await matchExistingTx(t, incoming, srcs);
      if (existing && mode === "keep") {
        result.skipped++;
        idMap.set(incoming.id, existing.id);
        continue;
      }

      let target: Series;
      if (existing) {
        target = existing;
        if (mode === "replace") {
          Object.assign(target, pickUserData(incoming));
        } else {
          mergeSeriesFields(target, incoming as Series);
        }
        result.merged++;
      } else {
        target = { ...(incoming as Series), titleKeys: titleKeysFor(incoming.title, incoming.alternateTitles), sourceIds: [] };
        if (await t.get("series", target.id)) target.id = newId();
        result.added++;
      }
      target.removedAt = undefined;
      const coverFor = (id?: string) => (id ? coverBlobs.get(id) : undefined);
      const detected = coverFor(incoming.detectedCoverId);
      const chosen = coverFor(incoming.coverId);
      for (const c of [detected, chosen]) if (c && !(await t.get("covers", c.id))) await t.put("covers", c);
      if (detected && (!existing || mode === "replace" || !target.detectedCoverId)) target.detectedCoverId = detected.id;
      if (chosen && (!existing || mode === "replace" || !target.coverId)) target.coverId = chosen.id;
      if (target.coverId && !(await t.get("covers", target.coverId))) target.coverId = target.detectedCoverId;
      if (target.detectedCoverId && !(await t.get("covers", target.detectedCoverId))) target.detectedCoverId = undefined;
      await putSeriesTx(t, target);
      idMap.set(incoming.id, target.id);

      const chapterIdMap = new Map<string, string>();
      for (const src of srcs) {
        let targetSource = await t.firstByIndex<SeriesSource>("sources", "canonicalSeriesUrl", src.canonicalSeriesUrl);
        if (targetSource && targetSource.seriesId !== target.id) targetSource = undefined;
        if (!targetSource) {
          targetSource = { ...src, seriesId: target.id };
          if (await t.get("sources", targetSource.id)) targetSource.id = newId();
          if (target.preferredSourceId === src.id) target.preferredSourceId = targetSource.id;
          await t.put("sources", targetSource);
        } else {
          if (mode === "replace") {
            targetSource.removedAt = src.removedAt;
            targetSource.disabled = src.disabled;
          } else {
            // Merge never silently reactivates an explicitly removed/disabled source.
            targetSource.removedAt ??= src.removedAt;
            targetSource.disabled ||= src.disabled || !!targetSource.removedAt;
          }
          await t.put("sources", targetSource);
        }
        for (const ch of chaptersBySource.get(src.id) ?? []) {
          const same = (await t.byIndex<Chapter>("chapters", "canonicalUrl", canonicalizeUrl(ch.url))).find((c) => c.sourceId === targetSource.id)
            ?? await t.firstByIndex<Chapter>("chapters", "sourceKey", [targetSource.id, ch.key]);
          if (same) {
            const localPosition = sanitizeReadingPosition(same.readingPosition);
            const incomingPosition = canonicalizeUrl(ch.url) === canonicalizeUrl(same.url) ? sanitizeReadingPosition(ch.readingPosition) : undefined;
            const localRevision = same.progressRevision ?? 0;
            const incomingRevision = ch.progressRevision ?? 0;
            const localProgress = { completedAt: same.completedAt, completionSource: same.completionSource, maxProgress: same.maxProgress };
            // Revision-zero backups predate corrections. At equal nonzero revisions,
            // keep local explicit progress rather than inventing a conflict winner.
            const useIncoming = mode === "replace" || incomingRevision > localRevision;
            if (mode !== "replace") mergeChapterInto(same, ch, true);
            else {
              same.visitCount = Math.max(same.visitCount, ch.visitCount);
              same.associationOverridden = ch.associationOverridden === true;
              Object.assign(same, { chapterLabel: ch.chapterLabel, title: ch.title, chapterNumber: ch.chapterNumber, ordinal: ch.ordinal, volumeNumber: ch.volumeNumber, seasonNumber: ch.seasonNumber, userFields: [...ch.userFields] });
            }
            if (useIncoming) {
              const changed = localProgress.completedAt !== ch.completedAt || localProgress.completionSource !== ch.completionSource || localProgress.maxProgress !== ch.maxProgress;
              Object.assign(same, { completedAt: ch.completedAt, completionSource: ch.completionSource, maxProgress: ch.maxProgress });
              same.progressRevision = Math.max(localRevision, incomingRevision) + (changed || mode === "replace" ? 1 : 0);
              if (changed || same.progressRevision !== localRevision) progressChanged.add(target.id);
            } else if (localRevision > 0) {
              Object.assign(same, localProgress);
              same.progressRevision = localRevision;
            }
            const adoptedRevision = useIncoming ? incomingRevision : localRevision;
            const candidates = [
              ...(mode !== "replace" && localRevision === adoptedRevision && localPosition?.progressRevision === localRevision ? [localPosition] : []),
              ...(incomingRevision === adoptedRevision && incomingPosition?.progressRevision === incomingRevision ? [incomingPosition] : []),
            ];
            const chosenPosition = candidates.sort((a, b) => b.capturedAt - a.capturedAt)[0];
            same.readingPosition = chosenPosition ? { ...chosenPosition, progressRevision: same.progressRevision ?? 0 } : undefined;
            await t.put("chapters", same);
            chapterIdMap.set(ch.id, same.id);
          } else {
            const copy = { ...ch, seriesId: target.id, sourceId: targetSource.id };
            if (await t.get("chapters", copy.id)) copy.id = newId();
            await t.put("chapters", copy);
            chapterIdMap.set(ch.id, copy.id);
          }
        }
      }
      for (const e of eventsBySeries.get(incoming.id) ?? []) {
        const mappedChapter = e.chapterId ? chapterIdMap.get(e.chapterId) ?? e.chapterId : undefined;
        const prior = await t.get<ReadingEvent>("events", e.id);
        if (prior) {
          // Minute buckets may have grown since the previous backup. Merge snapshots
          // by their largest measured value, never add the same reading twice.
          if (prior.seriesId === target.id && prior.chapterId === mappedChapter && prior.type === e.type &&
              ((e.type === "time" && e.durationMs! > (prior.durationMs ?? 0)) || (e.type === "backlog" && e.timestamp > prior.timestamp))) {
            await t.put("events", { ...e, seriesId:target.id, chapterId:mappedChapter });
          }
          continue;
        }
        await t.put("events", { ...e, seriesId: target.id, chapterId: mappedChapter });
      }
      if (incoming.currentChapterId) {
        const mapped = chapterIdMap.get(incoming.currentChapterId);
        if (mapped && (!existing || mode === "replace")) target.currentChapterId = mapped;
      }
      await refreshSeriesTx(t, target.id, (s) => {
        s.currentChapterId = target.currentChapterId ?? s.currentChapterId;
        s.preferredSourceId = target.preferredSourceId ?? s.preferredSourceId;
      });
    }

    for (const incoming of file.collections ?? []) {
      const mapped = incoming.seriesIds.map(id => idMap.get(id)).filter((id): id is string => !!id);
      const existing = collectionTargets.get(incoming.id);
      if (existing) {
        if (mode === "keep") continue;
        existing.seriesIds = mode === "replace" ? [...new Set(mapped)] : [...new Set([...existing.seriesIds, ...mapped])];
        if (mode === "replace" || incoming.updatedAt > existing.updatedAt) {
          if (collections.some(c => c.id !== existing.id && c.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase())) throw new Error(`List “${incoming.name}” has a conflicting saved name. Rename the conflicting list in Your lists, then import again.`);
          existing.name = incoming.name;
        }
        existing.createdAt = Math.min(existing.createdAt, incoming.createdAt);
        existing.updatedAt = Math.max(existing.updatedAt, incoming.updatedAt);
      } else {
        if (collections.some(c => c.id === incoming.id || c.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase())) throw new Error(`List “${incoming.name}” has a conflicting saved identity. Rename the conflicting list in Your lists, then import again.`);
        collections.push({ ...incoming, seriesIds: [...new Set(mapped)] });
      }
    }
    await putCollectionsTx(t, collections);

    if (file.queue.length) {
      const q = (await t.get<{ key: string; value: string[] }>("meta", "queue"))?.value ?? [];
      const mapped = file.queue.map((id) => idMap.get(id)).filter((x): x is string => !!x);
      await t.put("meta", { key: "queue", value: [...new Set([...q, ...mapped])] });
    }
  });

  // Cross-origin readers listen to local-storage changes; notification is outside
  // the library transaction and cannot turn a committed import into an error.
  for (const seriesId of progressChanged) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ "reading:revision": { seriesId, at: Date.now(), token: newId() } });
      }
    } catch {
      // Durable chapter revisions still reject in-flight automatic observations.
    }
  }

  if (opts.importSettings && file.settings && Object.keys(file.settings).length) {
    try {
      await saveSettings(repairSettings({ ...(await getSettings()), ...file.settings }));
    } catch {
      result.settingsWarning = "Library imported, but settings could not be saved. Your existing settings were kept.";
    }
  }
  return result;
}

function pickUserData(s: PortableSeries): Partial<Series> {
  return {
    title: s.title,
    format: s.format,
    genres: s.genres,
    alternateTitles: s.alternateTitles,
    status: s.status,
    favorite: s.favorite,
    pinned: s.pinned,
    personalRating: s.personalRating,
    tags: s.tags,
    notes: s.notes,
    userFields: s.userFields,
    hidden: s.hidden,
  };
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBlob(data: string, mimeType: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
