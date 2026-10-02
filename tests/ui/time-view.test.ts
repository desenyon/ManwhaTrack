// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Chapter, Series } from "../../src/shared/types/models";
import type { BusMessage } from "../../src/shared/bus";
const state = vi.hoisted(() => ({ chapters: [] as Chapter[], changed: undefined as undefined | ((message: BusMessage) => void), off: vi.fn() }));
vi.mock("../../src/storage/repositories/chapters", () => ({ allChapters: async () => structuredClone(state.chapters) }));
vi.mock("../../src/shared/bus", () => ({ subscribe: (fn: (message: BusMessage) => void) => { state.changed = fn; return state.off; } }));
vi.mock("../../src/sidepanel/components/ReadingTimer", () => ({ ReadingTimer: () => null }));
import { TimeView } from "../../src/sidepanel/views/TimeView";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("shows real totals, sorts series by time, excludes removed/unknown entries, and refreshes saves", async () => {
  const series = [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }, { id: "gone", title: "Removed", removedAt: 1 }] as Series[];
  state.chapters = [
    { id: "a1", seriesId: "a", chapterLabel: "Chapter 1", readingTimeMs: 1200 },
    { id: "a2", seriesId: "a", chapterLabel: "Chapter 2", readingTimeMs: 1900 },
    { id: "a3", seriesId: "a", chapterLabel: "Chapter 3", readingTimeMs: 0 },
    { id: "b1", seriesId: "b", chapterLabel: "Chapter 1", readingTimeMs: 8000 },
    { id: "deleted", seriesId: "gone", readingTimeMs: 51000 },
    { id: "unknown", seriesId: "missing", readingTimeMs: 99000 },
  ] as Chapter[];
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(TimeView, { series, onBack: vi.fn(), onOpenSeries: vi.fn() })));
    expect(host.querySelector('[data-testid="total-reading-time"]')?.textContent).toBe("00:11");
    expect(host.querySelector(".time-totals > div:nth-child(2) dd")?.textContent).toBe("3");
    expect([...host.querySelectorAll(".time-series-name")].map(el => el.textContent)).toEqual(["Beta", "Alpha"]);
    await act(async () => (host.querySelectorAll(".time-series-name")[1] as HTMLElement).click());
    expect(host.querySelector(".time-chapters")?.textContent).toContain("Chapter 2");
    expect(host.querySelector(".time-chapters")?.textContent).not.toContain("Chapter 3");
    state.chapters[0]!.readingTimeMs = 9000;
    await act(async () => state.changed!({ type: "library-changed" }));
    expect(host.querySelector('[data-testid="total-reading-time"]')?.textContent).toBe("00:18");
    expect([...host.querySelectorAll(".time-series-name")].map(el => el.textContent)).toEqual(["Alpha", "Beta"]);
  } finally { await act(async () => root.unmount()); host.remove(); }
  expect(state.off).toHaveBeenCalledOnce();
});
