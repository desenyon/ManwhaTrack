import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleMessage } from "../../src/background/messages";
import { setTabState } from "../../src/background/tabs";
import { expectResume } from "../../src/background/resume";
import { trackChapterOpened, recordProgress } from "../../src/storage/tracking";
import { listChapters, markChapters } from "../../src/storage/repositories/chapters";
import { useDatabase } from "../../src/storage/db";
import { chapterObs, SL, slChapter } from "../helpers/obs";
import { DEFAULT_SETTINGS } from "../../src/shared/types/settings";

let data: Record<string,unknown>, navigations:string[], creates:string[], windows:string[];
beforeEach(()=>{
  useDatabase(`resume-${crypto.randomUUID()}`); data={}; navigations=[]; creates=[]; windows=[];
  const kv={get:async(k:string)=>({[k]:data[k]}),set:async(v:Record<string,unknown>)=>Object.assign(data,v),remove:async(k:string)=>{delete data[k]}};
  vi.stubGlobal("chrome",{runtime:{getURL:(p:string)=>`chrome-extension://test/${p}`},storage:{local:kv,session:kv,onChanged:{addListener(){}}},
    windows:{create:async(o:{url:string})=>{windows.push(o.url);return {id:2,tabs:[{id:7}]}}},
    tabs:{query:async()=>[{id:7}],create:async(o:{url:string})=>{creates.push(o.url);return {id:7}},update:async(id:number,o:{url:string})=>{expect(data['resume:7']).toBeDefined();navigations.push(o.url);return{id}}}});
});
afterEach(()=>vi.unstubAllGlobals());
async function visit(){
  const obs=chapterObs({title:"Solo",seriesUrl:SL,label:"Chapter 31",url:slChapter(31)});
  const r=(await trackChapterOpened(obs))!;
  await recordProgress(r.chapterId!,{progress:.5,threshold:.85,readingTimeDeltaMs:0,readingPosition:{version:1,capturedAt:Date.now(),progressRevision:0,readerOffset:2000,readerHeight:6000,viewportHeight:600}});
  await setTabState({tabId:7,observation:obs,chapterId:r.chapterId,seriesId:r.seriesId,updatedAt:Date.now()});
  const c=(await listChapters(r.seriesId)).find(c=>c.id===r.chapterId)!;
  const sender={tab:{id:7,url:slChapter(31)},url:slChapter(31),frameId:0} as chrome.runtime.MessageSender;
  return{r,c,sender};
}
it("creates a local session intent before navigation and consumes it only once",async()=>{
  const {r,c,sender}=await visit();
  await handleMessage({type:"continue/open",seriesId:r.seriesId,newTab:true},{url:"chrome-extension://test/sidepanel.html"});
  expect(creates).toEqual(["about:blank"]); expect(navigations).toEqual([slChapter(31)]);
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:0},sender)).toEqual({position:c.readingPosition});
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:0},sender)).toEqual({position:undefined});
});
it("ordinary chapter visits have no restore intent",async()=>{
  const {c,sender}=await visit();
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:0},sender)).toEqual({position:undefined});
});
it("rejects wrong chapter, route, frame, and manual-correction revision",async()=>{
  const {r,c,sender}=await visit(); await expectResume(7,c,c.url);
  expect(await handleMessage({type:"chapter/resume-position",chapterId:"another",progressRevision:0},sender)).toEqual({});
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:0},{...sender,url:slChapter(32)})).toEqual({});
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:0},{...sender,frameId:2})).toEqual({});
  expect(data["resume:7"]).toBeDefined();
  await markChapters(r.seriesId,[c.id],false);
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:1},sender)).toEqual({position:undefined});
});
it("rejects expired intents after a worker lifetime and hostile position messages",async()=>{
  const {c,sender}=await visit();await expectResume(7,c,c.url);
  (data["resume:7"] as {at:number}).at-=121000;
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:0},sender)).toEqual({position:undefined});
  const response=await handleMessage({type:"chapter/progress",chapterId:c.id,progress:1,readingTimeDeltaMs:0,readingPosition:{...c.readingPosition!,readerOffset:-1}},sender);
  expect(response).toEqual({completed:false});
});
it("clears a reused-tab intent for ordinary source or next-chapter navigation",async()=>{
  const {c}=await visit();await expectResume(7,c,c.url);
  await expectResume(7,undefined,c.url);
  expect(data["resume:7"]).toBeUndefined();
});
it.each(["ignored", "incognito"])("does not expose a saved position to a %s page",async(policy)=>{
  const {c,sender}=await visit(); await expectResume(7,c,c.url);
  data.settings={...DEFAULT_SETTINGS,ignoredHosts:policy==='ignored'?['example-scans.com']:[],trackIncognito:false};
  const blocked=policy==='incognito'?{...sender,tab:{...sender.tab,incognito:true} as chrome.tabs.Tab}:sender;
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:0},blocked)).toEqual({});
});

it("opens Resume in a separate window and registers position before navigation",async()=>{
  const {r,c,sender}=await visit();
  await handleMessage({type:"continue/open",seriesId:r.seriesId,newTab:false,newWindow:true},{url:"chrome-extension://test/library.html"});
  expect(windows).toEqual(["about:blank"]); expect(creates).toEqual([]); expect(navigations).toEqual([c.url]);
  expect(await handleMessage({type:"chapter/resume-position",chapterId:c.id,progressRevision:0},sender)).toEqual({position:c.readingPosition});
});
