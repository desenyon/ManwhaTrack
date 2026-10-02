// Service-worker message router. Every handler validates its payload; content-script
// data is treated as untrusted.

import {
  isProgressMessage,
  sanitizeObservation,
  type ExtensionMessage,
  type ObservedResponse,
  type PageObservedMessage,
  type TabState,
} from "../shared/messages";
import { CONFIDENCE, type PageObservation } from "../detection/types";
import { canonicalizeUrl, hostMatches, isSafeHttpUrl } from "../detection/normalization/url";
import { completeChapter, markSourceFailing, recordProgress, trackChapterOpened, trackSeriesPage, type TrackResult } from "../storage/tracking";
import { read, revokeDisallowedWrites } from "../storage/db";
import type { Settings } from "../shared/types/settings";
import type { Chapter } from "../shared/types/models";
import { getSeries, purgeSeriesNow, removeSeries } from "../storage/repositories/series";
import { markChapters } from "../storage/repositories/chapters";
import { getSettings, repairSettings } from "../storage/repositories/settings";
import { publish } from "../shared/bus";
import { expectNavigation, getTabState, patchTabState, setTabState, takeExpectation } from "./tabs";
import { cacheDetectedCover, refreshCover } from "./covers";
import { runUpdateChecks } from "./update-checker";
import { refreshBadge } from "./badge";
import { updateMenusForTab } from "./menus";
import { registerNotificationListeners } from "./notifications";
import { debug, warn } from "./log";
import { expectResume, takeResume } from "./resume";

type Sender = chrome.runtime.MessageSender;

// Chrome preferences and IndexedDB cannot share a transaction. The listener gives
// in-flight IDB writes a synchronous fence when Chrome delivers a revocation.
let policyStorage: typeof chrome.storage | undefined;
let policyEpoch = 0;
let latestPolicy: Settings | undefined;
function watchPolicy(): void {
  if (policyStorage === chrome.storage) return;
  policyStorage = chrome.storage;
  latestPolicy = undefined;
  policyEpoch++;
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      latestPolicy = repairSettings(changes.settings.newValue);
      policyEpoch++;
      revokeDisallowedWrites();
    }
  });
}
function permits(settings: Settings, host: string, sender: Sender): boolean {
  return !(sender.tab?.incognito && !settings.trackIncognito) && !settings.ignoredHosts.some(h => hostMatches(host, h));
}
async function authorize(host: string, sender: Sender): Promise<{ settings: Settings; shouldWrite: () => boolean } | undefined> {
  watchPolicy();
  const before = policyEpoch;
  const stored = await getSettings();
  const settings = policyEpoch !== before && latestPolicy ? latestPolicy : stored;
  if (!permits(settings, host, sender)) return;
  const epoch = policyEpoch;
  return { settings, shouldWrite: () => permits(policyEpoch !== epoch && latestPolicy ? latestPolicy : settings, host, sender) };
}

async function isActiveTab(tabId: number): Promise<boolean> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active?.id === tabId;
}

/** Persists an observation. `force` tracks medium-confidence pages the user explicitly asked for. */
export async function persistObservation(obs: PageObservation, force = false, shouldWrite?: () => boolean): Promise<TrackResult | null> {
  if (!force && obs.confidence < CONFIDENCE.track) return null;
  if (obs.kind === "chapter" && obs.chapter && obs.series) return trackChapterOpened(obs, { shouldWrite });
  if ((obs.kind === "series" || force) && obs.series) return trackSeriesPage({ ...obs, kind: "series" }, Date.now(), shouldWrite);
  return null;
}

