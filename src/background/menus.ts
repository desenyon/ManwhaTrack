// Page context menu. Items are only visible when relevant to the active tab.

import { getTabState } from "./tabs";
import { CONFIDENCE } from "../detection/types";

export const MENU = {
  track: "mt-track",
  open: "mt-open",
  markRead: "mt-mark-read",
  markUnread: "mt-mark-unread",
  openSeries: "mt-open-series",
  refresh: "mt-refresh",
} as const;

export function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    const items: [string, string][] = [
      [MENU.track, "Track this series"],
      [MENU.open, "Open in ManwhaTrack"],
      [MENU.markRead, "Mark current chapter read"],
      [MENU.markUnread, "Mark current chapter unread"],
      [MENU.openSeries, "Open series page"],
      [MENU.refresh, "Refresh metadata"],
    ];
    for (const [id, title] of items) chrome.contextMenus.create({ id, title, contexts: ["page"], visible: false });
  });
}

export async function updateMenusForTab(tabId: number | undefined): Promise<void> {
  const state = tabId !== undefined ? await getTabState(tabId) : undefined;
  const obs = state?.observation;
  const tracked = !!state?.seriesId;
  const isChapter = obs?.kind === "chapter" && !!state?.chapterId;
  const trackable = !tracked && !!obs && (obs.kind === "series" || obs.kind === "chapter") && !!obs.series && obs.confidence >= CONFIDENCE.observe;
  const vis: Record<string, boolean> = {
    [MENU.track]: trackable,
    [MENU.open]: tracked,
    [MENU.markRead]: isChapter,
    [MENU.markUnread]: isChapter,
    [MENU.openSeries]: isChapter,
    [MENU.refresh]: tracked,
  };
  await Promise.all(Object.entries(vis).map(([id, visible]) => chrome.contextMenus.update(id, { visible }).catch(() => undefined)));
}
