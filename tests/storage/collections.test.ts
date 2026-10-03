import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, seriesObs } from "../helpers/obs";
import { closeDb, openDb, read, write } from "../../src/storage/db";
import { trackSeriesPage } from "../../src/storage/tracking";
import { createCollection, assignCollections, deleteCollection, listCollections, renameCollection, updateCollection } from "../../src/storage/repositories/collections";
import { getSeries, removeSeries, restoreSeries, purgeSeriesNow, editSeries } from "../../src/storage/repositories/series";
import { mergeSeries, splitSource } from "../../src/storage/repositories/sources";
import { exportLibrary, parseBackup, applyImport } from "../../src/storage/backup";
import type { Collection } from "../../src/shared/types/collections";

beforeEach(() => freshDb());
async function seed(title = "Solo Leveling", host = "one.test") {
  return (await trackSeriesPage(seriesObs({ title, url: `https://${host}/series/${title.toLowerCase().replaceAll(" ", "-")}` })))!.seriesId;
}

describe("local user lists", () => {
  it("keeps stable identities, empty lists and multiple membership after closing and reopening the database", async () => {
    const id = await seed();
    const weekly = await createCollection("  Weekly  ", [id]);
    const art = await createCollection("Art");
    await assignCollections([id], [{ collectionId: art.id, included: true }]);
    await renameCollection(weekly.id, "Read weekly");
    await closeDb(); await openDb();
    expect(await listCollections()).toEqual([expect.objectContaining({ id: weekly.id, name: "Read weekly", seriesIds: [id] }), expect.objectContaining({ id: art.id, seriesIds: [id] })]);
    await deleteCollection(weekly.id);
    expect(await getSeries(id)).toBeDefined();
    expect(await listCollections()).toHaveLength(1);
    await assignCollections([id], [{ collectionId: art.id, included: false }]);
    expect((await listCollections())[0]?.seriesIds).toEqual([]);
  });

  it("rejects blanks, duplicate names, unknown lists and inactive members without partial mutations", async () => {
    const id = await seed();
    const a = await createCollection("Read weekly");
    const b = await createCollection("Artwork");
    await expect(createCollection(" \n ")).rejects.toThrow();
    await expect(createCollection("READ   WEEKLY")).rejects.toThrow("already exists");
    await expect(renameCollection(b.id, "read weekly")).rejects.toThrow();
    await expect(createCollection("Missing", ["unknown"])).rejects.toThrow();
    await expect(assignCollections([id], [{ collectionId: a.id, included: true }, { collectionId: "missing", included: true }])).rejects.toThrow();
    expect((await listCollections())[0]?.seriesIds).toEqual([]);
    await expect(updateCollection(a.id, "Renamed", { unknown: true })).rejects.toThrow();
    expect((await listCollections())[0]?.name).toBe("Read weekly");
    await removeSeries([id]);
    await expect(assignCollections([id], [{ collectionId: a.id, included: true }])).rejects.toThrow();
  });

  it("serializes simultaneous writes rather than losing list changes", async () => {
    const ids = await Promise.all([seed("One"), seed("Two")]);
    const c = await createCollection("Both");
    await Promise.all(ids.map(id => assignCollections([id], [{ collectionId: c.id, included: true }])));
    expect(new Set((await listCollections())[0]?.seriesIds)).toEqual(new Set(ids));
    const concurrent = await Promise.allSettled([createCollection("Same"), createCollection("same")]);
    expect(concurrent.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });

  it("hides removed members, restores membership, transfers merges/splits and scrubs permanent removal", async () => {
    const original = await seed();
    const second = await seed("Second", "two.test");
    const c = await createCollection("Favorites art", [second]);
    await removeSeries([second]);
    expect((await listCollections())[0]?.seriesIds).toEqual([]);
    await restoreSeries([second]);
    expect((await listCollections())[0]?.seriesIds).toEqual([second]);
    await mergeSeries(original, second);
    expect((await listCollections())[0]?.seriesIds).toEqual([original]);
    const sources = (await getSeries(original))!.sourceIds;
    const split = await splitSource(sources[1]!);
    expect(new Set((await listCollections())[0]?.seriesIds)).toEqual(new Set([original, split]));
    await purgeSeriesNow([split!]);
    expect((await listCollections())[0]?.seriesIds).toEqual([original]);
    const record = await read(["meta"], t => t.get<{value: Collection[]}>("meta", "collections"));
    expect(record?.value[0]?.seriesIds).not.toContain(split);
    expect(record?.value[0]?.id).toBe(c.id);
  });

  it("roundtrips empty and populated lists, tags and partial exports", async () => {
    const a = await seed("Alpha"); const b = await seed("Beta");
    await editSeries(a, { tags: ["Read weekly", "Favorite art"] });
    const list = await createCollection("Read weekly", [a, b]);
    const empty = await createCollection("Next season");
    const partial = await exportLibrary({ seriesIds: [a] });
    expect(partial.collections).toEqual([expect.objectContaining({ id: list.id, seriesIds: [a] })]);
    const backup = await exportLibrary();
    expect(backup.collections).toHaveLength(2);
    freshDb();
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.error);
    await applyImport(parsed.file, "merge"); await applyImport(parsed.file, "merge");
    expect(await listCollections()).toEqual([expect.objectContaining({ id: list.id, seriesIds: [a, b] }), expect.objectContaining({ id: empty.id, seriesIds: [] })]);
    expect((await getSeries(a))?.tags).toEqual(["Read weekly", "Favorite art"]);
  });

  it("maps memberships onto canonical imported series identities and respects keep/merge/replace", async () => {
    const original = await seed("Alpha");
    const c = await createCollection("Read weekly", [original]);
    const file = await exportLibrary();
    freshDb();
    const local = await seed("Alpha");
    const other = await seed("Other");
    const localList = await createCollection("READ WEEKLY", [other]);
    await applyImport(file, "keep");
    expect((await listCollections())[0]?.seriesIds).toEqual([other]);
    await applyImport(file, "merge");
    expect(new Set((await listCollections())[0]?.seriesIds)).toEqual(new Set([other, local]));
    await applyImport(file, "replace");
    expect(await listCollections()).toEqual([expect.objectContaining({ id: localList.id, name: c.name, seriesIds: [local] })]);
  });

  it("migrates schema3 backups and rejects invalid collection identity or dangling references", async () => {
    await seed(); const file = await exportLibrary();
    const old = parseBackup(JSON.stringify({ ...file, exportVersion: 3, schemaVersion: 3, collections: undefined }));
    expect(old).toMatchObject({ ok: true, file: { exportVersion: 5, collections: [] } });
    const c = { id: "list", name: "Weekly", seriesIds: [file.series[0]!.id], createdAt: 0, updatedAt: 0 };
    for (const collections of [[{ ...c, name: " " }], [c, { ...c, id: "other", name: "weekly" }], [{ ...c, seriesIds: ["missing"] }], [c, { ...c, name: "Another" }]]) {
      expect(parseBackup(JSON.stringify({ ...file, collections })).ok).toBe(false);
    }
  });
});

it("preserves malformed saved list data rather than resetting it during a write", async () => {
  const value = [{ id: "broken", name: "Still recoverable", seriesIds: "invalid" }];
  await write(["meta"], t => t.put("meta", { key: "collections", value }));
  await expect(createCollection("New list")).rejects.toThrow("existing data was kept");
  const saved = await read(["meta"], t => t.get<{value: unknown}>("meta", "collections"));
  expect(saved?.value).toEqual(value);
});

it("rejects ambiguous list id/name collisions without changing series or either list", async () => {
  const a = await seed("Alpha"); const b = await seed("Beta");
  const first = await createCollection("X", [a]);
  const second = await createCollection("Y", [b]);
  const file = await exportLibrary();
  file.series[0]!.notes = "This must not be committed";
  file.collections = [{ ...first, name: "Y" }, { ...second, name: "Z" }];
  for (const mode of ["merge", "keep", "replace"] as const) {
    await expect(applyImport(file, mode)).rejects.toThrow("Rename the conflicting list");
    expect(await listCollections()).toEqual([first, second]);
    expect((await getSeries(a))?.notes).toBeUndefined();
  }
});
