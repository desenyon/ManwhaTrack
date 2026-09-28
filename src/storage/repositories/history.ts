// Append-oriented reading history. Clearing history never changes library or progress state.

import type { ReadingEvent } from "../../shared/types/models";
import { read, write } from "../db";

export async function listEvents(opts: { seriesId?: string; limit?: number; before?: number } = {}): Promise<ReadingEvent[]> {
  const limit = opts.limit ?? 200;
  return read(["events"], async (t) => {
    if (opts.seriesId) {
      const all = await t.byIndex<ReadingEvent>("events", "seriesId", opts.seriesId);
      return all
        .filter((e) => opts.before === undefined || e.timestamp < opts.before)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    }
    const out: ReadingEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const range = opts.before !== undefined ? IDBKeyRange.upperBound(opts.before, true) : undefined;
      const r = t.store("events").index("timestamp").openCursor(range, "prev");
      r.onsuccess = () => {
        const c = r.result;
        if (!c || out.length >= limit) return resolve();
        out.push(c.value as ReadingEvent);
        c.continue();
      };
      r.onerror = () => reject(r.error);
    });
    return out;
  });
}

export async function allEvents(): Promise<ReadingEvent[]> {
  return read(["events"], (t) => t.getAll<ReadingEvent>("events"));
}

export async function deleteEvent(id: string): Promise<void> {
  await write(["events"], (t) => t.delete("events", id));
}

export async function clearSeriesHistory(seriesId: string): Promise<void> {
  await write(["events"], async (t) => {
    for (const k of await t.keysByIndex("events", "seriesId", seriesId)) await t.delete("events", k);
  });
}

export async function clearAllHistory(): Promise<void> {
  await write(["events"], (t) => t.clear("events"));
}
