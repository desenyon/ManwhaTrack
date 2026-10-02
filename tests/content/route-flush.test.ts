// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { chapterObs, SL, slChapter } from '../helpers/obs';
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings';
const state = vi.hoisted(() => ({ route: undefined as undefined | ((reason: string)=>void), bottom: 200, defer: false, resume: false, revision:0, changed:undefined as undefined | ((changes:Record<string,unknown>,area:string)=>void), messages: [] as Record<string, unknown>[] }));
vi.mock('../../src/content/observer',()=>({watchPage:(run:(reason:string)=>void)=>{state.route=run;return {stop(){},settle(){}}}}));
vi.mock('../../src/detection',()=>({detectPage:()=>chapterObs({title:'Solo Leveling',seriesUrl:SL,label:'Chapter 31',url:slChapter(31)}),mightBeReadingPage:()=>true,readerContainerFor:()=>document.querySelector('#reader'),pagedProgressFor:()=>null}));
let handlers: {type:string;listener:EventListenerOrEventListenerObject}[];
beforeEach(()=>{
 vi.resetModules();vi.useFakeTimers();handlers=[];Object.assign(state,{bottom:200,defer:false,resume:false,revision:0,changed:undefined,messages:[],route:undefined});
 history.replaceState({},'', '/chapter-31');document.body.innerHTML='<div id="reader"></div>';
 document.querySelector<HTMLElement>('#reader')!.getBoundingClientRect=()=>({top:-state.bottom,bottom:6000-state.bottom,height:6000,width:600,left:0,right:600,x:0,y:-state.bottom,toJSON(){}});
 vi.spyOn(document,'hasFocus').mockReturnValue(true);
 const add=window.addEventListener.bind(window);vi.spyOn(window,'addEventListener').mockImplementation((type,listener,options)=>{handlers.push({type,listener});add(type,listener,options)});
 vi.stubGlobal('chrome',{runtime:{id:'test',sendMessage:async(m:Record<string,unknown>)=>{state.messages.push(m);if(m.type==='chapter/resume-position'&&state.resume)return{position:{version:1,capturedAt:1,progressRevision:0,readerOffset:1800,readerHeight:6000,viewportHeight:600}};if(m.type==='chapter/state')return{progress:0,progressRevision:state.revision};if(m.type==='page/observed'){if(state.defer)return new Promise(()=>{});return {ok:true,tracked:{chapterId:'c',seriesId:'s',seriesTitle:'Solo Leveling'}}}return {}},onMessage:{addListener(){}}},extension:{inIncognitoContext:false},storage:{local:{get:async()=>({settings:{...DEFAULT_SETTINGS,showTrackingToast:false}})},onChanged:{addListener:(fn:typeof state.changed)=>{state.changed=fn}}}});
});

it('manual unread cancels settling restore before old evidence can move or complete the reader',async()=>{
 state.resume=true;const scroll=vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 Object.defineProperty(document.documentElement,'scrollHeight',{configurable:true,value:6100});
 await import('../../src/content/index');await settle();expect(scroll).toHaveBeenCalled();
 state.revision=1;state.changed!({'reading:revision':{newValue:{seriesId:'s'}}},'local');await settle();
 const calls=scroll.mock.calls.length;state.bottom=5500;await vi.advanceTimersByTimeAsync(20000);
 expect(scroll).toHaveBeenCalledTimes(calls);
 expect(state.messages.some(m=>m.type==='chapter/progress')).toBe(false);
});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));for(const h of handlers)window.removeEventListener(h.type,h.listener);vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
it('flushes the real reader pending time before suspending on pagehide',async()=>{
 await import('../../src/content/index');await settle();await vi.advanceTimersByTimeAsync(10000);
 const before=state.messages.filter(m=>m.type==='chapter/progress').length;
 window.dispatchEvent(new Event('pagehide'));await settle();
 const sent=state.messages.filter(m=>m.type==='chapter/progress');expect(sent.length).toBe(before+1);expect(sent.at(-1)).toMatchObject({final:true});expect(sent.reduce((sum,m)=>sum+Number(m.readingTimeDeltaMs),0)).toBe(10000);
});
it('stops the old reader while a new route observation awaits acknowledgement',async()=>{
 await import('../../src/content/index');await settle();state.defer=true;
 history.replaceState({},'', '/chapter-32');state.route!('url');state.bottom=5500;
 window.dispatchEvent(new Event('scroll'));await vi.advanceTimersByTimeAsync(15000);
 expect(state.messages.filter(m=>m.type==='chapter/progress' && Number(m.progress)>=.85)).toEqual([]);
});

it('does not measure replaced route DOM before the watcher fires, but flushes earlier queued evidence',async()=>{
 await import('../../src/content/index');await settle();await vi.advanceTimersByTimeAsync(10000);state.defer=true;
 history.replaceState({},'', '/chapter-32');state.bottom=5500;
 window.dispatchEvent(new Event('scroll'));await vi.advanceTimersByTimeAsync(300);
 state.route!('url');await settle();
 const sent=state.messages.filter(m=>m.type==='chapter/progress');
 expect(sent.some(m=>Number(m.progress)>=.85)).toBe(false);expect(sent.at(-1)).toMatchObject({final:true});expect(sent.reduce((sum,m)=>sum+Number(m.readingTimeDeltaMs),0)).toBe(10000);
});
