import { describe, expect, it } from "vitest";
import { buildAnalytics, dayStart, readingSessions, shiftDay, type AnalyticsInput } from "../../src/shared/utils/analytics";
import { createChapter, createSeries } from "../../src/storage/schema";
import type { ReadingEvent } from "../../src/shared/types/models";
const now=new Date(2026,8,28,23,0).getTime();
function sample():AnalyticsInput {
 const s=createSeries({title:"River",now:now-30*86_400_000});s.summary.newCount=4;s.totalReadingTimeMs=3_600_000;
 const c=createChapter({seriesId:s.id,sourceId:"src",label:"Chapter 12",url:"https://example.com/novel/river/chapter-12"});
 return {series:[s],chapters:[c],events:[],sources:[]};
}
const time=(seriesId:string,start:number,duration=60_000,chapterId?:string):ReadingEvent=>({id:crypto.randomUUID(),seriesId,chapterId,type:"time",startedAt:start,timestamp:start+duration,durationMs:duration});
describe("truthful reading analytics",()=>{
 it("opens a large minute history without exceeding JavaScript argument limits",()=>{
  const input=sample(),s=input.series[0]!;const start=shiftDay(dayStart(now),-150);
  input.events=Array.from({length:150_000},(_,i)=>{const startedAt=start+Math.floor(i/1000)*86_400_000+(i%1000)*60_000;return {id:`minute-${i}`,seriesId:s.id,type:"time" as const,startedAt,timestamp:startedAt+60_000,durationMs:60_000};});
  const a=buildAnalytics(input,"7D",now);expect(a.days).toHaveLength(7);expect(a.time).toBe(6*1000*60_000);expect(a.sessions).toHaveLength(6);
 });
 it("preserves undated lifetime totals without spreading them over calendar days",()=>{
  const a=buildAnalytics(sample(),"30D",now);expect(a.time).toBe(0);expect(a.historicalTime).toBe(3_600_000);expect(a.days.every(d=>d.minutes===0)).toBe(true);expect(a.week.netBacklog).toBeUndefined();expect(a.catchupDays).toBeUndefined();expect(a.backlogEstimate).toBeUndefined();
 });
 it("splits measured minutes at local midnight and keeps the session continuous",()=>{
  const input=sample();const midnight=dayStart(now);input.events=[time(input.series[0]!.id,midnight-30_000)];
  const a=buildAnalytics(input,"7D",now);expect(a.days.find(d=>d.date===shiftDay(midnight,-1))?.minutes).toBe(.5);expect(a.days.find(d=>d.date===midnight)?.minutes).toBe(.5);expect(a.time).toBe(60_000);expect(a.sessions).toHaveLength(1);expect(a.currentStreak).toBe(2);
 });
 it("groups active sessions across series and starts another after a 15-minute gap",()=>{
  const times=[time("a",now-3_600_000),time("b",now-3_000_000),time("a",now-1_800_000)];
  const sessions=readingSessions(times);expect(sessions).toHaveLength(2);expect(sessions[0]?.duration).toBe(120_000);expect(sessions[0]?.seriesIds.size).toBe(2);
 });
 it("deduplicates chapters across sources, excludes manual corrections, and respects date ranges",()=>{
  const input=sample();const s=input.series[0]!,c=input.chapters[0]!;const copy={...c,id:"other",sourceId:"another"};input.chapters.push(copy);
  input.events=[{id:"a",seriesId:s.id,chapterId:c.id,type:"completed",timestamp:now-1000},{id:"b",seriesId:s.id,chapterId:copy.id,type:"completed",timestamp:now-500},{id:"manual",seriesId:s.id,chapterId:c.id,type:"manual-read",timestamp:now},{id:"old",seriesId:s.id,chapterId:c.id,type:"completed",timestamp:now-40*86_400_000}];
  expect(buildAnalytics(input,"7D",now).chapters).toBe(1);expect(buildAnalytics(input,"ALL",now).chapters).toBe(2);expect(buildAnalytics(input,"7D",now).time).toBe(0);
 });
 it("leaves missing backlog baselines unknown, carries recorded values, and computes rough pace",()=>{
  const input=sample(),s=input.series[0]!;input.events=[{id:"snapshot",seriesId:s.id,type:"backlog",backlogCount:6,timestamp:shiftDay(dayStart(now),-10)},{id:"done",seriesId:s.id,type:"completed",timestamp:now-500}];
  const a=buildAnalytics(input,"30D",now);expect(a.days[0]?.backlog).toBeUndefined();expect(a.days.at(-1)?.backlog).toBe(6);expect(a.week.netBacklog).toBe(-2);expect(a.catchupDays).toBe(28);
 });
 it("does not treat a high opened chapter or initial catalog as completed or released",()=>{
  const input=sample();input.series[0]!.summary.currentOrdinal=324;input.series[0]!.summary.chaptersKnown=100;input.chapters[0]!.chapterNumber=324;
  const a=buildAnalytics(input,"ALL",now);expect(a.retention.every(r=>r.reached===0)).toBe(true);expect(a.releases).toBe(0);expect(a.chapters).toBe(0);
 });
 it("deduplicates observed updates and derives source, genre, and time-of-day from measured data",()=>{
  const input=sample(),s=input.series[0]!,c=input.chapters[0]!;s.genres=["Fantasy"];s.personalRating=8;c.observedReleaseAt=now-3600_000;c.firstOpenedAt=now-600_000;c.completedAt=now-200_000;c.completionSource="progress";c.readingTimeMs=120_000;
  input.chapters.push({...c,id:"duplicate"});input.events=[time(s.id,now-60_000,60_000,c.id)];
  const a=buildAnalytics(input,"7D",now);expect(a.releases).toBe(1);expect(a.releaseDelay).toBe(3_000_000);expect(a.genreRows[0]?.rating).toBe(8);expect(a.hours.reduce((n,h)=>n+h,0)).toBe(60_000);expect(a.topHour).toBe(new Date(now-60_000).getHours());expect(a.backlogEstimate).toBe(480_000);
 });
});

it("retention excludes readers still accumulating history and distinguishes dropping before or after a threshold",()=>{
 const input=sample(),s=input.series[0]!;s.summary.chaptersKnown=60;s.summary.chaptersRead=5;
 const droppedEarly={...s,id:"early",status:"dropped" as const,summary:{...s.summary,chaptersRead:8}};
 const droppedLater={...s,id:"later",status:"dropped" as const,summary:{...s.summary,chaptersRead:28}};
 input.series.push(droppedEarly,droppedLater);
 const r=buildAnalytics(input,"ALL",now).retention;
 expect(r[0]).toMatchObject({threshold:10,total:2,reached:1});expect(r[1]).toMatchObject({threshold:25,total:2,reached:1});expect(r[2]).toMatchObject({threshold:50,total:2,reached:0});
});
