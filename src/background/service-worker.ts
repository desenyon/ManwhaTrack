// Service worker entry. All listeners are registered synchronously at startup so they
// exist every time Chrome restarts the worker. No state is kept only in memory.

import { registerMessageRouter } from "./messages";
import { createMenus, MENU, updateMenusForTab } from "./menus";
import { registerOmnibox } from "./omnibox";
import { registerNotificationListeners } from "./notifications";
import { runUpdateChecks } from "./update-checker";
import { refreshBadge } from "./badge";
import { clearTabState, getTabState } from "./tabs";
import { refreshDebugFlag, warn } from "./log";
import { handleMessage } from "./messages";
import { purgeRemovedSeries } from "../storage/repositories/series";
import { getSettings, onSettingsChanged, setLocal, getLocal } from "../storage/repositories/settings";
import { getSeries } from "../storage/repositories/series";
import { listSources } from "../storage/repositories/sources";
import { openDb } from "../storage/db";
import { isSafeHttpUrl } from "../detection/normalization/url";

const ALARM_UPDATES = "update-check";
const ALARM_MAINTENANCE = "maintenance";
const REMOVED_RETENTION_MS = 30 * 86_400_000;

registerMessageRouter();
registerOmnibox();
registerNotificationListeners();

async function setup(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => warn("side panel", e));
  createMenus();
  await chrome.alarms.create(ALARM_UPDATES, { periodInMinutes: 30, delayInMinutes: 2 });
  await chrome.alarms.create(ALARM_MAINTENANCE, { periodInMinutes: 24 * 60, delayInMinutes: 10 });
  await refreshDebugFlag();
  await openDb(); // Runs any pending schema migration now rather than on first use.
  await refreshBadge();
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") await setLocal("meta:installedAt", Date.now());
  if (!(await getLocal("meta:installedAt", 0))) await setLocal("meta:installedAt", Date.now());
  await setup();
});

chrome.runtime.onStartup.addListener(() => {
  void setup();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_UPDATES) await runUpdateChecks().catch((e) => warn("update checks", e));
  if (alarm.name === ALARM_MAINTENANCE) await purgeRemovedSeries(REMOVED_RETENTION_MS).catch((e) => warn("maintenance", e));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabState(tabId, { tabClosed: true });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void updateMenusForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  // A full navigation invalidates what we knew about the page until the content script reports again.
  if (info.status === "loading" && info.url) void clearTabState(tabId).then(() => updateMenusForTab(tabId));
});

chrome.permissions.onAdded.addListener(() => registerNotificationListeners());

onSettingsChanged(() => {
  void refreshDebugFlag();
  void refreshBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const state = await getTabState(tab.id);
  switch (info.menuItemId) {
    case MENU.track:
      await handleMessage({ type: "tab/track", tabId: tab.id }, { id: chrome.runtime.id });
      break;
    case MENU.open:
    case MENU.refresh:
      if (info.menuItemId === MENU.refresh) await handleMessage({ type: "tab/redetect", tabId: tab.id }, { id: chrome.runtime.id });
      if (info.menuItemId === MENU.open && state?.seriesId) {
        await chrome.storage.session.set({ "panel:focusSeries": state.seriesId });
        await chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
      }
      break;
    case MENU.markRead:
    case MENU.markUnread:
      await handleMessage({ type: "tab/mark-current", tabId: tab.id, read: info.menuItemId === MENU.markRead }, { id: chrome.runtime.id });
      break;
    case MENU.openSeries: {
      if (!state?.seriesId) break;
      const s = await getSeries(state.seriesId);
      const src = (await listSources(state.seriesId)).find((x) => x.id === s?.preferredSourceId) ?? (await listSources(state.seriesId))[0];
      if (src && isSafeHttpUrl(src.seriesUrl)) await chrome.tabs.update(tab.id, { url: src.seriesUrl });
      break;
    }
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "mark-current-read") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) await handleMessage({ type: "tab/mark-current", tabId: tab.id, read: true }, { id: chrome.runtime.id });
});

// Keep settings-dependent state warm on worker start.
void getSettings().then(() => refreshDebugFlag());
