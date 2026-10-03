// Dated measurements accompany the existing chapter totals in the same transaction.
// Minute buckets bound history growth without guessing dates for legacy totals.
import type { Chapter, ReadingEvent, Series, SeriesSource } from "../../shared/types/models";
import { read, type Tx } from "../db";

export async function recordTimedActivityTx(t: Tx, c: Chapter, delta: number, now: number): Promise<void> {
  let start = now - delta;
  while (start < now) {
    const bucket = Math.floor(start / 60_000);
    const end = Math.min(now, (bucket + 1) * 60_000);
    const id = `time:${c.id}:${bucket}`;
    const previous = await t.get<ReadingEvent>("events", id);
    const durationMs = (previous?.durationMs ?? 0) + end - start;
    await t.put("events", { id, type: "time", seriesId: c.seriesId, chapterId: c.id,
      startedAt: Math.min(previous?.startedAt ?? start, start), timestamp: Math.max(previous?.timestamp ?? end, end),
      durationMs: Math.min(60_000, durationMs, Math.max(previous?.timestamp ?? end, end) - Math.min(previous?.startedAt ?? start, start)), chapterLabel: c.chapterLabel } satisfies ReadingEvent);
    start = end;
  }
}

export async function recordBacklogTx(t: Tx, s: Series, now = Date.now()): Promise<void> {
  const date = new Date(now);
  const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const id = `backlog:${s.id}:${day}`;
  const count = s.removedAt || s.status === "completed" || s.status === "dropped" ? 0 : s.summary.newCount;
  const previous = await t.get<ReadingEvent>("events", id);
  if (previous?.backlogCount === count) return;
  await t.put("events", { id, seriesId: s.id, type: "backlog", timestamp: now, backlogCount: count } satisfies ReadingEvent);
}

export function analyticsRecords() {
  return read(["events", "chapters", "sources"], async t => {
    const [events, chapters, sources] = await Promise.all([
      t.getAll<ReadingEvent>("events"), t.getAll<Chapter>("chapters"), t.getAll<SeriesSource>("sources"),
    ]);
    return { events, chapters, sources };
  });
}
