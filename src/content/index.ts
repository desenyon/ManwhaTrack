// Content script. Stays small and mostly invisible: detect → report → measure progress.
// No UI framework is injected into pages.

import { detectPage, mightBeReadingPage, pagedProgressFor, readerContainerFor } from "../detection";
import { CONFIDENCE, type PageObservation } from "../detection/types";
import { canonicalizeUrl, hostMatches, sourceHost } from "../detection/normalization/url";
import { repairSettings } from "../storage/repositories/settings";
import type { Settings } from "../shared/types/settings";
import type { ContentMessage, ExtensionMessage, ObservedResponse } from "../shared/messages";
import { ReaderProgress } from "./reader-progress";
import { watchPage, type PageWatcher } from "./observer";
import { showTrackingToast } from "./toast";

let settings: Settings;
let progress: ReaderProgress | null = null;
let watcher: PageWatcher | null = null;
let currentChapter: { id: string; nextUrl?: string } | null = null;
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

function stopProgress(): void {
  progress?.stop(true);
  progress = null;
  currentChapter = null;
}

function startProgress(chapterId: string, nextUrl?: string): void {
  if (currentChapter?.id === chapterId && progress) return;
  stopProgress();
  currentChapter = { id: chapterId, nextUrl };
  const url = new URL(location.href);
  let container: HTMLElement | null = null;
  progress = new ReaderProgress(
    () => (container && container.isConnected ? container : (container = readerContainerFor(document, url, { siteRules: settings.siteRules }))),
    settings.completionThreshold,
    (u) => void send({ type: "chapter/progress", chapterId, ...u }),
    () => pagedProgressFor(document, new URL(location.href), { siteRules: settings.siteRules }),
  );
  progress.start();
}

/** Clicking the detected "next chapter" link is strong evidence the current chapter is finished. */
function onClick(ev: MouseEvent): void {
  if (!currentChapter?.nextUrl) return;
  const a = (ev.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  let href: string;
  try {
    href = canonicalizeUrl(new URL(a.getAttribute("href") ?? "", location.href).href);
  } catch {
    return;
  }
  if (href === currentChapter.nextUrl) void send({ type: "chapter/next-clicked", chapterId: currentChapter.id });
}

async function run(): Promise<void> {
  if (running) {
    // A route change or late content arrived mid-report: run once more afterwards.
    rerunRequested = true;
    return;
  }
  running = true;
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
    lastReportKey = key;

    const res = await send<ObservedResponse>({ type: "page/observed", observation: obs, errorPage: obs.kind === "unknown" && isErrorPage() });
    const tracked = res?.tracked;
    if (tracked?.chapterId && obs.kind === "chapter") startProgress(tracked.chapterId, res?.nextUrl);
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
  stopProgress();
  watcher?.stop();
  watcher = null;
  removeEventListener("click", onClick, true);
}

async function init(): Promise<void> {
  if (!/^https?:$/.test(location.protocol) || window.top !== window) return;
  const stored = await chrome.storage.local.get("settings").catch(() => ({}) as Record<string, unknown>);
  settings = repairSettings((stored as Record<string, unknown>).settings);
  if (chrome.extension?.inIncognitoContext && !settings.trackIncognito) return;
  if (settings.ignoredHosts.some((h) => hostMatches(sourceHost(location.href), h))) return;

  addEventListener("click", onClick, true);
  watcher = watchPage((reason) => {
    // Progress keeps running across URL changes within one chapter (e.g. /chapter/x/2 on
    // paged readers); run() stops or replaces it once the new page is identified.
    if (reason === "url") lastReportKey = "";
    void run();
  });

  chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
    if (msg?.type === "content/redetect") {
      lastReportKey = "";
      void run().then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      settings = repairSettings(changes.settings.newValue);
      lastReportKey = "";
    }
  });

  await run();
}

void init();
