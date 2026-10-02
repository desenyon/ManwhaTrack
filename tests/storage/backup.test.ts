import { beforeEach, describe, expect, it } from "vitest";
import { chapterObs, freshDb, seriesObs, SL, slChapter } from "../helpers/obs";
import { completeChapter, trackChapterOpened, trackSeriesPage } from "../../src/storage/tracking";
import { applyImport, exportLibrary, parseBackup, previewImport, toCsv } from "../../src/storage/backup";
import { editSeries, getSeries, listSeries } from "../../src/storage/repositories/series";
import { listChapters } from "../../src/storage/repositories/chapters";
import { setDetectedCover } from "../../src/storage/repositories/covers";
import { read, write } from "../../src/storage/db";
import type { Chapter } from "../../src/shared/types/models";
import { listEvents } from "../../src/storage/repositories/history";

beforeEach(() => {
  freshDb();
});

async function seed() {
  const r = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 31", url: slChapter(31), next: slChapter(32) }));
  await completeChapter(r!.chapterId!, "progress");
  await editSeries(r!.seriesId, { tags: ["Action"], notes: "note", favorite: true });
  await setDetectedCover(r!.seriesId, { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), mimeType: "image/png", origin: "detected" });
  return r!;
}

describe("export / import", () => {
  it("round-trips a library into an empty database, including covers", async () => {
    await seed();
    const file = await exportLibrary({ includeCovers: true });
    expect(file.application).toBe("ManwhaTrack");
    expect(file.exportVersion).toBe(4);
    expect(file.series[0]).not.toHaveProperty("summary");
    expect(file.covers).toHaveLength(1);

    freshDb();
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const preview = await previewImport(parsed.file);
    expect(preview.newSeries).toBe(1);
    const res = await applyImport(parsed.file, "merge");
    expect(res.added).toBe(1);
    const [s] = await listSeries();
    expect(s?.title).toBe("Solo Leveling");
    expect(s?.tags).toEqual(["Action"]);
    expect(s?.summary.lastCompletedLabel).toBe("Chapter 31");
    expect(s?.summary.continueUrl).toBe(slChapter(32));
    expect(s?.coverId).toBeTruthy();
    expect((await listEvents()).length).toBeGreaterThan(0);
  });

  it("detects duplicates and honours conflict modes", async () => {
    const r = await seed();
    const file = await exportLibrary();
    await editSeries(r.seriesId, { notes: "changed locally", tags: ["Local"] });

    const parsed = parseBackup(JSON.stringify(file));
    if (!parsed.ok) throw new Error(parsed.error);
    expect((await previewImport(parsed.file)).duplicates).toHaveLength(1);

    await applyImport(parsed.file, "keep");
    expect((await getSeries(r.seriesId))?.notes).toBe("changed locally");

    await applyImport(parsed.file, "merge");
    let s = await getSeries(r.seriesId);
    expect(s?.tags.sort()).toEqual(["Action", "Local"]);
    expect(await listSeries()).toHaveLength(1);
    expect(await listChapters(r.seriesId)).toHaveLength(2);

    await applyImport(parsed.file, "replace");
    s = await getSeries(r.seriesId);
    expect(s?.notes).toBe("note");
    expect(s?.tags).toEqual(["Action"]);
  });

  it("importing the same file twice does not duplicate anything", async () => {
    await seed();
    const text = JSON.stringify(await exportLibrary());
    freshDb();
    for (let i = 0; i < 2; i++) {
      const p = parseBackup(text);
      if (!p.ok) throw new Error(p.error);
      await applyImport(p.file, "merge");
    }
    expect(await listSeries()).toHaveLength(1);
    const [s] = await listSeries();
    expect(await listChapters(s!.id)).toHaveLength(2);
    expect((await listEvents()).filter((e) => e.type === "opened")).toHaveLength(1);
  });

  it("rejects malformed files without touching the library", async () => {
    await seed();
    for (const bad of ["not json", "{}", JSON.stringify({ application: "ManwhaTrack", exportVersion: 99 }), JSON.stringify({ application: "Other", exportVersion: 1 })]) {
      expect(parseBackup(bad).ok).toBe(false);
    }
    expect(await listSeries()).toHaveLength(1);
  });

  it("imports files with missing optional fields and skips invalid records", async () => {
    const minimal = {
      application: "ManwhaTrack",
      exportVersion: 1,
      series: [{ id: "a", title: "Minimal" }, { id: "b" }],
      sources: [
        { id: "sa", seriesId: "a", seriesUrl: "https://min.io/manga/minimal/" },
        { id: "bad", seriesId: "a", seriesUrl: "javascript:alert(1)" },
      ],
      chapters: [{ id: "c1", seriesId: "a", sourceId: "sa", chapterLabel: "Chapter 1", url: "https://min.io/manga/minimal/chapter-1/", completedAt: 5 }],
    };
    const p = parseBackup(JSON.stringify(minimal));
    if (!p.ok) throw new Error(p.error);
    expect(p.invalid).toBe(2);
    await applyImport(p.file, "merge");
    const [s] = await listSeries();
    expect(s?.title).toBe("Minimal");
    expect(s?.summary.lastCompletedLabel).toBe("Chapter 1");
  });

  it("exports CSV with formula-injection protection", async () => {
    await trackSeriesPage(seriesObs({ title: "=HYPERLINK(evil)", url: SL }));
    const csv = toCsv(await exportLibrary());
    expect(csv.split("\r\n")[0]).toContain("Title,Status");
    expect(csv).toContain("'=HYPERLINK(evil)");
  });
});

