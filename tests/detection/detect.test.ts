import { describe, expect, it } from "vitest";
import { detectPage, mightBeReadingPage } from "../../src/detection";
import { CONFIDENCE } from "../../src/detection/types";
import { fixture } from "../helpers/dom";

function run(name: string, url: string, rules = []) {
  const { doc, url: u } = fixture(name, url);
  return detectPage(doc, u, { siteRules: rules });
}

describe("known adapters", () => {
  it("madara series page", () => {
    const o = run("madara-series.html", "https://example-scans.com/manga/solo-leveling/");
    expect(o.adapterId).toBe("madara");
    expect(o.kind).toBe("series");
    expect(o.confidence).toBeGreaterThanOrEqual(CONFIDENCE.track);
    expect(o.series?.title).toBe("Solo Leveling");
    expect(o.series?.alternateTitles).toContain("Only I Level Up");
    expect(o.series?.coverUrl).toBe("https://cdn.example-scans.com/covers/solo-leveling-193x278.jpg");
    expect(o.series?.storyEnded).toBe(true);
    expect(o.series?.chapterList.map((c) => c.label)).toEqual(["Chapter 200", "Chapter 199.5", "Chapter 199", "Chapter 2", "Chapter 1", "Prologue"]);
    expect(o.series?.canonicalSeriesUrl).toBe("https://example-scans.com/manga/solo-leveling");
  });

  it("madara chapter page", () => {
    const o = run("madara-chapter.html", "https://example-scans.com/manga/solo-leveling/chapter-31/");
    expect(o.kind).toBe("chapter");
    expect(o.confidence).toBeGreaterThanOrEqual(CONFIDENCE.track);
    expect(o.chapter?.label).toBe("Chapter 31");
    expect(o.chapter?.nextUrl).toBe("https://example-scans.com/manga/solo-leveling/chapter-32");
    expect(o.chapter?.prevUrl).toBe("https://example-scans.com/manga/solo-leveling/chapter-30");
    expect(o.series?.title).toBe("Solo Leveling");
    expect(o.series?.canonicalSeriesUrl).toBe("https://example-scans.com/manga/solo-leveling");
    expect(o.readerSelector).toContain("reading-content");
    // The share image is kept as a fallback cover candidate for chapter-first discovery.
    expect(o.series?.coverCandidates).toEqual(["https://cdn.example-scans.com/covers/solo-leveling-og.jpg"]);
  });

  it("mangathemesia series + chapter", () => {
    const s = run("mangathemesia-series.html", "https://toonplace.net/manga/omniscient-readers-viewpoint/");
    expect(s.adapterId).toBe("mangathemesia");
    expect(s.kind).toBe("series");
    expect(s.series?.title).toBe("Omniscient Reader’s Viewpoint");
    expect(s.series?.coverUrl).toBe("https://toonplace.net/wp-content/uploads/orv-cover.webp");
    expect(s.series?.storyEnded).toBe(false);
    expect(s.series?.chapterList).toHaveLength(4);
    expect(s.series?.chapterList[0]).toMatchObject({ label: "Chapter 271" });

    const c = run("mangathemesia-chapter.html", "https://toonplace.net/omniscient-readers-viewpoint-chapter-83/");
    expect(c.kind).toBe("chapter");
    expect(c.chapter?.label).toBe("Chapter 83");
    expect(c.series?.title).toBe("Omniscient Reader’s Viewpoint");
    expect(c.series?.canonicalSeriesUrl).toBe("https://toonplace.net/manga/omniscient-readers-viewpoint");
    expect(c.chapter?.nextUrl).toBe("https://toonplace.net/omniscient-readers-viewpoint-chapter-84");
  });

  it("webtoons series + viewer keep identifying query params", () => {
    const s = run("webtoons-series.html", "https://www.webtoons.com/en/action/omniscient-reader/list?title_no=2154&page=2");
    expect(s.adapterId).toBe("webtoons");
    expect(s.series?.title).toBe("Omniscient Reader");
    expect(s.series?.canonicalSeriesUrl).toBe("https://www.webtoons.com/en/action/omniscient-reader/list?title_no=2154");
    // Live markup (checked Sep 2026): header art is wide landing art; og:image is the poster as a square crop.
    expect(s.series?.coverUrl).toBe("https://swebtoon-phinf.pstatic.net/orv/4)%20Thumb_Poster_2154.jpg");
    expect(s.series?.chapterList.map((c) => c.label)).toEqual(["Episode 172", "Episode 171", "Episode 170"]);

    const c = run("webtoons-viewer.html", "https://www.webtoons.com/en/action/omniscient-reader/episode-171/viewer?title_no=2154&episode_no=171&utm_medium=x");
    expect(c.kind).toBe("chapter");
    expect(c.chapter?.label).toBe("Episode 171");
    expect(c.chapter?.canonicalUrl).toBe("https://www.webtoons.com/en/action/omniscient-reader/episode-171/viewer?episode_no=171&title_no=2154");
    expect(c.chapter?.nextUrl).toContain("episode_no=172");
    expect(c.series?.canonicalSeriesUrl).toBe(s.series?.canonicalSeriesUrl);
  });
});

