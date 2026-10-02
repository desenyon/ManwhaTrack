import type { Collection } from "../../shared/types/collections";
import type { Series } from "../../shared/types/models";
import { publish } from "../../shared/bus";
import { read, write, type Tx } from "../db";
import { newId } from "../schema";

export function collectionName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Enter a list name between 1 and 80 characters.");
  return name;
}

export function repairCollection(value: unknown): Collection | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<Collection>;
  if (typeof c.id !== "string" || !c.id || typeof c.name !== "string" || !Array.isArray(c.seriesIds) || c.seriesIds.some(id => typeof id !== "string" || !id)) return null;
  try {
    return { id: c.id, name: collectionName(c.name), seriesIds: [...new Set(c.seriesIds)], createdAt: Number.isFinite(c.createdAt) ? c.createdAt! : 0, updatedAt: Number.isFinite(c.updatedAt) ? c.updatedAt! : 0 };
  } catch { return null; }
}

export async function getCollectionsTx(t: Tx): Promise<Collection[]> {
  const record = await t.get<{ key: string; value: unknown[] }>("meta", "collections");
  if (!record) return [];
  if (!Array.isArray(record.value)) throw new Error("Saved lists could not be read. Your existing data was kept.");
  const collections: Collection[] = [];
  for (const value of record.value) {
    const c = repairCollection(value);
    if (!c || collections.some(other => other.id === c.id || other.name.toLocaleLowerCase() === c.name.toLocaleLowerCase())) throw new Error("A saved list could not be read. Your existing data was kept.");
    collections.push(c);
  }
  return collections;
}

export async function putCollectionsTx(t: Tx, collections: Collection[]): Promise<void> {
  await t.put("meta", { key: "collections", value: collections });
}

/** Hide removed members without losing membership if their series is restored. */
export async function listCollections(): Promise<Collection[]> {
  return read(["meta", "series"], async t => {
    const active = new Set((await t.getAll<Series>("series")).filter(s => !s.removedAt).map(s => s.id));
    return (await getCollectionsTx(t)).map(c => ({ ...c, seriesIds: c.seriesIds.filter(id => active.has(id)) }));
  });
}

async function change<T>(fn: (t: Tx, collections: Collection[]) => Promise<T>): Promise<T> {
  const result = await write(["meta", "series"], async t => {
    const collections = await getCollectionsTx(t);
    const result = await fn(t, collections);
    await putCollectionsTx(t, collections);
    return result;
  });
  publish({ type: "library-changed" });
  return result;
}

function validateName(collections: Collection[], value: string, except?: string): string {
  const name = collectionName(value);
  if (collections.some(c => c.id !== except && c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A list with this name already exists.");
  return name;
}

async function validSeries(t: Tx, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  for (const id of unique) {
    const s = await t.get<Series>("series", id);
    if (!s || s.removedAt) throw new Error("One of these series is no longer in your library.");
  }
  return unique;
}

export function createCollection(name: string, seriesIds: string[] = []): Promise<Collection> {
  return change(async (t, collections) => {
    const c: Collection = { id: newId(), name: validateName(collections, name), seriesIds: await validSeries(t, seriesIds), createdAt: Date.now(), updatedAt: Date.now() };
    collections.push(c);
    return c;
  });
}

export function renameCollection(id: string, name: string): Promise<void> {
  return change(async (_t, collections) => {
    const c = collections.find(c => c.id === id);
    if (!c) throw new Error("This list no longer exists.");
    c.name = validateName(collections, name, id);
    c.updatedAt = Date.now();
  });
}

export function updateCollection(id: string, name: string, membership: Record<string, boolean>): Promise<void> {
  return change(async (t, collections) => {
    const c = collections.find(c => c.id === id);
    if (!c) throw new Error("This list no longer exists.");
    c.name = validateName(collections, name, id);
    const ids = await validSeries(t, Object.keys(membership));
    c.seriesIds = [...new Set([...c.seriesIds.filter(id => membership[id] !== false), ...ids.filter(id => membership[id])])];
    c.updatedAt = Date.now();
  });
}

export function deleteCollection(id: string): Promise<void> {
  return change(async (_t, collections) => {
    const index = collections.findIndex(c => c.id === id);
    if (index >= 0) collections.splice(index, 1);
  });
}

/** Set membership of the selected series in each specified list, atomically. */
export function assignCollections(seriesIds: string[], assignments: { collectionId: string; included: boolean }[]): Promise<void> {
  return change(async (t, collections) => {
    const ids = await validSeries(t, seriesIds);
    for (const assignment of assignments) {
      const c = collections.find(c => c.id === assignment.collectionId);
      if (!c) throw new Error("One of these lists no longer exists. Reopen the list chooser.");
      c.seriesIds = assignment.included ? [...new Set([...c.seriesIds, ...ids])] : c.seriesIds.filter(id => !ids.includes(id));
      c.updatedAt = Date.now();
    }
  });
}

/** Identity changes preserve list organization; passing no target scrubs a purged series. */
export async function remapCollectionSeriesTx(t: Tx, fromId: string, toId?: string, keepOriginal = false): Promise<void> {
  const collections = await getCollectionsTx(t);
  for (const c of collections) {
    if (!c.seriesIds.includes(fromId)) continue;
    c.seriesIds = [...new Set(c.seriesIds.flatMap(id => id === fromId ? [...(keepOriginal ? [id] : []), ...(toId ? [toId] : [])] : [id]))];
    c.updatedAt = Date.now();
  }
  await putCollectionsTx(t, collections);
}