it("imports the latest valid reading position and rebases an explicitly replaced snapshot", async () => {
  const result = await seed();
  const position = (at: number, revision = 0) => ({ version: 1 as const, capturedAt: at, progressRevision: revision, readerOffset: at, readerHeight: 3000, viewportHeight: 700 });
  await write(["chapters"], async t => {
    const chapter = (await t.get<Chapter>("chapters", result.chapterId!))!;
    chapter.readingPosition = position(100, chapter.progressRevision ?? 0);
    await t.put("chapters", chapter);
  });
  const file = await exportLibrary();
  const incoming = file.chapters.find(c => c.id === result.chapterId)!;
  incoming.readingPosition = position(300, incoming.progressRevision ?? 0);
  await applyImport(file, "merge");
  let chapter = (await read(["chapters"], t => t.get<Chapter>("chapters", result.chapterId!)))!;
  expect(chapter.readingPosition?.readerOffset).toBe(300);
  expect(chapter.readingPosition?.progressRevision).toBe(chapter.progressRevision ?? 0);
  await applyImport(file, "replace");
  chapter = (await read(["chapters"], t => t.get<Chapter>("chapters", result.chapterId!)))!;
  expect(chapter.progressRevision).toBeGreaterThan(incoming.progressRevision ?? 0);
  expect(chapter.readingPosition?.readerOffset).toBe(300);
  expect(chapter.readingPosition?.progressRevision).toBe(chapter.progressRevision);
  incoming.readingPosition = position(900, (incoming.progressRevision ?? 0) + 50);
  await applyImport(file, "replace");
  chapter = (await read(["chapters"], t => t.get<Chapter>("chapters", result.chapterId!)))!;
  expect(chapter.readingPosition).toBeUndefined();
});

it("does not adopt a viewport from a different URL with the same chapter source key", async () => {
  const result = await seed();
  const file = await exportLibrary();
  const incoming = file.chapters.find(c => c.id === result.chapterId)!;
  incoming.url = incoming.canonicalUrl = slChapter(999);
  incoming.readingPosition = { version: 1, capturedAt: 500, progressRevision: incoming.progressRevision ?? 0, readerOffset: 500, readerHeight: 3000, viewportHeight: 700 };
  for (const mode of ["merge", "replace"] as const) {
    await applyImport(file, mode);
    const chapter = (await read(["chapters"], t => t.get<Chapter>("chapters", result.chapterId!)))!;
    expect(chapter.url).toBe(slChapter(31));
    expect(chapter.readingPosition).toBeUndefined();
  }
});
