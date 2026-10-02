import { beforeEach, expect, it } from "vitest";
import { useDatabase, write } from "../../src/storage/db";
import { addManualSeries, moveChapter } from "../../src/storage/manual";
import { getSeries, listSeries, removeSeries } from "../../src/storage/repositories/series";
import { listSources, mergeChapterInto } from "../../src/storage/repositories/sources";
import { listChapters } from "../../src/storage/repositories/chapters";
import { listEvents } from "../../src/storage/repositories/history";
import { trackChapterOpened, trackSeriesPage, recordProgress } from "../../src/storage/tracking";
import { chapterObs, seriesObs, SL, slChapter } from "../helpers/obs";
import { applyImport, exportLibrary, parseBackup } from "../../src/storage/backup";
import { canonicalizeUrl } from "../../src/detection/normalization/url";
beforeEach(()=>useDatabase(`manual-${crypto.randomUUID()}`));
it("adds a series without fabricating opened or completed chapters",async()=>{
 const s=await addManualSeries({title:" My corrected title ",url:"https://unknown.example/series/my-story/?utm_source=test"});
 expect(s.title).toBe("My corrected title");expect(s.userFields).toContain("title");expect(s.lastOpenedChapterId).toBeUndefined();expect(await listChapters(s.id)).toHaveLength(0);
 expect((await listSources(s.id))[0]?.canonicalSeriesUrl).toBe("https://unknown.example/series/my-story");expect(s.summary.continueKind).toBe("series");
});
it("keeps existing data when the same URL is manually added twice",async()=>{
 const one=await addManualSeries({title:"First",url:SL});const two=await addManualSeries({title:"Accidental second title",url:SL});expect(two.id).toBe(one.id);expect(two.title).toBe("First");expect(await listSeries()).toHaveLength(1);
});
it("rejects unsafe URLs and missing titles without writing",async()=>{
 await expect(addManualSeries({title:"Title",url:"javascript:alert(1)"})).rejects.toThrow(/address/i);
 await expect(addManualSeries({title:" ",url:SL})).rejects.toThrow(/title/i);expect(await listSeries()).toHaveLength(0);
});
it("manual title and status survive subsequent automatic discovery",async()=>{
 const s=await addManualSeries({title:"User title",url:SL,status:"on-hold"});await trackSeriesPage(seriesObs({title:"Detected title",url:SL}));expect((await getSeries(s.id))?.title).toBe("User title");expect((await getSeries(s.id))?.status).toBe("on-hold");
});
it("moves a chapter and its events transactionally while preserving reading evidence",async()=>{
 const r=(await trackChapterOpened(chapterObs({title:"Wrong title",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)})))!;
 await recordProgress(r.chapterId!,{progress:.4,readingTimeDeltaMs:5000,threshold:.85});
 const target=await addManualSeries({title:"Correct title",url:"https://other.example/series/correct/"});const before=(await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!;
 await moveChapter(r.chapterId!,target.id);const moved=(await listChapters(target.id)).find(c=>c.id===r.chapterId)!;
 expect(moved.url).toBe(before.url);expect(moved.visitCount).toBe(before.visitCount);expect(moved.readingTimeMs).toBe(5000);expect(moved.maxProgress).toBe(.4);expect(await listChapters(r.seriesId)).not.toContainEqual(expect.objectContaining({id:r.chapterId}));
 expect((await listEvents({seriesId:target.id})).some(e=>e.chapterId===r.chapterId)).toBe(true);expect((await getSeries(target.id))?.summary.continueUrl).toBe(slChapter(31));
 const backup=parseBackup(JSON.stringify(await exportLibrary()));expect(backup.ok&&backup.invalid).toBe(0);
});
it("a reassociated chapter stays on the corrected series when the wrong detector/list repeats",async()=>{
 const obs=chapterObs({title:"Wrong title",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)});const r=(await trackChapterOpened(obs))!;
 const target=await addManualSeries({title:"Correct title",url:"https://other.example/series/correct/"});await moveChapter(r.chapterId!,target.id);
 const revisit=await trackChapterOpened(obs);expect(revisit?.seriesId).toBe(target.id);expect(revisit?.chapterId).toBe(r.chapterId);
 await trackSeriesPage(seriesObs({title:"Wrong title",url:SL,chapters:[{label:"Chapter 31",url:slChapter(31)}]}));expect((await listChapters(r.seriesId)).filter(c=>c.canonicalUrl===canonicalizeUrl(slChapter(31)))).toHaveLength(0);
});
it("rejects a destination source belonging to another series without moving anything",async()=>{
 const r=(await trackChapterOpened(chapterObs({title:"Wrong title",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)})))!;
 const target=await addManualSeries({title:"Correct title",url:"https://other.example/series/correct/"});await expect(moveChapter(r.chapterId!,target.id,r.sourceId)).rejects.toThrow(/source/i);expect((await listChapters(r.seriesId)).some(c=>c.id===r.chapterId)).toBe(true);
});

