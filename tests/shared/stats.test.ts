import { describe, expect, it } from "vitest";
import { computeStats } from "../../src/shared/utils/stats";
import { createChapter, createSeries } from "../../src/storage/schema";

describe("statistics", () => {
  it("counts only recorded completions and measured time", () => {
    const now = Date.now();
    const s = createSeries({ title: "A" });
    const c1 = { ...createChapter({ seriesId: s.id, sourceId: "x", label: "1", url: "https://a.com/1" }), completedAt: now - 1000, readingTimeMs: 60_000 };
    const c2 = { ...createChapter({ seriesId: s.id, sourceId: "x", label: "2", url: "https://a.com/2" }), readingTimeMs: 30_000 };
    const stats = computeStats([s], [c1, c2], [], [], now);
    expect(stats.chaptersRead).toBe(1);
    expect(stats.measuredReadingMs).toBe(90_000);
    expect(stats.byDay.at(-1)?.count).toBe(1);
    expect(stats.mostRead[0]?.chapters).toBe(1);
  });
});
