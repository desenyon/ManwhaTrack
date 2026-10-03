import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrateRecords, SCHEMA_VERSION, upgradeDatabase, type MigrationStep } from "../../src/storage/migrations";
import { closeDb, openDb, useDatabase } from "../../src/storage/db";
import { createChapter, createSeries, createSource, repairChapter, repairSeries } from "../../src/storage/schema";

function open(name: string, version: number, steps: Record<number, MigrationStep>): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = (ev) => upgradeDatabase(r.result, r.transaction!, ev.oldVersion, ev.newVersion ?? version, steps);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).put(value);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function getAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

describe("schema migrations", () => {
  it("creates every store at the current version", async () => {
    const name = `mig-${crypto.randomUUID()}`;
    useDatabase(name);
    const db = await openDb();
    expect(db.version).toBe(SCHEMA_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(["chapters", "covers", "events", "meta", "series", "sources"]);
    await closeDb();
  });

  it("runs steps in order and transforms records without losing any", async () => {
    const name = `mig-${crypto.randomUUID()}`;
    const v1 = await open(name, 1, MIGRATIONS);
    await put(v1, "series", { id: "s1", title: "Old Record" });
    await put(v1, "series", { id: "s2", title: "Another" });
    v1.close();

    const steps: Record<number, MigrationStep> = {
      ...MIGRATIONS,
      2: (_db, tx) => migrateRecords<Record<string, unknown>>(tx, "series", (s) => ({ ...s, migratedField: "yes" })),
      3: (db) => db.createObjectStore("extra", { keyPath: "id" }),
    };
    const v3 = await open(name, 3, steps);
    const rows = (await getAll(v3, "series")) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.migratedField === "yes")).toBe(true);
    expect([...v3.objectStoreNames]).toContain("extra");
    v3.close();
  });

  it("aborts the upgrade (keeping data) when a step is missing", async () => {
    const name = `mig-${crypto.randomUUID()}`;
    const v1 = await open(name, 1, MIGRATIONS);
    await put(v1, "series", { id: "s1", title: "Keep me" });
    v1.close();
    await expect(open(name, 3, { 1: MIGRATIONS[1]!, 3: () => undefined })).rejects.toBeTruthy();
    const again = await open(name, 1, MIGRATIONS);
    expect(again.version).toBe(1);
    expect(await getAll(again, "series")).toHaveLength(1);
    again.close();
  });

  it("upgrades legacy chapter revisions without changing historical progress or sources", async () => {
    const name = `mig-${crypto.randomUUID()}`;
    const v1 = await open(name, 1, MIGRATIONS);
    await put(v1, "chapters", { id: "c1", sourceId: "src", maxProgress: 0.7, readingTimeMs: 123 });
    await put(v1, "sources", { id: "src", seriesUrl: "https://old.example/series" });
    v1.close();
    const upgraded = await open(name, SCHEMA_VERSION, MIGRATIONS);
    expect(await getAll(upgraded, "chapters")).toEqual([{ id: "c1", sourceId: "src", maxProgress: 0.7, readingTimeMs: 123, progressRevision: 0, associationOverridden: false }]);
    expect(await getAll(upgraded, "sources")).toEqual([{ id: "src", seriesUrl: "https://old.example/series", removedAt: undefined }]);
    upgraded.close();
  });

  it("upgrades version 2 without resetting a manual correction revision", async () => {
    const name = `mig-${crypto.randomUUID()}`;
    const v2 = await open(name, 2, MIGRATIONS);
    await put(v2, "chapters", { id: "c", progressRevision: 7, maxProgress: 0.4 });
    v2.close();
    const upgraded = await open(name, SCHEMA_VERSION, MIGRATIONS);
    expect(await getAll(upgraded, "chapters")).toEqual([{ id: "c", progressRevision: 7, maxProgress: 0.4, associationOverridden: false }]);
    upgraded.close();
  });

  it("repairs records with missing optional fields instead of dropping them", () => {
    const s = repairSeries({ id: "x", title: "Only required fields" } as never);
    expect(s).toMatchObject({ status: "reading", tags: [], favorite: false, sourceIds: [], userFields: [] });
    expect(repairSeries({ id: "x" } as never)).toBeNull();
    const c = repairChapter({ id: "c", seriesId: "s", sourceId: "src", chapterLabel: "Chapter 4", url: "https://x.com/c/4" } as never);
    expect(c?.ordinal).toBe(4);
    expect(c?.visitCount).toBe(0);
  });
});