it.each(["merge", "replace"] as const)("%s import preserves a chapter's explicit association marker on an existing record", async mode => {
 const r=(await trackChapterOpened(chapterObs({title:"Title",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)})))!;
 const file=await exportLibrary();file.chapters.find(c=>c.id===r.chapterId)!.associationOverridden=true;
 await applyImport(file,mode);
 expect((await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)?.associationOverridden).toBe(true);
});

it("a corrected association survives a complete backup restore", async () => {
 const obs=chapterObs({title:"Wrong title",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)});
 const r=(await trackChapterOpened(obs))!;
 const target=await addManualSeries({title:"Correct title",url:"https://other.example/series/correct/"});await moveChapter(r.chapterId!,target.id);
 const file=parseBackup(JSON.stringify(await exportLibrary()));if(!file.ok)throw new Error(file.error);
 useDatabase(`restore-manual-${crypto.randomUUID()}`);await applyImport(file.file,"merge");
 const revisit=await trackChapterOpened(obs);expect(revisit?.seriesId).toBe(target.id);expect(revisit?.chapterId).toBe(r.chapterId);
});

it("does not silently duplicate a chapter already in the destination series", async () => {
 const obs=chapterObs({title:"Wrong",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)});
 const r=(await trackChapterOpened(obs))!;
 const target=await addManualSeries({title:"Correct",url:"https://other.example/series/correct"});
 const original=(await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!;
 const targetSource=(await listSources(target.id))[0]!;
 await write(["chapters"],t=>t.put("chapters",{...original,id:"already-there",seriesId:target.id,sourceId:targetSource.id}));
 await expect(moveChapter(original.id,target.id)).rejects.toThrow(/already contains/);
 expect((await listChapters(r.seriesId)).some(c=>c.id===original.id)).toBe(true);
 expect(await listChapters(target.id)).toHaveLength(1);
});

it("revisiting a corrected chapter restores a removed series with its original corrected identity", async () => {
 const obs=chapterObs({title:"Wrong",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)});const r=(await trackChapterOpened(obs))!;
 const target=await addManualSeries({title:"Correct",url:"https://other.example/series/correct"});await moveChapter(r.chapterId!,target.id);await removeSeries([target.id]);
 const revisit=await trackChapterOpened(obs);expect(revisit?.seriesId).toBe(target.id);expect(revisit?.restored).toBe(true);expect((await getSeries(target.id))?.removedAt).toBeUndefined();
});

it("source chapter merging retains an absorbed association correction", async () => {
 const r=(await trackChapterOpened(chapterObs({title:"Title",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)})))!;
 const c=(await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!;
 mergeChapterInto(c,{...c,associationOverridden:true});expect(c.associationOverridden).toBe(true);
});

it.each(["merge", "replace"] as const)("%s imports manual label/number corrections into an existing chapter without changing its identity", async mode => {
 const obs=chapterObs({title:"Title",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)});const r=(await trackChapterOpened(obs))!;
 const file=await exportLibrary();const c=file.chapters.find(c=>c.id===r.chapterId)!;
 Object.assign(c,{chapterLabel:"Chapter 30 corrected",title:"Chapter 30 corrected",chapterNumber:30,ordinal:30,userFields:["label","number"]});
 await applyImport(file,mode);await trackChapterOpened(obs);
 const result=(await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!;
 expect(result.chapterLabel).toBe("Chapter 30 corrected");expect(result.ordinal).toBe(30);expect(result.key).toBe(c.key);
 expect((await listChapters(r.seriesId)).filter(c=>c.canonicalUrl===canonicalizeUrl(obs.url))).toHaveLength(1);
});
