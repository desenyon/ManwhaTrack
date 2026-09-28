import { describe, expect, it } from "vitest";
import { freshDb } from "../helpers/obs";
import { write } from "../../src/storage/db";
import { createChapter, createSeries, createSource } from "../../src/storage/schema";
import { listSeries } from "../../src/storage/repositories/series";
import { computeSeriesState } from "../../src/storage/summary";
import { inView, sortSeries } from "../../src/shared/utils/library";
import { buildSearchEntry, search } from "../../src/shared/utils/search";

describe("scale", () => {
  it("handles 1,000 series and 20,000 chapters", async () => {
    freshDb();
    const series = Array.from({ length: 1000 }, (_, i) => createSeries({ title: `Series ${i} ${["Blade", "Tower", "Return", "Leveling"][i % 4]}` }));
    await write(["series", "sources", "chapters"], async (t) => {
      for (const s of series) {
        const src = createSource({ seriesId: s.id, seriesUrl: `https://site${s.id.slice(0, 2)}.com/manga/${s.id}/` });
        s.sourceIds = [src.id];
        await t.put("series", s);
        await t.put("sources", src);
        for (let c = 1; c <= 20; c++) await t.put("chapters", { ...createChapter({ seriesId: s.id, sourceId: src.id, label: `Chapter ${c}`, url: `${src.seriesUrl}chapter-${c}/` }), completedAt: c < 10 ? 1 : undefined });
      }
    });

    let t0 = performance.now();
    const loaded = await listSeries();
    const loadMs = performance.now() - t0;
    expect(loaded).toHaveLength(1000);

    t0 = performance.now();
    const entries = loaded.map((s) => buildSearchEntry(s, []));
    search(entries, "tower 12");
    search(entries, "levling");
    sortSeries(loaded.filter((s) => inView(s, "all")), "title-asc");
    const uiMs = performance.now() - t0;

    const big = createSeries({ title: "Long" });
    const chapters = Array.from({ length: 2000 }, (_, i) => ({ ...createChapter({ seriesId: big.id, sourceId: "s", label: `${i + 1}`, url: `https://a.com/${i}` }), completedAt: i < 1500 ? 1 : undefined }));
    t0 = performance.now();
    const state = computeSeriesState(big, chapters, []);
    const summaryMs = performance.now() - t0;
    expect(state.summary.newCount).toBe(500);

    // Generous bounds: these guard against accidental quadratic behaviour, not micro-timings.
    expect(loadMs).toBeLessThan(3000);
    expect(uiMs).toBeLessThan(500);
    expect(summaryMs).toBeLessThan(100);
  }, 60_000);
});
