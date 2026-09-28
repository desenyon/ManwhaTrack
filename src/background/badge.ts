// Optional toolbar badge: number of series with new chapters.

import { listSeries } from "../storage/repositories/series";
import { getSettings } from "../storage/repositories/settings";

export async function refreshBadge(): Promise<void> {
  const settings = await getSettings();
  if (!settings.badge) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  const n = (await listSeries()).filter((s) => !s.hidden && s.status !== "dropped" && s.summary.newCount > 0).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#3b5bdb" });
  await chrome.action.setBadgeText({ text: n > 0 ? (n > 99 ? "99+" : String(n)) : "" });
}
