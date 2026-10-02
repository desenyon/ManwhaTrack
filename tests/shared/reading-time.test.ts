import { expect, it } from "vitest";
import { formatReadingClock, selectReadingActivity } from "../../src/shared/utils/reading-time";
import type { TabState } from "../../src/shared/messages";
const tab = (id: number, active: boolean, sampledAt: number) => ({ tabId: id, seriesId: `s${id}`, chapterId: `c${id}`, readingActivity: { active, sampledAt, sessionMs: 6500, chapterId: `c${id}` } }) as TabState;
it("formats measured time without rounding up a partial second", () => {
  expect(formatReadingClock(650)).toBe("00:00");
  expect(formatReadingClock(65000)).toBe("01:05");
  expect(formatReadingClock(3661999)).toBe("1:01:01");
});
it("prefers a fresh active reader over a newer paused reader", () => {
  expect(selectReadingActivity([tab(1, true, 9000), tab(2, false, 9500)], 10000)?.tabId).toBe(1);
});
it("does not keep a terminated reader running from a stale heartbeat", () => {
  expect(selectReadingActivity([tab(1, true, 1000)], 10000)).toMatchObject({ active: false, sessionMs: 6500 });
});
it("ignores an old chapter sample after a tab navigates to another chapter", () => {
  const mismatch = { ...tab(1, true, 9000), readingActivity: { active: true, sampledAt: 9000, sessionMs: 6500, chapterId: "old" } } as TabState;
  expect(selectReadingActivity([mismatch], 10000)).toBeUndefined();
});
