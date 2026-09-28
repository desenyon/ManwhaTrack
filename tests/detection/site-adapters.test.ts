// Fixtures sanitized from the live markup of each site (September 2026).
import { describe, expect, it } from "vitest";
import { detectPage, pagedProgressFor } from "../../src/detection";
import { CONFIDENCE } from "../../src/detection/types";
import { chaptersFromMangadexFeed, pageIndicatorProgress } from "../../src/detection/adapters/mangadex";
import { fixture } from "../helpers/dom";

const run = (name: string, url: string) => {
  const f = fixture(name, url);
  return { obs: detectPage(f.doc, f.url), ...f };
};

describe("MangaDex", () => {
  it("series page: title, aliases, cover and chapters from UUID links", () => {
    const { obs } = run("mangadex-series.html", "https://mangadex.org/title/aca35267-19bf-4cc9-96b6-cabd52b924b3/2200-nen-neko-no-kuni-nippon");
    expect(obs.adapterId).toBe("mangadex");
    expect(obs.confidence).toBeGreaterThanOrEqual(CONFIDENCE.track);
    expect(obs.series?.title).toBe("2200 Nen Neko no Kuni Nippon");
    expect(obs.series?.alternateTitles).toContain("2200 AD Cat Country Japan");
    expect(obs.series?.canonicalSeriesUrl).toBe("https://mangadex.org/title/aca35267-19bf-4cc9-96b6-cabd52b924b3");
    expect(obs.series?.coverUrl).toContain("/covers/aca35267");
    expect(obs.series?.chapterList.map((c) => c.label)).toEqual(["Ch. 54.5 - Volume 3 Extras", "Ch. 54 - Cat Care Robot", "Ch. 53"]);
  });

  it("chapter page: number from reader meta, series from header link, paged progress", () => {
    const { obs, doc, url } = run("mangadex-chapter.html", "https://mangadex.org/chapter/4b2e7853-cd8c-4a28-a1a2-2efc737f6ecd/4");
    expect(obs.kind).toBe("chapter");
    expect(obs.chapter?.label).toBe("Ch. 54.5");
    expect(obs.chapter?.canonicalUrl).toBe("https://mangadex.org/chapter/4b2e7853-cd8c-4a28-a1a2-2efc737f6ecd");
    expect(obs.series?.title).toBe("2200 Nen Neko no Kuni Nippon");
    expect(obs.series?.canonicalSeriesUrl).toBe("https://mangadex.org/title/aca35267-19bf-4cc9-96b6-cabd52b924b3");
    expect(pagedProgressFor(doc, url)).toBeCloseTo(4 / 9);
  });

  it("waits instead of guessing while the app hasn't rendered", () => {
    const { doc, url } = fixture("mangadex-series.html", "https://mangadex.org/title/aca35267-19bf-4cc9-96b6-cabd52b924b3");
    doc.body.innerHTML = "<div id='__nuxt'></div>";
    doc.title = "MangaDex";
    const obs = detectPage(doc, url);
    expect(obs.kind).toBe("unknown");
    expect(obs.confidence).toBeLessThan(CONFIDENCE.observe);
  });

  it("parses the public API feed for update checks", () => {
    const list = chaptersFromMangadexFeed({ data: [{ id: "a", attributes: { chapter: "55", title: "Home" } }, { id: "b", attributes: { chapter: "56", externalUrl: "https://x" } }, { id: "c", attributes: { chapter: null } }] });
    expect(list).toEqual([
      { label: "Ch. 55 - Home", url: "https://mangadex.org/chapter/a" },
      { label: "Oneshot", url: "https://mangadex.org/chapter/c" },
    ]);
  });

  it("reads page indicators", () => {
    expect(pageIndicatorProgress("Pg. 9 / 9")).toBe(1);
    expect(pageIndicatorProgress("3 of 12")).toBe(0.25);
    expect(pageIndicatorProgress("Menu")).toBeNull();
  });
});

describe("Tapas", () => {
  it("series info page with episode list", () => {
    const { obs } = run("tapas-series.html", "https://tapas.io/series/the-little-spy-who-kidnapped-the-villain/info");
    expect(obs.adapterId).toBe("tapas");
    expect(obs.series?.title).toBe("The Little Spy Who Kidnapped the Villain");
    expect(obs.series?.coverUrl).toContain("tapas.io/sa/");
    expect(obs.series?.chapterList.map((c) => c.label)).toEqual(["Episode 1", "Episode 2", "Episode 3"]);
  });

  it("episode page with neighbours from the episode drawer", () => {
    const { obs } = run("tapas-episode.html", "https://tapas.io/episode/3981330");
    expect(obs.kind).toBe("chapter");
    expect(obs.chapter?.label).toBe("Episode 2");
    expect(obs.chapter?.nextUrl).toBe("https://tapas.io/episode/3981332");
    expect(obs.chapter?.prevUrl).toBe("https://tapas.io/episode/3958118");
    expect(obs.series?.canonicalSeriesUrl).toBe("https://tapas.io/series/the-little-spy-who-kidnapped-the-villain/info");
  });
});

describe("MANGA Plus", () => {
  it("series page by CSS-module class prefixes", () => {
    const { obs } = run("mangaplus-series.html", "https://mangaplus.shueisha.co.jp/titles/100020");
    expect(obs.adapterId).toBe("mangaplus");
    expect(obs.confidence).toBeGreaterThanOrEqual(CONFIDENCE.track);
    expect(obs.series?.title).toBe("One Piece");
    expect(obs.series?.coverUrl).toContain("title_thumbnail_portrait");
  });

  it("viewer page with page-count progress", () => {
    const { obs, doc, url } = run("mangaplus-viewer.html", "https://mangaplus.shueisha.co.jp/viewer/1000486");
    expect(obs.kind).toBe("chapter");
    expect(obs.chapter?.label).toBe("#001");
    expect(obs.series?.canonicalSeriesUrl).toBe("https://mangaplus.shueisha.co.jp/titles/100020");
    expect(pagedProgressFor(doc, url)).toBeCloseTo(12 / 58);
  });
});
