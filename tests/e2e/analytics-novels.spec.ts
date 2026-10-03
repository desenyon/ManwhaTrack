import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";
const EXT=fileURLToPath(new URL("../../dist",import.meta.url));
async function bounds(page:Page) {
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(()=>[...document.querySelectorAll<HTMLElement>("button,input,select,textarea")].filter(el=>el.getClientRects().length).filter(el=>{const r=el.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1;}).map(el=>el.getAttribute("aria-label") ?? el.textContent))).toEqual([]);
}
async function shot(page:Page,name:string) {if(process.env.SCREENSHOT_DIR){mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/${name}.png`});}}

test("comic translation notes do not change format, and revisiting repairs an older incorrect label",async()=>{
 const fx=await startFixtureServer(),dir=mkdtempSync(join(tmpdir(),"mt-format-repair-"));
 const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,executablePath:process.env.PW_CHROMIUM_PATH || undefined,viewport:{width:380,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
 try{
  let [sw]=ctx.serviceWorkers();sw??=await ctx.waitForEvent("serviceworker");const ext=`chrome-extension://${new URL(sw.url()).host}`;
  const fixture=readFileSync(new URL("../fixtures/comic-with-prose.html",import.meta.url),"utf8").replace(/\/page-(\d)\.jpg/g,"/pages/river-12-$1.png");
  await ctx.route("**/manga/river/chapter-12/",route=>route.fulfill({contentType:"text/html",body:fixture}));
  const reader=await ctx.newPage();await reader.goto(`${fx.base}/manga/river/chapter-12/`);
  const full=await ctx.newPage();await full.goto(`${ext}/library.html`);await expect(full.locator(".tile .format-badge")).toHaveText("Manhwa");
  await full.evaluate(async()=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("manwhatrack");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const tx=db.transaction("series","readwrite"),store=tx.objectStore("series");const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
   const r=store.getAll();r.onsuccess=()=>store.put({...r.result[0],format:"novel"});await done;db.close();
  });await full.reload();await expect(full.locator(".tile .format-badge")).toHaveText("Novel");
  await reader.reload();await expect(full.locator(".tile .format-badge")).toHaveText("Manhwa");await expect(full.locator(".tile")).toHaveCount(1);
  await full.reload();await expect(full.locator(".tile .format-badge")).toHaveText("Manhwa");
 }finally{await ctx.close();fx.server.close();rmSync(dir,{recursive:true,force:true});}
});

