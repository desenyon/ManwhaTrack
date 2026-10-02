// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api=vi.hoisted(()=>({preview:vi.fn(),apply:vi.fn()}));
vi.mock("../../src/storage/backup",()=>({
 parseBackup:(text:string)=>({ok:true,file:{marker:text}}),previewImport:api.preview,applyImport:api.apply,
 exportLibrary:vi.fn(),toCsv:vi.fn(),
}));
vi.mock("../../src/storage/repositories/series",()=>({listSeries:async()=>[],purgeSeriesNow:vi.fn(),restoreSeries:vi.fn()}));
vi.mock("../../src/shared/bus",()=>({publish:vi.fn()}));
import { DataSection } from "../../src/options/views/Data";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const preview=(series:number)=>({series,newSeries:series,duplicates:[],chapters:0,events:0,covers:0,invalid:0});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve}}
async function mount(){const host=document.createElement("div");document.body.append(host);const root=createRoot(host);await act(async()=>root.render(createElement(DataSection)));const input=host.querySelector<HTMLInputElement>('input[type="file"]')!;return{host,input,cleanup:async()=>{await act(async()=>root.unmount());host.remove()}}}
async function select(input:HTMLInputElement,text:()=>Promise<string>){Object.defineProperty(input,"files",{configurable:true,value:[{size:1,text}]});await act(async()=>input.dispatchEvent(new Event("change",{bubbles:true})))}
it("imports the latest selection when an older file finishes reading later",async()=>{
 api.preview.mockImplementation(async(file:{marker:string})=>preview(file.marker==="A"?1:2));api.apply.mockResolvedValue({added:2,merged:0,skipped:0});const ui=await mount();const a=deferred<string>();
 try{await select(ui.input,()=>a.promise);await select(ui.input,async()=>"B");await act(async()=>a.resolve("A"));
 await act(async()=>[...ui.host.querySelectorAll("button")].find(b=>b.textContent==="Import")!.click());expect(api.apply.mock.lastCall?.[0]).toEqual({marker:"B"});
 }finally{await ui.cleanup();vi.clearAllMocks()}
});
it("ignores a stale preview after a newer backup has been selected",async()=>{
 const a=deferred<ReturnType<typeof preview>>();api.preview.mockImplementation((file:{marker:string})=>file.marker==="A"?a.promise:Promise.resolve(preview(2)));const ui=await mount();
 try{await select(ui.input,async()=>"A");await select(ui.input,async()=>"B");await act(async()=>a.resolve(preview(1)));expect(ui.host.textContent).toContain("2 series (2 new");
 }finally{await ui.cleanup();vi.clearAllMocks()}
});
