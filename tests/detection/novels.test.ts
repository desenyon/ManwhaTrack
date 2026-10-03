import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { detectPage, mightBeReadingPage, readerContainerFor } from "../../src/detection";
const prose=Array.from({length:14},(_,i)=>`<p>${i}. ${"The traveller followed the river into a quiet forest, searching for the forgotten city. ".repeat(4)}</p>`).join("");
const doc=(html:string)=>new JSDOM(html).window.document;
describe("web novel reading",()=>{
  it("tracks paragraph readers on unknown sites, not just image stacks",()=>{
    const url=new URL("https://stories.example/novel/river/chapter-12/");
    const d=doc(readFileSync(new URL("../fixtures/novel-chapter.html",import.meta.url),"utf8"));
    const o=detectPage(d,url);expect(mightBeReadingPage(d,url)).toBe(true);expect(o.kind).toBe("chapter");expect(o.confidence).toBeGreaterThanOrEqual(.8);expect(o.series).toMatchObject({title:"River",format:"novel"});expect(o.chapter?.label).toBe("Chapter 12");expect(readerContainerFor(d,url)?.className).toBe("chapter-content");
  });
  it("uses visible identities instead of Royal Road opaque IDs",()=>{
    const url=new URL("https://www.royalroad.com/fiction/456/river/chapter/987654/chapter-12");
    const d=doc(`<a href="/fiction/456/river">River</a><h1>Chapter 12: The forest</h1><div class="chapter-content">${prose}</div><a href="/fiction/456/river/chapter/999000/the-city">Next Chapter</a>`);
    const o=detectPage(d,url);expect(o.adapterId).toBe("novel-platforms");expect(o.chapter?.label).toBe("Chapter 12");expect(o.chapter?.nextUrl).toContain("999000");expect(o.series?.canonicalSeriesUrl).toBe("https://www.royalroad.com/fiction/456/river");
  });
  it("keeps prose as the reader when a novel contains illustrations and unrelated images",()=>{
    const d=doc(readFileSync(new URL("../fixtures/novel-chapter.html",import.meta.url),"utf8"));
    d.querySelector("article")!.insertAdjacentHTML("beforeend",'<img src="/art-1.jpg" width="600" height="900"><img src="/art-2.jpg" width="600" height="900">');
    d.body.insertAdjacentHTML("beforeend",'<aside><img src="/other-1.jpg" width="600" height="900"><img src="/other-2.jpg" width="600" height="900"><img src="/other-3.jpg" width="600" height="900"></aside>');
    const url=new URL("https://stories.example/novel/river/chapter-12/");
    expect(detectPage(d,url).series?.format).toBe("novel");expect(readerContainerFor(d,url)).toBe(d.querySelector("article"));
  });
  it("tracks Webnovel book/chapter routes and catalogs",()=>{
    const chapter=new URL("https://www.webnovel.com/book/river_123/the-forest_987654");
    const d=doc(`<a href="/book/river_123">River</a><h1>Chapter 8: The forest</h1><div class="cha-words">${prose}</div>`);
    expect(detectPage(d,chapter).chapter?.label).toBe("Chapter 8");
    const series=doc(`<h1>River</h1><a href="/book/river_123/forest_987654">Chapter 8</a><a href="/book/river_123/city_999999">Chapter 9</a>`);
    const o=detectPage(series,new URL("https://www.webnovel.com/book/river_123"));expect(o.series?.format).toBe("novel");expect(o.series?.chapterList).toHaveLength(2);
  });
  it("does not turn articles, previews, listings, or comments into novels",()=>{
    for(const [url,html] of [
      ["https://news.example/forest",`<h1>A forest story</h1><article>${prose}</article>`],
      ["https://stories.example/novel/river/chapter-12",`<h1>River Chapter 12</h1><div class="comments"><article>${prose}</article></div>`],
      ["https://stories.example/novel/river/chapter-12",'<h1>River Chapter 12</h1><div class="chapter-content"><p>A short preview</p></div>'],
    ]) expect(detectPage(doc(html!),new URL(url!)).confidence).toBeLessThan(.8);
  });
  it("waits for locked or unrendered platform chapters",()=>{
    const o=detectPage(doc('<a href="/book/river_123">River</a><h1>Chapter 8</h1><p>Unlock to read</p>'),new URL("https://www.webnovel.com/book/river_123/forest_987654"));expect(o.kind).toBe("unknown");expect(o.confidence).toBeLessThan(.8);
  });
});

it("keeps season and part identities and accepts numbered novel headings without trusting route IDs",()=>{
 for(const [heading,label] of [["Season 2 Chapter 8 Part 2: Return","Season 2 Chapter 8 Part 2"],["12. The forest","Chapter 12"],["Prologue","Prologue"]]) {
  const d=doc(`<a href="/fiction/456/river">River</a><h1>${heading}</h1><div class="chapter-content">${prose}</div>`);
  expect(detectPage(d,new URL("https://www.royalroad.com/fiction/456/river/chapter/987654/the-forest")).chapter?.label).toBe(label);
 }
});
