import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Settings } from "../../src/shared/types/settings";
import { startFixtureServer } from "./fixture-server";

const EXT = fileURLToPath(new URL("../../dist", import.meta.url));
const options = { channel: "chromium", headless: process.platform !== "darwin" || !!process.env.CI, executablePath: process.env.PW_CHROMIUM_PATH || undefined, viewport: { width: 380, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] };
async function shot(page: Page, name: string) {
  if (!process.env.SCREENSHOT_DIR) return;
  mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` });
}

test("footer fits the viewport, visibly moves, and saves its motion preference", async () => {
  const fx = await startFixtureServer();
  const dir = mkdtempSync(join(tmpdir(), "mt-motion-"));
  const ctx = await chromium.launchPersistentContext(dir, options);
  try {
    let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(sw.url()).host}`;
    const reader = await ctx.newPage(); await reader.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);
    const panel = await ctx.newPage(); await panel.goto(`${ext}/sidepanel.html`);
    await expect(panel.locator(".srow")).toHaveCount(1);
    await panel.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
    const landscape = panel.locator(".landscape-scene");
    await expect(panel.getByText("Your library stays on this device.", { exact: true })).toHaveCount(0);
    expect(await panel.locator(".colophon").evaluate(el => getComputedStyle(el).borderTopWidth)).toBe("0px");
    await expect(panel.locator(".colophon")).toHaveAttribute("data-visible", "true");
    const tall = await landscape.evaluate(el => el.getBoundingClientRect().height);
    await panel.setViewportSize({ width: 380, height: 640 });
    await expect.poll(async () => landscape.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(tall - 30);
    await shot(panel, "sidebar-short");
    await panel.setViewportSize({ width: 380, height: 900 });
    await expect.poll(async () => landscape.evaluate(el => el.getBoundingClientRect().height)).toBe(tall);
    const art = panel.locator(".landscape-image");
    const before = await art.evaluate(el => el.getBoundingClientRect().x);
    const frame = await landscape.screenshot();
    await panel.waitForTimeout(1400);
    expect(Math.abs(await art.evaluate(el => el.getBoundingClientRect().x) - before)).toBeGreaterThan(1);
    expect((await landscape.screenshot()).equals(frame)).toBe(false);
    await shot(panel, "sidebar-tall");
    await panel.getByRole("button", { name: "Pause artwork animation" }).click();
    await expect.poll(() => art.evaluate(el => getComputedStyle(el).animationPlayState)).toBe("paused");
    await panel.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const stopped = await art.evaluate(el => getComputedStyle(el).transform);
    await panel.waitForTimeout(500);
    expect(await art.evaluate(el => getComputedStyle(el).transform)).toBe(stopped);
    await panel.reload();
    await expect(panel.getByRole("button", { name: "Play artwork animation" })).toBeVisible();
    await expect.poll(() => art.evaluate(el => getComputedStyle(el).animationPlayState)).toBe("paused");
    // System respects reduced motion, while an explicit Play opt-in works.
    await sw.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...(settings as Settings), artworkMotion: "system" } }); });
    await panel.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => art.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
    await panel.getByRole("button", { name: "Play artwork animation" }).click();
    await expect.poll(() => art.evaluate(el => getComputedStyle(el).animationName)).toBe("landscape-drift");
    await expect.poll(() => art.evaluate(el => getComputedStyle(el).animationPlayState)).toBe("running");
    for (const width of [280, 380]) {
      await panel.setViewportSize({ width, height: 700 });
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(panel.getByRole("button", { name: "Pause artwork animation" })).toBeVisible();
      const caption = await panel.locator(".colophon-caption").boundingBox();
      const text = await panel.locator(".colophon-caption > div").boundingBox();
      expect(Math.abs((text!.x+text!.width/2)-(caption!.x+caption!.width/2))).toBeLessThan(2);
    }
    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.getByLabel("Lists and library views").selectOption("all");
    for (let i = 0; i < 5; i++) { await reader.goto(`${fx.base}/manga/series-${i}/`); await expect(panel.locator(".srow")).toHaveCount(i + 2); }
    await expect.poll(async () => landscape.evaluate(el => el.getBoundingClientRect().height)).toBe(84);
    await panel.locator(".colophon").scrollIntoViewIfNeeded();
    await shot(panel, "sidebar-many-series");
  } finally { await ctx.close(); fx.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("active timer pauses, totals match chapter time, and survive closing the browser", async () => {
  const fx = await startFixtureServer();
  const dir = mkdtempSync(join(tmpdir(), "mt-time-"));
  let ctx = await chromium.launchPersistentContext(dir, options);
  try {
    let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(sw.url()).host}`;
    const reader = await ctx.newPage(); await reader.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);
    const panel = await ctx.newPage(); await panel.goto(`${ext}/sidepanel.html`);
    await expect(panel.locator(".srow")).toHaveCount(1);
    await reader.bringToFront(); await reader.evaluate(() => scrollTo(0, 300));
    await expect.poll(() => reader.evaluate(() => document.hasFocus())).toBe(true);
    await expect(panel.getByRole("region", { name: "Reading timer" })).toHaveAttribute("data-active", "true");
    await expect.poll(async () => panel.getByRole("timer").textContent()).not.toBe("00:00");
    // UI preferences must not restart the actual reader session.
    const first = await panel.getByRole("timer").textContent();
    await sw.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...(settings as Settings), artworkMotion: "off", theme: "dark" } }); });
    await reader.waitForTimeout(2400);
    expect(await panel.getByRole("timer").textContent()).not.toBe(first);
    await panel.bringToFront();
    // Playwright forces document.hasFocus() true even in headed tabs. Disable
    // that override in this disposable reader before checking real focus loss.
    const readerSession = await ctx.newCDPSession(reader);
    await readerSession.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    await expect.poll(() => reader.evaluate(() => document.hasFocus())).toBe(false);
    await expect(panel.getByRole("region", { name: "Reading timer" })).toHaveAttribute("data-active", "false");
    const paused = await panel.getByRole("timer").textContent();
    await panel.waitForTimeout(1800);
    expect(await panel.getByRole("timer").textContent()).toBe(paused);
    const [full] = await Promise.all([ctx.waitForEvent("page"), panel.getByRole("button", { name: "Time tracking", exact: true }).click()]);
    await full.waitForURL(/library.html#time/);
    await full.setViewportSize({ width: 1280, height: 900 });
    await expect(full.getByTestId("total-reading-time")).not.toHaveText("00:00");
    await expect(full.getByTestId("total-reading-time")).toHaveText(paused!);
    const total = await full.getByTestId("total-reading-time").textContent();
    await full.getByRole("button", { name: "Solo Leveling", exact: true }).click();
    await expect(full.locator(".time-chapters")).toContainText("Chapter 5");
    await expect(full.locator(".time-chapters .reading-clock")).toHaveText(total!);
    await shot(full, "time-tracking-expanded");
    await ctx.close();
    ctx = await chromium.launchPersistentContext(dir, options);
    const reopened = await ctx.newPage(); await reopened.setViewportSize({ width: 1280, height: 900 }); await reopened.goto(`${ext}/library.html#time`);
    await expect(reopened.getByTestId("total-reading-time")).toHaveText(total!);
    await expect(reopened.getByRole("timer")).toHaveText("00:00");
    await reopened.getByRole("button", { name: "Back to library", exact: true }).click();
    await expect(reopened.locator(".tile")).toHaveCount(1);
    await reopened.getByRole("complementary").getByRole("button", { name: "Time tracking", exact: true }).click();
    await expect(reopened.getByTestId("total-reading-time")).toHaveText(total!);
    // Analytics reflects the same persisted measurements, and refreshes while
    // reading continues rather than waiting for the reader to stop.
    await reopened.getByRole("complementary").getByRole("button", { name: "Analytics", exact: true }).click();
    const active = reopened.locator(".analytics-overview dd").first();
    await expect(active).toHaveText(/^(<1|\d+)s$/);
    const before = await active.textContent();
    const nextReader = await ctx.newPage();await nextReader.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);await nextReader.bringToFront();
    await nextReader.evaluate(() => scrollTo(0,300));
    await expect.poll(() => active.textContent(), { timeout: 12_000 }).not.toBe(before);
    await nextReader.evaluate(() => scrollTo(0,document.body.scrollHeight));
    await expect(reopened.locator(".analytics-overview dd").nth(1)).toHaveText("1");
    await expect(reopened.locator(".analytics-overview dd").nth(2)).toHaveText("1");
    await nextReader.close();
    await reopened.reload();await expect(reopened.locator(".analytics-overview dd").nth(1)).toHaveText("1");
    await shot(reopened,"analytics-live-reading");
  } finally { await ctx.close(); fx.server.close(); rmSync(dir, { recursive: true, force: true }); }
});
