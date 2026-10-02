import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";
const EXT = fileURLToPath(new URL("../../dist", import.meta.url));
const OUT = process.env.SCREENSHOT_DIR;
async function launch(dir: string): Promise<{ctx: BrowserContext; ext: string}> {
  const ctx = await chromium.launchPersistentContext(dir, { channel: "chromium", headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: {width: 1100, height: 820} });
  let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker");
  return {ctx, ext: `chrome-extension://${new URL(sw.url()).host}`};
}
async function records(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(s => new Promise((resolve, reject) => { const r = indexedDB.open("manwhatrack"); r.onsuccess = () => {const db=r.result; const q=db.transaction(s).objectStore(s).getAll(); q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)}), store);
}
async function bounds(page: Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(()=>[...document.querySelectorAll<HTMLElement>("button,input,select,textarea")].filter(el=>el.getClientRects().length && !el.closest(".collection-choices,.collection-manager")).filter(el=>{const r=el.getBoundingClientRect();return r.left< -1 || r.right>innerWidth+1}).map(el=>el.getAttribute("aria-label")??el.textContent))).toEqual([]);
}
async function shot(page: Page, name: string) { if(OUT){await page.waitForTimeout(150);mkdirSync(OUT,{recursive:true});await page.screenshot({path:`${OUT}/${name}.png`})} }

test("latest reader position resumes after Chrome restart without fake completion", async () => {
  test.setTimeout(150_000);
  const fx=await startFixtureServer();const dir=mkdtempSync(join(tmpdir(),"mt-position-"));let ctx: BrowserContext|undefined;
  try {
    let session=await launch(dir);ctx=session.ctx;let ext=session.ext;
    const reader=await ctx.newPage();await reader.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);
    const panel=await ctx.newPage();await panel.goto(`${ext}/sidepanel.html`);
    await expect(panel.locator(".srow")).toBeVisible();
    await reader.bringToFront();await reader.evaluate(()=>window.scrollTo(0,3100));await reader.waitForTimeout(600);
    // The final viewport is behind the furthest page already viewed.
    await reader.evaluate(()=>window.scrollTo(0,1700));await reader.waitForTimeout(350);
    const position=await reader.evaluate(()=>scrollY);
    await reader.close();
    await expect.poll(async()=>{
      const c=(await records(panel,"chapters")).find(c=>c.chapterLabel==="Chapter 5");return (c?.readingPosition as {readerOffset?:number}|undefined)?.readerOffset;
    }).toBeGreaterThan(1200);
    const before=(await records(panel,"chapters")).find(c=>c.chapterLabel==="Chapter 5")!;
    expect(before.completedAt).toBeUndefined();expect(before.maxProgress).toBeGreaterThan(.4);
    await ctx.close();session=await launch(dir);ctx=session.ctx;ext=session.ext;
    const reopened=await ctx.newPage();await reopened.goto(`${ext}/sidepanel.html`);
    await expect(reopened.locator(".srow")).toBeVisible();
    const [resumed]=await Promise.all([ctx.waitForEvent("page"),reopened.locator(".srow .btn.primary").click({modifiers:["ControlOrMeta"]})]);
    await resumed.waitForURL(/chapter-5/);
    await expect.poll(async()=>resumed.evaluate(saved=>Math.abs(scrollY-saved),position),{timeout:15_000}).toBeLessThan(4);
    await resumed.waitForTimeout(2200);
    const after=(await records(reopened,"chapters")).find(c=>c.id===before.id)!;
    expect(after.completedAt).toBeUndefined();expect(after.maxProgress).toBe(before.maxProgress);
    // Normal visits remain ordinary: no automatic scrolling just because a bookmark exists.
    const ordinary=await ctx.newPage();await ordinary.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);await ordinary.waitForTimeout(2000);expect(await ordinary.evaluate(()=>scrollY)).toBe(0);
    await ordinary.close();
    // Actual reading after restoration continues producing newer positions.
    const beforeWheel=(await records(reopened,"chapters")).find(c=>c.id===before.id)!;
    await resumed.bringToFront();await resumed.mouse.wheel(0,300);await resumed.waitForTimeout(350);
    const wheelOffset=await resumed.locator(".reading-content").evaluate(el=>-el.getBoundingClientRect().top);
    await resumed.close();
    await expect.poll(async()=>{
      const saved=(await records(reopened,"chapters")).find(c=>c.id===before.id)?.readingPosition as {capturedAt:number;readerOffset:number}|undefined;
      return saved && saved.capturedAt>(beforeWheel.readingPosition as {capturedAt:number}).capturedAt ? Math.abs(saved.readerOffset-wheelOffset) : Infinity;
    }).toBeLessThan(4);
  } finally {await ctx?.close();fx.server.close();rmSync(dir,{recursive:true,force:true})}
});

