import { describe, expect, it } from "vitest";
import { sanitizeObservation } from "../../src/shared/messages";

describe("message boundary validation", () => {
  it("rejects malformed observations", () => {
    expect(sanitizeObservation(null)).toBeNull();
    expect(sanitizeObservation({ url: "javascript:alert(1)", kind: "chapter", confidence: 1 })).toBeNull();
    expect(sanitizeObservation({ url: "https://x.com", kind: "evil", confidence: 1 })).toBeNull();
  });
  it("strips unsafe URLs and control characters from scraped data", () => {
    const o = sanitizeObservation({
      url: "https://x.com/manga/a/chapter-1",
      kind: "chapter",
      confidence: 5,
      series: { title: "A\u0000 title", seriesUrl: "https://x.com/manga/a/", canonicalSeriesUrl: "https://x.com/manga/a", coverUrl: "data:image/png;base64,AAA", chapterList: [{ label: "1", url: "javascript:x" }] },
      chapter: { label: "Chapter 1", url: "https://x.com/manga/a/chapter-1", canonicalUrl: "https://x.com/manga/a/chapter-1", nextUrl: "javascript:void(0)" },
    });
    expect(o?.confidence).toBe(1);
    expect(o?.series?.title).toBe("A  title");
    expect(o?.series?.coverUrl).toBeUndefined();
    expect(o?.series?.chapterList).toEqual([]);
    expect(o?.chapter?.nextUrl).toBeUndefined();
  });
});
