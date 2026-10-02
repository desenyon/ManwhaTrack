// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReaderProgress, type ProgressSink } from "../../src/content/reader-progress";
import { captureReadingPosition } from "../../src/content/reading-position";

let active = true;
let bottom = 200;
let tracker: ReaderProgress;
let container: HTMLElement;
let sink: ReturnType<typeof vi.fn<ProgressSink>>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockImplementation(() => active);
  active = true;
  bottom = 200;
  document.body.innerHTML = '<div id="reader"></div>';
  container = document.querySelector('#reader')!;
  container.getBoundingClientRect = () => ({ top: -bottom, bottom: 6000 - bottom, height: 6000, width: 600, left: 0, right: 600, x: 0, y: -bottom, toJSON() {} });
  sink = vi.fn<ProgressSink>();
  tracker = new ReaderProgress(() => container, .85, sink);
});
afterEach(() => { tracker.stop(false); vi.useRealTimers(); vi.restoreAllMocks(); });
it('does not count reading time while the browser window is unfocused', () => {
  tracker.start(); active = false; vi.advanceTimersByTime(20_000);
  tracker.stop();
  expect(sink.mock.calls.reduce((sum, [u]) => sum + u.readingTimeDeltaMs, 0)).toBe(0);
});
it('does not count reading time outside the meaningful reader', () => {
  bottom = -8000; tracker.start(); vi.advanceTimersByTime(20_000); tracker.stop();
  expect(sink.mock.calls.reduce((sum, [u]) => sum + u.readingTimeDeltaMs, 0)).toBe(0);
});
it('cancels queued measurements when the chapter tracker stops', () => {
  tracker.start(); window.dispatchEvent(new Event('scroll')); tracker.stop(); const calls = sink.mock.calls.length;
  bottom = 5500; vi.advanceTimersByTime(500);
  expect(sink.mock.calls.length).toBe(calls);
});
it('can restart after pagehide and measures only its new active lifetime', () => {
  tracker.start(); window.dispatchEvent(new Event('pagehide')); tracker.start(); vi.advanceTimersByTime(10_000);
  expect(sink.mock.calls.some(([u]) => u.readingTimeDeltaMs > 0)).toBe(true);
});

it('manual unread at the old end position cannot immediately re-complete', () => {
  bottom = 5500; tracker.reset(0); tracker.start(); vi.advanceTimersByTime(10_000);
  expect(sink.mock.calls.every(([u]) => u.progress < .85)).toBe(true);
  bottom = 200; window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(300);
  bottom = 5500; window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(300);
  expect(sink.mock.calls.some(([u]) => u.progress >= .85)).toBe(true);
});

it('final flush saves an upward scroll before its debounce even when furthest progress stays unchanged', () => {
  tracker = new ReaderProgress(() => container,.85,sink,()=>null,()=>true,()=>captureReadingPosition(container,0));
  bottom=4000; tracker.start(); bottom=1000; window.dispatchEvent(new Event('scroll')); tracker.stop();
  expect(sink.mock.calls.at(-1)![0]).toMatchObject({readingPosition:{readerOffset:1000},final:true});
  expect(sink.mock.calls.at(-1)![0].progress).toBeGreaterThan(.6);
});
it('restoration and programmatic scroll cannot add progress, completion or reading time', () => {
  bottom=5500; tracker.waitForActivity(); tracker.start(); window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20000);
  expect(sink).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('wheel')); vi.advanceTimersByTime(300);
  expect(sink.mock.calls.some(([u])=>u.progress>=.85)).toBe(true);
});

it('durably checkpoints a short backward reading session before the tab closes', () => {
  tracker = new ReaderProgress(() => container,.85,sink,()=>null,()=>true,()=>captureReadingPosition(container,0));
  tracker.start(); bottom=3100; window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(600);
  expect(sink.mock.calls.at(-1)?.[0].readingPosition?.readerOffset).toBe(3100);
  bottom=1700; window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(350);
  expect(sink.mock.calls.at(-1)?.[0].readingPosition?.readerOffset).toBe(1700);
});
it('coalesces continual scrolling and checkpoints the trailing settled position', () => {
  tracker = new ReaderProgress(() => container,.85,sink,()=>null,()=>true,()=>captureReadingPosition(container,0));
  tracker.start();
  for(let i=0;i<20;i++){bottom+=50;window.dispatchEvent(new Event('scroll'));vi.advanceTimersByTime(50)}
  vi.advanceTimersByTime(300);
  expect(sink.mock.calls.length).toBeLessThanOrEqual(4);
  expect(sink.mock.calls.at(-1)?.[0].readingPosition?.readerOffset).toBe(bottom);
});
it('measures the latest viewport immediately when the page becomes hidden', () => {
  tracker = new ReaderProgress(() => container,.85,sink,()=>null,()=>true,()=>captureReadingPosition(container,0));
  tracker.start();bottom=1700;window.dispatchEvent(new Event('scroll'));
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(sink.mock.calls.at(-1)?.[0].readingPosition?.readerOffset).toBe(1700);
  expect(sink.mock.calls.at(-1)?.[0].progress).toBeGreaterThan(.3);
});

it('checkpoints real wheel input even when its activity timer coalesces the scroll event', () => {
  tracker = new ReaderProgress(() => container,.85,sink,()=>null,()=>true,()=>captureReadingPosition(container,0));
  tracker.start();window.dispatchEvent(new Event('wheel'));bottom=1700;window.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(350);
  expect(sink.mock.calls.at(-1)?.[0].readingPosition?.readerOffset).toBe(1700);
});

it('records a short active reading session before the first periodic tick', () => {
  tracker.start(); vi.advanceTimersByTime(650); tracker.stop();
  expect(sink.mock.calls.reduce((sum, [u]) => sum + u.readingTimeDeltaMs, 0)).toBe(650);
});

it('flushes active time on blur and excludes the unfocused interval', () => {
  tracker.start(); vi.advanceTimersByTime(1500);
  active = false; window.dispatchEvent(new Event('blur'));
  expect(sink.mock.calls.reduce((sum, [u]) => sum + u.readingTimeDeltaMs, 0)).toBe(1500);
  vi.advanceTimersByTime(10000); active = true; window.dispatchEvent(new Event('focus'));
  vi.advanceTimersByTime(750); tracker.stop();
  expect(sink.mock.calls.reduce((sum, [u]) => sum + u.readingTimeDeltaMs, 0)).toBe(2250);
});

it('reports measured session time and pauses after inactivity', () => {
  const live = vi.fn();
  tracker = new ReaderProgress(() => container, .85, sink, () => null, () => true, () => undefined, live);
  tracker.start(); vi.advanceTimersByTime(2000);
  expect(live.mock.calls.at(-1)?.[0]).toMatchObject({ active: true, sessionMs: 2000 });
  vi.advanceTimersByTime(100000);
  expect(live.mock.calls.at(-1)?.[0]).toMatchObject({ active: false, sessionMs: 90000 });
});

it('keeps measured time when progress is manually corrected', () => {
  tracker.start(); vi.advanceTimersByTime(2000); tracker.reset(0);
  vi.advanceTimersByTime(1000); tracker.stop();
  expect(sink.mock.calls.reduce((sum, [u]) => sum + u.readingTimeDeltaMs, 0)).toBe(3000);
});

it('pauses active time when no connected reader content is available', () => {
  tracker = new ReaderProgress(() => null, .85, sink);
  tracker.start(); vi.advanceTimersByTime(5000); tracker.stop();
  expect(sink.mock.calls.reduce((sum, [u]) => sum + u.readingTimeDeltaMs, 0)).toBe(0);
});
