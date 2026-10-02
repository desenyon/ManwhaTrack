// @vitest-environment jsdom
import { expect, it } from "vitest";
import { madaraAdapter } from "../../src/detection/adapters/madara";
import { correctJoinedChapterLabel } from "../../src/detection/normalization/chapter";
import { scanLinks } from "../../src/detection/generic/links";
import { mangaThemesiaAdapter } from "../../src/detection/adapters/mangathemesia";

const url = new URL("https://scans.example/manga/nano-machine/");
it("keeps recommended series out of a Madara series chapter list", () => {
  document.body.innerHTML = `<div id="manga-chapters-holder"><ul><li class="wp-manga-chapter"><a href="/manga/nano-machine/chapter-304/">Chapter 304</a></li></ul></div>
    <aside><li class="wp-manga-chapter"><a href="/manga/another-series/chapter-999/">Chapter 999</a></li></aside>`;
  expect(madaraAdapter.extractChapterList?.(document, url)?.map(c => c.label)).toEqual(["Chapter 304"]);
});
it("keeps a MangaThemesia sidebar episode list out of the main chapter list", () => {
  document.body.innerHTML = `<aside class="eplister"><li><a href="/manga/another-series/chapter-999/"><span class="chapternum">Chapter 999</span></a></li></aside>
    <div id="chapterlist"><li><a href="/manga/nano-machine/chapter-304/"><span class="chapternum">Chapter 304</span></a></li></div>`;
  expect(mangaThemesiaAdapter.extractChapterList?.(document, url)?.map(c => c.label)).toEqual(["Chapter 304"]);
});

it("separates Nano Machine chapter numbers from adjacent subtitle numbers and dates", () => {
  document.body.innerHTML = `<div id="manga-chapters-holder"><ul>
    <li class="wp-manga-chapter"><a href="/comics/nano-machine-3ec3b16f/chapter/324"><span>Chapter 324</span><span>105. TP &lt;2&gt;</span><time>Aug 5, 2026</time></a></li>
    <li class="wp-manga-chapter"><a href="/comics/nano-machine-3ec3b16f/chapter/332"><span>Chapter 332</span><span>107: Special Forces &lt;5&gt;</span><time>1 day ago</time></a></li>
    <li class="wp-manga-chapter"><a href="/comics/nano-machine-3ec3b16f/chapter/143"><span>Chapter 143</span><span>50.Night in the Inn (3) {S2 START}</span><time>Jun 5, 2023</time></a></li>
  </ul></div>`;
  expect(madaraAdapter.extractChapterList?.(document, url)?.map(c => c.label)).toEqual(["Chapter 324", "Chapter 332", "Chapter 143"]);
});

it("uses chapter URL identity for generic links whose text joins number and subtitle", () => {
  document.body.innerHTML = `<a href="/comics/nano-machine/chapter/324"><span>Chapter 324</span><span>105. TP</span><time>Aug 5, 2026</time></a>`;
  expect(scanLinks(document, url).chapterList[0]?.label).toBe("Chapter 324");
});

it("keeps authored prologue and side-story labels when a site uses numeric URLs", () => {
  document.body.innerHTML = `<a href="/manga/nano-machine/chapter-0">Prologue</a><a href="/manga/nano-machine/chapter-100">Side Story 4</a>`;
  expect(scanLinks(document, url).chapterList.map(c=>c.label)).toEqual(["Prologue", "Side Story 4"]);
});

it("does not guess repairs for plain conflicting chapter numbers or decimal chapters", () => {
  expect(correctJoinedChapterLabel("Chapter 324", "https://scans.example/chapter/32")).toBeUndefined();
  expect(correctJoinedChapterLabel("Chapter 324.5", "https://scans.example/chapter/32")).toBeUndefined();
  expect(correctJoinedChapterLabel("Chapter 324105. TP <2>Aug 5, 2026", "https://asurascans.com/comics/nano-machine/chapter/324")).toBe("Chapter 324");
});
