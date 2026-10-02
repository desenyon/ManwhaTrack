import { expect, test, chromium, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server";
const EXT = fileURLToPath(new URL("../../dist", import.meta.url));
const OUT = process.env.SCREENSHOT_DIR;
interface StoredRecord { id: string; title?: string; chapterLabel?: string; chapterId?: string; seriesId?: string; lastOpenedAt?: number; associationOverridden?: boolean }
async function records(page: Page, store: string): Promise<StoredRecord[]> {
 return page.evaluate(s => new Promise((resolve,reject) => { const r=indexedDB.open("manwhatrack");r.onsuccess=()=>{const db=r.result;const q=db.transaction(s).objectStore(s).getAll();q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)}),store);
}
async function noOverflow(page: Page) {
 expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 expect(await page.evaluate(()=>[...document.querySelectorAll<HTMLElement>("button,input,select,textarea")].filter(el=>el.offsetWidth && el.offsetHeight && !el.closest(".tabs")).filter(el=>{const r=el.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1}).map(el=>el.getAttribute("aria-label")??el.textContent?.trim()))).toEqual([]);
}

test("manual correction, offline backup and narrow panel interactions", async () => {
 test.setTimeout(120_000);
 const fx=await startFixtureServer();const dir=mkdtempSync(join(tmpdir(),"mt-upgrade-"));
 const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,executablePath:process.env.PW_CHROMIUM_PATH||undefined,args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
 try {
 let [sw]=ctx.serviceWorkers();sw??=await ctx.waitForEvent("serviceworker");const ext=`chrome-extension://${new URL(sw.url()).host}`;
 const reader=await ctx.newPage();await reader.goto(`${fx.base}/manga/solo-leveling/`);
 const panel=await ctx.newPage();await panel.setViewportSize({width:380,height:820});await panel.goto(`${ext}/sidepanel.html`);
 await expect(panel.locator(".srow")).toBeVisible();await expect.poll(async()=> (await records(panel,"covers")).length).toBe(1);
 await reader.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);await expect.poll(async()=> (await records(panel,"chapters")).find(c=>c.chapterLabel==="Chapter 5")?.lastOpenedAt).toBeTruthy();
 await panel.getByRole("button",{name:"Menu",exact:true}).click();await panel.getByRole("menuitem",{name:/Track a series manually/}).click();
 const dialog=panel.getByRole("dialog");await expect(dialog).toBeVisible();
 await panel.keyboard.press("ControlOrMeta+k");await expect(panel.getByRole("dialog")).toHaveCount(1);
 await dialog.getByLabel("Title",{exact:true}).fill("Correct title with a deliberately long local library name");
 await dialog.getByLabel("Source page address").fill("javascript:alert(1)");await expect(dialog.getByRole("button",{name:"Track series",exact:true})).toBeDisabled();
 await dialog.getByLabel("Source page address").fill(`${fx.base}/manga/correct-title/`);
 if(OUT){mkdirSync(OUT,{recursive:true});await panel.setViewportSize({width:280,height:820});for(const scheme of ["light","dark"] as const){await panel.emulateMedia({colorScheme:scheme,reducedMotion:"reduce"});await noOverflow(panel);await panel.screenshot({path:`${OUT}/manual-${scheme}-280.png`})}}
 // Native modal keeps tab focus inside it and returns focus after Escape.
 for(let i=0;i<12;i++){await panel.keyboard.press("Tab");expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true)}
 await dialog.getByRole("button",{name:"Track series",exact:true}).click();await expect(dialog).not.toBeVisible();
 const target=(await records(panel,"series")).find(s=>s.title?.startsWith("Correct title"))!;expect(target).toBeTruthy();
 await noOverflow(panel);if(OUT)await panel.screenshot({path:`${OUT}/detail-long-dark-280.png`});
 await panel.keyboard.press("Escape");await panel.locator(".srow").filter({hasText:"Solo Leveling"}).click();
 await panel.getByRole("button",{name:"Actions for Chapter 5",exact:true}).click();await panel.getByRole("menuitem",{name:"Edit label / number…"}).click();
 await panel.getByLabel("Move to another series").selectOption(target.id);await panel.getByRole("button",{name:"Move chapter",exact:true}).click();
 await expect(panel.getByRole("dialog")).not.toBeVisible();
 const moved=(await records(panel,"chapters")).find(c=>c.chapterLabel==="Chapter 5")!;expect(moved.seriesId).toBe(target.id);
 const movedEvents=(await records(panel,"events")).filter(e=>e.chapterId===moved.id);expect(movedEvents.length).toBeGreaterThan(0);expect(movedEvents.every(e=>e.seriesId===target.id)).toBe(true);
 await reader.reload();await expect.poll(async()=> (await records(panel,"chapters")).filter(c=>c.chapterLabel==="Chapter 5"&&c.lastOpenedAt).map(c=>c.seriesId)).toEqual([target.id]);
 await panel.keyboard.press("Escape");await panel.getByLabel("Lists and library views").selectOption("all");
 if(OUT)mkdirSync(OUT,{recursive:true});
 for(const scheme of ["light","dark"] as const)for(const width of [280,320,380,480,900]){
  await panel.setViewportSize({width,height:820});await panel.emulateMedia({colorScheme:scheme,reducedMotion:"reduce"});await noOverflow(panel);
  expect(await panel.evaluate(()=>{
   const style=getComputedStyle(document.documentElement);
   const luminance=(name:string)=>{const hex=style.getPropertyValue(name).trim();const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722};
   return ["--text-2","--text-3"].flatMap(fg=>["--bg","--surface","--hover","--surface-2","--accent-soft"].map(bg=>{const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})).every(ratio=>ratio>=4.5);
  })).toBe(true);
  if(OUT)await panel.screenshot({path:`${OUT}/panel-${scheme}-${width}.png`});
 }
 await panel.getByRole("button",{name:/More actions for Correct title/}).click();await panel.setViewportSize({width:280,height:600});
 const menu=panel.getByRole("menu");await expect.poll(async()=>{const b=await menu.boundingBox();return b!.x+b!.width}).toBeLessThanOrEqual(280);const box=await menu.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(600);
 if(OUT)await panel.screenshot({path:`${OUT}/menu-dark-280.png`});await panel.keyboard.press("Escape");
 await panel.getByRole("button",{name:"Show as grid"}).click();await panel.locator(".tile").first().click({button:"right"});await panel.keyboard.press("Escape");
 await panel.getByRole("button",{name:"Menu",exact:true}).click();await panel.getByRole("menuitem",{name:"Select multiple",exact:true}).click();await panel.locator(".tile").first().getByRole("checkbox").check();await noOverflow(panel);
 if(OUT)await panel.screenshot({path:`${OUT}/grid-selected-dark-280.png`});
 await panel.getByRole("button",{name:"Menu",exact:true}).click();await panel.getByRole("menuitem",{name:"Stop selecting",exact:true}).click();
 const [opened]=await Promise.all([ctx.waitForEvent("page"),panel.locator(".tile").filter({hasText:"Correct title"}).getByRole("button",{name:/^(Resume|Continue|Reopen|Open) Correct title/}).click({button:"middle"})]);await opened.waitForURL(/chapter-5/);expect(opened.url()).toBe(`${fx.base}/manga/solo-leveling/chapter-5/`);await opened.close();
 await panel.getByRole("button",{name:"Show as list"}).click();await panel.keyboard.press("j");await expect(panel.locator(".srow[data-focused=true]")).toBeFocused();
 await ctx.setOffline(true);const requests:string[]=[];panel.on("request",r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});await panel.reload();
 await panel.getByLabel("Lists and library views").selectOption("all");await panel.getByRole("searchbox",{name:"Search library"}).fill("correct");await expect(panel.locator(".srow").filter({hasText:"Correct title"})).toBeVisible();expect(requests).toEqual([]);
 const opts=await ctx.newPage();await opts.goto(`${ext}/options.html#data`);
 const [download]=await Promise.all([opts.waitForEvent("download"),opts.getByRole("button",{name:"Complete backup with covers",exact:true}).click()]);
 const path=await download.path();expect(path).toBeTruthy();await opts.getByLabel("Choose a ManwhaTrack backup file").setInputFiles(path!);
 await expect(opts.getByText("Preview",{exact:true})).toBeVisible();await opts.getByRole("button",{name:"Import",exact:true}).click();
 await expect(opts.getByText("Preview",{exact:true})).not.toBeVisible();expect(await records(opts,"series")).toHaveLength(2);expect((await records(opts,"chapters")).find(c=>c.chapterLabel==="Chapter 5")?.associationOverridden).toBe(true);
 await opts.getByLabel("Choose a ManwhaTrack backup file").setInputFiles(path!);await expect(opts.getByText("Preview",{exact:true})).toBeVisible();
 await opts.getByLabel("Also import settings and site rules").check();
 await opts.evaluate(()=>{const original=chrome.storage.local.set.bind(chrome.storage.local);Object.defineProperty(chrome.storage.local,"set",{value:async(items:Record<string,unknown>)=>{if("settings" in items)throw new Error("Simulated preferences write failure");return original(items)}})});
 await opts.getByRole("button",{name:"Import",exact:true}).click();
 await expect(opts.locator("main").getByRole("status")).toContainText("Library imported, but settings could not be saved.");expect(await records(opts,"series")).toHaveLength(2);
 if(OUT)await opts.screenshot({path:`${OUT}/import-partial-success.png`});
 }finally{await ctx.close();fx.server.close();rmSync(dir,{recursive:true,force:true})}
});

