import { chromium, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";

const EXT = fileURLToPath(new URL("../../dist", import.meta.url));
const OUT = process.env.SCREENSHOT_DIR;

test("Nano Machine repairs joined identities in All and expanded cards stay usable at each width", async () => {
  const fx = await startFixtureServer();
  fx.setLatest("sss-class-suicide-hunter",158); fx.setLatest("demon-breaker",3);
  const dir = mkdtempSync(join(tmpdir(), "mt-nano-"));
  const ctx = await chromium.launchPersistentContext(dir, { channel: "chromium", headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined, viewport: {width:1280,height:950}, args:[`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    let [worker] = ctx.serviceWorkers(); worker ??= await ctx.waitForEvent("serviceworker");
    const ext = `chrome-extension://${new URL(worker.url()).host}`;
    // Minimal fixture reproducing Asura's adjacent chapter/subtitle/date elements.
    const links = [...Array.from({length:20}, (_,i)=>332-i),143].map(n=>`<a href="${fx.base}/manga/nano-machine/chapter-${n}/"><span>Chapter ${n}</span><span>${n===143?"50.Night in the Inn":"105. TP &lt;2&gt;"}</span><time>Aug 5, 2026</time></a>`).join("");
    await ctx.route("**/manga/nano-machine/", route=>route.fulfill({contentType:"text/html",body:`<title>Nano Machine | Test Scans</title><meta property="og:image" content="${fx.base}/covers/nano-machine.png"><h1>Nano Machine</h1>${links}`}));
    const reader = await ctx.newPage(); await reader.goto(`${fx.base}/manga/nano-machine/chapter-324/`);
    const panel = await ctx.newPage(); await panel.setViewportSize({width:380,height:950}); await panel.goto(`${ext}/sidepanel.html`);
    await expect(panel.locator(".srow")).toHaveCount(1);
    await reader.close();
    const chapterId = await panel.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("manwhatrack");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      const tx=db.transaction(["chapters","series"],"readwrite");
      const all=tx.objectStore("chapters").getAll();
      const id=await new Promise<string>(resolve=>{all.onsuccess=()=>{const c=all.result.find(c=>c.chapterLabel==="Chapter 324");Object.assign(c,{chapterLabel:"Chapter 324105. TP <2>Aug 5, 2026",key:"32410",ordinal:32410,chapterNumber:32410,maxProgress:.56,readingTimeMs:1250});tx.objectStore("chapters").put(c);resolve(c.id)}});
      await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});db.close();return id;
    });
    const source = await ctx.newPage(); await source.goto(`${fx.base}/manga/nano-machine/`);
    await panel.getByLabel("Lists and library views").selectOption("all");
    await expect(panel.locator(".srow .meta-card").first()).toHaveText("Ch. 324");
    await expect(panel.locator(".srow")).toContainText("56% read");
    await expect(panel.locator(".srow")).toContainText("+8 new");
    expect(await panel.evaluate(id=>new Promise(resolve=>{const r=indexedDB.open("manwhatrack");r.onsuccess=()=>{const db=r.result;const q=db.transaction("chapters").objectStore("chapters").get(id);q.onsuccess=()=>{resolve({id:q.result.id,time:q.result.readingTimeMs,ordinal:q.result.ordinal});db.close()}}}),chapterId)).toEqual({id:chapterId,time:1250,ordinal:324});
    await source.goto(`${fx.base}/manga/sss-class-suicide-hunter/`);
    await expect(panel.locator(".srow")).toHaveCount(2);
    await source.goto(`${fx.base}/manga/sss-class-suicide-hunter/chapter-153/`);
    await expect(panel.locator(".srow")).toHaveCount(2);
    await source.goto(`${fx.base}/manga/demon-breaker/`);
    await expect(panel.locator(".srow")).toHaveCount(3);
    await source.goto(`${fx.base}/manga/demon-breaker/chapter-1/`);
    await expect(panel.locator(".srow")).toHaveCount(3);
    const full = await ctx.newPage(); await full.goto(`${ext}/library.html`);
    await full.getByRole("complementary").getByRole("button",{name:/^All/}).click();
    await expect(full.locator(".tile")).toHaveCount(3);
    await expect(full.locator(".tile .cover img")).toHaveCount(3);
    await expect(full.locator(".featured-continue")).toHaveCount(0);
    await expect(full.getByRole("button",{name:"Show as list"})).toBeVisible();
    for (const width of [652,960,1280,1440]) {
      await full.setViewportSize({width,height:950});
      expect(await full.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const card = await full.locator(".tile").first().boundingBox(); expect(card!.width).toBeGreaterThan(200);
      for (const theme of ["light","dark"] as const) {
        await full.emulateMedia({colorScheme:theme,reducedMotion:"reduce"});
        if(OUT){mkdirSync(OUT,{recursive:true});await full.screenshot({path:`${OUT}/refined-grid-${theme}-${width}.png`})}
      }
    }
    await full.locator(".tile").filter({hasText:"Nano Machine"}).getByRole("button",{name:"Details for Nano Machine",exact:true}).click();
    await expect(full.locator(".progress-facts")).toContainText("Ch. 324");
    await expect(full.locator(".progress-facts")).toContainText("Ch. 332");
    await expect(full.locator(".chapters li").first()).toContainText("Chapter 332");
    for(const width of [280,380,652,960,1280,1440]) {
      await full.setViewportSize({width,height:950});
      expect(await full.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(await full.evaluate(()=>[...document.querySelectorAll<HTMLElement>("button,input,select,textarea")].filter(el=>el.getClientRects().length).filter(el=>{const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth}).map(el=>el.getAttribute("aria-label")??el.textContent))).toEqual([]);
      if(OUT)await full.screenshot({path:`${OUT}/refined-details-dark-${width}.png`});
    }
  } finally {await ctx.close();fx.server.close();rmSync(dir,{recursive:true,force:true})}
});