test("novels auto-track, Resume restores prose, compact timer fits, analytics stays local and persists",async()=>{
 test.setTimeout(120_000);
 const fx=await startFixtureServer(),dir=mkdtempSync(join(tmpdir(),"mt-novel-analytics-"));
 const launch=()=>chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,executablePath:process.env.PW_CHROMIUM_PATH || undefined,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
 let ctx=await launch();const errors:string[]=[];
 try{
  let [sw]=ctx.serviceWorkers();sw??=await ctx.waitForEvent("serviceworker");const ext=`chrome-extension://${new URL(sw.url()).host}`;
  const reader=await ctx.newPage();await reader.goto(`${fx.base}/novel/shadow-slave/`);
  const panel=await ctx.newPage();panel.on("pageerror",e=>errors.push(e.message));await panel.goto(`${ext}/sidepanel.html`);
  await panel.getByLabel("Lists and library views").selectOption("all");await expect(panel.locator(".srow")).toContainText("Novel");
  await reader.goto(`${fx.base}/novel/shadow-slave/chapter-12/`);await expect(panel.locator(".srow")).toContainText("Ch. 12");
  await reader.bringToFront();await reader.evaluate(()=>scrollTo(0,1600));await reader.waitForTimeout(2200);
  await expect(panel.getByRole("timer")).not.toHaveText("00:00");
  const position=await reader.evaluate(()=>scrollY);await reader.close();
  for(const width of [280,320,380]){await panel.setViewportSize({width,height:900});await bounds(panel);await expect(panel.getByText("A private reading collection")).toHaveCount(0);const heading=await panel.locator(".folio-heading h1").boundingBox(),timer=await panel.locator(".compact-timer").boundingBox();expect(timer!.x).toBeGreaterThan(heading!.x+heading!.width);expect(Math.abs(timer!.y-heading!.y)).toBeLessThan(20);await shot(panel,`archive-sidebar-${width}`);}
  const [resumed]=await Promise.all([ctx.waitForEvent("page"),panel.getByRole("button",{name:/^Resume Shadow Slave,/}).click()]);await resumed.waitForURL(/chapter-12/);await expect.poll(()=>resumed.evaluate(()=>scrollY)).toBeGreaterThan(position-40);expect(await resumed.evaluate(()=>scrollY)).toBeLessThan(position+60);await resumed.close();
  const full=await ctx.newPage();full.on("pageerror",e=>errors.push(e.message));await full.goto(`${ext}/library.html`);await full.locator(".tile").click();
  await expect(full.getByLabel("Format",{exact:true})).toHaveValue("novel");await full.getByRole("button",{name:"Edit genres",exact:true}).click();const dialog=full.getByRole("dialog");await dialog.getByRole("textbox").fill("Fantasy\nMurim");await dialog.getByRole("button",{name:"Save",exact:true}).click();
  for(const width of [320,960,1280,2560]){await full.setViewportSize({width,height:1000});await bounds(full);await shot(full,`archive-details-${width}`);}
  await full.getByRole("button",{name:"Reading analytics",exact:true}).click();await expect(full.locator(".analytics-page h1")).toHaveText("Shadow Slave");await full.reload();await expect(full.locator(".analytics-page h1")).toHaveText("Shadow Slave");
  await full.getByRole("button",{name:"All reading analytics",exact:true}).click();await expect(full.locator(".analytics-overview dl dd").first()).toHaveText(/^(<1|\d+)s$/);await expect(full.locator(".analytics-overview")).toContainText("Chapters finished");
  await full.getByRole("button",{name:"Chapters",exact:true}).click();await expect(full.getByRole("button",{name:"Chapters",exact:true})).toHaveAttribute("aria-pressed","true");await full.locator(".activity-day").last().focus();await full.keyboard.press("ArrowUp");await expect(full.locator(".heatmap-caption p")).not.toContainText("Hover or focus");
  for(const range of ["7D","30D","3M","1Y","ALL"]){await full.getByRole("button",{name:range,exact:true}).click();await expect(full.getByRole("button",{name:range,exact:true})).toHaveAttribute("aria-pressed","true");}
  const saved=await full.locator(".analytics-overview dl").textContent();await ctx.close();ctx=await launch();const reopened=await ctx.newPage();await reopened.goto(`${ext}/library.html#analytics`);await expect(reopened.locator(".analytics-overview dl")).toHaveText(saved!);
  await expect(reopened.locator(".analytics-section > summary").filter({hasText:"Observed updates"})).toBeVisible();expect(errors).toEqual([]);
 }finally{await ctx.close();fx.server.close();rmSync(dir,{recursive:true,force:true});}
});

