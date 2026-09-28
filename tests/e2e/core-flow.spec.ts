// Core acceptance test (AGENTS.md §83) in a real Chromium with the built extension.
// Run: npm run test:e2e

import { expect, test, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";

const EXT = fileURLToPath(new URL("../../dist", import.meta.url));

async function launch(userDataDir: string): Promise<{ ctx: BrowserContext; extId: string }> {
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1000, height: 800 },
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker");
  return { ctx, extId: new URL(sw.url()).host };
}

/** Reads a store from the extension's IndexedDB via an extension page. */
async function dbAll(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (s) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("manwhatrack");
        r.onsuccess = () => {
          const q = r.result.transaction(s).objectStore(s).getAll();
          q.onsuccess = () => {
            resolve(q.result);
            r.result.close();
          };
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
    store,
  );
}

test("new user: browse, read, click next, restart, continue", async () => {
  const { base, server } = await startFixtureServer();
  const dir = mkdtempSync(join(tmpdir(), "mt-e2e-"));
  try {
    let { ctx, extId } = await launch(dir);
    const ext = `chrome-extension://${extId}`;

    // 1. Visit the series page: it appears automatically with a cached cover.
    const page = await ctx.newPage();
    await page.goto(`${base}/manga/solo-leveling/`);
    const probe = await ctx.newPage();
    await probe.goto(`${ext}/options.html`);
    await expect.poll(async () => (await dbAll(probe, "series")).length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await dbAll(probe, "covers")).length, { timeout: 15_000 }).toBe(1);
    const [series] = await dbAll(probe, "series");
    expect(series?.title).toBe("Solo Leveling");

    // 2. Open Chapter 31: recorded as opened, not finished.
    await page.goto(`${base}/manga/solo-leveling/chapter-31/`);
    await expect
      .poll(async () => (await dbAll(probe, "chapters")).find((c) => c.chapterLabel === "Chapter 31")?.lastOpenedAt, { timeout: 15_000 })
      .toBeTruthy();
    expect((await dbAll(probe, "chapters")).find((c) => c.chapterLabel === "Chapter 31")?.completedAt).toBeUndefined();

    // 3. Read to the end and click Next.
    for (let y = 0; y < 12; y++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(120);
    }
    await page.click("#next");
    await page.waitForURL(/chapter-32/);
    await expect
      .poll(async () => {
        const ch = await dbAll(probe, "chapters");
        return [!!ch.find((c) => c.chapterLabel === "Chapter 31")?.completedAt, !!ch.find((c) => c.chapterLabel === "Chapter 32")?.lastOpenedAt];
      }, { timeout: 15_000 })
      .toEqual([true, true]);
    const s2 = (await dbAll(probe, "series"))[0] as { summary: { currentLabel: string; lastCompletedLabel: string; continueUrl: string } };
    expect(s2.summary.lastCompletedLabel).toBe("Chapter 31");
    expect(s2.summary.currentLabel).toBe("Chapter 32");

    // 4. Close Chrome and come back later.
    await ctx.close();
    ({ ctx, extId } = await launch(dir));
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);

    // The series is still there with its cover and says where the reader stopped.
    const row = panel.locator(".srow").filter({ hasText: "Solo Leveling" }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator("img[alt='Cover of Solo Leveling']")).toBeVisible();
    await expect(row).toContainText("Ch. 32");

    // 5. One click on Continue opens Chapter 32 (modifier-click → new tab).
    const [opened] = await Promise.all([ctx.waitForEvent("page"), row.locator(".btn.primary").click({ modifiers: ["ControlOrMeta"] })]);
    await opened.waitForURL(/chapter-32/);
    expect(opened.url()).toBe(`${base}/manga/solo-leveling/chapter-32/`);
    await ctx.close();
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("library opens and searches without network access", async () => {
  const { base, server } = await startFixtureServer();
  const dir = mkdtempSync(join(tmpdir(), "mt-e2e-"));
  try {
    const { ctx, extId } = await launch(dir);
    const page = await ctx.newPage();
    await page.goto(`${base}/manga/solo-leveling/chapter-5/`);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await expect(panel.locator(".srow, .continue-card").first()).toBeVisible({ timeout: 15_000 });

    await ctx.setOffline(true);
    await panel.reload();
    await panel.keyboard.press("/");
    await panel.keyboard.type("solo levling");
    await expect(panel.locator(".srow").filter({ hasText: "Solo Leveling" })).toBeVisible();
    await ctx.close();
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
