import { beforeEach, describe, expect, it } from "vitest";
import { chapterObs, freshDb, seriesObs, SL, slChapter } from "../helpers/obs";
import { completeChapter, recordProgress, trackChapterOpened, trackSeriesPage } from "../../src/storage/tracking";
import { editSeries, getSeries, listSeries } from "../../src/storage/repositories/series";
import { listChapters, markChapters, markReadUpTo, setProgressTo } from "../../src/storage/repositories/chapters";
import { listEvents } from "../../src/storage/repositories/history";
import { listSources } from "../../src/storage/repositories/sources";

const T = 0.85;

beforeEach(() => {
  freshDb();
});

describe("automatic series discovery", () => {
  it("creates a series and source from a series page, with chapter list", async () => {
    const r = await trackSeriesPage(
      seriesObs({ title: "Solo Leveling", url: SL, cover: "https://cdn.x/c.jpg", chapters: [1, 2, 3].map((n) => ({ label: `Chapter ${n}`, url: slChapter(n) })) }),
    );
    expect(r?.created).toBe(true);
    expect(r?.coverUrl).toBe("https://cdn.x/c.jpg");
    const s = await getSeries(r!.seriesId);
    expect(s?.title).toBe("Solo Leveling");
    expect(s?.status).toBe("planning");
    expect(s?.summary.chaptersKnown).toBe(3);
    expect(s?.summary.continueKind).toBe("series");
    expect(s?.summary.continueUrl).toBe(SL);
  });

  it("does not duplicate a series on revisit", async () => {
    await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: `${SL}?utm_source=x` }));
    expect(await listSeries()).toHaveLength(1);
    expect(await listSources()).toHaveLength(1);
  });

  it("creates the parent series from a chapter page when the series page was never visited", async () => {
    const r = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 31", url: slChapter(31), inferred: true }));
    const s = await getSeries(r!.seriesId);
    expect(s?.status).toBe("reading");
    expect(s?.summary.currentLabel).toBe("Chapter 31");
    expect(s?.summary.continueKind).toBe("resume");
    expect(s?.summary.continueUrl).toBe(slChapter(31));
  });

  it("uses a chapter page's share image as a cover only until one is cached", async () => {
    const obs = chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 1", url: slChapter(1) });
    obs.series!.coverCandidates = ["https://cdn.x/og.jpg"];
    const r = await trackChapterOpened(obs);
    expect(r?.coverUrl).toBe("https://cdn.x/og.jpg");
  });

  it("upgrades an inferred series URL when the real series page is seen", async () => {
    await trackChapterOpened(chapterObs({ title: "ORV", seriesUrl: "https://toon.net/orv-", label: "Chapter 1", url: "https://toon.net/orv-chapter-1/", inferred: true }));
    await trackSeriesPage(seriesObs({ title: "ORV", url: "https://toon.net/manga/orv/" }));
    const sources = await listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.canonicalSeriesUrl).toBe("https://toon.net/manga/orv");
    expect(sources[0]?.previousUrls).toContain("https://toon.net/orv-");
    expect(await listSeries()).toHaveLength(1);
  });

  it("never overwrites user-owned title or status", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL }));
    await editSeries(r!.seriesId, { title: "SL (my name)", status: "on-hold" });
    await trackSeriesPage(seriesObs({ title: "Solo Leveling [Updated]", url: SL }));
    await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 1", url: slChapter(1) }));
    const s = await getSeries(r!.seriesId);
    expect(s?.title).toBe("SL (my name)");
    expect(s?.detectedTitle).toBe("Solo Leveling");
    expect(s?.status).toBe("on-hold");
  });
});

