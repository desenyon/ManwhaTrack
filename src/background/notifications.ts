// Optional new-chapter notifications. The permission is requested only when the user
// enables the feature in Settings; until then chrome.notifications is undefined.

import type { Chapter, Series } from "../shared/types/models";
import { getSettings } from "../storage/repositories/settings";
import { isSafeHttpUrl } from "../detection/normalization/url";

const PREFIX = "mt:";
let registered = false;

export async function notificationsAllowed(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ["notifications"] });
  } catch {
    return false;
  }
}

export async function notifyNewChapters(series: Series, chapters: Chapter[]): Promise<void> {
  if (!chapters.length || !chrome.notifications) return;
  const settings = await getSettings();
  if (settings.notifications === "off") return;
  if (settings.notifications === "favorites" && !series.favorite) return;
  if (series.status === "dropped" || series.hidden) return;
  if (!(await notificationsAllowed())) return;
  const newest = [...chapters].sort((a, b) => (b.ordinal ?? 0) - (a.ordinal ?? 0))[0]!;
  const message = chapters.length === 1 ? `${newest.chapterLabel} is available.` : `${chapters.length} new chapters, up to ${newest.chapterLabel}.`;
  const url = series.summary.continueUrl ?? newest.url;
  await chrome.notifications.create(`${PREFIX}${series.id}:${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: series.title,
    message,
    contextMessage: isSafeHttpUrl(url) ? new URL(url).hostname : undefined,
  });
  await chrome.storage.session.set({ [`notif:${series.id}`]: url });
}

export function registerNotificationListeners(): void {
  if (!chrome.notifications?.onClicked || registered) return;
  registered = true;
  chrome.notifications.onClicked.addListener(async (id) => {
    if (!id.startsWith(PREFIX)) return;
    const seriesId = id.slice(PREFIX.length).split(":")[0] ?? "";
    const res = await chrome.storage.session.get(`notif:${seriesId}`);
    const url = res[`notif:${seriesId}`];
    if (isSafeHttpUrl(url)) await chrome.tabs.create({ url });
    chrome.notifications.clear(id);
  });
}
