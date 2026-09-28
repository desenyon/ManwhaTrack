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
import { hostMatches, isSafeHttpUrl } from "../detection/normalization/url";
import { completeChapter, markSourceFailing, recordProgress, trackChapterOpened, trackSeriesPage, type TrackResult } from "../storage/tracking";
import { getSeries, purgeSeriesNow, removeSeries } from "../storage/repositories/series";
import { markChapters } from "../storage/repositories/chapters";
import { getSettings } from "../storage/repositories/settings";
import { publish } from "../shared/bus";
import { expectNavigation, getTabState, patchTabState, setTabState, takeExpectation } from "./tabs";
import { cacheDetectedCover, refreshCover } from "./covers";
import { runUpdateChecks } from "./update-checker";
import { refreshBadge } from "./badge";
import { updateMenusForTab } from "./menus";
import { registerNotificationListeners } from "./notifications";
import { debug, warn } from "./log";

type Sender = chrome.runtime.MessageSender;

async function isActiveTab(tabId: number): Promise<boolean> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active?.id === tabId;
}

/** Persists an observation. `force` tracks medium-confidence pages the user explicitly asked for. */
export async function persistObservation(obs: PageObservation, force = false): Promise<TrackResult | null> {
  if (!force && obs.confidence < CONFIDENCE.track) return null;
  if (obs.kind === "chapter" && obs.chapter && obs.series) return trackChapterOpened(obs);
  if ((obs.kind === "series" || force) && obs.series) return trackSeriesPage({ ...obs, kind: "series" });
  return null;
}

async function onObserved(msg: PageObservedMessage, sender: Sender): Promise<ObservedResponse> {
  const tab = sender.tab;
  if (!tab?.id || sender.frameId) return {};
  const settings = await getSettings();
  if (tab.incognito && !settings.trackIncognito) return {};
  const obs = sanitizeObservation(msg.observation);
  if (!obs) return {};
  if (settings.ignoredHosts.some((h) => hostMatches(obs.hostname, h))) return {};

  const expectation = await takeExpectation(tab.id);
  if (msg.errorPage && expectation?.sourceId) {
    await markSourceFailing(expectation.sourceId, "The saved page could not be found. The series may have moved.");
  }

  const state: TabState = { tabId: tab.id, observation: obs, errorPage: msg.errorPage, updatedAt: Date.now() };
  let result: TrackResult | null = null;
  try {
    result = await persistObservation(obs);
  } catch (err) {
    warn("tracking", err);
  }

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
    tracked: result
      ? {
          seriesId: result.seriesId,
          seriesTitle: result.seriesTitle,
          chapterId: result.chapterId,
          chapterLabel: result.chapterLabel,
          created: result.created,
          restored: result.restored,
        }
      : undefined,
    showToast: !!result && (result.created || result.restored) && settings.showTrackingToast,
    nextUrl: obs.chapter?.nextUrl,
  };
}

async function openUrl(url: string, newTab: boolean, tabId?: number): Promise<number | undefined> {
  if (newTab) return (await chrome.tabs.create({ url, active: true })).id;
  if (tabId !== undefined) return (await chrome.tabs.update(tabId, { url }))?.id;
  return (await chrome.tabs.update({ url }))?.id;
}

export async function handleMessage(msg: ExtensionMessage, sender: Sender): Promise<unknown> {
  switch (msg.type) {
    case "page/observed":
      return onObserved(msg, sender);

    case "chapter/progress": {
      if (!isProgressMessage(msg)) return { completed: false };
      const settings = await getSettings();
      const res = await recordProgress(msg.chapterId, {
        progress: msg.progress,
        readingTimeDeltaMs: msg.readingTimeDeltaMs,
        threshold: settings.completionThreshold,
        final: msg.final,
      });
      if (sender.tab?.id) {
        await patchTabState(sender.tab.id, { progress: res.progress });
        publish({ type: "tab-state-changed", tabId: sender.tab.id });
      }
      const state = sender.tab?.id ? await getTabState(sender.tab.id) : undefined;
      publish({ type: "library-changed", seriesIds: state?.seriesId ? [state.seriesId] : undefined });
      if (res.completed) void refreshBadge();
      return res;
    }

    case "chapter/next-clicked": {
      if (typeof msg.chapterId !== "string") return { ok: false };
      const done = await completeChapter(msg.chapterId, "next-link");
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
      const s = await getSeries(msg.seriesId);
      const url = msg.url ?? s?.summary.continueUrl;
      if (!s || !url || !isSafeHttpUrl(url)) return { ok: false, error: "No reading destination is known for this series." };
      const tabId = await openUrl(url, msg.newTab, msg.tabId);
      if (tabId !== undefined) await expectNavigation(tabId, { seriesId: s.id, sourceId: s.preferredSourceId, url, at: Date.now() });
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
