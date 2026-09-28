import { beforeEach, describe, expect, it } from "vitest";
import { chapterObs, freshDb, seriesObs, SL, slChapter } from "../helpers/obs";
import { completeChapter, trackChapterOpened, trackSeriesPage } from "../../src/storage/tracking";
import { editSeries, getSeries, listSeries, purgeSeriesNow, removeSeries, restoreSeries, resetUserField } from "../../src/storage/repositories/series";
import { listChapters } from "../../src/storage/repositories/chapters";
import { keepSeparate, listSources, mergeSeries, removeSource, splitSource } from "../../src/storage/repositories/sources";
import { clearAllHistory, clearSeriesHistory, listEvents } from "../../src/storage/repositories/history";
import { clearUnusedCovers, getCover, removeCustomCover, setCustomCover, setDetectedCover } from "../../src/storage/repositories/covers";
import { addToQueue, getQueue, moveInQueue } from "../../src/storage/repositories/queue";
import { write } from "../../src/storage/db";

beforeEach(() => {
  freshDb();
});

const OTHER = "https://toonplace.net/manga/solo-leveling/";

describe("series CRUD", () => {
  it("update, soft remove, restore, purge", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    const id = r!.seriesId;
    await editSeries(id, { favorite: true, pinned: true, tags: ["Action", " action ", "Murim"], notes: "Wait for S2", personalRating: 8.7 });
    let s = await getSeries(id);
    expect(s?.favorite).toBe(true);
    expect(s?.tags).toEqual(["Action", "Murim"]);
    expect(s?.personalRating).toBe(8.5);

    await removeSeries([id]);
    expect(await listSeries()).toHaveLength(0);
    expect(await listSeries({ includeRemoved: true })).toHaveLength(1);
    await restoreSeries([id]);
    expect(await listSeries()).toHaveLength(1);

    await purgeSeriesNow([id]);
    expect(await listSeries({ includeRemoved: true })).toHaveLength(0);
    expect(await listSources()).toHaveLength(0);
  });

  it("revisiting a removed series restores it", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    await removeSeries([r!.seriesId]);
    const again = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    expect(again?.restored).toBe(true);
    expect(await listSeries()).toHaveLength(1);
  });

  it("reset of a user title returns to the detected title", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    await editSeries(r!.seriesId, { title: "Mine" });
    await resetUserField(r!.seriesId, "title");
    expect((await getSeries(r!.seriesId))?.title).toBe("Solo Leveling");
  });
});

