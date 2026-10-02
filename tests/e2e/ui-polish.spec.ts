import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";

const EXT = fileURLToPath(new URL("../../dist", import.meta.url));
const OUT = process.env.SCREENSHOT_DIR;
async function bounds(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button,input,select,textarea")].filter(el => el.getClientRects().length).filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map(el => el.getAttribute("aria-label") ?? el.textContent))).toEqual([]);
}
async function shot(page: Page, name: string) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test("sidebar metadata, expanded details, list forms, adaptive artwork and reduced motion", async () => {
  test.setTimeout(150_000);
  const fx = await startFixtureServer({ host: "asurascans.example" });
  fx.setLatest("nano-machine", 304);
  const dir = mkdtempSync(join(tmpdir(), "mt-polish-"));
  const ctx = await chromium.launchPersistentContext(dir, { channel: "chromium", headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined, viewport: { width: 1280, height: 950 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--host-resolver-rules=MAP *.example 127.0.0.1"] });
  ctx.setDefaultTimeout(10_000);
  const errors: string[] = [];
  try {
    let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(sw.url()).host}`;
    // Recommendations can reuse the theme's chapter class but belong to another work.
    await ctx.route("**/manga/nano-machine/", async route => {
      const local = new URL(route.request().url()); local.hostname = "127.0.0.1";
      const response = await route.fetch({ url: local.href, headers: { ...route.request().headers(), host: new URL(fx.base).host } });
      await route.fulfill({ response, body: (await response.text()).replace("</body>", '<aside><li class="wp-manga-chapter"><a href="/manga/another-series/chapter-999/">Chapter 999</a></li></aside></body>') });
    });
    const reader = await ctx.newPage();
    await reader.goto(`${fx.base}/manga/nano-machine/`);
    const panel = await ctx.newPage();
    panel.on("pageerror", e => errors.push(e.message));
    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.goto(`${ext}/sidepanel.html`);
    await panel.getByLabel("Lists and library views").selectOption("all");
    await expect(panel.locator(".srow")).toHaveCount(1);
    await expect(panel.locator(".cover img").first()).toBeVisible();
    await reader.goto(`${fx.base}/manga/nano-machine/chapter-153/`);
    await reader.bringToFront(); await reader.evaluate(() => scrollTo(0, 1700)); await reader.waitForTimeout(700);
    await expect(panel.locator(".srow .meta-card").first()).toHaveText("Ch. 153");
    await expect(panel.locator(".srow .source-badge")).toHaveText("Asura Scans");
    await expect(panel.locator(".srow .source-badge")).toHaveAttribute("title", "asurascans.example");
    expect((await panel.locator(".srow").boundingBox())?.height).toBe(88);
    await expect(panel.locator(".colophon-roomy")).toBeAttached();
    const roomy = await panel.locator(".landscape-scene").evaluate(el => el.getBoundingClientRect().height);
    for (const width of [280, 380]) for (const colorScheme of ["light", "dark"] as const) {
      await panel.setViewportSize({ width, height: 900 }); await panel.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await bounds(panel); await shot(panel, `polished-sidebar-${colorScheme}-${width}`);
    }
    await panel.setViewportSize({ width: 380, height: 900 });
    const [full] = await Promise.all([ctx.waitForEvent("page"), panel.getByRole("button", { name: "Expand library", exact: true }).click()]);
    full.on("pageerror", e => errors.push(e.message));
    await full.waitForURL(/library.html/);
    await full.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    const clouds = full.locator(".featured-continue .scene-clouds");
    await expect(full.locator(".featured-continue .hands-scene")).toHaveAttribute("data-visible", "true");
    const initial = await clouds.evaluate(el => getComputedStyle(el).transform);
    await full.waitForTimeout(400);
    expect(await clouds.evaluate(el => getComputedStyle(el).transform)).not.toBe(initial);
    await full.locator(".colophon").scrollIntoViewIfNeeded();
    await expect(full.locator(".colophon")).toHaveAttribute("data-visible", "true");
    // Headless Chromium keeps background pages visible. Exercise the visibility
    // handler explicitly; reduced motion and off-screen pausing remain real.
    await full.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    await expect(full.locator(".colophon")).toHaveAttribute("data-visible", "false");
    expect(await full.locator(".river-shimmer").evaluate(el => getComputedStyle(el).animationPlayState)).toBe("paused");
    await full.evaluate(() => { Reflect.deleteProperty(document, "visibilityState"); document.dispatchEvent(new Event("visibilitychange")); });
    await full.locator(".featured-continue").scrollIntoViewIfNeeded();
    await expect(full.locator(".featured-continue .hands-scene")).toHaveAttribute("data-visible", "true");
    await full.emulateMedia({ reducedMotion: "reduce" });
    expect(await clouds.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
    await shot(full, "polished-expanded-dark");
    await full.locator(".tile").filter({ hasText: "Nano Machine" }).click();
    await expect(full.locator(".detail-layout")).toBeVisible();
    await expect(full.locator(".detail-chapters .chapters li")).toHaveCount(100);
    await expect(full.locator(".progress-facts")).toContainText("Ch. 153");
    await expect(full.locator(".progress-facts")).toContainText("Ch. 304");
    const chapterBox = await full.locator(".detail-chapters").boundingBox();
    const metadataBox = await full.locator(".detail-metadata").boundingBox();
    expect(chapterBox!.x).toBeGreaterThan(metadataBox!.x + metadataBox!.width);
    for (const colorScheme of ["light", "dark"] as const) {
      await full.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await bounds(full); await shot(full, `polished-details-${colorScheme}`);
    }
    // Exercise a chapter beyond the initial page, then edit its actual number/label.
    await full.getByRole("button", { name: "Show 100 more", exact: true }).click();
    await full.getByRole("button", { name: "Actions for Chapter 153", exact: true }).click();
    await full.getByRole("menuitem", { name: "Edit label / number…" }).click();
    await full.getByLabel("Label", { exact: true }).fill("Chapter 153.5");
    await full.getByLabel("Number used for ordering (blank for specials)").fill("153.5");
    await full.getByRole("button", { name: "Save", exact: true }).click();
    await expect(full.locator(".progress-facts")).toContainText("Ch. 153.5");
    await full.reload(); await full.locator(".tile").filter({ hasText: "Nano Machine" }).click(); await expect(full.locator(".progress-facts")).toContainText("Ch. 153.5");
    await full.getByRole("button", { name: "Back to library", exact: true }).click();
    await full.getByRole("button", { name: "Create or manage lists", exact: true }).click();
    const dialog = full.getByRole("dialog");
    await dialog.getByLabel("New list name").fill("Read weekly — a deliberately long personal collection");
    await dialog.getByRole("button", { name: "Create list", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Edit / add series", exact: true })).toBeVisible();
    await dialog.getByLabel("New list name").fill("Weekly");
    await dialog.getByRole("button", { name: "Create list", exact: true }).click();
    const shortName = dialog.getByText("Weekly", { exact: true });
    await expect(shortName).toBeVisible();
    await expect(dialog.getByLabel("New list name")).toHaveValue("");
    const nameBox = await shortName.boundingBox();
    const rowBox = await dialog.locator(".collection-row").filter({ has: full.getByText("Weekly", { exact: true }) }).boundingBox();
    expect(Math.abs(nameBox!.x - rowBox!.x)).toBeLessThan(2);
    await bounds(full); await shot(full, "polished-list-manager-expanded");
    await dialog.locator(".collection-row").filter({ hasText: "Read weekly — a deliberately long personal collection" }).getByRole("button", { name: "Edit / add series", exact: true }).click();
    await dialog.getByLabel("Nano Machine", { exact: true }).check();
    await bounds(full); await shot(full, "polished-list-edit-expanded");
    await dialog.getByRole("button", { name: "Save list", exact: true }).click();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    // Lists remain usable at the actual narrow panel width.
    await panel.getByLabel("Lists and library views").selectOption("manage");
    await panel.setViewportSize({ width: 280, height: 700 });
    await bounds(panel); await shot(panel, "polished-list-manager-280"); await panel.keyboard.press("Escape");
    for (let i = 0; i < 10; i++) {
      await reader.goto(`${fx.base}/manga/series-${i}/`);
      await expect.poll(async () => panel.locator(".toolbar").textContent()).toContain(`${i + 2} series`);
    }
    await expect(panel.locator(".colophon-compact")).toBeAttached();
    expect(await panel.locator(".landscape-scene").evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(roomy);
    await full.getByRole("complementary").getByRole("button", { name: "All series", exact: true }).click();
    await expect(full.locator(".featured-continue")).toHaveCount(0);
    await full.getByRole("complementary").getByRole("button", { name: /^Continue\b/ }).click();
    await full.setViewportSize({ width: 1280, height: 600 });
    await full.emulateMedia({ reducedMotion: "no-preference" });
    await full.locator(".colophon").scrollIntoViewIfNeeded();
    await expect(full.locator(".featured-continue .hands-scene")).toHaveAttribute("data-visible", "false");
    expect(await clouds.evaluate(el => getComputedStyle(el).animationPlayState)).toBe("paused");
    expect(errors).toEqual([]);
  } finally { await ctx.close(); fx.server.close(); rmSync(dir, { recursive: true, force: true }); }
});
