// Minimal promise wrapper over IndexedDB. All related writes happen inside one
// transaction via `withTx`, so partial writes cannot leave the library inconsistent.
//
// Rule for callers: inside a `withTx` callback, only await IDB requests made through the
// Tx object. Awaiting anything else (fetch, timers, chrome APIs) lets the transaction
// auto-commit early.

import { SCHEMA_VERSION, upgradeDatabase } from "./migrations";

export const DB_NAME = "manwhatrack";

export type StoreName = "series" | "sources" | "chapters" | "events" | "covers" | "meta";
export const ALL_STORES: StoreName[] = ["series", "sources", "chapters", "events", "covers", "meta"];

const connections = new Map<string, Promise<IDBDatabase>>();
let currentDbName = DB_NAME;

/** Test hook: point the storage layer at a different database. */
export function useDatabase(name: string): void {
  currentDbName = name;
}

export function openDb(name = currentDbName): Promise<IDBDatabase> {
  let p = connections.get(name);
  if (!p) {
    p = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, SCHEMA_VERSION);
      req.onupgradeneeded = (ev) => {
        const tx = req.transaction;
        if (!tx) throw new Error("Upgrade transaction missing");
        upgradeDatabase(req.result, tx, ev.oldVersion, ev.newVersion ?? SCHEMA_VERSION);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another context (e.g. a newer extension version) wants to upgrade: let it.
        db.onversionchange = () => {
          db.close();
          connections.delete(name);
        };
        db.onclose = () => connections.delete(name);
        resolve(db);
      };
      req.onerror = () => {
        connections.delete(name);
        reject(req.error ?? new Error("Could not open the local database"));
      };
      req.onblocked = () => {
        // Older connection still open in another context; it will close on versionchange.
      };
    }).catch(err => {
      // `indexedDB.open` can also throw synchronously (e.g. storage access).
      // Do not retain a rejected connection promise that makes Retry ineffective.
      if (connections.get(name) === p) connections.delete(name);
      throw err;
    });
    connections.set(name, p);
  }
  return p;
}

export async function closeDb(name = currentDbName): Promise<void> {
  const p = connections.get(name);
  connections.delete(name);
  if (p) (await p).close();
}

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

export class WriteRevokedError extends Error {
  constructor() { super("Tracking permission changed before the write committed"); this.name = "WriteRevokedError"; }
}

const guardedWrites = new Map<IDBTransaction, { allows: () => boolean; revoked: boolean }>();

/** Called when tracking policy changes, including while IDB is awaiting commit. */
export function revokeDisallowedWrites(): void {
  for (const [raw, guard] of guardedWrites) {
    if (guard.allows()) continue;
    try { raw.abort(); guard.revoked = true; } catch { /* Already committed. */ }
  }
}

export class Tx {
  constructor(readonly raw: IDBTransaction, private readonly shouldWrite?: () => boolean) {}

  private checkWrite(): void {
    if (this.shouldWrite && !this.shouldWrite()) throw new WriteRevokedError();
  }

  store(name: StoreName): IDBObjectStore {
    return this.raw.objectStore(name);
  }

  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return req(this.store(store).get(key)) as Promise<T | undefined>;
  }

  getAll<T>(store: StoreName, query?: IDBKeyRange | IDBValidKey, count?: number): Promise<T[]> {
    return req(this.store(store).getAll(query, count)) as Promise<T[]>;
  }

  byIndex<T>(store: StoreName, index: string, query: IDBKeyRange | IDBValidKey, count?: number): Promise<T[]> {
    return req(this.store(store).index(index).getAll(query, count)) as Promise<T[]>;
  }

  firstByIndex<T>(store: StoreName, index: string, query: IDBKeyRange | IDBValidKey): Promise<T | undefined> {
    return req(this.store(store).index(index).get(query)) as Promise<T | undefined>;
  }

  keysByIndex(store: StoreName, index: string, query: IDBKeyRange | IDBValidKey): Promise<IDBValidKey[]> {
    return req(this.store(store).index(index).getAllKeys(query));
  }

  count(store: StoreName, query?: IDBKeyRange | IDBValidKey): Promise<number> {
    return req(this.store(store).count(query));
  }

  put<T>(store: StoreName, value: T): Promise<IDBValidKey> {
    this.checkWrite();
    return req(this.store(store).put(value));
  }

  delete(store: StoreName, key: IDBValidKey | IDBKeyRange): Promise<undefined> {
    this.checkWrite();
    return req(this.store(store).delete(key));
  }

  clear(store: StoreName): Promise<undefined> {
    this.checkWrite();
    return req(this.store(store).clear());
  }
}

/**
 * Runs `fn` inside a single IDB transaction. Resolves after the transaction commits;
 * if `fn` throws, the transaction is aborted and nothing is written.
 */
export async function withTx<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (t: Tx) => Promise<T>, shouldWrite?: () => boolean): Promise<T> {
  const db = await openDb();
  const raw = db.transaction(stores, mode, { durability: "strict" } as IDBTransactionOptions);
  const guard = shouldWrite ? { allows: shouldWrite, revoked: false } : undefined;
  if (guard) guardedWrites.set(raw, guard);
  const done = new Promise<void>((resolve, reject) => {
    raw.oncomplete = () => { guardedWrites.delete(raw); resolve(); };
    raw.onabort = () => { guardedWrites.delete(raw); reject(guard?.revoked ? new WriteRevokedError() : raw.error ?? new Error("Transaction aborted")); };
    raw.onerror = () => { guardedWrites.delete(raw); reject(raw.error ?? new Error("Transaction failed")); };
  });
  let result: T;
  try {
    result = await fn(new Tx(raw, shouldWrite));
    if (shouldWrite && !shouldWrite()) throw new WriteRevokedError();
  } catch (err) {
    try {
      raw.abort();
    } catch {
      // Already finished.
    }
    await done.catch(() => undefined);
    throw guard?.revoked ? new WriteRevokedError() : err;
  }
  await done;
  return result;
}

export const read = <T>(stores: StoreName[], fn: (t: Tx) => Promise<T>) => withTx(stores, "readonly", fn);
export const write = <T>(stores: StoreName[], fn: (t: Tx) => Promise<T>, shouldWrite?: () => boolean) => withTx(stores, "readwrite", fn, shouldWrite);