test("custom lists, tags, backup and expanded library survive full profile restart", async () => {
  test.setTimeout(180_000);
  const fx=await startFixtureServer();const dir=mkdtempSync(join(tmpdir(),"mt-lists-"));let ctx:BrowserContext|undefined;
  try {
    let session=await launch(dir);ctx=session.ctx;let ext=session.ext;
    const reader=await ctx.newPage();await reader.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);
    const panel=await ctx.newPage();await panel.setViewportSize({width:380,height:820});await panel.goto(`${ext}/sidepanel.html`);await expect(panel.locator(".srow")).toBeVisible();
    await reader.goto(`${fx.base}/manga/starfall-academy/`);await expect.poll(async()=>(await records(panel,"series")).length).toBe(2);
    await panel.getByLabel("Lists and library views").selectOption("manage");
    const dialog=panel.getByRole("dialog");await dialog.getByLabel("New list name").fill("Read weekly");await dialog.getByRole("button",{name:"Create list",exact:true}).click();await expect(dialog.getByRole("button",{name:/Read weekly/})).toBeVisible();
    await dialog.getByLabel("New list name").fill("read weekly");await dialog.getByRole("button",{name:"Create list",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("already exists");
    await dialog.getByRole("button",{name:"Edit / add series",exact:true}).click();await dialog.getByLabel("Solo Leveling",{exact:true}).check();await dialog.getByRole("button",{name:"Save list",exact:true}).click();
    await dialog.getByRole("button",{name:/Read weekly/}).click();await expect(dialog).not.toBeVisible();await expect(panel.locator(".srow")).toHaveCount(1);await expect(panel.locator(".srow")).toContainText("Solo Leveling");
    await panel.getByRole("searchbox",{name:"Search library"}).fill("Starfall");await expect(panel.locator(".srow")).toHaveCount(0);await panel.getByRole("searchbox",{name:"Search library"}).fill("");await expect(panel.locator(".srow")).toHaveCount(1);
    await panel.locator(".srow").click();await panel.getByLabel("Add tag",{exact:true}).fill("Read on Fridays");await panel.getByLabel("Add tag",{exact:true}).press("Enter");await expect(panel.getByRole("button",{name:"Remove tag Read on Fridays"})).toBeVisible();
    await panel.keyboard.press("Escape");
    const [full]=await Promise.all([ctx.waitForEvent("page"),panel.getByRole("button",{name:"Expand library",exact:true}).click()]);await full.waitForURL(/library.html/);await expect(full.locator(".library-rail")).toBeVisible();
    await full.getByRole("complementary").getByRole("button",{name:/Read weekly/}).click();await expect(full.locator(".srow")).toHaveCount(1);
    for(const scheme of ["light","dark"] as const){await full.emulateMedia({colorScheme:scheme,reducedMotion:"reduce"});await bounds(full);await shot(full,`expanded-${scheme}-1100`)}
    await panel.getByRole("button",{name:"Manage lists",exact:true}).click();await dialog.getByRole("button",{name:"Edit / add series",exact:true}).click();await dialog.getByLabel("List name",{exact:true}).fill("A very long weekly reading collection name for compact widths");await dialog.getByRole("button",{name:"Save list",exact:true}).click();await dialog.getByRole("button",{name:"Done",exact:true}).click();
    await expect(full.locator(".library-rail")).toContainText("A very long weekly");
    for(const scheme of ["light","dark"] as const)for(const width of [280,380]){await panel.setViewportSize({width,height:820});await panel.emulateMedia({colorScheme:scheme,reducedMotion:"reduce"});await bounds(panel);await shot(panel,`lists-${scheme}-${width}`)}
    await panel.setViewportSize({width:280,height:820});await panel.getByRole("button",{name:"Manage lists",exact:true}).click();await panel.emulateMedia({colorScheme:"dark",reducedMotion:"reduce"});await bounds(panel);await shot(panel,"list-manager-dark-280");await panel.keyboard.press("Escape");
    const opts=await ctx.newPage();await opts.goto(`${ext}/options.html#data`);
    const [download]=await Promise.all([opts.waitForEvent("download"),opts.getByRole("button",{name:"Complete backup with covers",exact:true}).click()]);const backup=await download.path();expect(backup).toBeTruthy();
    await opts.getByLabel("Choose a ManwhaTrack backup file").setInputFiles(backup!);await expect(opts.getByText("Preview",{exact:true})).toBeVisible();await opts.getByRole("button",{name:"Import",exact:true}).click();await expect(opts.getByText("Preview",{exact:true})).not.toBeVisible();
    await ctx.close();session=await launch(dir);ctx=session.ctx;ext=session.ext;
    const reopened=await ctx.newPage();await reopened.setViewportSize({width:380,height:820});await reopened.goto(`${ext}/sidepanel.html`);
    const listRecord=(await records(reopened,"meta")).find(r=>r.key==="collections")!;const lists=listRecord.value as {id:string;name:string;seriesIds:string[]}[];expect(lists).toHaveLength(1);expect(lists[0]?.seriesIds).toHaveLength(1);expect(lists[0]?.name).toContain("A very long weekly");
    await reopened.getByLabel("Lists and library views").selectOption(`collection:${lists[0]!.id}`);await expect(reopened.locator(".srow")).toHaveCount(1);
    await reopened.locator(".srow").click();await expect(reopened.getByRole("button",{name:"Remove tag Read on Fridays"})).toBeVisible();await reopened.keyboard.press("Escape");
    // Delete a list, then verify the entire library and reading event identities remain.
    const seriesBefore=await records(reopened,"series"),eventsBefore=await records(reopened,"events");await reopened.getByRole("button",{name:"Manage lists",exact:true}).click();await reopened.getByRole("dialog").getByRole("button",{name:"Delete",exact:true}).click();await reopened.getByRole("dialog").getByRole("button",{name:"Delete list",exact:true}).click();await reopened.getByRole("dialog").getByRole("button",{name:"Done",exact:true}).click();
    expect((await records(reopened,"series")).map(r=>r.id)).toEqual(seriesBefore.map(r=>r.id));expect((await records(reopened,"events")).map(r=>r.id)).toEqual(eventsBefore.map(r=>r.id));
    await expect(reopened.locator(".srow")).toHaveCount(2);
    await ctx.setOffline(true);await reopened.reload();await expect(reopened.locator(".srow")).toHaveCount(2);await reopened.getByRole("searchbox",{name:"Search library"}).fill("Read on Fridays");await expect(reopened.locator(".srow")).toHaveCount(1);
  } finally{await ctx?.close();fx.server.close();rmSync(dir,{recursive:true,force:true})}
});

test("bulk and individual list assignments, tag filters and modal keyboard controls", async () => {
  const fx=await startFixtureServer();const dir=mkdtempSync(join(tmpdir(),"mt-list-actions-"));const {ctx,ext}=await launch(dir);
  try {
    const reader=await ctx.newPage();await reader.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);
    const panel=await ctx.newPage();await panel.setViewportSize({width:280,height:820});await panel.goto(`${ext}/sidepanel.html`);await expect(panel.locator(".srow")).toBeVisible();
    await reader.goto(`${fx.base}/manga/starfall-academy/chapter-3/`);await expect.poll(async()=>(await records(panel,"series")).length).toBe(2);
    await panel.getByLabel("Lists and library views").selectOption("all");await expect(panel.locator(".srow")).toHaveCount(2);
    await panel.getByRole("button",{name:"Menu",exact:true}).click();await panel.getByRole("menuitem",{name:"Select multiple",exact:true}).click();
    await panel.getByRole("checkbox",{name:"Select Solo Leveling",exact:true}).check();await panel.getByRole("checkbox",{name:"Select Starfall Academy",exact:true}).check();
    await panel.getByRole("toolbar",{name:"Selection actions"}).getByRole("button",{name:"Assign to lists",exact:true}).click();
    const dialog=panel.getByRole("dialog");await dialog.getByLabel("New list name").fill("Weekend reading");await dialog.getByRole("button",{name:"Create list",exact:true}).click();
    await expect(dialog.getByRole("checkbox",{name:/Weekend reading/})).toBeChecked();
    for(let i=0;i<12;i++){await panel.keyboard.press("Tab");expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true)}
    await panel.emulateMedia({colorScheme:"dark",reducedMotion:"reduce"});await bounds(panel);await shot(panel,"list-assign-dark-280");
    await dialog.getByRole("button",{name:"Save assignments",exact:true}).click();await expect(dialog).not.toBeVisible();
    await panel.getByRole("toolbar",{name:"Selection actions"}).getByRole("button",{name:"Add tag",exact:true}).click();await dialog.getByLabel("Tag",{exact:true}).fill("Weekly art");await dialog.getByRole("button",{name:"Apply",exact:true}).click();
    await panel.getByRole("toolbar",{name:"Selection actions"}).getByRole("button",{name:"Done",exact:true}).click();
    const saved=(await records(panel,"meta")).find(r=>r.key==="collections")!.value as {id:string;seriesIds:string[]}[];expect(saved[0]?.seriesIds).toHaveLength(2);
    await panel.getByLabel("Lists and library views").selectOption(`collection:${saved[0]!.id}`);await expect(panel.locator(".srow")).toHaveCount(2);
    await panel.locator(".srow").filter({hasText:"Solo Leveling"}).getByRole("button",{name:"More actions for Solo Leveling",exact:true}).click();await panel.getByRole("menuitem",{name:"Assign to lists…",exact:true}).click();
    await expect(dialog.getByRole("checkbox",{name:/Weekend reading/})).toBeChecked();await dialog.getByRole("checkbox",{name:/Weekend reading/}).uncheck();await dialog.getByRole("button",{name:"Save assignments",exact:true}).click();await expect(panel.locator(".srow")).toHaveCount(1);await expect(panel.locator(".srow")).toContainText("Starfall Academy");
    await panel.getByRole("button",{name:/^Filters/}).click();await panel.getByLabel("Filter by tag").selectOption("Weekly art");await expect(panel.locator(".srow")).toHaveCount(1);await panel.getByRole("button",{name:"Remove filter #Weekly art",exact:true}).click();
    expect((await records(panel,"series")).every(s=>(s.tags as string[]).includes("Weekly art"))).toBe(true);
    await bounds(panel);
  } finally {await ctx.close();fx.server.close();rmSync(dir,{recursive:true,force:true})}
});
