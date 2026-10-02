import { beforeEach, expect, it } from "vitest";
import { closeDb, useDatabase, read } from "../../src/storage/db";
import { recordProgress, trackChapterOpened } from "../../src/storage/tracking";
import { markChapters, updateReadingPosition } from "../../src/storage/repositories/chapters";
import { createChapter } from "../../src/storage/schema";
import { sanitizeReadingPosition } from "../../src/shared/reading-position";
import { chapterObs, SL, slChapter } from "../helpers/obs";
const position = (offset: number, at: number, revision=0) => ({ version: 1 as const, capturedAt: at, progressRevision: revision, readerOffset:offset, readerHeight:6000, viewportHeight:600 });
beforeEach(()=>useDatabase(`position-${crypto.randomUUID()}`));

it("persists the latest backward location after database reopen without reducing furthest progress", async()=>{
  const r=(await trackChapterOpened(chapterObs({title:"Solo",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)})))!;
  await recordProgress(r.chapterId!,{progress:.7,readingTimeDeltaMs:0,threshold:.85,readingPosition:position(4000,1)});
  await recordProgress(r.chapterId!,{progress:.2,readingTimeDeltaMs:0,threshold:.85,readingPosition:position(1000,2)});
  await closeDb();
  const c=await read(["chapters"],t=>t.get("chapters",r.chapterId!));
  expect(c).toMatchObject({maxProgress:.7,readingPosition:{readerOffset:1000,capturedAt:2}});
  expect(c).not.toHaveProperty("completedAt");
});
it("rejects stale, mismatched-revision and future-dated position evidence",async()=>{
  const c=createChapter({seriesId:"s",sourceId:"src",label:"31",url:slChapter(31)});
  updateReadingPosition(c,position(2000,20),30); updateReadingPosition(c,position(1000,10),30);
  updateReadingPosition(c,position(5000,30,1),30); updateReadingPosition(c,position(5000,100000),30);
  expect(c.readingPosition?.readerOffset).toBe(2000);
  const r=(await trackChapterOpened(chapterObs({title:"Solo",seriesUrl:SL,label:"31",url:slChapter(31)})))!;
  await markChapters(r.seriesId,[r.chapterId!],false);
  const res=await recordProgress(r.chapterId!,{progress:.7,progressRevision:0,readingTimeDeltaMs:0,threshold:.85,readingPosition:position(4000,1)});
  expect(res.stale).toBe(true);
  expect(await read(["chapters"],t=>t.get("chapters",r.chapterId!))).toMatchObject({maxProgress:0,progressRevision:1});
});
it.each([NaN,Infinity,-1,10000001])("rejects invalid coordinates %s instead of clamping hostile positions",value=>{
  expect(sanitizeReadingPosition({...position(10,1),readerHeight:value})).toBeUndefined();
});
it("returns only documented fields and rejects malformed anchors",()=>{
  expect(sanitizeReadingPosition({...position(10,1),selector:"script"})).toEqual(position(10,1));
  expect(sanitizeReadingPosition({...position(10,1),imageIndex:.5})).toBeUndefined();
  expect(sanitizeReadingPosition({...position(10,1),imageOffset:.5})).toBeUndefined();
});

it("a position-only checkpoint still honors a newly lowered completion threshold", async () => {
  const r=(await trackChapterOpened(chapterObs({title:"Solo",seriesUrl:SL,label:"31",url:slChapter(31)})))!;
  await recordProgress(r.chapterId!,{progress:.9,readingTimeDeltaMs:0,threshold:.95,readingPosition:position(4000,1)});
  const result=await recordProgress(r.chapterId!,{progress:.9,readingTimeDeltaMs:0,threshold:.85,readingPosition:position(3000,2)});
  expect(result.completed).toBe(true);
  expect(await read(["chapters"],t=>t.get("chapters",r.chapterId!))).toHaveProperty("completedAt");
});
