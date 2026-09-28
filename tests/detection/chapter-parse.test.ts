import { describe, expect, it } from "vitest";
import { chapterLabelFromUrl, compareChapters, parseChapterLabel } from "../../src/detection/normalization/chapter";

describe("parseChapterLabel", () => {
  it.each([
    ["12", 12, "numbered"],
    ["12.5", 12.5, "numbered"],
    ["12.1", 12.1, "numbered"],
    ["001", 1, "numbered"],
    ["Chapter 31 Part 2", 31, "numbered"],
    ["Season 2 Chapter 8", 8, "numbered"],
    ["Ch. 83", 83, "numbered"],
    ["Episode 171", 171, "numbered"],
    ["#172", 172, "numbered"],
    ["Vol.2 Ch.10 - The Gate", 10, "numbered"],
  ] as const)("parses %s", (label, number, kind) => {
    const p = parseChapterLabel(label);
    expect(p.number).toBe(number);
    expect(p.kind).toBe(kind);
    expect(p.label).toBe(label);
  });

  it("keeps specials, prologues, epilogues and side stories distinct", () => {
    expect(parseChapterLabel("Special").kind).toBe("special");
    expect(parseChapterLabel("Prologue").kind).toBe("prologue");
    expect(parseChapterLabel("Epilogue").kind).toBe("epilogue");
    const side = parseChapterLabel("Side Story 4");
    expect(side.kind).toBe("side");
    expect(side.number).toBe(4);
    expect(side.ordinal).toBeUndefined();
  });

  it("does not misread possessive s as a season", () => {
    expect(parseChapterLabel("Solo Leveling's 12 Chapter 3").season).toBeUndefined();
    expect(parseChapterLabel("S2 Ep. 8").season).toBe(2);
  });

  it("season and part affect ordering but not the label", () => {
    const s1 = parseChapterLabel("Chapter 50");
    const s2 = parseChapterLabel("Season 2 Chapter 8");
    expect(s2.ordinal!).toBeGreaterThan(s1.ordinal!);
    const p1 = parseChapterLabel("Chapter 31 Part 1");
    const p2 = parseChapterLabel("Chapter 31 Part 2");
    expect(p2.ordinal!).toBeGreaterThan(p1.ordinal!);
    expect(p1.key).not.toBe(p2.key);
  });

  it("gives equal keys to equivalent labels", () => {
    expect(parseChapterLabel("Chapter 5").key).toBe(parseChapterLabel("Ch. 5").key);
    expect(parseChapterLabel("Episode 005").key).toBe(parseChapterLabel("5").key);
  });
});

describe("chapterLabelFromUrl", () => {
  it.each([
    ["https://x.com/manga/a/chapter-42/", "Chapter 42"],
    ["https://x.com/manga/a/chapter/42", "Chapter 42"],
    ["https://x.com/a/ch-42", "Chapter 42"],
    ["https://x.com/a/ch/42", "Chapter 42"],
    ["https://x.com/a/chapter_42", "Chapter 42"],
    ["https://x.com/a/episode-42", "Chapter 42"],
    ["https://x.com/a/episode/42", "Chapter 42"],
    ["https://x.com/a/chapter-12-5/", "Chapter 12.5"],
    ["https://x.com/a/chapter-12-the-return", "Chapter 12"],
    ["https://x.com/a/solo-leveling-chapter-7/", "Chapter 7"],
    ["https://www.webtoons.com/en/a/b/episode-3/viewer?title_no=1&episode_no=3", "Chapter 3"],
    // Live webtoons markup: the slug is the display title, episode_no is the identity.
    ["https://www.webtoons.com/en/action/omniscient-reader/episode-2/viewer?title_no=2154&episode_no=3", "Chapter 3"],
  ])("%s → %s", (url, label) => {
    expect(chapterLabelFromUrl(new URL(url))).toBe(label);
  });

  it("ignores URLs without chapter tokens", () => {
    expect(chapterLabelFromUrl(new URL("https://x.com/manga/chaptered-lives/"))).toBeUndefined();
    expect(chapterLabelFromUrl(new URL("https://x.com/checkout/42"))).toBeUndefined();
  });
});

describe("compareChapters", () => {
  const mk = (label: string, discoveredAt = 0) => ({ ...parseChapterLabel(label), chapterLabel: label, discoveredAt });

  it("sorts numerically, never lexically", () => {
    const sorted = ["1", "10", "100", "11", "2"].map((l) => mk(l)).sort(compareChapters).map((c) => c.chapterLabel);
    expect(sorted).toEqual(["1", "2", "10", "11", "100"]);
  });

  it("handles decimals", () => {
    const sorted = ["11", "10.5", "10", "10.1"].map((l) => mk(l)).sort(compareChapters).map((c) => c.chapterLabel);
    expect(sorted).toEqual(["10", "10.1", "10.5", "11"]);
  });

  it("places prologue first and specials after the main sequence, stably", () => {
    const sorted = [mk("Special", 2), mk("2"), mk("Prologue"), mk("1"), mk("Epilogue"), mk("Side Story 2"), mk("Side Story 1"), mk("Notice", 1)]
      .sort(compareChapters)
      .map((c) => c.chapterLabel);
    expect(sorted).toEqual(["Prologue", "1", "2", "Epilogue", "Side Story 1", "Side Story 2", "Notice", "Special"]);
  });
});