test("1,000 series and 20,000 chapters remain local and virtualized in Chromium",async()=>{
 test.setTimeout(120_000);const dir=mkdtempSync(join(tmpdir(),"mt-scale-"));const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,executablePath:process.env.PW_CHROMIUM_PATH||undefined,args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
 try{
 let [sw]=ctx.serviceWorkers();sw??=await ctx.waitForEvent("serviceworker");const ext=`chrome-extension://${new URL(sw.url()).host}`;const panel=await ctx.newPage();await panel.goto(`${ext}/sidepanel.html`);await expect(panel.getByText("No series tracked yet.",{exact:true})).toBeVisible();
 if(OUT){mkdirSync(OUT,{recursive:true});await panel.setViewportSize({width:320,height:820});await panel.screenshot({path:`${OUT}/empty-light-320.png`})}
 await panel.evaluate(()=>new Promise<void>((resolve,reject)=>{const r=indexedDB.open("manwhatrack");r.onsuccess=()=>{const db=r.result;const tx=db.transaction(["series","sources","chapters"],"readwrite");const now=Date.now();for(let i=0;i<1000;i++){const id=`scale-${i}`,sourceId=`src-${i}`,url=`https://scale.example/series/${i}`;tx.objectStore("series").put({id,title:`Series ${i} Tower`,detectedTitle:`Series ${i} Tower`,normalizedTitle:`series ${i} tower`,titleKeys:[`series ${i} tower`],status:"reading",alternateTitles:[],tags:[],favorite:false,pinned:false,userFields:[],keptSeparateFrom:[],sourceIds:[sourceId],preferredSourceId:sourceId,discoveredAt:now,updatedAt:now,lastReadAt:now-i,currentChapterId:`ch-${i}-20`,lastOpenedChapterId:`ch-${i}-20`,summary:{newCount:0,caughtUp:false,chaptersRead:0,chaptersKnown:20,currentLabel:"Chapter 20",currentProgress:.4,continueKind:"resume",continueUrl:`${url}/chapter-20`,continueLabel:"Chapter 20"}});tx.objectStore("sources").put({id:sourceId,seriesId:id,hostname:"scale.example",seriesUrl:url,canonicalSeriesUrl:url,previousUrls:[],coverCandidates:[],consecutiveFailures:0,disabled:false,discoveredAt:now,updatedAt:now});for(let n=1;n<=20;n++)tx.objectStore("chapters").put({id:`ch-${i}-${n}`,seriesId:id,sourceId,key:`n:${n}`,chapterLabel:`Chapter ${n}`,title:`Chapter ${n}`,chapterNumber:n,ordinal:n,url:`${url}/chapter-${n}`,canonicalUrl:`${url}/chapter-${n}`,visitCount:n===20?1:0,maxProgress:n===20?.4:0,readingTimeMs:0,progressRevision:0,userFields:[],discoveredAt:now,lastOpenedAt:n===20?now:undefined})}tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}}));
 await ctx.setOffline(true);const requests:string[]=[];panel.on("request",r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});const start=Date.now();await panel.reload();await expect(panel.locator(".srow").first()).toBeVisible();const loadMs=Date.now()-start;
 expect(await records(panel,"chapters")).toHaveLength(20000);expect(await panel.locator(".srow").count()).toBeLessThan(50);
 const searchStart=Date.now();await panel.getByRole("searchbox",{name:"Search library"}).fill("series 999");await expect(panel.locator(".srow").filter({hasText:"Series 999 Tower"})).toBeVisible();const searchMs=Date.now()-searchStart;
 expect(requests).toEqual([]);await noOverflow(panel);if(OUT){mkdirSync(OUT,{recursive:true});writeFileSync(`${OUT}/scale-timings.json`,JSON.stringify({series:1000,chapters:20000,loadMs,searchMs,httpRequests:requests.length},null,2))}
 console.log(JSON.stringify({series:1000,chapters:20000,loadMs,searchMs}));
 }finally{await ctx.close();rmSync(dir,{recursive:true,force:true})}
});

