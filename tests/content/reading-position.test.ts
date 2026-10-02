// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureReadingPosition, restoreReadingPosition } from "../../src/content/reading-position";
import type { ReadingPosition } from "../../src/shared/types/models";

let y: number, height: number, reader: HTMLElement, scroll: ReturnType<typeof vi.fn>;
let imageHeight: number, imageTop: number;
const saved: ReadingPosition = { version: 1, capturedAt: 1, progressRevision: 0, readerOffset: 1800, readerHeight: 6000, viewportHeight: 600 };
const rect = (top: number, h: number) => ({ top, bottom: top + h, height: h, width: 600, left: 0, right: 600, x: 0, y: top, toJSON() {} });
beforeEach(() => {
  vi.useFakeTimers(); y = 0; height = 6000; imageHeight = 1000; imageTop = 2000;
  vi.stubGlobal("innerHeight", 600); vi.stubGlobal("scrollY", 0);
  document.body.innerHTML = '<div id="reader"><img src="/one.jpg"><img src="/two.jpg"></div>';
  reader = document.getElementById("reader")!;
  reader.getBoundingClientRect = () => rect(100-y, height);
  [...reader.querySelectorAll("img")].forEach((img,i) => { img.getBoundingClientRect = () => rect((i ? imageTop : 100)-y, imageHeight); Object.defineProperty(img,"complete",{configurable:true,get:()=>true}); });
  Object.defineProperty(document.documentElement,"scrollHeight",{configurable:true,get:()=>height+100});
  scroll = vi.fn((opts: ScrollToOptions) => { y = opts.top ?? 0; vi.stubGlobal("scrollY", y); });
  vi.stubGlobal("scrollTo", scroll);
});
afterEach(() => { window.dispatchEvent(new Event("pagehide")); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("captures a backward viewport independently from the furthest read position", () => {
  y=2600; vi.stubGlobal("scrollY",y);
  expect(captureReadingPosition(reader,3,5)).toMatchObject({readerOffset:2500,imageIndex:1,imageOffset:.6,progressRevision:3});
  y=600; vi.stubGlobal("scrollY",y);
  expect(captureReadingPosition(reader,3,6)).toMatchObject({readerOffset:500,imageIndex:0,imageOffset:.5,capturedAt:6});
});
it("captures a document fallback only when a meaningful reader is unavailable", () => {
  y=700; vi.stubGlobal("scrollY",y);
  expect(captureReadingPosition(null,0)).toMatchObject({readerOffset:700,readerHeight:6100});
  y=9000; expect(captureReadingPosition(reader,0)).toBeUndefined();
});
it("restores the image anchor again when late image dimensions change", async () => {
  const restoration=restoreReadingPosition({...saved,imageIndex:1,imageOffset:.4},()=>reader,()=>true);
  expect(y).toBe(2400);
  imageTop=3000; imageHeight=2000; height=8000;
  await vi.advanceTimersByTimeAsync(200);
  expect(y).toBe(3800);
  await vi.advanceTimersByTimeAsync(2000); await restoration.done;
  expect(scroll.mock.calls.length).toBe(2);
});
it("waits for a late SPA reader and cancels without moving after user input", async () => {
  height=100; let available=false;
  const restoration=restoreReadingPosition(saved,()=>available?reader:null,()=>true);
  expect(scroll).not.toHaveBeenCalled();
  height=6000; available=true; await vi.advanceTimersByTimeAsync(200); expect(y).toBe(1900);
  window.dispatchEvent(new Event("wheel"));
  expect(await restoration.done).toEqual({userInput:true});
  const calls=scroll.mock.calls.length; height=9000; await vi.advanceTimersByTimeAsync(500);
  expect(scroll).toHaveBeenCalledTimes(calls);
});
it("cancels on route changes and times out a permanently missing image", async () => {
  let current=true;
  const restoration=restoreReadingPosition({...saved,imageIndex:20,imageOffset:.4},()=>reader,()=>current);
  current=false; await vi.advanceTimersByTimeAsync(200); expect(await restoration.done).toEqual({userInput:false});
  expect(scroll).not.toHaveBeenCalled();
  const stuck=restoreReadingPosition({...saved,imageIndex:20,imageOffset:.4},()=>reader,()=>true);
  await vi.advanceTimersByTimeAsync(12000); expect(await stuck.done).toEqual({userInput:false});
});
