import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { freshDb, chapterObs, seriesObs, SL, slChapter } from "../../tests/helpers/obs";
import { trackChapterOpened, trackSeriesPage, recordProgress, completeChapter, applyUpdateCheck } from "../../src/storage/tracking";
import { listChapters, editChapter, markChapters } from "../../src/storage/repositories/chapters";
import { getSeries, removeSeries } from "../../src/storage/repositories/series";
import { exportLibrary, parseBackup, applyImport } from "../../src/storage/backup";
import { mergeSeries, removeSource, listSources } from "../../src/storage/repositories/sources";
import { saveSettings } from "../../src/storage/repositories/settings";


beforeEach(() => freshDb());
afterEach(() => vi.unstubAllGlobals());
const observation = () => chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Chapter 31", url: slChapter(31), next: slChapter(32) });

it("repeated merge import preserves counters", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await recordProgress(r.chapterId!, { progress: 0.2, readingTimeDeltaMs: 10_000, threshold: 0.85 });
  const file = await exportLibrary();
  await applyImport(file, "merge");
  const ch = (await listChapters(r.seriesId)).find(c => c.id === r.chapterId)!;
  expect(ch.visitCount).toBe(1);
  expect(ch.readingTimeMs).toBe(10_000);
});

it("rediscovery preserves corrected chapter identity", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await editChapter(r.chapterId!, { label: "Chapter 30" });
  await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: SL, chapters: [{ label: "Chapter 31", url: slChapter(31) }] }));
  const records = (await listChapters(r.seriesId)).filter(c => c.url === slChapter(31));
  expect(records).toHaveLength(1);
});

it("lowering manual progress does not immediately recomplete chapters", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await markChapters(r.seriesId, [r.chapterId!], true);
  const { setProgressTo } = await import("../../src/storage/repositories/chapters");
  await setProgressTo(r.seriesId, "30");
  await recordProgress(r.chapterId!, { progress: 0, readingTimeDeltaMs: 0, threshold: 0.85 });
  const c = (await listChapters(r.seriesId)).find(c => c.id === r.chapterId)!;
  expect(c.completedAt).toBeUndefined();
});

it("export contains no dependents of omitted removed series", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await removeSeries([r.seriesId]);
  const file = await exportLibrary();
  const parsed = parseBackup(JSON.stringify(file));
  expect(file.sources).toHaveLength(0);
  expect(file.chapters).toHaveLength(0);
  expect(file.history).toHaveLength(0);
});

it("completed special chapter continues through its next link", async () => {
  const r = (await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: SL, label: "Prologue", url: `${SL}prologue/`, next: slChapter(1) })))!;
  await completeChapter(r.chapterId!, "next-link");
  const s = (await getSeries(r.seriesId))!;
  expect(s.summary.continueUrl).toBe(slChapter(1));
});

it("removing a source does not continue to that source", async () => {
  const r = (await trackChapterOpened(observation()))!;
  const b = (await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: "https://other.example/series/solo/" })))!;
  await mergeSeries(r.seriesId, b.seriesId);
  await removeSource(r.sourceId);
  const s = (await getSeries(r.seriesId))!;
  expect(new URL(s.summary.continueUrl!).hostname).toBe("other.example");
});

it("a settings failure reports committed library accurately", async () => {
  await trackChapterOpened(observation());
  const file = await exportLibrary();
  file.settings = { theme: "dark" };
  freshDb();
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({}), set: async () => { throw new Error("simulated settings write failure"); } } } });
  const result = await applyImport(file, "merge", { importSettings: true });
  expect(result.settingsWarning).toBe("Library imported, but settings could not be saved. Your existing settings were kept.");
  const committed = await getSeries(file.series[0]!.id);
  expect(committed).toBeDefined();
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
  expect(c).toHaveLength(0);
});

it("manual unread invalidates stale progress and next-link completion across database restart", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await recordProgress(r.chapterId!, { progress: 0.6, readingTimeDeltaMs: 1000, threshold: 0.85 });
  await markChapters(r.seriesId, [r.chapterId!], false);
  const { closeDb } = await import("../../src/storage/db");
  closeDb();
  const stale = await recordProgress(r.chapterId!, { progress: 1, readingTimeDeltaMs: 1000, threshold: 0.85, progressRevision: 0 });
  expect(stale.stale).toBe(true);
  expect(await completeChapter(r.chapterId!, "next-link", Date.now(), 0)).toBe(false);
  const c = (await listChapters(r.seriesId)).find(c => c.id === r.chapterId)!;
  expect(c.maxProgress).toBe(0);
  expect(c.completedAt).toBeUndefined();
  expect(c.readingTimeMs).toBe(1000);
  expect(c.progressRevision).toBe(1);
  const opened = (await trackChapterOpened(observation()))!;
  expect(opened.chapterProgressRevision).toBe(1);
  expect(opened.chapterProgress).toBe(0);
  expect((await recordProgress(c.id, { progress: 0.3, readingTimeDeltaMs: 10, threshold: 0.85, progressRevision: 1 })).stale).toBeUndefined();
});

