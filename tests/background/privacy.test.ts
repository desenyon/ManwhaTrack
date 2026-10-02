import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useDatabase, Tx, read } from "../../src/storage/db";
import { handleMessage } from "../../src/background/messages";
import { trackChapterOpened } from "../../src/storage/tracking";
import { listChapters } from "../../src/storage/repositories/chapters";
import { saveSettings } from "../../src/storage/repositories/settings";
import { chapterObs, SL, slChapter } from "../helpers/obs";
import { setTabState } from "../../src/background/tabs";
let data: Record<string, unknown>;
let settingsChanged: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let pauseTabRead: (() => Promise<void>) | undefined;
beforeEach(() => {
  useDatabase(`privacy-${crypto.randomUUID()}`); data = {}; pauseTabRead = undefined;
  const kv = { get: async (k: string) => { if (k === "tab:7" && pauseTabRead) await pauseTabRead(); return {[k]:data[k]}; }, set: async (values:Record<string,unknown>)=>Object.assign(data, values), remove:async(k:string)=>{ delete data[k] } };
  vi.stubGlobal('chrome',{storage:{local:kv,session:kv,onChanged:{addListener:(fn:typeof settingsChanged)=>{settingsChanged=fn}}},tabs:{query:async()=>[]},action:{setBadgeBackgroundColor:async()=>{},setBadgeText:async()=>{}}});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function visit(incognito = false){
  const obs=chapterObs({title:'Solo Leveling',seriesUrl:SL,label:'Chapter 31',url:slChapter(31),next:slChapter(32)});
  const r=(await trackChapterOpened(obs))!;
  await setTabState({tabId:7,observation:obs,seriesId:r.seriesId,chapterId:r.chapterId,updatedAt:Date.now()});
  return {r,sender:{tab:{id:7,incognito,url:slChapter(31)},frameId:0} as chrome.runtime.MessageSender};
}
it('rejects progress after incognito tracking is disabled',async()=>{
  const {r,sender}=await visit(true);await saveSettings({trackIncognito:false});
  await handleMessage({type:'chapter/progress',chapterId:r.chapterId!,progress:1,readingTimeDeltaMs:10_000},sender);
  const c=(await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!;expect(c.maxProgress).toBe(0);expect(c.readingTimeMs).toBe(0);expect(c.completedAt).toBeUndefined();
});
it('rejects next-link completion on ignored hosts',async()=>{
  const {r,sender}=await visit();await saveSettings({ignoredHosts:['example-scans.com']});
  await handleMessage({type:'chapter/next-clicked',chapterId:r.chapterId!},sender);
  expect((await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!.completedAt).toBeUndefined();
});
it('rejects a content message for another tab chapter',async()=>{
  const {r,sender}=await visit();const other=(await trackChapterOpened(chapterObs({title:'Solo Leveling',seriesUrl:SL,label:'Chapter 32',url:slChapter(32)})))!;
  await handleMessage({type:'chapter/progress',chapterId:other.chapterId!,progress:1,readingTimeDeltaMs:10000},sender);
  expect((await listChapters(r.seriesId)).find(c=>c.id===other.chapterId)!.completedAt).toBeUndefined();
});

it.each(['chapter/progress','chapter/next-clicked'] as const)('rejects %s when settings are revoked during tab authorization',async(type)=>{
 const {r,sender}=await visit(true);await saveSettings({trackIncognito:true});
 let resume!:()=>void;pauseTabRead=()=>new Promise<void>(resolve=>{resume=resolve});
 const pending=handleMessage(type==='chapter/progress'?{type,chapterId:r.chapterId!,progress:1,readingTimeDeltaMs:5000}:{type,chapterId:r.chapterId!},sender);
 while(!resume)await Promise.resolve();await saveSettings({trackIncognito:false});
 resume();pauseTabRead=undefined;await pending;
 const c=(await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!;expect(c.maxProgress).toBe(0);expect(c.readingTimeMs).toBe(0);expect(c.completedAt).toBeUndefined();
});

it.each(['chapter/progress','chapter/next-clicked','page/observed'] as const)('rolls back %s when revocation arrives between real IDB mutations',async(type)=>{
 const {r,sender}=await visit(true);const settings=await saveSettings({trackIncognito:true});
 const beforeEvents=await read(['events'],t=>t.count('events'));
 const original=Tx.prototype.put;let puts=0;
 vi.spyOn(Tx.prototype,'put').mockImplementation(async function<T>(this:Tx,store:Parameters<Tx['put']>[0],value:T){
   const result=await original.call(this,store,value);
   if(++puts===1){const revoked={...settings,trackIncognito:false};data.settings=revoked;settingsChanged({settings:{newValue:revoked}},'local');}
   return result;
 });
 const observation=chapterObs({title:'Solo Leveling',seriesUrl:SL,label:'Chapter 31',url:slChapter(31)});
 await handleMessage(type==='chapter/progress'?{type,chapterId:r.chapterId!,progress:1,readingTimeDeltaMs:5000}:type==='chapter/next-clicked'?{type,chapterId:r.chapterId!}:{type,observation},sender);
 const c=(await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!;
 expect(puts).toBe(1);expect(c.maxProgress).toBe(0);expect(c.readingTimeMs).toBe(0);expect(c.completedAt).toBeUndefined();expect(c.visitCount).toBe(1);
 expect(await read(['events'],t=>t.count('events'))).toBe(beforeEvents);
});

it('updates the authorized live clock without adding the same time to chapter totals',async()=>{
 const {r,sender}=await visit();
 expect(await handleMessage({type:'chapter/activity',chapterId:r.chapterId!,active:true,sessionMs:3200},sender)).toEqual({ok:true});
 expect((data['tab:7'] as {readingActivity:unknown}).readingActivity).toMatchObject({active:true,sessionMs:3200,chapterId:r.chapterId});
 expect((await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!.readingTimeMs).toBe(0);
 await handleMessage({type:'chapter/progress',chapterId:r.chapterId!,progress:.2,readingTimeDeltaMs:3200},sender);
 expect((await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!.readingTimeMs).toBe(3200);
});
it.each(['ignored','incognito','foreign','invalid'] as const)('rejects %s live clock updates',async(reason)=>{
 const {r,sender}=await visit(reason==='incognito');
 if(reason==='ignored')await saveSettings({ignoredHosts:['example-scans.com']});
 const result=await handleMessage({type:'chapter/activity',chapterId:reason==='foreign'?'foreign':r.chapterId!,active:true,sessionMs:reason==='invalid'?NaN:3200},sender);
 expect(result).toEqual({ok:false});
 expect((data['tab:7'] as {readingActivity?:unknown}).readingActivity).toBeUndefined();
});