it("repairs version 4 joined chapter labels, summaries and events without losing saved reading data", async () => {
  const name = `mig-${crypto.randomUUID()}`;
  const old = await open(name, 4, MIGRATIONS);
  const series = createSeries({title:"Nano Machine"});
  const source = createSource({seriesId:series.id,seriesUrl:"https://asurascans.com/comics/nano-machine-3ec3b16f"});
  const chapter = createChapter({seriesId:series.id,sourceId:source.id,label:"Chapter 324105. TP <2>Aug 5, 2026",url:`${source.seriesUrl}/chapter/324`});
  chapter.maxProgress=.56; chapter.readingTimeMs=1250; chapter.lastOpenedAt=1000;
  chapter.readingPosition={version:1,capturedAt:1000,progressRevision:0,readerOffset:1700,readerHeight:6000,viewportHeight:800};
  const manual = createChapter({seriesId:series.id,sourceId:source.id,label:"Chapter 14350.Night in the Inn",url:`${source.seriesUrl}/chapter/143`});
  manual.userFields=["label","number"];
  series.currentChapterId=chapter.id;
  source.latestKnownChapter={key:chapter.key,label:chapter.chapterLabel,ordinal:chapter.ordinal,url:chapter.url};
  await put(old,"series",series); await put(old,"sources",source); await put(old,"chapters",chapter); await put(old,"chapters",manual);
  await put(old,"events",{id:"event",seriesId:series.id,chapterId:chapter.id,type:"opened",timestamp:1000,chapterLabel:chapter.chapterLabel});
  old.close();
  const upgraded = await open(name, SCHEMA_VERSION, MIGRATIONS);
  const chapters = await getAll(upgraded,"chapters") as typeof chapter[];
  expect(chapters.find(c=>c.id===chapter.id)).toEqual({...chapter,key:"324",chapterLabel:"Chapter 324",chapterNumber:324,ordinal:324,associationOverridden:false});
  expect(chapters.find(c=>c.id===manual.id)?.chapterLabel).toBe(manual.chapterLabel);
  expect((await getAll(upgraded,"sources") as typeof source[])[0]?.latestKnownChapter?.label).toBe("Chapter 324");
  expect((await getAll(upgraded,"series") as typeof series[])[0]?.summary.currentLabel).toBe("Chapter 324");
  expect((await getAll(upgraded,"events") as {chapterLabel:string}[])[0]?.chapterLabel).toBe("Chapter 324");
  upgraded.close();
});

it("upgrades v5 and earlier libraries to format-aware records without guessing dated reading",async()=>{
 for(const version of [1,4,5]) {
  const name=`format-${crypto.randomUUID()}`;const old=await open(name,version,MIGRATIONS);
  const series=createSeries({title:"Legacy",now:123});const raw:Partial<typeof series>={...series};delete raw.format;delete raw.genres;raw.totalReadingTimeMs=42_000;raw.notes="Keep this";
  await put(old,"series",raw);old.close();const next=await open(name,SCHEMA_VERSION,MIGRATIONS);
  const rows=await getAll(next,"series");expect(rows).toEqual([expect.objectContaining({id:series.id,format:"manhwa",genres:[],totalReadingTimeMs:42_000,notes:"Keep this",discoveredAt:123})]);expect(await getAll(next,"events")).toEqual([]);next.close();
 }
});
