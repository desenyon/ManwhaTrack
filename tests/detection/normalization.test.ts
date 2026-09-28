import { describe, expect, it } from "vitest";
import { cleanSeriesTitle, normalizeTitle, titleSimilarity } from "../../src/detection/normalization/title";
import { canonicalizeUrl, inferSeriesUrlFromChapterUrl, isSafeHttpUrl, sourceHost } from "../../src/detection/normalization/url";

describe("normalizeTitle", () => {
  it("lowercases, trims, collapses and unifies punctuation", () => {
    expect(normalizeTitle("  Omniscient Reader’s   Viewpoint ")).toBe("omniscient readers viewpoint");
    expect(normalizeTitle("Omniscient Reader's Viewpoint")).toBe("omniscient readers viewpoint");
    expect(normalizeTitle("Tower of God: Season 3")).toBe("tower of god season 3");
    expect(normalizeTitle("Sword & Magic")).toBe("sword and magic");
  });
  it("strips only known presentation suffixes", () => {
    expect(normalizeTitle("Solo Leveling (Manhwa)")).toBe("solo leveling");
    expect(normalizeTitle("Solo Leveling [Official]")).toBe("solo leveling");
    expect(normalizeTitle("Solo Leveling: Ragnarok")).toBe("solo leveling ragnarok");
  });
});

describe("cleanSeriesTitle", () => {
  it("removes site names and chapter markers", () => {
    expect(cleanSeriesTitle("Solo Leveling - Chapter 31 - Example Scans", "Example Scans")).toBe("Solo Leveling");
    expect(cleanSeriesTitle("Read Solo Leveling Manhwa Online Free")).toBe("Solo Leveling");
    expect(cleanSeriesTitle("Episode 171 | Omniscient Reader")).toBe("Omniscient Reader");
    expect(cleanSeriesTitle("The Returned Swordsman Chapter 12 | ReadToonsHub", "ReadToonsHub")).toBe("The Returned Swordsman");
  });
});

describe("titleSimilarity", () => {
  it("scores true duplicates high and distinct titles low", () => {
    expect(titleSimilarity("omniscient readers viewpoint", "omniscient reader viewpoint")).toBeGreaterThan(0.85);
    expect(titleSimilarity("solo leveling", "solo leveling ragnarok")).toBeLessThan(0.85);
    expect(titleSimilarity("tower of god", "god of tower")).toBe(1); // token-equal: suggestion only, never auto-merge
  });
});

describe("url normalization", () => {
  it("removes tracking params but keeps chapter-identifying ones", () => {
    expect(canonicalizeUrl("https://www.webtoons.com/en/a/b/ep/viewer?title_no=1&episode_no=5&utm_source=x#top")).toBe(
      "https://www.webtoons.com/en/a/b/ep/viewer?episode_no=5&title_no=1",
    );
    expect(canonicalizeUrl("https://X.com/manga/a/chapter-1/?fbclid=abc")).toBe("https://x.com/manga/a/chapter-1");
  });
  it("rejects unsafe schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,hi")).toBe(false);
    expect(isSafeHttpUrl("https://ok.com/x")).toBe(true);
  });
  it("infers series URLs from chapter URLs", () => {
    expect(inferSeriesUrlFromChapterUrl("https://x.com/manga/solo/chapter-5/")).toBe("https://x.com/manga/solo/");
    expect(inferSeriesUrlFromChapterUrl("https://x.com/series/abc/ch/5")).toBe("https://x.com/series/abc/");
    expect(inferSeriesUrlFromChapterUrl("https://x.com/solo-chapter-5/")).toBeUndefined();
  });
  it("derives source hosts", () => {
    expect(sourceHost("https://www.webtoons.com/en")).toBe("webtoons.com");
  });
});
