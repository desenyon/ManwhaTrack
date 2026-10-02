// Content script. Stays small and mostly invisible: detect → report → measure progress.
// No UI framework is injected into pages.

import { detectPage, mightBeReadingPage, pagedProgressFor, readerContainerFor } from "../detection";
import { CONFIDENCE, type PageObservation } from "../detection/types";
import { canonicalizeUrl, hostMatches, sourceHost } from "../detection/normalization/url";
import { repairSettings } from "../storage/repositories/settings";
import type { Settings } from "../shared/types/settings";
import type { ReadingPosition } from "../shared/types/models";
import { sanitizeReadingPosition } from "../shared/reading-position";
import type { ContentMessage, ExtensionMessage, ObservedResponse, ProgressResponse } from "../shared/messages";
import { ReaderProgress } from "./reader-progress";
import { watchPage, type PageWatcher } from "./observer";
import { showTrackingToast } from "./toast";
import { captureReadingPosition, restoreReadingPosition } from "./reading-position";

let settings: Settings;
let progress: ReaderProgress | null = null;
let watcher: PageWatcher | null = null;
let currentChapter: { id: string; nextUrl?: string; revision: number } | null = null;
let cancelRestore: (() => void) | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryCount = 0;
let generation = 0;
let suspended = false;
let lastReportKey = "";
let running = false;
let rerunRequested = false;

function alive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

async function send<R>(msg: ExtensionMessage): Promise<R | undefined> {
  if (!alive()) {
    shutdown();
    return undefined;
  }
  try {
    return (await chrome.runtime.sendMessage(msg)) as R;
  } catch {
    return undefined;
  }
}

