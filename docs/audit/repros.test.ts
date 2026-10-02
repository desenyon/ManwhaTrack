import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { freshDb, chapterObs, seriesObs, SL, slChapter } from "../../tests/helpers/obs";
import { trackChapterOpened, trackSeriesPage, recordProgress, completeChapter, applyUpdateCheck } from "../../src/storage/tracking";
import { listChapters, editChapter, markChapters } from "../../src/storage/repositories/chapters";
import { getSeries, removeSeries } from "../../src/storage/repositories/series";
import { exportLibrary, parseBackup, applyImport } from "../../src/storage/backup";
import { mergeSeries, removeSource, listSources } from "../../src/storage/repositories/sources";
import { saveSettings } from "../../src/storage/repositories/settings";
import { handleMessage } from "../../src/background/messages";

beforeEach(() => freshDb());
afterEach(() => vi.unstubAllGlobals());
const observation = () => chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 31", url: slChapter(31), next: slChapter(32) });

it("repeated merge import preserves counters", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await recordProgress(r.chapterId!, { progress: 0.2, readingTimeDeltaMs: 10_000, threshold: 0.85 });
  const file = await exportLibrary();
  await applyImport(file, "merge");
  const ch = (await listChapters(r.seriesId)).find(c => c.id === r.chapterId)!;
  console.log("audit repeated import", { visits: ch.visitCount, readingTimeMs: ch.readingTimeMs });
  expect(ch.visitCount).toBe(1);
  expect(ch.readingTimeMs).toBe(10_000);
});

it("rediscovery preserves corrected chapter identity", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await editChapter(r.chapterId!, { label: "Chapter 30" });
  await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL, chapters: [{ label: "Chapter 31", url: slChapter(31) }] }));
  const records = (await listChapters(r.seriesId)).filter(c => c.url === slChapter(31));
  console.log("audit corrected identity", records.map(c => ({ key: c.key, label: c.chapterLabel, url: c.url })));
  expect(records).toHaveLength(1);
});

it("lowering manual progress does not immediately recomplete chapters", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await markChapters(r.seriesId, [r.chapterId!], true);
  const { setProgressTo } = await import("../../src/storage/repositories/chapters");
  await setProgressTo(r.seriesId, "30");
  await recordProgress(r.chapterId!, { progress: 0, readingTimeDeltaMs: 0, threshold: 0.85 });
  const c = (await listChapters(r.seriesId)).find(c => c.id === r.chapterId)!;
  console.log("audit manual rollback", { completed: !!c.completedAt, progress: c.maxProgress });
  expect(c.completedAt).toBeUndefined();
});

it("export contains no dependents of omitted removed series", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await removeSeries([r.seriesId]);
  const file = await exportLibrary();
  const parsed = parseBackup(JSON.stringify(file));
  console.log("audit removed export", { series: file.series.length, sources: file.sources.length, chapters: file.chapters.length, history: file.history.length, invalid: parsed.ok ? parsed.invalid : parsed.error });
  expect(file.sources).toHaveLength(0);
  expect(file.chapters).toHaveLength(0);
  expect(file.history).toHaveLength(0);
});

it("completed special chapter continues through its next link", async () => {
  const r = (await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Prologue", url: `${SL}prologue/`, next: slChapter(1) })))!;
  await completeChapter(r.chapterId!, "next-link");
  const s = (await getSeries(r.seriesId))!;
  console.log("audit special continue", { kind: s.summary.continueKind, url: s.summary.continueUrl });
  expect(s.summary.continueUrl).toBe(slChapter(1));
});

it("removing a source does not continue to that source", async () => {
  const r = (await trackChapterOpened(observation()))!;
  const b = (await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: "https://other.example/series/solo/" })))!;
  await mergeSeries(r.seriesId, b.seriesId);
  await removeSource(r.sourceId);
  const s = (await getSeries(r.seriesId))!;
  console.log("audit source removal", { hosts: (await listSources(r.seriesId)).map(x => x.hostname), continueUrl: s.summary.continueUrl });
  expect(new URL(s.summary.continueUrl!).hostname).toBe("other.example");
});

it("a settings import error does not commit the library", async () => {
  await trackChapterOpened(observation());
  const file = await exportLibrary();
  file.settings = { theme: "dark" };
  freshDb();
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({}), set: async () => { throw new Error("simulated settings write failure"); } } } });
  await expect(applyImport(file, "merge", { importSettings: true })).rejects.toThrow("simulated settings write failure");
  const committed = await getSeries(file.series[0]!.id);
  console.log("audit partial import", { libraryCommittedDespiteError: !!committed });
  expect(committed).toBeUndefined();
});

it("progress from incognito is rejected when disabled", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await saveSettings({ trackIncognito: false });
  await handleMessage({ type: "chapter/progress", chapterId: r.chapterId!, progress: 0.2, readingTimeDeltaMs: 10_000 }, { tab: { incognito: true } } as chrome.runtime.MessageSender);
  const c = (await listChapters(r.seriesId)).find(c => c.id === r.chapterId)!;
  console.log("audit incognito progress", { progress: c.maxProgress, readingTimeMs: c.readingTimeMs });
  expect(c.maxProgress).toBe(0);
  expect(c.readingTimeMs).toBe(0);
});

it("an unrelated redirect does not pollute a tracked series", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await applyUpdateCheck(r.sourceId, {
    ok: true,
    title: "Unrelated Series",
    finalUrl: "https://example-scans.com/manga/unrelated-series/",
    chapters: [{ label: "Chapter 999", url: "https://example-scans.com/manga/unrelated-series/chapter-999/" }],
  });
  const c = (await listChapters(r.seriesId)).filter(c => c.chapterNumber === 999);
  console.log("audit unrelated redirect", { unrelatedChaptersSaved: c.length });
  expect(c).toHaveLength(0);
});
