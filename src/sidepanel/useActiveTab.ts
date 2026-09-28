// Tracks the tab beside the side panel and what ManwhaTrack knows about its page.

import { useEffect, useState } from "react";
import type { TabState } from "../shared/messages";
import { subscribe } from "../shared/bus";

export function useActiveTab(): { tabId?: number; state?: TabState } {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<TabState>();

  useEffect(() => {
    let windowId: number | undefined;
    const refresh = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      windowId = tab?.windowId;
      setTabId(tab?.id);
      if (tab?.id !== undefined) {
        const res = await chrome.storage.session.get(`tab:${tab.id}`);
        setState(res[`tab:${tab.id}`] as TabState | undefined);
      } else setState(undefined);
    };
    void refresh();
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
      if (windowId === undefined || info.windowId === windowId) void refresh();
    };
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.status || info.url) void refresh();
    };
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && Object.keys(changes).some((k) => k.startsWith("tab:"))) void refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.storage.onChanged.addListener(onStorage);
    const unsub = subscribe((m) => m.type === "tab-state-changed" && void refresh());
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.storage.onChanged.removeListener(onStorage);
      unsub();
    };
  }, []);

  return { tabId, state };
}
