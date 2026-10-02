// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { chapterObs, SL, slChapter } from '../helpers/obs';
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings';
import type { ContentMessage } from '../../src/shared/messages';
const state = vi.hoisted(() => ({ starts: 0, discarded: 0, stops: 0, detect: undefined as undefined | (()=>void) }));
vi.mock('../../src/content/reader-progress',()=>({ReaderProgress:class {start(){state.starts++}stop(_final:boolean,discard:boolean){state.stops++;if(discard)state.discarded++}reset(){}}}));
vi.mock('../../src/content/observer',()=>({watchPage:(run:()=>void)=>{state.detect=run;return {stop(){},settle(){}}}}));
vi.mock('../../src/detection',async()=>({detectPage:()=>chapterObs({title:'Solo Leveling',seriesUrl:SL,label:'Chapter 31',url:slChapter(31)}),mightBeReadingPage:()=>true,readerContainerFor:()=>null,pagedProgressFor:()=>null}));
let onSettings: (c: Record<string, chrome.storage.StorageChange>, area:string)=>void;
let onMessage: (m:ContentMessage, sender:unknown, reply:()=>void)=>unknown;
let attempts:number, failOnce:boolean, moved:boolean;
let handlers: { type: string; listener: EventListenerOrEventListenerObject }[];
let stored:typeof DEFAULT_SETTINGS;
beforeEach(async()=>{
  vi.resetModules();vi.useFakeTimers();handlers=[];
  const add=window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type,listener,options)=>{handlers.push({type,listener});add(type,listener,options)});Object.assign(state,{starts:0,discarded:0,stops:0,detect:undefined});attempts=0;failOnce=false;moved=false;stored={...DEFAULT_SETTINGS,showTrackingToast:false};
  vi.stubGlobal('chrome',{runtime:{id:'test',sendMessage:async(m:{type:string})=>{if(m.type==='chapter/state' && moved)return {blocked:true};if(m.type==='page/observed'){attempts++;if(failOnce){failOnce=false;throw Error('worker restarting')}return {ok:true,tracked:{chapterId:'c',seriesId:'s',seriesTitle:'Solo Leveling',created:false,restored:false,progressRevision:0,progress:0}}}return {}},onMessage:{addListener:(fn:typeof onMessage)=>{onMessage=fn}}},extension:{inIncognitoContext:true},storage:{local:{get:async()=>({settings:stored})},onChanged:{addListener:(fn:typeof onSettings)=>{onSettings=fn}}}});
});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));for(const h of handlers)window.removeEventListener(h.type,h.listener);vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
it('retries a detection after a transient worker failure',async()=>{
  stored.trackIncognito=true;failOnce=true;await import('../../src/content/index');await settle();await vi.advanceTimersByTimeAsync(3000);await settle();
  expect(attempts).toBeGreaterThan(1);expect(state.starts).toBe(1);
});
it('stops active tracking without flushing when preferences revoke access',async()=>{
  stored.trackIncognito=true;await import('../../src/content/index');await settle();
  onSettings({settings:{newValue:{...stored,trackIncognito:false}}},'local');await settle();
  expect(state.discarded).toBe(1);
});
it('can enable tracking after initially disabled incognito startup',async()=>{
  await import('../../src/content/index');await settle();
  expect(state.starts).toBe(0);expect(typeof onSettings).toBe('function');
  onSettings({settings:{newValue:{...stored,trackIncognito:true}}},'local');await settle();expect(state.starts).toBe(1);
});
it('restarts detection on restored pages',async()=>{
  stored.trackIncognito=true;await import('../../src/content/index');await settle();window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));await settle();
  expect(attempts).toBe(2);expect(state.starts).toBe(2);
});

it('re-detects live chapter ownership after a manual reassociation',async()=>{
  stored.trackIncognito=true;await import('../../src/content/index');await settle();
  moved=true;onSettings({'reading:revision':{newValue:{seriesId:'s'}}},'local');await settle();
  expect(state.discarded).toBe(1);expect(attempts).toBe(2);expect(state.starts).toBe(2);
});
