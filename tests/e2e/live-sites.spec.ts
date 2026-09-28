// Live smoke test against real reading sites. Not part of the default run (network, and
// sites change): LIVE=1 npm run test:e2e -- live-sites
//
// Loads the built extension, visits series and chapter pages, and reports what was
// detected and tracked. Use it to catch adapter/detector drift, then capture a fixture.

import { expect, test, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EXT = fileURLToPath(new URL("../../dist", import.meta.url));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

test.skip(!process.env.LIVE, "set LIVE=1 to run against real sites");
test.setTimeout(240_000);

interface Visit {
  site: string;
  kind: "series" | "chapter";
  url: () => Promise<string | undefined>;
  /** How to advance through a chapter: scroll (default) or page-turn keys. */
  advance?: "ArrowRight" | "ArrowLeft" | "ArrowDown";
}

async function firstLink(page: Page, listUrl: string, pattern: RegExp): Promise<string | undefined> {
  await page.goto(listUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
  return hrefs.find((h) => pattern.test(h));
}

let mdChapter: { id: string; manga: string } | undefined;
async function mangadex(kind: "series" | "chapter"): Promise<string | undefined> {
  if (!mdChapter) {
    const r = await fetch("https://api.mangadex.org/chapter?translatedLanguage[]=en&limit=20&includeExternalUrl=0&order[readableAt]=desc&contentRating[]=safe");
    const c = ((await r.json()).data as { id: string; attributes: { pages: number; chapter: string | null }; relationships: { type: string; id: string }[] }[]).find((x) => x.attributes.pages >= 4 && x.attributes.chapter);
    if (c) mdChapter = { id: c.id, manga: c.relationships.find((x) => x.type === "manga")!.id };
  }
  if (!mdChapter) return undefined;
  return kind === "series" ? `https://mangadex.org/title/${mdChapter.manga}` : `https://mangadex.org/chapter/${mdChapter.id}`;
}

async function mangaPlusChapter(page: Page): Promise<string | undefined> {
  await page.goto("https://mangaplus.shueisha.co.jp/titles/100020", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.locator("[class*=ChapterListItem-module_chapterListItem]").first().click();
  await page.waitForURL(/\/viewer\//, { timeout: 15_000 });
  return page.url();
}

test("real sites", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mt-live-"));
  const ctx: BrowserContext = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    userAgent: UA,
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1200, height: 900 },
  });
  const report: Record<string, unknown>[] = [];
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(sw.url()).host}`;
    const scout = await ctx.newPage();
    const probe = await ctx.newPage();
    await probe.goto(`${ext}/options.html`);

    let tapasInfo = "https://tapas.io/comics";
    const visits: Visit[] = [
      { site: "webtoons", kind: "series", url: async () => "https://www.webtoons.com/en/action/omniscient-reader/list?title_no=2154" },
      { site: "webtoons", kind: "chapter", url: async () => "https://www.webtoons.com/en/action/omniscient-reader/episode-1/viewer?title_no=2154&episode_no=2" },
      { site: "webtoons-canvas", kind: "series", url: () => firstLink(scout, "https://www.webtoons.com/en/canvas", /\/canvas\/[^/]+\/list\?title_no=\d+/) },
      { site: "tapas", kind: "series", url: async () => (tapasInfo = ((await firstLink(scout, "https://tapas.io/comics", /tapas\.io\/series\/[^/?#]+$/)) ?? "") + "/info") },
      { site: "tapas", kind: "chapter", url: () => firstLink(scout, tapasInfo, /tapas\.io\/episode\/\d+$/) },
      { site: "mangadex", kind: "series", url: () => mangadex("series") },
      { site: "mangadex", kind: "chapter", url: () => mangadex("chapter"), advance: "ArrowRight" },
      { site: "mangaplus", kind: "series", url: async () => "https://mangaplus.shueisha.co.jp/titles/100020" },
      { site: "mangaplus", kind: "chapter", url: () => mangaPlusChapter(scout), advance: "ArrowDown" },
    ];

    for (const v of visits) {
      const url = await v.url().catch(() => undefined);
      if (!url) {
        report.push({ site: v.site, expected: v.kind, error: "could not find a page to test" });
        continue;
      }
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(6000);
        // Remember which chapter was opened before reading (readers may move on at the end).
        const before = (await probe.evaluate(() => chrome.storage.session.get(null))) as Record<string, { observation?: { url: string }; chapterId?: string }>;
        const openedChapterId = Object.values(before).find((s) => s?.observation?.url.split("#")[0] === page.url().split("#")[0])?.chapterId;
        if (v.kind === "chapter") {
          // Read to the end: turn pages or scroll through the reader.
          // Paged viewers ignore keys while a page image loads, so allow plenty of presses.
          for (let i = 0; i < 160; i++) {
            if (v.advance) await page.keyboard.press(v.advance);
            else await page.mouse.wheel(0, 1500);
            await page.waitForTimeout(v.advance ? 300 : 100);
          }
          await page.waitForTimeout(1500);
        } else {
          await page.mouse.wheel(0, 1500);
          await page.waitForTimeout(800);
        }
        const states = (await probe.evaluate(() => chrome.storage.session.get(null))) as Record<string, { observation: { url: string; kind: string; confidence: number; adapterId: string; series?: { title: string; canonicalSeriesUrl: string; coverUrl?: string; chapterList: unknown[] }; chapter?: { label: string; nextUrl?: string } }; seriesId?: string; chapterId?: string }>;
        const chapters = (await probe.evaluate(
          () =>
            new Promise((resolve) => {
              const r = indexedDB.open("manwhatrack");
              r.onsuccess = () => {
                const q = r.result.transaction("chapters").objectStore("chapters").getAll();
                q.onsuccess = () => resolve(q.result);
              };
            }),
        )) as { id: string; completedAt?: number; maxProgress: number }[];
        const st = Object.values(states).find((s) => s?.observation && new URL(s.observation.url).host === new URL(page.url()).host && s.observation.url.split("#")[0] === page.url().split("#")[0]);
        const o = st?.observation;
        report.push({
          site: v.site,
          expected: v.kind,
          url: page.url(),
          detected: o?.kind ?? "(nothing reported)",
          confidence: o?.confidence,
          adapter: o?.adapterId,
          title: o?.series?.title,
          seriesUrl: o?.series?.canonicalSeriesUrl,
          cover: !!o?.series?.coverUrl,
          chapters: o?.series?.chapterList.length,
          chapter: o?.chapter?.label,
          next: !!o?.chapter?.nextUrl,
          tracked: !!st?.seriesId,
          ...(v.kind === "chapter"
            ? (() => {
                const c = chapters.find((x) => x.id === (openedChapterId ?? st?.chapterId));
                return { openedTracked: !!openedChapterId, progress: c?.maxProgress, finished: !!c?.completedAt };
              })()
            : {}),
        });
      } catch (e) {
        report.push({ site: v.site, expected: v.kind, url, error: (e as Error).message.slice(0, 120) });
      } finally {
        await page.close();
      }
    }
    const library = (await probe.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("manwhatrack");
          r.onsuccess = () => {
            const q = r.result.transaction("series").objectStore("series").getAll();
            q.onsuccess = () => resolve(q.result.map((s: { title: string; summary: { continueLabel?: string } }) => `${s.title} → ${s.summary.continueLabel ?? "series page"}`));
          };
        }),
    )) as string[];
    report.push({ library });
  } finally {
    const out = process.env.LIVE_REPORT ?? join(tmpdir(), "manwhatrack-live-report.json");
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
  expect(report.length).toBeGreaterThan(0);
});
