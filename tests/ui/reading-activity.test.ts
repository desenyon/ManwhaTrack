// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useReadingActivity } from "../../src/ui/useReadingActivity";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("shows a heartbeat immediately between clock ticks and pauses when it expires", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let raw: Record<string, unknown> = {};
  let changed!: (changes: Record<string, unknown>, area: string) => void;
  const remove = vi.fn();
  vi.stubGlobal("chrome", { storage: { session: { get: async () => raw }, onChanged: { addListener: (fn: typeof changed) => { changed = fn; }, removeListener: remove } } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Clock() { const activity = useReadingActivity(); return createElement("output", { "data-active": !!activity?.active }, activity?.sessionMs ?? 0); }
  try {
    await act(async () => root.render(createElement(Clock)));
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    raw = { "tab:7": { tabId: 7, seriesId: "s", chapterId: "c", readingActivity: { chapterId: "c", sampledAt: 1500, active: true, sessionMs: 1400 } } };
    await act(async () => changed({ "tab:7": {} }, "session"));
    expect(host.querySelector("output")?.dataset.active).toBe("true");
    expect(host.textContent).toBe("1400");
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(host.querySelector("output")?.dataset.active).toBe("false");
    expect(host.textContent).toBe("1400");
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); }
  expect(remove).toHaveBeenCalledOnce();
});