test("analytics charts and editorial layouts render with dated fixture history",async()=>{
 const fx=await startFixtureServer(),dir=mkdtempSync(join(tmpdir(),"mt-analytics-visual-"));
 const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,executablePath:process.env.PW_CHROMIUM_PATH || undefined,viewport:{width:1280,height:1000},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
 try{
  let [sw]=ctx.serviceWorkers();sw??=await ctx.waitForEvent("serviceworker");const ext=`chrome-extension://${new URL(sw.url()).host}`;
  const reader=await ctx.newPage();await reader.goto(`${fx.base}/novel/shadow-slave/chapter-12/`);const full=await ctx.newPage();await full.goto(`${ext}/library.html`);await expect(full.locator(".tile")).toHaveCount(1);await reader.close();
  // Synthetic, isolated QA history; never touches the user's extension profile.
  await full.evaluate(async()=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("manwhatrack");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const tx=db.transaction(["series","chapters","events","sources"],"readwrite");const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
   const request=tx.objectStore("series").getAll();request.onsuccess=()=>{const s=request.result[0];s.discoveredAt=Date.now()-90*86_400_000;s.genres=["Fantasy"];s.personalRating=8;s.totalReadingTimeMs=0;s.summary.newCount=8;tx.objectStore("series").put(s);const c=tx.objectStore("chapters").get(s.currentChapterId);c.onsuccess=()=>{
    for(let n=13;n<=20;n++) tx.objectStore("chapters").put({...c.result,id:`qa-unread-${n}`,key:String(n),chapterLabel:`Chapter ${n}`,title:`Chapter ${n}`,chapterNumber:n,ordinal:n,url:c.result.url.replace("chapter-12",`chapter-${n}`),canonicalUrl:c.result.canonicalUrl.replace("chapter-12",`chapter-${n}`),firstOpenedAt:undefined,lastOpenedAt:undefined,visitCount:0,maxProgress:0,readingTimeMs:0,readingPosition:undefined});
    const source=tx.objectStore("sources").get(c.result.sourceId);source.onsuccess=()=>tx.objectStore("sources").put({...source.result,latestKnownChapter:{key:"20",label:"Chapter 20",ordinal:20,url:c.result.url.replace("chapter-12","chapter-20")}});
    let sum=0;for(let day=0;day<60;day++){const date=new Date();date.setDate(date.getDate()-day);date.setHours(22,0,0,0);const minuteCount=day%5===0 ? 0 : 4+day%12;for(let n=0;n<minuteCount;n++){const startedAt=date.getTime()+n*60_000;if(startedAt+60_000>Date.now())continue;sum+=60_000;tx.objectStore("events").put({id:`qa-time-${day}-${n}`,seriesId:s.id,chapterId:c.result.id,type:"time",startedAt,timestamp:startedAt+60_000,durationMs:60_000});}if(minuteCount){for(let n=0;n<3;n++)tx.objectStore("events").put({id:`qa-done-${day}-${n}`,seriesId:s.id,type:"completed",timestamp:date.getTime()+n*120_000,chapterLabel:`Chapter ${180-day*3+n}`});}tx.objectStore("events").put({id:`qa-backlog-${day}`,seriesId:s.id,type:"backlog",timestamp:Math.min(date.getTime(),Date.now()),backlogCount:8+Math.floor(day/4)});}
    tx.objectStore("chapters").put({...c.result,readingTimeMs:sum});tx.objectStore("series").put({...s,totalReadingTimeMs:sum});
   };};await done;db.close();
  });await full.goto(`${ext}/library.html#analytics`);await full.reload();await expect(full.locator(".activity-day[data-level='4']").first()).toBeVisible();await expect(full.getByRole("img",{name:"Daily active reading in minutes"})).toBeVisible();
  for(const theme of ["dark","light"] as const){await full.emulateMedia({colorScheme:theme,reducedMotion:"reduce"});for(const width of [320,960,1280,2560]){await full.setViewportSize({width,height:1000});await bounds(full);await shot(full,`analytics-${theme}-${width}`);}}
  await full.setViewportSize({width:1280,height:1000});await full.emulateMedia({colorScheme:"dark"});
  const backlog=full.locator(".analytics-section").filter({has:full.getByRole("heading",{name:"Your backlog",exact:true})});
  await expect(backlog.locator(".analytics-big-number")).toContainText("8");await expect(backlog.locator(".analytics-line")).toContainText("Shadow Slave");
  await full.locator(".analytics-columns").first().scrollIntoViewIfNeeded();await shot(full,"analytics-graphs-dark-1280");
  const data=full.locator(".chart-data").first();await data.locator("summary").click();await expect(data.locator("tbody tr")).toHaveCount(30);await data.locator("summary").click();
  await full.getByRole("heading",{name:"When you read",exact:true}).scrollIntoViewIfNeeded();await expect(full.locator(".hour-heatmap > div")).toHaveCount(24);await shot(full,"analytics-habits-dark-1280");
  for(const name of ["Your reading fingerprint","Series retention","Genres, status & sources","Observed updates","Milestones"]){const details=full.locator("details.analytics-section").filter({has:full.locator("summary").filter({hasText:name})});await details.locator("summary").click();await expect(details).toHaveAttribute("open","");await bounds(full);await details.locator("summary").click();}
  await full.locator(".analytics-ranking").first().click();await expect(full.locator(".analytics-page h1")).toHaveText("Shadow Slave");await full.locator(".analytics-heading").scrollIntoViewIfNeeded();await shot(full,"analytics-series-dark-1280");
 }finally{await ctx.close();fx.server.close();rmSync(dir,{recursive:true,force:true});}
});