it("lowering progress resets automatic completions as well as manual ones", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await recordProgress(r.chapterId!, { progress: 1, readingTimeDeltaMs: 0, threshold: 0.85 });
  const { setProgressTo } = await import("../../src/storage/repositories/chapters");
  await setProgressTo(r.seriesId, "30");
  const c = (await listChapters(r.seriesId)).find(c => c.id === r.chapterId)!;
  expect(c.completedAt).toBeUndefined();
  expect(c.maxProgress).toBe(0);
  expect(c.progressRevision).toBe(1);
});

it("removed source history remains round-trip portable with original URLs", async () => {
  const r = (await trackChapterOpened(observation()))!;
  const b = (await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: "https://other.example/series/solo/" })))!;
  await mergeSeries(r.seriesId, b.seriesId);
  await removeSource(r.sourceId);
  const file = await exportLibrary();
  expect(file.sources.find(s => s.id === r.sourceId)?.removedAt).toBeDefined();
  expect(file.chapters.find(c => c.id === r.chapterId)?.sourceId).toBe(r.sourceId);
  expect(parseBackup(JSON.stringify(file))).toMatchObject({ ok: true, invalid: 0 });
  freshDb();
  await applyImport(file, "merge");
  expect((await getSeries(r.seriesId))?.summary.continueUrl).toBe("https://other.example/series/solo/");
});

it("repeated snapshot import preserves event IDs and counters", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await recordProgress(r.chapterId!, { progress: 0.2, readingTimeDeltaMs: 100, threshold: 0.85 });
  const file = await exportLibrary();
  await applyImport(file, "merge");
  await applyImport(file, "merge");
  const after = await exportLibrary();
  expect(after.history.map(e => e.id)).toEqual(file.history.map(e => e.id));
  expect(after.chapters.find(c => c.id === r.chapterId)).toMatchObject({ visitCount: 1, readingTimeMs: 100 });
});

it("progress invalidation notification failure does not roll back committed manual unread", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await completeChapter(r.chapterId!, "progress");
  vi.stubGlobal("chrome", { storage: { local: { set: async () => { throw new Error("notification failed"); } } } });
  await expect(markChapters(r.seriesId, [r.chapterId!], false)).resolves.toBeUndefined();
  expect((await listChapters(r.seriesId)).find(c => c.id === r.chapterId)).toMatchObject({ maxProgress: 0, progressRevision: 1, completedAt: undefined });
});

it("legacy backups explicitly migrate with revision defaults", async () => {
  await trackChapterOpened(observation());
  const file = await exportLibrary();
  file.exportVersion = 1;
  file.schemaVersion = 1;
  for (const c of file.chapters) delete c.progressRevision;
  const parsed = parseBackup(JSON.stringify(file));
  expect(parsed).toMatchObject({ ok: true, invalid: 0, file: { exportVersion: 5, schemaVersion: 6 } });
  if (parsed.ok) expect(parsed.file.chapters.every(c => c.progressRevision === 0)).toBe(true);
});

it("source removal prefers matching remaining chapter and preserves historical URL", async () => {
  const r = (await trackChapterOpened(observation()))!;
  const url = "https://other.example/series/solo/chapter-31/";
  const b = (await trackChapterOpened(chapterObs({ title: "Solo Leveling", seriesUrl: "https://other.example/series/solo/", label: "Chapter 31", url })))!;
  await mergeSeries(r.seriesId, b.seriesId);
  await trackChapterOpened(observation());
  await removeSource(r.sourceId);
  expect((await getSeries(r.seriesId))?.summary.continueUrl).toBe(url);
  expect((await listChapters(r.seriesId)).find(c => c.id === r.chapterId)?.url).toBe(slChapter(31));
});

it("unrelated update rejection records source failure without successful timestamp", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await applyUpdateCheck(r.sourceId, { ok: true, title: "Another work", finalUrl: SL, chapters: [] }, 100);
  expect((await listSources(r.seriesId))[0]).toMatchObject({ consecutiveFailures: 1, lastCheckedAt: 100, lastError: "Update page does not match the tracked series." });
  expect((await listSources(r.seriesId))[0]?.lastSuccessfulCheckAt).toBeUndefined();
});