async function onObserved(msg: PageObservedMessage, sender: Sender): Promise<ObservedResponse> {
  const tab = sender.tab;
  if (tab?.id === undefined || sender.frameId) return { ok: true };
  const obs = sanitizeObservation(msg.observation);
  if (!obs) return { ok: true };
  if (!(await authorize(obs.hostname, sender))) return { ok: true };
  const senderUrl = sender.url ?? tab.url;
  if (senderUrl && (!isSafeHttpUrl(senderUrl) || new URL(senderUrl).origin !== new URL(obs.url).origin)) return { ok: true };

  const expectation = await takeExpectation(tab.id);
  const permission = await authorize(obs.hostname, sender);
  if (!permission) return { ok: true };
  const settings = permission.settings;
  if (msg.errorPage && expectation?.sourceId) {
    await markSourceFailing(expectation.sourceId, "The saved page could not be found. The series may have moved.", permission.shouldWrite);
  }

  const state: TabState = { tabId: tab.id, observation: obs, errorPage: msg.errorPage, updatedAt: Date.now() };
  let result: TrackResult | null = null;
  try {
    result = await persistObservation(obs, false, permission.shouldWrite);
  } catch (err) {
    warn("tracking", err);
    return { ok: false };
  }

  if (!permission.shouldWrite()) return { ok: true };

  if (result) {
    state.seriesId = result.seriesId;
    state.chapterId = result.chapterId;
    debug("tracked", obs.kind, result.seriesTitle, result.chapterLabel ?? "");
    if (result.coverUrl) void cacheDetectedCover(result.seriesId, result.coverUrl, obs.url);
    publish({ type: "library-changed", seriesIds: [result.seriesId] });
  }
  await setTabState(state);
  publish({ type: "tab-state-changed", tabId: tab.id });
  if (await isActiveTab(tab.id)) await updateMenusForTab(tab.id);
  if (result) void refreshBadge();

  return {
    ok: true,
    tracked: result
      ? {
          seriesId: result.seriesId,
          seriesTitle: result.seriesTitle,
          chapterId: result.chapterId,
          chapterLabel: result.chapterLabel,
          progressRevision: result.chapterProgressRevision,
          progress: result.chapterProgress,
          created: result.created,
          restored: result.restored,
        }
      : undefined,
    showToast: !!result && (result.created || result.restored) && settings.showTrackingToast,
    nextUrl: obs.chapter?.nextUrl,
  };
}

async function automaticChapter(chapterId: string, sender: Sender): Promise<{ chapter: Chapter; settings: Settings; shouldWrite: () => boolean } | undefined> {
  const tab = sender.tab;
  if (tab?.id === undefined || sender.frameId) return;
  watchPolicy();
  const settings = await getSettings();
  if (tab.incognito && !settings.trackIncognito) return;
  const state = await getTabState(tab.id);
  if (!state || state.chapterId !== chapterId) return;
  const host = new URL(state.observation.url).hostname;
  if (settings.ignoredHosts.some(h => hostMatches(host, h))) return;
  const senderUrl = sender.url ?? tab.url;
  if (senderUrl && (!isSafeHttpUrl(senderUrl) || canonicalizeUrl(senderUrl) !== canonicalizeUrl(state.observation.url))) return;
  const chapter = await read(["chapters"], t => t.get<Chapter>("chapters", chapterId));
  if (!chapter || chapter.seriesId !== state.seriesId) return;
  const permission = await authorize(host, sender);
  return permission ? { chapter, ...permission } : undefined;
}