describe("reading progress", () => {
  it("core flow: open 31, finish, click next → 31 completed, 32 current, Continue → 32", async () => {
    const o31 = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 31", url: slChapter(31), next: slChapter(32) }));
    let s = await getSeries(o31!.seriesId);
    expect(s?.summary.currentLabel).toBe("Chapter 31");
    expect(s?.summary.lastCompletedLabel).toBeUndefined();

    await recordProgress(o31!.chapterId!, { progress: 0.4, readingTimeDeltaMs: 60_000, threshold: T });
    s = await getSeries(o31!.seriesId);
    expect(s?.summary.currentProgress).toBeCloseTo(0.4);
    expect(s?.summary.lastCompletedLabel).toBeUndefined();

    const o32 = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 32", url: slChapter(32) }), { completedViaNext: o31!.chapterId });
    s = await getSeries(o32!.seriesId);
    expect(s?.summary.lastCompletedLabel).toBe("Chapter 31");
    expect(s?.summary.currentLabel).toBe("Chapter 32");
    expect(s?.summary.continueUrl).toBe(slChapter(32));
    expect(s?.summary.continueKind).toBe("resume");
    const types = (await listEvents({ seriesId: s!.id })).map((e) => e.type).sort();
    expect(types).toEqual(["completed", "opened", "opened"]);
  });

  it("opening a chapter does not mark it finished; reaching the threshold does", async () => {
    const r = await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 5", url: slChapter(5), next: slChapter(6) }));
    expect((await listChapters(r!.seriesId)).find((c) => c.id === r!.chapterId)?.completedAt).toBeUndefined();
    const p = await recordProgress(r!.chapterId!, { progress: 0.9, readingTimeDeltaMs: 1000, threshold: T });
    expect(p.completed).toBe(true);
    const s = await getSeries(r!.seriesId);
    expect(s?.summary.lastCompletedLabel).toBe("Chapter 5");
    // Next chapter was learned from the navigation link.
    expect(s?.summary.continueKind).toBe("next");
    expect(s?.summary.continueUrl).toBe(slChapter(6));
  });

  it("a next link past the site's latest chapter is not counted as new", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "X", url: SL, chapters: [1, 2].map((n) => ({ label: `Chapter ${n}`, url: slChapter(n) })) }));
    const o = await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Chapter 2", url: slChapter(2), next: slChapter(3) }));
    await recordProgress(o!.chapterId!, { progress: 1, readingTimeDeltaMs: 0, threshold: T });
    let s = await getSeries(r!.seriesId);
    expect(s?.summary.newCount).toBe(0);
    expect(s?.summary.caughtUp).toBe(true);
    expect(s?.summary.latestKnownLabel).toBe("Chapter 2");
    expect(s?.summary.continueUrl).toBe(slChapter(3)); // still the best place to continue
    // Once the chapter list confirms chapter 3, it counts.
    await trackSeriesPage(seriesObs({ title: "X", url: SL, chapters: [1, 2, 3].map((n) => ({ label: `Chapter ${n}`, url: slChapter(n) })) }));
    s = await getSeries(r!.seriesId);
    expect(s?.summary.newCount).toBe(1);
    expect(s?.summary.caughtUp).toBe(false);
  });

  it("a chapter learned from a link takes the site's label once opened", async () => {
    await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Episode 2", url: slChapter(2), next: slChapter(3) }));
    const r = await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Episode 3", url: slChapter(3) }));
    const labels = (await listChapters(r!.seriesId)).map((c) => c.chapterLabel);
    expect(labels).toEqual(["Episode 2", "Episode 3"]);
  });

  it("caps reading time per update and keeps max progress", async () => {
    const r = await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Chapter 1", url: slChapter(1) }));
    await recordProgress(r!.chapterId!, { progress: 0.5, readingTimeDeltaMs: 8 * 3600_000, threshold: T });
    await recordProgress(r!.chapterId!, { progress: 0.2, readingTimeDeltaMs: 0, threshold: T });
    const c = (await listChapters(r!.seriesId))[0]!;
    expect(c.readingTimeMs).toBe(15 * 60_000);
    expect(c.maxProgress).toBe(0.5);
  });

  it("repeated visits within the window count once", async () => {
    const obs = chapterObs({ title: "X", seriesUrl: SL, label: "Chapter 1", url: slChapter(1) });
    const r = await trackChapterOpened(obs, { now: 1000 });
    await trackChapterOpened(obs, { now: 2000 });
    await trackChapterOpened(obs, { now: 1000 + 31 * 60_000 });
    const c = (await listChapters(r!.seriesId))[0]!;
    expect(c.visitCount).toBe(2);
    expect((await listEvents({ seriesId: r!.seriesId })).filter((e) => e.type === "opened")).toHaveLength(2);
  });

  it("manual unread reverts completion and moves Continue back", async () => {
    const r = await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Chapter 1", url: slChapter(1), next: slChapter(2) }));
    await completeChapter(r!.chapterId!, "progress");
    await markChapters(r!.seriesId, [r!.chapterId!], false);
    const s = await getSeries(r!.seriesId);
    expect(s?.summary.lastCompletedLabel).toBeUndefined();
    expect(s?.summary.continueUrl).toBe(slChapter(1));
    const types = (await listEvents({ seriesId: r!.seriesId })).map((e) => e.type);
    expect(types).toContain("manual-unread");
  });

  it("mark all before X read, new-chapter count and caught-up state", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "X", url: SL, chapters: [1, 2, 3, 4, 5].map((n) => ({ label: `Chapter ${n}`, url: slChapter(n) })) }));
    const chapters = await listChapters(r!.seriesId);
    await markReadUpTo(r!.seriesId, chapters.find((c) => c.chapterLabel === "Chapter 3")!.id);
    let s = await getSeries(r!.seriesId);
    expect(s?.summary.chaptersRead).toBe(3);
    expect(s?.summary.newCount).toBe(2);
    expect(s?.summary.caughtUp).toBe(false);
    expect(s?.summary.continueUrl).toBe(slChapter(4));
    await markReadUpTo(r!.seriesId, chapters.find((c) => c.chapterLabel === "Chapter 5")!.id);
    s = await getSeries(r!.seriesId);
    expect(s?.summary.caughtUp).toBe(true);
    expect(s?.status).toBe("planning"); // never auto-completed
  });

  it("set progress to a chapter that is not known yet", async () => {
    const r = await trackSeriesPage(seriesObs({ title: "X", url: SL }));
    await setProgressTo(r!.seriesId, "50");
    const s = await getSeries(r!.seriesId);
    expect(s?.summary.lastCompletedLabel).toBe("50");
    expect(s?.summary.lastCompletedOrdinal).toBe(50);
  });

  it("decimal and special chapters are tracked with their original labels", async () => {
    const r = await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Chapter 12.5", url: slChapter("12-5") }));
    await trackChapterOpened(chapterObs({ title: "X", seriesUrl: SL, label: "Side Story 4", url: `${SL}side-story-4/` }));
    const labels = (await listChapters(r!.seriesId)).map((c) => c.chapterLabel);
    expect(labels).toEqual(["Chapter 12.5", "Side Story 4"]);
  });
});

describe("persistence", () => {
  it("data survives closing and reopening the database", async () => {
    const { closeDb } = await import("../../src/storage/db");
    const r = await trackChapterOpened(chapterObs({ title: "Persisted", seriesUrl: SL, label: "Chapter 2", url: slChapter(2) }));
    await closeDb();
    const s = await getSeries(r!.seriesId);
    expect(s?.title).toBe("Persisted");
    expect(s?.summary.currentLabel).toBe("Chapter 2");
  });
});
