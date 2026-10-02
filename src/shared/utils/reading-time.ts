import type { TabState } from "../messages";

export function formatReadingClock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const tail = `${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${tail}` : tail;
}

export function selectReadingActivity(states: TabState[], now = Date.now()) {
  const readers = states.flatMap(s => {
    const a = s?.readingActivity;
    if (!s?.seriesId || !s.chapterId || !a || a.chapterId !== s.chapterId || !Number.isFinite(a.sessionMs) || a.sessionMs < 0) return [];
    return [{ tabId: s.tabId, seriesId: s.seriesId, ...a, active: a.active && now >= a.sampledAt && now - a.sampledAt <= 3500 }];
  });
  return readers.sort((a, b) => Number(b.active) - Number(a.active) || b.sampledAt - a.sampledAt)[0];
}