it("Replace import invalidates in-flight progress when restoring unread state", async () => {
  const r = (await trackChapterOpened(observation()))!;
  const backup = await exportLibrary();
  backup.chapters.find(c => c.id === r.chapterId)!.progressRevision = 5;
  await recordProgress(r.chapterId!, { progress: 0.9, readingTimeDeltaMs: 20, threshold: 0.85, progressRevision: 0 });
  const set = vi.fn(async () => undefined);
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({}), set } } });
  await applyImport(backup, "replace");
  const before = (await exportLibrary()).history.length;
  const result = await recordProgress(r.chapterId!, { progress: 1, readingTimeDeltaMs: 500, threshold: 0.85, progressRevision: 0 });
  expect(result.stale).toBe(true);
  const chapter = (await listChapters(r.seriesId)).find(c => c.id === r.chapterId)!;
  expect(chapter).toMatchObject({ completedAt: undefined, maxProgress: 0, progressRevision: 6, readingTimeMs: 20 });
  expect((await exportLibrary()).history).toHaveLength(before);
  expect(set).toHaveBeenCalledWith({ "reading:revision": expect.objectContaining({ seriesId: r.seriesId }) });
});

it("merge preserves newer local manual unread over old completed snapshot", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await completeChapter(r.chapterId!, "progress");
  const old = await exportLibrary();
  await markChapters(r.seriesId, [r.chapterId!], false);
  await applyImport(old, "merge");
  expect((await listChapters(r.seriesId)).find(c => c.id === r.chapterId)).toMatchObject({ completedAt: undefined, maxProgress: 0, progressRevision: 1 });
});

it("merge applies newer imported manual correction and invalidates current observation", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await completeChapter(r.chapterId!, "progress");
  const file = await exportLibrary();
  Object.assign(file.chapters.find(c => c.id === r.chapterId)!, { completedAt: undefined, completionSource: undefined, maxProgress: 0, progressRevision: 2 });
  await applyImport(file, "merge");
  expect((await listChapters(r.seriesId)).find(c => c.id === r.chapterId)).toMatchObject({ completedAt: undefined, maxProgress: 0, progressRevision: 3 });
});

it("Replace import restores both directions of existing source removal state", async () => {
  const r = (await trackChapterOpened(observation()))!;
  const b = (await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: "https://other.example/series/solo/" })))!;
  await mergeSeries(r.seriesId, b.seriesId);
  const active = await exportLibrary();
  await removeSource(r.sourceId);
  const removed = await exportLibrary();
  await applyImport(active, "replace");
  expect((await listSources(r.seriesId)).map(s => s.id)).toContain(r.sourceId);
  expect((await getSeries(r.seriesId))?.summary.continueUrl).toBe(slChapter(31));
  await applyImport(removed, "replace");
  expect((await listSources(r.seriesId)).map(s => s.id)).not.toContain(r.sourceId);
  expect((await getSeries(r.seriesId))?.summary.continueUrl).toBe("https://other.example/series/solo/");
  expect((await exportLibrary()).chapters.find(c => c.id === r.chapterId)?.sourceId).toBe(r.sourceId);
});

it("merge retains local corrections on equal revisions and removal wins either import direction", async () => {
  const r = (await trackChapterOpened(observation()))!;
  await markChapters(r.seriesId, [r.chapterId!], true);
  const completed = await exportLibrary();
  await markChapters(r.seriesId, [r.chapterId!], false);
  completed.chapters.find(c => c.id === r.chapterId)!.progressRevision = 2;
  await applyImport(completed, "merge");
  expect((await listChapters(r.seriesId)).find(c => c.id === r.chapterId)).toMatchObject({ completedAt: undefined, maxProgress: 0, progressRevision: 2 });
  const b = (await trackSeriesPage(seriesObs({ title: "Solo Leveling", url: "https://other.example/series/solo/" })))!;
  await mergeSeries(r.seriesId, b.seriesId);
  const active = await exportLibrary();
  await removeSource(r.sourceId);
  const removed = await exportLibrary();
  await applyImport(active, "merge");
  expect((await listSources(r.seriesId)).map(s => s.id)).not.toContain(r.sourceId);
  await applyImport(active, "replace");
  await applyImport(removed, "merge");
  expect((await listSources(r.seriesId)).map(s => s.id)).not.toContain(r.sourceId);
});

it("failed import notification leaves lowered progress committed and stale writes rejected", async () => {
  const r = (await trackChapterOpened(observation()))!;
  const file = await exportLibrary();
  await completeChapter(r.chapterId!, "progress");
  vi.stubGlobal("chrome", { storage: { local: { set: async () => { throw new Error("notify failed"); } } } });
  await expect(applyImport(file, "replace")).resolves.toMatchObject({ merged: 1 });
  expect((await recordProgress(r.chapterId!, { progress: 1, readingTimeDeltaMs: 100, threshold: 0.85, progressRevision: 0 })).stale).toBe(true);
  expect((await listChapters(r.seriesId)).find(c => c.id === r.chapterId)).toMatchObject({ completedAt: undefined, maxProgress: 0, progressRevision: 1 });
});