test("local storage loading, error and Retry preserve the library",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"mt-retry-"));const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,executablePath:process.env.PW_CHROMIUM_PATH||undefined,args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
 try{
  let [sw]=ctx.serviceWorkers();sw??=await ctx.waitForEvent("serviceworker");const ext=`chrome-extension://${new URL(sw.url()).host}`;const panel=await ctx.newPage();await panel.setViewportSize({width:320,height:820});
  await panel.addInitScript(()=>{
   const native=indexedDB.open.bind(indexedDB);
   Object.defineProperty(indexedDB,"open",{value:(name:string,version?:number)=>{
    if(sessionStorage.getItem("qa-db-fail"))throw new DOMException("Local storage is temporarily unavailable.","SecurityError");
    const request=native(name,version);
    if(sessionStorage.getItem("qa-db-delay"))Object.defineProperty(request,"onsuccess",{set(handler:((event:Event)=>void)|null){request.addEventListener("success",event=>setTimeout(()=>handler?.(event),800))}});
    return request;
   }});
  });
  await panel.goto(`${ext}/sidepanel.html`);await expect(panel.getByText("No series tracked yet.",{exact:true})).toBeVisible();
  await panel.getByRole("button",{name:"Menu",exact:true}).click();await panel.getByRole("menuitem",{name:/Track a series manually/}).click();
  await panel.getByRole("dialog").getByLabel("Title",{exact:true}).fill("Preserved local series");await panel.getByLabel("Source page address").fill("https://reading.example/series/preserved");await panel.getByRole("button",{name:"Track series",exact:true}).click();await expect(panel.getByRole("dialog")).not.toBeVisible();await panel.keyboard.press("Escape");
  const [before]=await records(panel,"series");expect(before?.title).toBe("Preserved local series");
  await panel.evaluate(()=>sessionStorage.setItem("qa-db-delay","1"));await panel.reload({waitUntil:"domcontentloaded"});await expect(panel.getByText("Opening your local library…",{exact:true})).toBeVisible();
  if(OUT){mkdirSync(OUT,{recursive:true});await panel.screenshot({path:`${OUT}/loading-light-320.png`})}
  await expect(panel.locator(".srow")).toBeVisible();
  await panel.evaluate(()=>{sessionStorage.removeItem("qa-db-delay");sessionStorage.setItem("qa-db-fail","1")});await panel.reload();await expect(panel.getByText("The local library could not be opened.",{exact:true})).toBeVisible();
  if(OUT)for(const scheme of ["light","dark"] as const){await panel.emulateMedia({colorScheme:scheme});await panel.waitForTimeout(200);await noOverflow(panel);await panel.screenshot({path:`${OUT}/error-${scheme}-320.png`})}
  await panel.evaluate(()=>sessionStorage.removeItem("qa-db-fail"));await panel.getByRole("button",{name:"Retry",exact:true}).click();await expect(panel.locator(".srow")).toContainText("Preserved local series");expect((await records(panel,"series"))[0]?.id).toBe(before?.id);
 }finally{await ctx.close();rmSync(dir,{recursive:true,force:true})}
});

