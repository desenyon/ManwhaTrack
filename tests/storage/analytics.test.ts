import { beforeEach, describe, expect, it } from "vitest";
import { chapterObs, freshDb, seriesObs, SL, slChapter } from "../helpers/obs";
import { applyUpdateCheck, recordProgress, trackChapterOpened, trackSeriesPage } from "../../src/storage/tracking";
import { editSeries, getSeries } from "../../src/storage/repositories/series";
import { analyticsRecords } from "../../src/storage/repositories/analytics";
import { listEvents } from "../../src/storage/repositories/history";
import { exportLibrary, parseBackup, applyImport } from "../../src/storage/backup";
import { closeDb } from "../../src/storage/db";

beforeEach(()=>freshDb());
describe("dated local activity",()=>{
  it("splits minute boundaries, aggregates heartbeats, retains totals and survives reopen",async()=>{
    const r=await trackChapterOpened(chapterObs({title:"Solo",seriesUrl:SL,label:"Chapter 1",url:slChapter(1)}));
    const end=Date.UTC(2026,8,28,23,59,50);
    await recordProgress(r!.chapterId!,{progress:.2,readingTimeDeltaMs:20_000,threshold:.85},end);
    await recordProgress(r!.chapterId!,{progress:.3,readingTimeDeltaMs:20_000,threshold:.85},end+20_000);
    await closeDb();
    const records=await analyticsRecords();const timed=records.events.filter(e=>e.type==="time");
    expect(timed).toHaveLength(2);expect(timed.reduce((n,e)=>n+e.durationMs!,0)).toBe(40_000);
    expect(timed.every(e=>e.durationMs!<=e.timestamp-e.startedAt!)).toBe(true);
    expect((await getSeries(r!.seriesId))!.totalReadingTimeMs).toBe(40_000);
    expect((await listEvents()).some(e=>e.type==="time" || e.type==="backlog")).toBe(false);
    const parsed=parseBackup(JSON.stringify(await exportLibrary()));expect(parsed.ok).toBe(true);
    if(parsed.ok) {freshDb();await applyImport(parsed.file,"merge");expect((await analyticsRecords()).events.filter(e=>e.type==="time")).toHaveLength(2);}
  });
  it("rejects stale, revoked, zero and non-finite measurements",async()=>{
    const r=await trackChapterOpened(chapterObs({title:"Solo",seriesUrl:SL,label:"Chapter 1",url:slChapter(1)}));
    for(const delta of [0,NaN,Infinity,-1]) await recordProgress(r!.chapterId!,{progress:.1,readingTimeDeltaMs:delta,threshold:.85});
    await recordProgress(r!.chapterId!,{progress:.4,readingTimeDeltaMs:5000,threshold:.85,progressRevision:20});
    await recordProgress(r!.chapterId!,{progress:.4,readingTimeDeltaMs:5000,threshold:.85,shouldWrite:()=>false});
    expect((await analyticsRecords()).events.filter(e=>e.type==="time")).toHaveLength(0);
  });
  it("only labels new updates after a catalog baseline and keeps daily backlog samples",async()=>{
    const links=(n:number)=>Array.from({length:n},(_,i)=>({label:`Chapter ${i+1}`,url:slChapter(i+1)}));
    const r=await trackSeriesPage(seriesObs({title:"Solo",url:SL,chapters:links(2)}),100_000);
    expect((await analyticsRecords()).chapters.every(c=>c.observedReleaseAt===undefined)).toBe(true);
    await applyUpdateCheck(r!.sourceId,{ok:true,chapters:links(3)},200_000);
    const rec=await analyticsRecords();expect(rec.chapters.filter(c=>c.observedReleaseAt)).toHaveLength(1);
    expect(rec.chapters.find(c=>c.chapterNumber===3)?.observedReleaseAt).toBe(200_000);
    expect(rec.events.filter(e=>e.type==="backlog")).toHaveLength(1);
  });
});
describe("novel identity and corrections",()=>{
  it("keeps same-named adaptations separate and preserves explicit format and genres",async()=>{
    const comic=seriesObs({title:"A Story",url:SL,alts:["Another name"]});comic.series!.format="manhwa";
    const a=await trackSeriesPage(comic);
    const novel=seriesObs({title:"A Story",url:"https://example-scans.com/novel/a-story/",alts:["Another name"]});novel.series!.format="novel";novel.series!.genres=["Fantasy"];
    const b=await trackSeriesPage(novel);expect(b!.seriesId).not.toBe(a!.seriesId);
    expect((await getSeries(b!.seriesId))?.format).toBe("novel");
    await editSeries(b!.seriesId,{format:"manhwa",genres:["My genre"]});
    await trackSeriesPage(novel);
    const s=await getSeries(b!.seriesId);expect(s?.format).toBe("manhwa");expect(s?.genres).toEqual(["My genre"]);
  });
});

it("merges a growing minute bucket on repeated backup import without double counting",async()=>{
 freshDb();const r=await trackChapterOpened(chapterObs({title:"Solo",seriesUrl:SL,label:"Chapter 1",url:slChapter(1)}));
 const t=Date.UTC(2026,8,28,12,0,10);await recordProgress(r!.chapterId!,{progress:.2,readingTimeDeltaMs:5000,threshold:.85},t);
 const first=await exportLibrary();await recordProgress(r!.chapterId!,{progress:.3,readingTimeDeltaMs:5000,threshold:.85},t+5000);const second=await exportLibrary();
 freshDb();await applyImport(first,"merge");await applyImport(second,"merge");await applyImport(second,"merge");
 const records=await analyticsRecords();expect(records.events.filter(e=>e.type==="time").reduce((n,e)=>n+e.durationMs!,0)).toBe(10_000);expect((await getSeries(r!.seriesId))?.totalReadingTimeMs).toBe(10_000);
});
