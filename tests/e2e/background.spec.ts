// Service-worker paths: update checks (fetch → offscreen DOMParser → diff), cover Referer,
// context-menu wiring and absence of runtime errors.

import { expect, test, chromium } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";

const EXT = fileURLToPath(new URL("../../dist", import.meta.url));

test("update check finds new chapters without errors", async () => {
  const fx = await startFixtureServer();
  const dir = mkdtempSync(join(tmpdir(), "mt-e2e-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const errors: string[] = [];
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent("serviceworker");
    sw.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const ext = `chrome-extension://${new URL(sw.url()).host}`;

    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
    await page.goto(`${fx.base}/manga/moonlit-garden/`);
    await page.goto(`${fx.base}/manga/moonlit-garden/chapter-33/`);
    for (let y = 0; y < 12; y++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(60);
    }

    const panel = await ctx.newPage();
    panel.on("pageerror", (e) => errors.push(`panel: ${e.message}`));
    await panel.goto(`${ext}/sidepanel.html`);
    const row = panel.locator(".srow").filter({ hasText: "Moonlit Garden" });
    await expect(row).toContainText("Ch. 33 read", { timeout: 15_000 });
    await expect(row).toContainText("Caught up");

    // The site publishes two chapters; a manual refresh picks them up via the offscreen parser.
    fx.setLatest("moonlit-garden", 35);
    const res = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "updates/check" }));
    expect(res).toMatchObject({ ok: true });
    await expect(row).toContainText("2 new", { timeout: 15_000 });
    expect(fx.requests.some((r) => r.startsWith("GET /manga/moonlit-garden/ referer=http://127.0.0.1"))).toBe(true);

    // Source health is recorded.
    await row.click();
    await expect(panel.locator(".source")).toContainText("Healthy");

    // Menus exist and toggle with page state (no "Cannot find menu item" errors).
    await page.bringToFront();
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
    fx.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracking survives the service worker being terminated", async () => {
  const fx = await startFixtureServer();
  const dir = mkdtempSync(join(tmpdir(), "mt-e2e-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(sw.url()).host}`;
    const page = await ctx.newPage();
    await page.goto(`${fx.base}/manga/tower-of-the-mage-king/chapter-7/`);
    const panel = await ctx.newPage();
    await panel.goto(`${ext}/sidepanel.html`);
    const row = panel.locator(".srow").filter({ hasText: "Tower Of The Mage King" });
    await expect(row).toContainText("Ch. 7", { timeout: 15_000 });

    // Manifest V3 may stop the worker at any time; nothing may depend on its memory.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    await page.waitForTimeout(500);

    // The next page's message wakes a fresh worker, which tracks it normally.
    await page.goto(`${fx.base}/manga/tower-of-the-mage-king/chapter-8/`);
    await expect(row).toContainText("Ch. 8", { timeout: 15_000 });
    await panel.reload();
    await expect(panel.locator(".srow").filter({ hasText: "Tower Of The Mage King" })).toContainText("Ch. 8");
  } finally {
    await ctx.close();
    fx.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
