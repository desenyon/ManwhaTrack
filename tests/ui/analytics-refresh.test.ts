// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api=vi.hoisted(()=>({ records:vi.fn(),subscribe:vi.fn() }));
vi.mock("../../src/storage/repositories/analytics",()=>({analyticsRecords:api.records}));
vi.mock("../../src/shared/bus",()=>({subscribe:api.subscribe}));
import { AnalyticsView } from "../../src/sidepanel/views/AnalyticsView";
import { createSeries } from "../../src/storage/schema";
import type { ReadingEvent } from "../../src/shared/types/models";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const now=new Date(2026,9,3,12).getTime();
const series=createSeries({title:"River",now});
const records=(count=0)=>({chapters:[],sources:[],events:Array.from({length:count},(_,i)=>({id:`done-${i}`,seriesId:series.id,type:"completed",chapterLabel:`Chapter ${i+1}`,timestamp:now-i} satisfies ReadingEvent))});
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);api.subscribe.mockImplementation(()=>()=>{});
 vi.stubGlobal("matchMedia",vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();vi.resetAllMocks();});
async function render(s=series){await act(async()=>root.render(createElement(AnalyticsView,{series:[s],onBack:vi.fn(),onOpenSeries:vi.fn(),onAnalyzeSeries:vi.fn()})));}
async function changed(wait=500){await act(async()=>{api.subscribe.mock.calls[0]![0]({type:"library-changed"});await vi.advanceTimersByTimeAsync(wait);});}
const completed=()=>host.querySelectorAll(".analytics-metrics dd")[1]?.textContent;
it("refreshes during a sustained stream of progress messages rather than waiting for reading to stop",async()=>{
 api.records.mockResolvedValue(records());await render();api.records.mockResolvedValue(records(2));
 for(let n=0;n<5;n++)await changed(200);
 expect(api.records.mock.calls.length).toBeGreaterThan(1);expect(completed()).toBe("2");
});
it("reports a failed refresh without discarding the last data and allows retry",async()=>{
 api.records.mockResolvedValueOnce(records(1)).mockRejectedValueOnce(new Error("busy"));await render();await changed();
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be refreshed");expect(completed()).toBe("1");
 api.records.mockResolvedValueOnce(records(2));const retry=[...host.querySelectorAll("button")].find(b=>b.textContent==="Retry")!;
 await act(async()=>retry.click());expect(host.querySelector('[role="alert"]')).toBeNull();expect(completed()).toBe("2");
});
it("does not let an older read replace a newer completed snapshot",async()=>{
 api.records.mockResolvedValueOnce(records());await render();let resolve!:(r:ReturnType<typeof records>)=>void;
 api.records.mockReturnValueOnce(new Promise(r=>{resolve=r;})).mockResolvedValueOnce(records(2));
 await changed();await changed();expect(completed()).toBe("2");await act(async()=>resolve(records(1)));expect(completed()).toBe("2");
});
it("keeps sub-second measurement differences out of the historical-time notice",async()=>{
 api.records.mockResolvedValue(records());await render({...series,totalReadingTimeMs:750});
 expect(host.textContent).not.toContain("of earlier reading");
});
