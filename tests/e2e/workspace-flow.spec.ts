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
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button,input,select,textarea")].filter(el => el.getClientRects().length).filter(el => { const r=el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth+1; }).map(el=>el.getAttribute("aria-label") ?? el.textContent))).toEqual([]);
}
async function shot(page: Page, name: string) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: name.includes("settings") });
}

test("direct list membership, calm outer scenery, scrolling and settings survive restart", async () => {
  test.setTimeout(150_000);
  const fx = await startFixtureServer();
  const dir = mkdtempSync(join(tmpdir(), "mt-workspace-"));
  const launch = () => chromium.launchPersistentContext(dir, { channel:"chromium", headless:true, executablePath:process.env.PW_CHROMIUM_PATH || undefined, viewport:{width:2560,height:1000}, args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`] });
  let ctx = await launch();
  const errors: string[] = [];
  try {
    let [worker] = ctx.serviceWorkers(); worker ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(worker.url()).host}`;
    const reader = await ctx.newPage();
    const panel = await ctx.newPage(); await panel.goto(`${ext}/sidepanel.html`);
    await panel.getByLabel("Lists and library views").selectOption("all");
    for (const [i, slug] of ["nano-machine","solo-leveling","starfall-academy",...Array.from({length:5},(_,i)=>`test-series-${i}`)].entries()) {
      await reader.goto(`${fx.base}/manga/${slug}/`); await expect(panel.locator(".srow")).toHaveCount(i+1);
      await reader.goto(`${fx.base}/manga/${slug}/chapter-12/`);
      await expect(panel.locator(".srow").filter({has:panel.locator(".meta-card",{hasText:"Ch. 12"})})).toHaveCount(i+1);
      await expect(panel.locator(".srow .cover img")).toHaveCount(i+1);
    }
    await reader.close(); await panel.close();
    const full = await ctx.newPage(); full.on("pageerror",e=>errors.push(e.message));
    await full.goto(`${ext}/library.html`); await full.emulateMedia({colorScheme:"dark",reducedMotion:"no-preference"});
    await full.getByRole("complementary").getByRole("button",{name:"All series",exact:true}).click();
    await full.locator(".tile").first().focus(); await full.keyboard.press("ArrowDown");
    const pageCount=ctx.pages().length;
    await full.locator(".rail-more summary").focus(); await full.keyboard.press("Enter");
    await expect(full.locator(".rail-more")).toHaveAttribute("open",""); await full.waitForTimeout(300); expect(ctx.pages()).toHaveLength(pageCount);
    await full.keyboard.press("Enter"); await expect(full.locator(".rail-more")).not.toHaveAttribute("open","");
    await full.getByRole("button",{name:"Create or manage lists",exact:true}).click();
    let dialog = full.getByRole("dialog");
    await dialog.getByLabel("New list name").fill("Peak"); await dialog.getByRole("button",{name:"Create list",exact:true}).click();
    await dialog.getByRole("button",{name:"Done",exact:true}).click();
    await full.getByRole("complementary").getByRole("button",{name:/^Peak/}).click();
    await expect(full.getByText("This list is empty.")).toBeVisible();
    await full.getByRole("button",{name:"Add series",exact:true}).click();
    dialog=full.getByRole("dialog",{name:"Add series to list"});
    await dialog.getByLabel("Find series").fill("Nano"); await dialog.getByRole("checkbox",{name:"Nano Machine",exact:true}).check();
    await dialog.getByLabel("Find series").fill("Solo"); await dialog.getByRole("checkbox",{name:"Solo Leveling",exact:true}).check();
    await dialog.getByRole("button",{name:"Save list",exact:true}).click();
    await expect(full.getByRole("dialog")).toHaveCount(0); await expect(full.locator(".tile")).toHaveCount(2);
    await expect(full.locator(".featured-continue")).toHaveCount(0);
    await full.getByRole("button",{name:"Add series",exact:true}).click(); dialog=full.getByRole("dialog");
    for (const width of [320,1280]) { await full.setViewportSize({width,height:1000}); await bounds(full); await shot(full,`workspace-list-picker-${width}`); }
    await full.setViewportSize({width:2560,height:1000});
    await dialog.getByRole("checkbox",{name:"Nano Machine",exact:true}).uncheck(); await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
    await expect(full.locator(".tile")).toHaveCount(2);
    await full.getByRole("button",{name:"Add series",exact:true}).click(); dialog=full.getByRole("dialog");
    await dialog.getByRole("checkbox",{name:"Nano Machine",exact:true}).uncheck(); await dialog.getByRole("button",{name:"Save list",exact:true}).click();
    await expect(full.locator(".tile")).toHaveCount(1); await expect(full.locator(".tile")).toContainText("Solo Leveling");
    await full.getByRole("button",{name:"Filters",exact:true}).click(); await full.getByLabel("Filter by status").selectOption("planning");
    await expect(full.getByText("No series match this list’s filters.")).toBeVisible(); await expect(full.getByText("This list is empty.")).toHaveCount(0);
    await full.getByRole("button",{name:"Clear filters",exact:true}).click(); await expect(full.locator(".tile")).toHaveCount(1);
    await full.getByRole("button",{name:"Filters",exact:true}).click();
    for (const width of [320,652,1280,2560]) {
      await full.setViewportSize({width,height:1000}); await bounds(full);
      if(width>=960) expect((await full.locator(".tile").boundingBox())!.width).toBe(224);
      await shot(full,`workspace-list-dark-${width}`);
    }
    await full.setViewportSize({width:2560,height:1000});
    await expect(full.locator(".margin-scenery")).toHaveAttribute("data-visible","true");
    const appBox=await full.locator(".app").boundingBox();
    const left=await full.locator(".margin-left").boundingBox(), right=await full.locator(".margin-right").boundingBox();
    expect(left!.x+left!.width).toBeLessThanOrEqual(appBox!.x+1); expect(right!.x).toBeGreaterThanOrEqual(appBox!.x+appBox!.width-1);
    const clouds=full.locator(".margin-clouds").first(); const before=await clouds.evaluate(el=>getComputedStyle(el).transform);
    expect(await clouds.evaluate(el=>getComputedStyle(el).animationDuration)).toBe("10s");
    expect(await clouds.evaluate(el=>getComputedStyle(el).opacity)).toBe("0.09");
    await full.waitForTimeout(1200); expect(await clouds.evaluate(el=>getComputedStyle(el).transform)).not.toBe(before);
    expect(await full.locator(".margin-scenery").evaluate(el=>getComputedStyle(el).pointerEvents)).toBe("none");
    await full.emulateMedia({reducedMotion:"reduce"}); expect(await clouds.evaluate(el=>getComputedStyle(el).animationName)).toBe("none");
    await full.emulateMedia({reducedMotion:"no-preference"});
    await full.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"));});
    await expect(full.locator(".margin-scenery")).toHaveAttribute("data-visible","false");
    expect(await clouds.evaluate(el=>getComputedStyle(el).animationPlayState)).toBe("paused");
    await full.evaluate(()=>{Reflect.deleteProperty(document,"visibilityState");document.dispatchEvent(new Event("visibilitychange"));});
    await full.getByRole("complementary").getByRole("button",{name:"All series",exact:true}).click();
    await expect(full.locator(".tile")).toHaveCount(8);
    expect(await full.locator("main.scroll").evaluate(el=>getComputedStyle(el).scrollbarWidth)).toBe("none");
    await full.locator("main.scroll").focus(); await full.keyboard.press("PageDown");
    await expect.poll(()=>full.locator("main.scroll").evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    await full.locator("main.scroll").evaluate(el=>el.scrollTo(0,0));
    await full.mouse.move(appBox!.x+400,500); await full.mouse.wheel(0,600);
    await expect.poll(()=>full.locator("main.scroll").evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    const opts=await ctx.newPage(); opts.on("pageerror",e=>errors.push(e.message)); await opts.goto(`${ext}/options.html`);
    await opts.getByLabel("Theme",{exact:true}).selectOption("dark");
    const background=opts.getByRole("switch",{name:"Background scenery",exact:true});
    await expect(background).toHaveAttribute("aria-checked","true"); await background.click();
    await expect(full.locator(".margin-scenery")).toHaveCount(0);
    await opts.getByRole("switch",{name:"Show reading timer",exact:true}).click(); await expect(full.locator(".reading-timer")).toHaveCount(0);
    await opts.getByRole("switch",{name:"Show featured Continue",exact:true}).click();
    await full.getByRole("complementary").getByRole("button",{name:/^Continue\b/}).click(); await expect(full.locator(".featured-continue")).toHaveCount(0);
    await opts.getByLabel("Cover card size").selectOption("large"); await expect.poll(async()=> (await full.locator(".tile").first().boundingBox())!.width).toBe(260);
    await opts.getByRole("switch",{name:"Show scrollbars",exact:true}).focus(); await opts.keyboard.press("Space");
    await expect(opts.getByRole("switch",{name:"Show scrollbars",exact:true})).toHaveAttribute("aria-checked","true");
    await expect.poll(()=>full.locator("main.scroll").evaluate(el=>getComputedStyle(el).scrollbarWidth)).toBe("auto");
    await opts.getByRole("switch",{name:"Show scrollbars",exact:true}).click();
    await opts.getByLabel("Expanded library layout").selectOption("list"); await expect(full.locator(".srow")).toHaveCount(8);
    await opts.getByLabel("Expanded library layout").selectOption("grid"); await expect(full.locator(".tile")).toHaveCount(8);
    await opts.getByRole("switch",{name:"Check for new chapters",exact:true}).click(); await expect(opts.getByLabel("Minimum time between checks of one source")).toBeDisabled();
    for(const width of [320,652,1280]) for(const theme of ["light","dark"]) {
      await opts.setViewportSize({width,height:1000}); await opts.getByLabel("Theme",{exact:true}).selectOption(theme); await bounds(opts);
      if(width===320) expect((await opts.getByRole("switch",{name:"Background scenery",exact:true}).boundingBox())!.x).toBeGreaterThan(200);
      await shot(opts,`workspace-settings-${theme}-${width}`);
    }
    await ctx.close(); ctx=await launch();
    const reopened=await ctx.newPage(); reopened.on("pageerror",e=>errors.push(e.message)); await reopened.goto(`${ext}/library.html`);
    await reopened.getByRole("complementary").getByRole("button",{name:/^Peak/}).click(); await expect(reopened.locator(".tile")).toHaveCount(1);
    await expect(reopened.locator(".tile")).toContainText("Solo Leveling"); await expect(reopened.locator(".margin-scenery")).toHaveCount(0); await expect(reopened.locator(".reading-timer")).toHaveCount(0);
    expect((await reopened.locator(".tile").boundingBox())!.width).toBe(260);
    await reopened.getByRole("complementary").getByRole("button",{name:"All series",exact:true}).click(); await expect(reopened.locator(".tile")).toHaveCount(8);
    await reopened.getByRole("complementary").getByRole("button",{name:/^Peak/}).click();
    await reopened.getByRole("button",{name:"Add series",exact:true}).click();
    await reopened.getByRole("dialog").getByRole("button",{name:"Track a series manually",exact:true}).click();
    const manual=reopened.getByRole("dialog",{name:"Track a series manually"});
    await manual.getByLabel("Title",{exact:true}).fill("A manually tracked story");
    await manual.getByLabel("Source page address").fill(`${fx.base}/manga/manual-story/`);
    await manual.getByRole("button",{name:"Track series",exact:true}).click();
    await expect(reopened.locator(".series-detail")).toBeVisible();
    await reopened.getByRole("button",{name:"Back to library",exact:true}).click();
    await expect(reopened.locator(".tile")).toHaveCount(2); await expect(reopened.locator(".tile").filter({hasText:"A manually tracked story"})).toBeVisible();
    await reopened.reload(); await expect(reopened.locator(".tile")).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {await ctx.close();fx.server.close();rmSync(dir,{recursive:true,force:true});}
});