export async function handleMessage(msg: ExtensionMessage, sender: Sender): Promise<unknown> {
  switch (msg.type) {
    case "page/observed":
      return onObserved(msg, sender);

    case "chapter/activity": {
      if (typeof msg.chapterId !== "string" || typeof msg.active !== "boolean" || !Number.isFinite(msg.sessionMs) || msg.sessionMs < 0 || msg.sessionMs > 86_400_000) return { ok: false };
      const permission = await automaticChapter(msg.chapterId, sender);
      if (!permission?.shouldWrite() || sender.tab?.id === undefined) return { ok: false };
      await patchTabState(sender.tab.id, { readingActivity: { active: msg.active, sessionMs: msg.sessionMs, sampledAt: Date.now(), chapterId: msg.chapterId } });
      return { ok: true };
    }

    case "chapter/progress": {
      if (!isProgressMessage(msg)) return { completed: false };
      const permission = await automaticChapter(msg.chapterId, sender);
      if (!permission) return { completed: false, blocked: true };
      const settings = permission.settings;
      const res = await recordProgress(msg.chapterId, {
        progress: msg.progress,
        readingTimeDeltaMs: msg.readingTimeDeltaMs,
        threshold: settings.completionThreshold,
        final: msg.final,
        readingPosition: msg.readingPosition,
        progressRevision: msg.progressRevision,
        shouldWrite: permission.shouldWrite,
      });
      if (res.blocked || res.positionOnly) return res;
      if (sender.tab?.id) {
        await patchTabState(sender.tab.id, { progress: res.progress });
        publish({ type: "tab-state-changed", tabId: sender.tab.id });
      }
      const state = sender.tab?.id ? await getTabState(sender.tab.id) : undefined;
      publish({ type: "library-changed", seriesIds: state?.seriesId ? [state.seriesId] : undefined });
      if (res.completed) void refreshBadge();
      return res;
    }

    case "chapter/state": {
      const permission = await automaticChapter(msg.chapterId, sender);
      const c = permission?.shouldWrite() ? permission.chapter : undefined;
      return c ? { progress: c.maxProgress, progressRevision: c.progressRevision ?? 0 } : { blocked: true };
    }

    case "chapter/resume-position": {
      if (typeof msg.chapterId !== "string" || !Number.isInteger(msg.progressRevision) || msg.progressRevision < 0) return {};
      const permission = await automaticChapter(msg.chapterId, sender);
      if (!permission?.shouldWrite() || sender.tab?.id === undefined) return {};
      const url = sender.url ?? sender.tab.url;
      return { position: url ? await takeResume(sender.tab.id, permission.chapter, url, msg.progressRevision) : undefined };
    }

    case "chapter/next-clicked": {
      if (typeof msg.chapterId !== "string") return { ok: false };
      const permission = await automaticChapter(msg.chapterId, sender);
      if (!permission) return { ok: false };
      const done = await completeChapter(msg.chapterId, "next-link", Date.now(), msg.progressRevision, permission.shouldWrite);
      if (done) publish({ type: "library-changed" });
      return { ok: done };
    }

    case "track/undo": {
      const s = await getSeries(msg.seriesId);
      if (!s) return { ok: false };
      // A series tracked moments ago is removed completely; older ones are soft-removed (restorable).
      if (Date.now() - s.discoveredAt < 10 * 60_000) await purgeSeriesNow([s.id]);
      else await removeSeries([s.id]);
      publish({ type: "library-changed" });
      if (sender.tab?.id) await patchTabState(sender.tab.id, { seriesId: undefined, chapterId: undefined });
      return { ok: true };
    }

    case "continue/open": {
      if (sender.url && !sender.url.startsWith(chrome.runtime.getURL(""))) return { ok: false };
      const s = await getSeries(msg.seriesId);
      const url = msg.url ?? s?.summary.continueUrl;
      if (!s || !url || !isSafeHttpUrl(url)) return { ok: false, error: "No reading destination is known for this series." };
      // Register the private intent before the new content script can detect its page.
      const tabId = msg.newTab ? (await chrome.tabs.create({ url: "about:blank", active: true })).id :
        msg.tabId ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (tabId === undefined) return { ok: false, error: "Could not find a browser tab." };
      const resume = msg.resume ?? (!msg.url && s.summary.continueKind === "resume");
      const chapter = resume ? await read(["chapters"], t => t.firstByIndex<Chapter>("chapters", "canonicalUrl", canonicalizeUrl(url))) : undefined;
      await expectResume(tabId, chapter?.seriesId === s.id ? chapter : undefined, url);
      await expectNavigation(tabId, { seriesId: s.id, sourceId: chapter?.sourceId ?? s.preferredSourceId, url, at: Date.now() });
      await chrome.tabs.update(tabId, { url });
      return { ok: true };
    }

    case "updates/check": {
      const n = await runUpdateChecks({ force: true, seriesIds: msg.seriesIds });
      return { ok: true, checked: n };
    }

    case "cover/refresh":
      return refreshCover(msg.seriesId, msg.url && isSafeHttpUrl(msg.url) ? msg.url : undefined);

    case "tab/track": {
      const state = await getTabState(msg.tabId);
      if (!state) return { ok: false, error: "Could not detect this page." };
      const r = await persistObservation(state.observation, true);
      if (!r) return { ok: false, error: "Could not detect a series on this page." };
      await patchTabState(msg.tabId, { seriesId: r.seriesId, chapterId: r.chapterId });
      if (r.coverUrl) void cacheDetectedCover(r.seriesId, r.coverUrl, state.observation.url);
      publish({ type: "library-changed", seriesIds: [r.seriesId] });
      publish({ type: "tab-state-changed", tabId: msg.tabId });
      await updateMenusForTab(msg.tabId);
      return { ok: true, seriesId: r.seriesId };
    }

    case "tab/redetect":
      await chrome.tabs.sendMessage(msg.tabId, { type: "content/redetect" }).catch(() => undefined);
      return { ok: true };

    case "tab/mark-current": {
      const state = await getTabState(msg.tabId);
      if (!state?.seriesId || !state.chapterId) return { ok: false };
      await markChapters(state.seriesId, [state.chapterId], msg.read);
      publish({ type: "library-changed", seriesIds: [state.seriesId] });
      void refreshBadge();
      return { ok: true };
    }

    case "badge/refresh":
      await refreshBadge();
      return { ok: true };

    case "notifications/changed":
      registerNotificationListeners();
      return { ok: true };

    default:
      return undefined;
  }
}

export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener((msg: ExtensionMessage & { target?: string }, sender, sendResponse) => {
    if (!msg || typeof msg !== "object" || msg.target === "offscreen") return false;
    // Only accept messages from this extension's own contexts and content scripts.
    if (sender.id !== chrome.runtime.id) return false;
    handleMessage(msg, sender)
      .then(sendResponse)
      .catch((err) => {
        warn(`message ${msg.type}`, err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : "Unexpected error" });
      });
    return true;
  });
}