describe("transactions", () => {
  it("roll back all writes when an operation fails midway", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    await expect(
      write(["series"], async (t) => {
        const s = await t.get<{ title: string }>("series", r!.seriesId);
        await t.put("series", { ...s, title: "CHANGED" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await getSeries(r!.seriesId))?.title).toBe("Solo Leveling");
  });
});

describe("multiple sources and deduplication", () => {
  it("same source via normalized URL is one entry", async () => {
    await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: "https://EXAMPLE-SCANS.com/manga/solo-leveling?fbclid=1" }));
    expect(await listSeries()).toHaveLength(1);
  });

  it("title variation on another site is suggested, not merged", async () => {
    const a = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    const b = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: OTHER }));
    expect(b?.seriesId).not.toBe(a?.seriesId);
    expect(b?.possibleDuplicateOf).toBe(a?.seriesId);
    expect(await listSeries()).toHaveLength(2);
  });

  it("attaches another site only when identity is essentially certain", async () => {
    const a = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL, alts: ["Only I Level Up"] }));
    const b = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: OTHER, alts: ["Only I Level Up", "나 혼자만 레벨업"] }));
    expect(b?.seriesId).toBe(a?.seriesId);
    expect(await listSources(a!.seriesId)).toHaveLength(2);
  });

  it("similar but distinct titles stay separate with no suggestion", async () => {
    await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    const b = await trackSeriesPage(seriesObs({ title: "Solo Leveling: Ragnarok", url: "https://example-scans.com/manga/solo-leveling-ragnarok/" }));
    expect(b?.possibleDuplicateOf).toBeUndefined();
    expect(await listSeries()).toHaveLength(2);
  });

  it("merge preserves sources, chapters, history, notes, tags, earliest discovery and progress", async () => {
    const a = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 10", url: slChapter(10) }), { now: 5000 });
    const b = await trackChapterOpened(chapterObs({ title: "Only I Level Up", seriesUrl: OTHER, label: "Chapter 11", url: `${OTHER}chapter-11/` }), { now: 1000 });
    await completeChapter(a!.chapterId!, "progress");
    await editSeries(a!.seriesId, { tags: ["Action"], notes: "A note" });
    await editSeries(b!.seriesId, { tags: ["Weekly"], notes: "B note" });
    await addToQueue(b!.seriesId);

    await mergeSeries(a!.seriesId, b!.seriesId);
    const all = await listSeries();
    expect(all).toHaveLength(1);
    const s = all[0]!;
    expect(s.sourceIds).toHaveLength(2);
    expect(s.alternateTitles).toContain("Only I Level Up");
    expect(s.tags).toEqual(["Action", "Weekly"]);
    expect(s.notes).toContain("A note");
    expect(s.notes).toContain("B note");
    expect(s.discoveredAt).toBe(1000);
    expect(s.summary.lastCompletedLabel).toBe("Chapter 10");
    // Chapter 10 was opened most recently, but Continue points past the completed frontier.
    expect(s.summary.currentLabel).toBe("Chapter 10");
    expect(s.summary.continueLabel).toBe("Chapter 11");
    expect(s.summary.continueKind).toBe("resume");
    expect(await listChapters(s.id)).toHaveLength(2);
    expect((await listEvents({ seriesId: s.id })).length).toBe(3);
    expect(await getQueue()).toEqual([s.id]);
  });

  it("split moves a source with its chapters into a new series", async () => {
    const a = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL, alts: ["Only I Level Up"] }));
    const b = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: OTHER, label: "Chapter 3", url: `${OTHER}chapter-3/`, alts: ["Only I Level Up"] }));
    expect(b?.seriesId).toBe(a?.seriesId);
    const newId = await splitSource(b!.sourceId);
    expect(newId).toBeTruthy();
    const split = await getSeries(newId!);
    expect(split?.summary.currentLabel).toBe("Chapter 3");
    expect(split?.keptSeparateFrom).toContain(a!.seriesId);
    expect((await getSeries(a!.seriesId))?.sourceIds).toHaveLength(1);
  });

  it("removing a source keeps its progress on the remaining source", async () => {
    const a = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 1", url: slChapter(1), alts: ["Only I Level Up"] }));
    const b = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: OTHER, label: "Chapter 2", url: `${OTHER}chapter-2/`, alts: ["Only I Level Up"] }));
    await completeChapter(b!.chapterId!, "progress");
    await removeSource(b!.sourceId);
    const s = await getSeries(a!.seriesId);
    expect(s?.sourceIds).toHaveLength(1);
    expect(s?.summary.lastCompletedLabel).toBe("Chapter 2");
  });

  it("keep separate is remembered both ways", async () => {
    const a = await trackSeriesPage(seriesObs({ title: "X", url: SL }));
    const b = await trackSeriesPage(seriesObs({ title: "X", url: OTHER }));
    await keepSeparate(a!.seriesId, b!.seriesId);
    expect((await getSeries(a!.seriesId))?.keptSeparateFrom).toContain(b!.seriesId);
    expect((await getSeries(b!.seriesId))?.keptSeparateFrom).toContain(a!.seriesId);
  });
});

describe("history", () => {
  it("clearing history keeps progress", async () => {
    const r = await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Chapter 1", url: slChapter(1) }));
    await completeChapter(r!.chapterId!, "progress");
    await clearSeriesHistory(r!.seriesId);
    expect(await listEvents({ seriesId: r!.seriesId })).toHaveLength(0);
    expect((await getSeries(r!.seriesId))?.summary.lastCompletedLabel).toBe("Chapter 1");
    await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Chapter 2", url: slChapter(2) }));
    await clearAllHistory();
    expect(await listEvents()).toHaveLength(0);
    expect(await listChapters(r!.seriesId)).toHaveLength(2);
  });
});

describe("covers", () => {
  const blob = (s: string) => new Blob([s], { type: "image/png" });

  it("custom cover survives new detections; removing it falls back; unused blobs are collected", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "X", url: SL }));
    const id = r!.seriesId;
    const d1 = await setDetectedCover(id, { blob: blob("d1"), mimeType: "image/png", origin: "detected" });
    expect((await getSeries(id))?.coverId).toBe(d1);
    await setCustomCover(id, { blob: blob("c"), mimeType: "image/png", origin: "custom" });
    const custom = (await getSeries(id))?.coverId;
    const d2 = await setDetectedCover(id, { blob: blob("d2"), mimeType: "image/png", origin: "detected" });
    let s = await getSeries(id);
    expect(s?.coverId).toBe(custom);
    expect(s?.detectedCoverId).toBe(d2);
    expect(await getCover(d1!)).toBeUndefined(); // old detected cover was garbage-collected
    await removeCustomCover(id);
    s = await getSeries(id);
    expect(s?.coverId).toBe(d2);
    expect(await getCover(custom!)).toBeUndefined();
    expect(await clearUnusedCovers()).toBe(0);
  });
});

describe("queue", () => {
  it("reorders without touching progress", () => {
    expect(moveInQueue(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveInQueue(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });
});
