// @vitest-environment jsdom
import { expect, it } from "vitest";
import { madaraAdapter } from "../../src/detection/adapters/madara";
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