describe("generic detector", () => {
  it("identifies an unseen series page", () => {
    const o = run("generic-series.html", "https://readtoonshub.io/series/returned-swordsman");
    expect(o.adapterId).toBe("generic");
    expect(o.kind).toBe("series");
    expect(o.confidence).toBeGreaterThanOrEqual(CONFIDENCE.track);
    expect(o.series?.title).toBe("The Returned Swordsman");
    expect(o.series?.coverUrl).toBe("https://img.readtoonshub.io/series/returned-swordsman/cover-ld.jpg");
    expect(o.series?.canonicalSeriesUrl).toBe("https://readtoonshub.io/series/returned-swordsman");
    expect(o.series?.chapterList.length).toBe(6);
    expect(o.series?.alternateTitles).toContain("Return of the Sword Saint");
  });

  it("identifies an unseen chapter page, its series and navigation", () => {
    const o = run("generic-chapter.html", "https://readtoonshub.io/series/returned-swordsman/ch/12");
    expect(o.kind).toBe("chapter");
    expect(o.confidence).toBeGreaterThanOrEqual(CONFIDENCE.track);
    expect(o.chapter?.label).toBe("Chapter 12");
    expect(o.chapter?.nextUrl).toBe("https://readtoonshub.io/series/returned-swordsman/ch/12.5");
    expect(o.chapter?.prevUrl).toBe("https://readtoonshub.io/series/returned-swordsman/ch/11");
    expect(o.series?.title).toBe("The Returned Swordsman");
    expect(o.series?.canonicalSeriesUrl).toBe("https://readtoonshub.io/series/returned-swordsman");
  });

  it("handles a special chapter without a number", () => {
    const o = run("generic-special.html", "https://readtoonshub.io/series/returned-swordsman/side-story-4");
    expect(o.kind).toBe("chapter");
    expect(o.chapter?.label).toBe("Side Story 4");
    expect(o.series?.title).toBe("The Returned Swordsman");
  });

  it("handles a decimal chapter from the URL", () => {
    const { doc } = fixture("generic-chapter.html", "https://readtoonshub.io/series/returned-swordsman/ch/12.5");
    doc.title = "The Returned Swordsman | ReadToonsHub";
    doc.querySelector('meta[property="og:title"]')?.remove();
    const o = detectPage(doc, new URL("https://readtoonshub.io/series/returned-swordsman/ch/12.5"));
    expect(o.chapter?.label).toBe("Chapter 12.5");
  });

  it("tracks a series without a cover rather than inventing one", () => {
    const o = run("generic-no-cover.html", "https://tinyscans.org/manhwa/moonlit-garden");
    expect(o.kind).toBe("series");
    expect(o.series?.title).toBe("Moonlit Garden");
    expect(o.series?.coverUrl).toBeUndefined();
  });

  it("survives malformed metadata and unsafe URLs", () => {
    const o = run("malformed.html", "https://brokenblade.site/manga/broken-blade/chapter-7/");
    expect(o.kind).toBe("chapter");
    expect(o.chapter?.label).toBe("Chapter 7");
    expect(o.chapter?.nextUrl).toBeUndefined();
    expect(o.series?.title).toBe("Broken Blade");
    expect(JSON.stringify(o)).not.toContain("javascript:");
  });

  it("does not treat a listing page as a series", () => {
    const o = run("listing.html", "https://readtoonshub.io/latest");
    expect(o.kind === "series" && o.confidence >= CONFIDENCE.track).toBe(false);
  });

  it("ignores ordinary articles that mention chapters", () => {
    const o = run("article.html", "https://blog.example.com/posts/first-chapter");
    expect(o.confidence).toBeLessThan(CONFIDENCE.track);
  });
});

describe("pre-check", () => {
  it("skips pages with no reading signals", () => {
    const { doc, url } = fixture("article.html", "https://mail.example.com/inbox");
    doc.title = "Inbox";
    doc.body.innerHTML = "<p>hello</p>";
    expect(mightBeReadingPage(doc, url)).toBe(false);
  });
  it("accepts manga pages", () => {
    const { doc, url } = fixture("madara-series.html", "https://example-scans.com/manga/solo-leveling/");
    expect(mightBeReadingPage(doc, url)).toBe(true);
  });
});

describe("local site rules", () => {
  it("override detection for a configured host", () => {
    const rule = {
      id: "r1",
      host: "tinyscans.org",
      enabled: true,
      updatedAt: 0,
      selectors: { seriesTitle: "h1", chapterList: "ul" },
    };
    const o = run("generic-no-cover.html", "https://tinyscans.org/manhwa/moonlit-garden", [rule] as never);
    expect(o.adapterId).toBe("rule:tinyscans.org");
    expect(o.kind).toBe("series");
    expect(o.series?.chapterList).toHaveLength(3);
  });
});
