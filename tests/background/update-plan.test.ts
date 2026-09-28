import { describe, expect, it } from "vitest";
import { isDue, planChecks } from "../../src/background/update-checker";
import { createSeries, createSource } from "../../src/storage/schema";

const H = 3_600_000;

describe("update check planning", () => {
  const now = 1_000 * H;
  it("respects the interval and backs off after failures", () => {
    const src = createSource({ seriesId: "s", seriesUrl: "https://a.com/manga/x/" });
    expect(isDue(src, 12, now)).toBe(true);
    expect(isDue({ ...src, lastCheckedAt: now - 6 * H }, 12, now)).toBe(false);
    expect(isDue({ ...src, lastCheckedAt: now - 13 * H }, 12, now)).toBe(true);
    expect(isDue({ ...src, lastCheckedAt: now - 13 * H, consecutiveFailures: 2 }, 12, now)).toBe(false);
    expect(isDue({ ...src, disabled: true }, 12, now)).toBe(false);
  });

  it("checks one source per host per run, favorites first, skipping dropped series", () => {
    const fav = { ...createSeries({ title: "Fav" }), favorite: true };
    const plain = createSeries({ title: "Plain" });
    const dropped = { ...createSeries({ title: "Dropped" }), status: "dropped" as const };
    const sources = [
      createSource({ seriesId: plain.id, seriesUrl: "https://a.com/manga/plain/" }),
      createSource({ seriesId: fav.id, seriesUrl: "https://a.com/manga/fav/" }),
      createSource({ seriesId: dropped.id, seriesUrl: "https://b.com/manga/d/" }),
      createSource({ seriesId: plain.id, seriesUrl: "https://c.com/manga/plain/" }),
    ];
    const plan = planChecks([fav, plain, dropped], sources, 12, now);
    expect(plan.map((s) => s.hostname)).toEqual(["a.com", "c.com"]);
    expect(plan[0]!.seriesId).toBe(fav.id);
  });
});