test("removing a source changes Continue without deleting chapter history", async () => {
 const fx=await startFixtureServer();const dir=mkdtempSync(join(tmpdir(),"mt-source-"));
 const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,executablePath:process.env.PW_CHROMIUM_PATH||undefined,args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
 try {
  let [sw]=ctx.serviceWorkers();sw??=await ctx.waitForEvent("serviceworker");const ext=`chrome-extension://${new URL(sw.url()).host}`;
  const reader=await ctx.newPage();await reader.goto(`${fx.base}/manga/solo-leveling/chapter-5/`);
  const panel=await ctx.newPage();await panel.setViewportSize({width:280,height:820});await panel.goto(`${ext}/sidepanel.html`);await expect(panel.locator(".srow")).toBeVisible();
  const [series]=await records(panel,"series");const chaptersBefore=await records(panel,"chapters");const eventsBefore=await records(panel,"events");
  // A second source with no known chapter is intentional: Continue must fall back to
  // its actual series URL, rather than assigning the old chapter to another website.
  await panel.evaluate(id=>new Promise<void>((resolve,reject)=>{const r=indexedDB.open("manwhatrack");r.onsuccess=()=>{const db=r.result;const tx=db.transaction(["series","sources"],"readwrite");const q=tx.objectStore("series").get(id);q.onsuccess=()=>{const s=q.result;const now=Date.now();s.sourceIds.push("qa-alternate-source");tx.objectStore("series").put(s);tx.objectStore("sources").put({id:"qa-alternate-source",seriesId:id,hostname:"alternate.example",seriesUrl:"https://alternate.example/solo-leveling",canonicalSeriesUrl:"https://alternate.example/solo-leveling",seriesUrlInferred:false,previousUrls:[],coverCandidates:[],consecutiveFailures:0,disabled:true,discoveredAt:now,updatedAt:now})};tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}}),series!.id);
  await reader.close();await panel.reload();await panel.locator(".srow").click();
  await panel.getByRole("button",{name:"More actions for 127.0.0.1",exact:true}).click();
  panel.once("dialog",dialog=>dialog.accept());await panel.getByRole("menuitem",{name:"Remove source (keep progress)",exact:true}).click();
  await expect(panel.locator(".source")).toHaveCount(1);await expect(panel.locator(".source")).toContainText("alternate.example");await noOverflow(panel);
  const stored=await panel.evaluate(id=>new Promise<{summary:{continueUrl:string}}>(resolve=>{const r=indexedDB.open("manwhatrack");r.onsuccess=()=>{const q=r.result.transaction("series").objectStore("series").get(id);q.onsuccess=()=>{resolve(q.result);r.result.close()}}}),series!.id);
  expect(stored.summary.continueUrl).toBe("https://alternate.example/solo-leveling");
  expect((await records(panel,"chapters")).map(c=>c.id)).toEqual(chaptersBefore.map(c=>c.id));expect((await records(panel,"events")).map(e=>e.id)).toEqual(eventsBefore.map(e=>e.id));
  if(OUT){mkdirSync(OUT,{recursive:true});await panel.screenshot({path:`${OUT}/source-removed-light-280.png`})}
 }finally{await ctx.close();fx.server.close();rmSync(dir,{recursive:true,force:true})}
});
