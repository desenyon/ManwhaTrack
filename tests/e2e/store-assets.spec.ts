// STORE_ASSET_DIR=chrome-web-store/assets npm run test:e2e -- store-assets
// Real production UI, isolated fictional library, original procedural cover art.
import { chromium, expect, test, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";

const EXT = fileURLToPath(new URL("../../dist", import.meta.url));
const OUT = process.env.STORE_ASSET_DIR;
test.skip(!OUT, "set STORE_ASSET_DIR to capture Store assets");

test("Chrome Web Store assets show the production UI and match required dimensions", async () => {
  test.setTimeout(150_000);
  mkdirSync(OUT!, { recursive: true });
  const fx = await startFixtureServer({ host: "inkwell.example" });
  const dir = mkdtempSync(join(tmpdir(), "mt-store-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium", headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--host-resolver-rules=MAP *.example 127.0.0.1"],
  });
  const errors: string[] = [];
  try {
    let [worker] = ctx.serviceWorkers();
    worker ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(worker.url()).host}`;
    const reader = await ctx.newPage();
    const full = await ctx.newPage();
    full.on("pageerror", e => errors.push(e.message));
    await full.goto(`${ext}/library.html`);
    await full.getByRole("complementary").getByRole("button", { name: "All series", exact: true }).click();
    const plans = [
      { slug: "the-last-swordmaster", latest: 64, current: 58 },
      { slug: "starfall-academy", latest: 30, current: 23 },
      { slug: "return-of-the-iron-scholar", latest: 91, current: 88 },
      { slug: "crimson-tide-regression", latest: 45, current: 44 },
    ];
    for (const [i, p] of plans.entries()) {
      fx.setLatest(p.slug, p.latest); fx.setPalette(p.slug, i);
      await reader.goto(`${fx.base}/manga/${p.slug}/`);
      await expect(full.locator(".tile")).toHaveCount(i + 1);
      await reader.goto(`${fx.base}/manga/${p.slug}/chapter-${p.current}/`);
      await expect(full.locator(".tile").filter({ hasText: `Ch. ${p.current}` })).toHaveCount(1);
    }
    fx.setPalette("the-silent-archive", 4);
    await reader.goto(`${fx.base}/novel/the-silent-archive/chapter-12/`);
    await expect(full.locator(".tile")).toHaveCount(5);
    await expect(full.locator(".tile .format-badge").filter({ hasText: "Novel" })).toHaveCount(1);
    await expect(full.locator(".tile .cover img")).toHaveCount(5);
    await reader.close();

    // Demonstration analytics, written only to this disposable browser profile.
    await full.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("manwhatrack"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      const tx = db.transaction(["series", "chapters", "events"], "readwrite");
      const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      const request = tx.objectStore("series").getAll();
      request.onsuccess = () => {
        for (const [index, s] of request.result.entries()) {
          let total = 0;
          for (let day = 0; day < 45; day++) {
            if ((day + index) % 4 === 0) continue;
            const date = new Date(); date.setDate(date.getDate() - day); date.setHours(19 + index % 3, 0, 0, 0);
            // Keep today's example activity in the past even during a morning capture.
            if (day === 0) date.setTime(Date.now() - (index + 1) * 3_600_000);
            const minutes = 5 + (day * 3 + index * 7) % 16;
            for (let n = 0; n < minutes; n++) {
              const startedAt = date.getTime() + n * 60_000;
              total += 60_000;
              tx.objectStore("events").put({ id: `store-time-${index}-${day}-${n}`, seriesId: s.id, chapterId: s.currentChapterId, type: "time", startedAt, timestamp: startedAt + 60_000, durationMs: 60_000 });
            }
            for (let n = 0; n < 2; n++) tx.objectStore("events").put({ id: `store-done-${index}-${day}-${n}`, seriesId: s.id, chapterId: `store-completed-${index}-${day}-${n}`, type: "completed", timestamp: date.getTime() + n * 120_000, chapterLabel: `Chapter ${Math.max(1, 90 - day * 2 + n)}` });
            tx.objectStore("events").put({ id: `store-backlog-${index}-${day}`, seriesId: s.id, type: "backlog", timestamp: date.getTime(), backlogCount: s.summary.newCount + Math.floor(day / 6) });
          }
          tx.objectStore("series").put({ ...s, totalReadingTimeMs: total, discoveredAt: Date.now() - 60 * 86_400_000 });
          const chapter = tx.objectStore("chapters").get(s.currentChapterId);
          chapter.onsuccess = () => { if (chapter.result) tx.objectStore("chapters").put({ ...chapter.result, readingTimeMs: total }); };
        }
      };
      await done; db.close();
    });
    await full.reload();
    const shot = async (page: Page, name: string) => {
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const png = await page.screenshot({ path: join(OUT!, name) });
      expect(png.readUInt32BE(16)).toBe(1280); expect(png.readUInt32BE(20)).toBe(800);
    };
    await shot(full, "01-library-1280x800.png");
    await full.getByRole("button", { name: "Create or manage lists", exact: true }).click();
    let dialog = full.getByRole("dialog");
    await dialog.getByLabel("New list name").fill("Read next");
    await dialog.getByRole("button", { name: "Create list", exact: true }).click();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await full.getByRole("complementary").getByRole("button", { name: /^Read next/ }).click();
    await full.getByRole("button", { name: "Add series", exact: true }).click();
    dialog = full.getByRole("dialog");
    await dialog.getByRole("checkbox", { name: "The Last Swordmaster", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "The Silent Archive", exact: true }).check();
    await dialog.getByRole("button", { name: "Save list", exact: true }).click();
    await expect(full.locator(".tile")).toHaveCount(2);
    await shot(full, "02-lists-1280x800.png");
    await full.locator(".tile").filter({ hasText: "The Last Swordmaster" }).click();
    await expect(full.locator(".detail-layout")).toBeVisible();
    await shot(full, "03-details-1280x800.png");
    await full.goto(`${ext}/library.html#analytics`);
    await expect(full.getByRole("img", { name: "Daily active reading in minutes" })).toBeVisible();
    await shot(full, "04-analytics-1280x800.png");
    await full.goto(`${ext}/options.html#general`);
    await expect(full.getByLabel("Theme", { exact: true })).toBeVisible();
    await shot(full, "05-settings-1280x800.png");

    // Brand graphic rendered from the existing app artwork, without altering screenshots.
    const promo = await ctx.newPage(); await promo.setViewportSize({ width: 440, height: 280 });
    const art = readFileSync(join(EXT, "assets/violet-hands.png")).toString("base64");
    await promo.setContent(`<!doctype html><html><style>
      *{box-sizing:border-box}body{margin:0;background:#241b31;color:#f7f3e8;width:440px;height:280px;overflow:hidden}
      header{height:110px;padding:25px 28px;position:relative;z-index:1}
      .name{display:flex;align-items:center;gap:12px;font:31px Georgia,serif;letter-spacing:-.7px}
      svg{width:30px;height:30px;flex:none}p{margin:12px 0 0;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#c4b2ef;letter-spacing:.2px}
      img{display:block;width:440px;height:170px;object-fit:cover;object-position:center;background:#4726ce}
      </style><body><header><div class="name"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#bea8ff"/><path d="M10 7h12v19l-6-4-6 4V7Z" fill="#241b31"/></svg>ManwhaTrack</div><p>Remember where you stopped.</p></header><img src="data:image/png;base64,${art}" alt=""></body></html>`);
    await promo.locator("img").evaluate((img: HTMLImageElement) => img.decode());
    const png = await promo.screenshot({ path: join(OUT!, "promo-440x280.png") });
    expect(png.readUInt32BE(16)).toBe(440); expect(png.readUInt32BE(20)).toBe(280);
    copyFileSync(join(EXT, "icons/icon128.png"), join(OUT!, "icon-128.png"));
    expect(errors).toEqual([]);
  } finally {
    await ctx.close(); fx.server.close(); rmSync(dir, { recursive: true, force: true });
  }
});