function isErrorPage(): boolean {
  const t = `${document.title} ${document.querySelector("h1")?.textContent ?? ""}`.slice(0, 300);
  return /\b(?:404|page not found|not found|doesn['’]t exist|no longer available)\b/i.test(t);
}

function stopProgress(discard = false): void {
  cancelRestore?.();
  cancelRestore = undefined;
  progress?.stop(true, discard);
  progress = null;
  currentChapter = null;
}

function startProgress(chapterId: string, nextUrl?: string, revision = 0, value = 0): void {
  if (currentChapter?.id === chapterId && progress) return;
  stopProgress();
  const chapter = { id: chapterId, nextUrl, revision };
  currentChapter = chapter;
  const url = new URL(location.href);
  const version = generation;
  let container: HTMLElement | null = null;
  let ready = false;
  const getContainer = () => (container && container.isConnected ? container : (container = readerContainerFor(document, url, { siteRules: settings.siteRules })));
  const tracker = new ReaderProgress(
    getContainer,
    settings.completionThreshold,
    (u) => {
      if (!allowed() || generation !== version || (!u.final && location.href !== url.href)) return;
      void send<ProgressResponse & { blocked?: boolean }>({ type: "chapter/progress", chapterId, ...u, progressRevision: chapter.revision }).then(res => {
        if (currentChapter !== chapter) return;
        if (res?.blocked) { stopProgress(true); lastReportKey = ""; void run(); }
        else if (res?.stale) { cancelRestore?.(); cancelRestore = undefined; chapter.revision = res.progressRevision; progress?.reset(res.progress); }
      });
    },
    () => pagedProgressFor(document, url, { siteRules: settings.siteRules }),
    () => ready && location.href === url.href && generation === version && allowed(),
    () => captureReadingPosition(getContainer(), chapter.revision),
    activity => { if (allowed() && generation === version) void send({ type: "chapter/activity", chapterId, ...activity }); },
  );
  progress = tracker;
  if (revision > 0 || value > 0) tracker.reset(value);
  void send<{ position?: ReadingPosition }>({ type: "chapter/resume-position", chapterId, progressRevision: revision }).then(async response => {
    if (currentChapter !== chapter || generation !== version || !allowed() || location.href !== url.href) return;
    const position = sanitizeReadingPosition(response?.position);
    // Paged readers need their own navigation controls; scrolling cannot restore a page.
    if (position && pagedProgressFor(document, url, { siteRules: settings.siteRules }) === null) {
      tracker.waitForActivity();
      const restoration = restoreReadingPosition(position, getContainer, () => currentChapter === chapter && chapter.revision === position.progressRevision && generation === version && allowed() && location.href === url.href);
      cancelRestore = restoration.cancel;
      const result = await restoration.done;
      if (currentChapter !== chapter || generation !== version || !allowed()) return;
      cancelRestore = undefined;
      if (result.userInput) tracker.resumeActivity();
    }
    ready = true;
    tracker.start();
  });
}

function allowed(): boolean {
  return !!settings && !suspended && alive() && !(chrome.extension?.inIncognitoContext && !settings.trackIncognito) && !settings.ignoredHosts.some(h => hostMatches(sourceHost(location.href), h));
}

async function reconcileProgress(): Promise<void> {
  const chapter = currentChapter;
  if (!chapter || !allowed()) return;
  const res = await send<{ progress?: number; progressRevision?: number; blocked?: boolean }>({ type: "chapter/state", chapterId: chapter.id });
  if (currentChapter !== chapter) return;
  if (res?.blocked) {
    stopProgress(true);
    // A manual chapter move changes tab ownership. Resolve the corrected page
    // again rather than leaving its live reader permanently stopped.
    lastReportKey = "";
    void run();
  }
  else if (res?.progressRevision !== undefined && res.progressRevision !== chapter.revision) {
    cancelRestore?.();
    cancelRestore = undefined;
    chapter.revision = res.progressRevision;
    progress?.reset(res.progress ?? 0);
  }
}

/** Clicking the detected "next chapter" link is strong evidence the current chapter is finished. */
function onClick(ev: MouseEvent): void {
  if (!allowed() || !currentChapter?.nextUrl) return;
  const a = (ev.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  let href: string;
  try {
    href = canonicalizeUrl(new URL(a.getAttribute("href") ?? "", location.href).href);
  } catch {
    return;
  }
  if (href === currentChapter.nextUrl) void send({ type: "chapter/next-clicked", chapterId: currentChapter.id, progressRevision: currentChapter.revision });
}

async function run(): Promise<void> {
  if (!allowed()) { stopProgress(true); return; }
  if (running) {
    // A route change or late content arrived mid-report: run once more afterwards.
    rerunRequested = true;
    return;
  }
  running = true;
  const version = generation;
  const visitedUrl = location.href;
  try {
    const url = new URL(location.href);
    if (!mightBeReadingPage(document, url, settings.siteRules)) {
      stopProgress();
      watcher?.settle(true);
      return;
    }
    const obs: PageObservation = detectPage(document, url, { siteRules: settings.siteRules });
    const key = `${obs.url}|${obs.kind}|${obs.chapter?.label ?? ""}|${obs.series?.title ?? ""}|${obs.series?.chapterList.length ?? 0}|${Math.round(obs.confidence * 10)}`;
    watcher?.settle(obs.confidence >= CONFIDENCE.track && (obs.kind !== "series" || (obs.series?.chapterList.length ?? 0) > 0));
    if (key === lastReportKey) return;
    const res = await send<ObservedResponse>({ type: "page/observed", observation: obs, errorPage: obs.kind === "unknown" && isErrorPage() });
    if (generation !== version || location.href !== visitedUrl || !allowed()) return;
    if (!res || res.ok === false) {
      if (retryCount < 5 && !retryTimer) {
        const delay = Math.min(30_000, 1000 * 2 ** retryCount++);
        retryTimer = setTimeout(() => { retryTimer = undefined; void run(); }, delay);
      }
      return;
    }
    lastReportKey = key;
    retryCount = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    const tracked = res.tracked;
    if (tracked?.chapterId && obs.kind === "chapter") startProgress(tracked.chapterId, res.nextUrl, tracked.progressRevision ?? 0, tracked.progress ?? 0);
    else if (obs.kind !== "chapter") stopProgress();
    if (tracked && res?.showToast) {
      const verb = tracked.restored ? "Tracking again" : "Tracking";
      showTrackingToast(`${verb} ${tracked.seriesTitle}`, () => void send({ type: "track/undo", seriesId: tracked.seriesId }));
    }
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      void run();
    }
  }
}

function shutdown(): void {
  generation++;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;
  stopProgress(true);
  watcher?.stop();
  watcher = null;
  removeEventListener("click", onClick, true);
}

async function init(): Promise<void> {
  if (!/^https?:$/.test(location.protocol) || window.top !== window) return;
  const stored = await chrome.storage.local.get("settings").catch(() => ({}) as Record<string, unknown>);
  settings = repairSettings((stored as Record<string, unknown>).settings);
  function observe(): void {
    if (!allowed()) return;
    addEventListener("click", onClick, true);
    watcher ??= watchPage((reason) => {
      if (reason === "url") {
        stopProgress();
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = undefined;
        lastReportKey = "";
        retryCount = 0;
        generation++;
      }
      void run();
    });
    void run();
  }
  addEventListener("pagehide", () => {
    stopProgress();
    suspended = true;
    shutdown();
  });
  addEventListener("pageshow", () => {
    suspended = false;
    lastReportKey = "";
    retryCount = 0;
    observe();
  });

  chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
    if (msg?.type === "content/redetect") {
      lastReportKey = "";
      retryCount = 0;
      void run().then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      const previous = settings;
      settings = repairSettings(changes.settings.newValue);
      const trackingChanged = previous.completionThreshold !== settings.completionThreshold || previous.trackIncognito !== settings.trackIncognito || JSON.stringify(previous.ignoredHosts) !== JSON.stringify(settings.ignoredHosts) || JSON.stringify(previous.siteRules) !== JSON.stringify(settings.siteRules);
      if (!trackingChanged) return;
      stopProgress(!allowed());
      generation++;
      lastReportKey = "";
      retryCount = 0;
      if (!allowed()) shutdown();
      else observe();
    }
    if (area === "local" && changes["reading:revision"]) void reconcileProgress();
  });

  observe();
}

void init();
