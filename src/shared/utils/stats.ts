// Local reading statistics. Only counts what was actually recorded; never estimates.

import type { Chapter, ReadingEvent, Series, SeriesSource } from "../types/models";
import { startOfDay } from "./format";

const DAY = 86_400_000;

export interface ReadingStats {
  chaptersRead: number;
  seriesStarted: number;
  seriesCompleted: number;
  measuredReadingMs: number;
  byDay: { day: number; count: number }[];
  byWeek: { week: number; count: number }[];
  mostRead: { series: Series; chapters: number }[];
  activeSources: { hostname: string; lastActive: number; events: number }[];
}

export function computeStats(series: Series[], chapters: Chapter[], events: ReadingEvent[], sources: SeriesSource[], now = Date.now()): ReadingStats {
  const live = series.filter((s) => !s.removedAt);
  const liveIds = new Set(live.map((s) => s.id));
  const completed = chapters.filter((c) => c.completedAt && liveIds.has(c.seriesId));

  const today = startOfDay(now);
  const byDay = Array.from({ length: 30 }, (_, i) => ({ day: today - (29 - i) * DAY, count: 0 }));
  const weekStart = today - ((new Date(today).getDay() + 6) % 7) * DAY; // Monday
  const byWeek = Array.from({ length: 12 }, (_, i) => ({ week: weekStart - (11 - i) * 7 * DAY, count: 0 }));
  for (const c of completed) {
    const t = c.completedAt!;
    const d = Math.floor((startOfDay(t) - byDay[0]!.day) / DAY);
    if (d >= 0 && d < 30) byDay[d]!.count++;
    const w = Math.floor((t - byWeek[0]!.week) / (7 * DAY));
    if (w >= 0 && w < 12) byWeek[w]!.count++;
  }

  const perSeries = new Map<string, number>();
  for (const c of completed) perSeries.set(c.seriesId, (perSeries.get(c.seriesId) ?? 0) + 1);
  const byId = new Map(live.map((s) => [s.id, s]));
  const mostRead = [...perSeries.entries()]
    .map(([id, n]) => ({ series: byId.get(id)!, chapters: n }))
    .filter((x) => x.series)
    .sort((a, b) => b.chapters - a.chapters)
    .slice(0, 5);

  const hostOfSeries = new Map<string, string>();
  for (const s of sources) if (!hostOfSeries.has(s.seriesId)) hostOfSeries.set(s.seriesId, s.hostname);
  const hosts = new Map<string, { lastActive: number; events: number }>();
  for (const e of events) {
    if (now - e.timestamp > 30 * DAY) continue;
    const h = e.hostname ?? hostOfSeries.get(e.seriesId);
    if (!h) continue;
    const cur = hosts.get(h) ?? { lastActive: 0, events: 0 };
    cur.events++;
    cur.lastActive = Math.max(cur.lastActive, e.timestamp);
    hosts.set(h, cur);
  }

  return {
    chaptersRead: completed.length,
    seriesStarted: live.filter((s) => s.summary.chaptersRead > 0 || s.lastReadAt).length,
    seriesCompleted: live.filter((s) => s.status === "completed").length,
    measuredReadingMs: chapters.filter((c) => liveIds.has(c.seriesId)).reduce((a, c) => a + c.readingTimeMs, 0),
    byDay,
    byWeek,
    mostRead,
    activeSources: [...hosts.entries()].map(([hostname, v]) => ({ hostname, ...v })).sort((a, b) => b.lastActive - a.lastActive).slice(0, 8),
  };
}
