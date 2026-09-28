// Database schema migrations. Each step upgrades from version N-1 to N inside the
// IndexedDB upgrade transaction. Steps must be deterministic and tolerate missing
// optional fields. A missing or failing step aborts the upgrade, which leaves the
// existing database untouched — never clear data to "recover".

export const SCHEMA_VERSION = 1;

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
  // 2: (db, tx) => { ...add index...; migrateRecords(tx, "series", (s) => ({ ...s, newField: default })); },
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
