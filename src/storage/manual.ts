// Explicit fallback/correction operations. Related metadata and history move atomically.
import type { Chapter, ReadingEvent, Series, SeriesSource, SeriesStatus } from "../shared/types/models";
import { SERIES_STATUSES } from "../shared/types/models";
import { canonicalizeUrl, isSafeHttpUrl, sourceHost } from "../detection/normalization/url";
import { write } from "./db";
import { createSeries, createSource } from "./schema";
import { getSeriesTx, putSeriesTx, refreshSeriesTx } from "./repositories/series";
import { notifyProgressChanged } from "./repositories/chapters";

export async function addManualSeries(input: { title: string; url: string; status?: SeriesStatus }): Promise<Series> {
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title || title.length > 200) throw new Error("Enter a title of 1–200 characters.");
  const url = input.url.trim();
  if (!isSafeHttpUrl(url)) throw new Error("Enter a valid http or https series address.");
  if (input.status && !SERIES_STATUSES.includes(input.status)) throw new Error("Choose a valid reading status.");
  const canonical = canonicalizeUrl(url);
  return write(["series", "sources", "chapters"], async t => {
    const source = await t.firstByIndex<SeriesSource>("sources", "canonicalSeriesUrl", canonical);
    if (source) {
      const existing = await getSeriesTx(t, source.seriesId);
      if (existing) {
        existing.removedAt = undefined;
        source.removedAt = undefined;
        await t.put("sources", source);
        await putSeriesTx(t, existing);
        return (await refreshSeriesTx(t, existing.id))!;
      }
    }
    const series = createSeries({ title, status: input.status ?? "planning" });
    series.userFields = input.status ? ["title", "status"] : ["title"];
    const added = createSource({ seriesId: series.id, seriesUrl: url });
    added.sourceTitle = title;
    series.preferredSourceId = added.id;
    await putSeriesTx(t, series);
    await t.put("sources", added);
    return (await refreshSeriesTx(t, series.id))!;
  });
}

export async function moveChapter(chapterId: string, targetSeriesId: string, targetSourceId?: string): Promise<void> {
  const oldSeriesId = await write(["series", "sources", "chapters", "events"], async t => {
    const chapter = await t.get<Chapter>("chapters", chapterId);
    const target = await getSeriesTx(t, targetSeriesId);
    if (!chapter || !target || target.removedAt) throw new Error("The chapter or destination series is no longer available.");
    if (chapter.seriesId === targetSeriesId && !targetSourceId) return chapter.seriesId;
    const duplicate = (await t.byIndex<Chapter>("chapters", "canonicalUrl", chapter.canonicalUrl)).find(c => c.id !== chapter.id && c.seriesId === target.id);
    if (duplicate) throw new Error("This series already contains that chapter. Merge the series to combine their history.");
    const host = sourceHost(chapter.url);
    const sources = (await t.byIndex<SeriesSource>("sources", "seriesId", target.id)).filter(s => !s.removedAt);
    let source = targetSourceId ? sources.find(s => s.id === targetSourceId) : sources.find(s => s.id === target.preferredSourceId && s.hostname === host) ?? sources.find(s => s.hostname === host);
    if (targetSourceId && (!source || source.hostname !== host)) throw new Error("Choose a source for this series on the chapter's website.");
    if (!source) {
      // The chapter URL is the only certain address. Do not invent its parent page or relabel its host.
      source = createSource({ seriesId: target.id, seriesUrl: chapter.url, inferred: true });
      source.sourceTitle = target.title;
      source.disabled = true;
      await t.put("sources", source);
    }
    const previousSeriesId = chapter.seriesId;
    chapter.seriesId = target.id;
    chapter.sourceId = source.id;
    chapter.associationOverridden = true;
    chapter.progressRevision = (chapter.progressRevision ?? 0) + 1;
    await t.put("chapters", chapter);
    const events = await t.byIndex<ReadingEvent>("events", "chapterId", chapter.id);
    for (const event of events) await t.put("events", { ...event, seriesId: target.id });
    await refreshSeriesTx(t, previousSeriesId);
    await refreshSeriesTx(t, target.id, s => {
      if (!s.currentChapterId) s.currentChapterId = chapter.id;
      if (chapter.lastOpenedAt && s.status === "planning" && !s.userFields.includes("status")) s.status = "reading";
    });
    return previousSeriesId;
  });
  await notifyProgressChanged(oldSeriesId);
  if (oldSeriesId !== targetSeriesId) await notifyProgressChanged(targetSeriesId);
}
