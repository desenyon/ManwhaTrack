// Database schema migrations. Each step upgrades from version N-1 to N inside the
// IndexedDB upgrade transaction. Steps must be deterministic and tolerate missing
// optional fields. A missing or failing step aborts the upgrade, which leaves the
// existing database untouched — never clear data to "recover".

import type { Chapter, ReadingEvent, Series, SeriesSource } from "../shared/types/models";
import { correctJoinedChapterLabel, parseChapterLabel } from "../detection/normalization/chapter";
import { computeSeriesState } from "./summary";

export const SCHEMA_VERSION = 6;

export type MigrationStep = (db: IDBDatabase, tx: IDBTransaction) => void;

function createInitialSchema(db: IDBDatabase): void {
  const series = db.createObjectStore("series", { keyPath: "id" });
  series.createIndex("normalizedTitle", "normalizedTitle");
  series.createIndex("titleKeys", "titleKeys", { multiEntry: true });
  series.createIndex("updatedAt", "updatedAt");

  const sources = db.createObjectStore("sources", { keyPath: "id" });
  sources.createIndex("seriesId", "seriesId");
  sources.createIndex("canonicalSeriesUrl", "canonicalSeriesUrl");
  sources.createIndex("previousUrls", "previousUrls", { multiEntry: true });
  sources.createIndex("hostname", "hostname");

  const chapters = db.createObjectStore("chapters", { keyPath: "id" });
  chapters.createIndex("seriesId", "seriesId");
  chapters.createIndex("sourceId", "sourceId");
  chapters.createIndex("canonicalUrl", "canonicalUrl");
  chapters.createIndex("sourceKey", ["sourceId", "key"]);

  const events = db.createObjectStore("events", { keyPath: "id" });
  events.createIndex("seriesId", "seriesId");
  events.createIndex("chapterId", "chapterId");
  events.createIndex("timestamp", "timestamp");

  db.createObjectStore("covers", { keyPath: "id" });
  db.createObjectStore("meta", { keyPath: "key" });
}

export const MIGRATIONS: Record<number, MigrationStep> = {
  1: (db) => createInitialSchema(db),
  3: (_db, tx) => {
    if (_db.version < 4) migrateRecords<Record<string, unknown>>(tx, "chapters", c => ({ ...c, progressRevision: c.progressRevision ?? 0, associationOverridden: c.associationOverridden === true }));
  },
  4: (_db, tx) => {
    // One cursor combines prior transforms during a direct 1 → 4 upgrade.
    // Existing chapters have no guessed viewport: maxProgress is not a position.
    if (_db.version < 5) migrateRecords<Record<string, unknown>>(tx, "chapters", c => ({ ...c, progressRevision: c.progressRevision ?? 0, associationOverridden: c.associationOverridden === true }));
  },
  5: (db, tx) => { if (db.version < 6) repairJoinedChapterRecords(tx); },
  6: (_db, tx) => repairJoinedChapterRecords(tx, true),
  2: (db, tx) => {
    // Version 3 combines chapter transforms in one cursor. Concurrent upgrade
    // cursors otherwise overwrite each other's snapshots during a 1 → 3 upgrade.
    if (db.version < 3) migrateRecords<Record<string, unknown>>(tx, "chapters", (c) => ({ ...c, progressRevision: c.progressRevision ?? 0 }));
    migrateRecords<Record<string, unknown>>(tx, "sources", (s) => ({ ...s, removedAt: s.removedAt ?? undefined }));
  },
};

export function upgradeDatabase(
  db: IDBDatabase,
  tx: IDBTransaction,
  oldVersion: number,
  newVersion: number,
  steps: Record<number, MigrationStep> = MIGRATIONS,
): void {
  for (let v = oldVersion + 1; v <= newVersion; v++) {
    const step = steps[v];
    if (!step) throw new Error(`No migration defined for schema version ${v}`);
    step(db, tx);
  }
}

/**
 * Rewrites every record in a store through `fn` using a cursor, inside the upgrade
 * transaction. Returning `undefined` keeps the record unchanged; records are never deleted here.
 */
export function migrateRecords<T>(tx: IDBTransaction, storeName: string, fn: (record: T) => T | undefined): void {
  const cursorReq = tx.objectStore(storeName).openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const next = fn(cursor.value as T);
    if (next !== undefined) cursor.update(next);
    cursor.continue();
  };
}

/** Read all related records before writes, keeping the repair atomic and IDs intact. */
function repairJoinedChapterRecords(tx: IDBTransaction, addFormats = false): void {
  const chapters = tx.objectStore("chapters").getAll();
  const sources = tx.objectStore("sources").getAll();
  const series = tx.objectStore("series").getAll();
  const events = tx.objectStore("events").getAll();
  let remaining = 4;
  const done = () => {
    if (--remaining) return;
    const changed = new Set<string>();
    const labels = new Map<string, { before: string; after: string }>();
    for (const c of chapters.result as Chapter[]) {
      const label = typeof c.chapterLabel === "string" && typeof c.url === "string" &&
        (!c.userFields || (Array.isArray(c.userFields) && !c.userFields.some(f => f === "label" || f === "number"))) ? correctJoinedChapterLabel(c.chapterLabel, c.url) : undefined;
      if (label) {
        const p = parseChapterLabel(label);
        labels.set(c.id, {before:c.chapterLabel, after:label});
        Object.assign(c, {chapterLabel:label, chapterNumber:p.number, ordinal:p.ordinal, key:p.key, seasonNumber:p.season, volumeNumber:p.volume});
        changed.add(c.seriesId);
      }
      // Combine earlier migrations here, so concurrent upgrade cursors cannot overwrite repairs.
      c.progressRevision ??= 0;
      c.associationOverridden = c.associationOverridden === true;
      tx.objectStore("chapters").put(c);
    }
    for (const src of sources.result as SeriesSource[]) {
      const lk = src.latestKnownChapter;
      const label = lk?.url && correctJoinedChapterLabel(lk.label, lk.url);
      if (!label || !lk) continue;
      const p = parseChapterLabel(label);
      src.latestKnownChapter = {...lk, label, ordinal:p.ordinal, key:p.key};
      changed.add(src.seriesId);
      tx.objectStore("sources").put(src);
    }
    for (const s of series.result as Series[]) {
      if (!changed.has(s.id) && !addFormats) continue;
      if (addFormats) { s.format = s.format === "novel" ? "novel" : "manhwa"; s.genres = Array.isArray(s.genres) ? s.genres : []; }
      if (changed.has(s.id)) Object.assign(s, computeSeriesState(s, (chapters.result as Chapter[]).filter(c=>c.seriesId===s.id), (sources.result as SeriesSource[]).filter(src=>src.seriesId===s.id)));
      tx.objectStore("series").put(s);
    }
    for (const event of events.result as ReadingEvent[]) {
      const label = event.chapterId && labels.get(event.chapterId);
      if (label && event.chapterLabel === label.before) {
        event.chapterLabel = label.after;
        tx.objectStore("events").put(event);
      }
    }
  };
  for (const request of [chapters, sources, series, events]) request.onsuccess = done;
}
