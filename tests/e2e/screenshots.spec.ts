// Generates the README screenshots from a realistic demo library.
//   SCREENSHOT_DIR=docs/screenshots npm run test:e2e -- screenshots
// Two fictional sites (inkwell.example, toonhaven.example) are mapped to a local fixture server.

import { test, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";

const EXT = fileURLToPath(new URL("../../dist", import.meta.url));
const OUT = process.env.SCREENSHOT_DIR;

test.skip(!OUT, "set SCREENSHOT_DIR to capture screenshots");
test.setTimeout(240_000);

interface Plan {
  slug: string;
  host: "inkwell" | "toonhaven";
  latest: number;
  finished?: number[];
  partial?: [number, number];
}

const LIBRARY: Plan[] = [
  { slug: "the-last-swordmaster", host: "inkwell", latest: 64, finished: [57], partial: [58, 0.45] },
  { slug: "starfall-academy", host: "toonhaven", latest: 30, finished: [23] },
  { slug: "return-of-the-iron-scholar", host: "inkwell", latest: 91, partial: [88, 0.3] },
  { slug: "tower-of-the-mage-king", host: "toonhaven", latest: 120, finished: [120] },
  { slug: "crimson-tide-regression", host: "inkwell", latest: 45, finished: [44] },
  { slug: "bloom-in-winter", host: "toonhaven", latest: 12, finished: [12] },
  { slug: "moonlit-garden", host: "inkwell", latest: 18 },
  { slug: "the-quiet-blacksmith", host: "toonhaven", latest: 9, finished: [3] },
];

async function readTo(page: Page, url: string, fraction: number) {
  await page.goto(url);
  await page.waitForTimeout(500);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const target = fraction >= 1 ? height : height * fraction;
  for (let y = 0; y < target; y += 900) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(fraction >= 1 ? 600 : 5600); // let a progress update flush
}

async function menuAction(panel: Page, title: string, action: string) {
  await panel.locator(".srow").filter({ hasText: title }).click({ button: "right" });
  await panel.locator(".menu button", { hasText: new RegExp(`^${action}`) }).first().click();
  await panel.waitForTimeout(250);
}

test("README screenshots", async () => {
  const fx = await startFixtureServer({ host: "inkwell.example" });
  const port = new URL(fx.base).port;
  const base = { inkwell: `http://inkwell.example:${port}`, toonhaven: `http://toonhaven.example:${port}` };
  const dir = mkdtempSync(join(tmpdir(), "mt-shots-"));
  const ctx: BrowserContext = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--host-resolver-rules=MAP *.example 127.0.0.1"],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(sw.url()).host}`;
    const reader = await ctx.newPage();
    await reader.setViewportSize({ width: 1100, height: 820 });

    LIBRARY.forEach((p, i) => fx.setPalette(p.slug, i));
    for (const p of LIBRARY) {
      fx.setLatest(p.slug, p.latest);
      const b = base[p.host];
      await reader.goto(`${b}/manga/${p.slug}/`);
      await reader.waitForTimeout(700);
      for (const n of p.finished ?? []) await readTo(reader, `${b}/manga/${p.slug}/chapter-${n}/`, 1);
      if (p.partial) await readTo(reader, `${b}/manga/${p.slug}/chapter-${p.partial[0]}/`, p.partial[1]);
    }

    const panel = await ctx.newPage();
    await panel.setViewportSize({ width: 380, height: 820 });
    await panel.goto(`${ext}/sidepanel.html`);
    await panel.waitForTimeout(800);
    await panel.locator(".tab", { hasText: "All" }).click();
    await menuAction(panel, "Bloom in Winter", "Favorite");
    await menuAction(panel, "The Last Swordmaster", "Favorite");
    await menuAction(panel, "Tower of the Mage King", "Pin");
    await menuAction(panel, "The Quiet Blacksmith", "Dropped");
    await panel.waitForTimeout(4200); // let confirmation toasts fade before capturing

    const shot = async (page: Page, name: string, scheme: "light" | "dark") => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/${name}.png` });
    };

    // Library: Continue view (light), grid of everything (dark).
    await panel.locator(".tab", { hasText: "Continue" }).click();
    await shot(panel, "library-light", "light");
    await shot(panel, "library-dark", "dark");
    await panel.locator(".tab", { hasText: "All" }).click();
    await panel.locator('button[aria-label="Show as grid"]').click();
    await shot(panel, "grid-dark", "dark");
    await panel.locator('button[aria-label="Show as list"]').click();

    // Series detail.
    await panel.locator(".srow").filter({ hasText: "The Last Swordmaster" }).click();
    await panel.waitForTimeout(500);
    await shot(panel, "detail-light", "light");
    await shot(panel, "detail-dark", "dark");
    await panel.keyboard.press("Escape");

    // Command palette.
    await panel.keyboard.press("ControlOrMeta+k");
    await panel.keyboard.type("star");
    await shot(panel, "palette-dark", "dark");
    await panel.keyboard.press("Escape");

    // Settings: privacy and statistics.
    const opts = await ctx.newPage();
    await opts.setViewportSize({ width: 1100, height: 760 });
    await opts.goto(`${ext}/options.html#storage`);
    await shot(opts, "privacy-light", "light");
    await opts.goto(`${ext}/options.html#stats`);
    await shot(opts, "stats-dark", "dark");

    // Hero: the reader beside the panel, composed in a simple browser frame.
    await readTo(reader, `${base.inkwell}/manga/the-last-swordmaster/chapter-58/`, 0.25);
    await reader.emulateMedia({ colorScheme: "light" });
    await panel.emulateMedia({ colorScheme: "light" });
    await panel.goto(`${ext}/sidepanel.html`);
    await panel.waitForTimeout(800);
    const readerPng = (await reader.screenshot()).toString("base64");
    const panelPng = (await panel.screenshot()).toString("base64");
    const hero = await ctx.newPage();
    await hero.setViewportSize({ width: 1600, height: 960 });
    const iconPng = readFileSync(join(EXT, "icons/icon48.png")).toString("base64");
    await hero.setContent(heroHtml(readerPng, panelPng, `inkwell.example/manga/the-last-swordmaster/chapter-58`, iconPng));
    await hero.waitForTimeout(300);
    await hero.screenshot({ path: `${OUT}/hero.png` });

  } finally {
    await ctx.close();
    fx.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function heroHtml(reader: string, panel: string, url: string, icon: string): string {
  return `<!doctype html><html><head><style>
    body{margin:0;height:100vh;display:grid;place-items:center;font:13px ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      background:linear-gradient(160deg,#eef1f7 0%,#dfe5f1 100%)}
    .win{width:1480px;height:880px;border-radius:12px;overflow:hidden;background:#fff;display:grid;grid-template-rows:44px 1fr;
      box-shadow:0 30px 80px rgba(30,40,70,.25),0 2px 6px rgba(30,40,70,.12);border:1px solid #cfd5e2}
    .bar{display:flex;align-items:center;gap:14px;padding:0 16px;background:#f3f4f7;border-bottom:1px solid #e1e4ea}
    .dots{display:flex;gap:8px}.dots i{width:12px;height:12px;border-radius:50%;background:#ff5f57}.dots i:nth-child(2){background:#febc2e}.dots i:nth-child(3){background:#28c840}
    .url{flex:1;max-width:620px;height:28px;border-radius:7px;background:#fff;border:1px solid #e1e4ea;display:flex;align-items:center;padding:0 12px;color:#55595f}
    .ext{margin-left:auto;width:22px;height:22px;border-radius:5px}
    .body{display:grid;grid-template-columns:1fr 380px;min-height:0}
    .body img{display:block;width:100%;height:100%;object-fit:cover;object-position:top left}
    .panel{border-left:1px solid #e1e4ea}
  </style></head><body><div class="win"><div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="url">${url}</div><img class="ext" src="data:image/png;base64,${icon}"></div>
  <div class="body"><img src="data:image/png;base64,${reader}"><div class="panel"><img src="data:image/png;base64,${panel}"></div></div></div></body></html>`;
}
