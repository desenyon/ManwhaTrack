import type { Chapter, ReadingEvent, SeriesSource } from "../../shared/types/models";
import { sanitizeReadingPosition } from "../../shared/reading-position";
import { read, write, type Tx } from "../db";
import { createChapter, newId, repairChapter } from "../schema";
import { refreshSeriesTx } from "./series";
import { parseChapterLabel } from "../../detection/normalization/chapter";
import { sortChapters } from "../summary";
import { sourceHost } from "../../detection/normalization/url";

/** Mutates only the latest viewport; furthest progress/completion remain separate. */
export function updateReadingPosition(chapter: Chapter, raw: unknown, now = Date.now()): void {
  const p = sanitizeReadingPosition(raw);
  if (!p || p.progressRevision !== (chapter.progressRevision ?? 0) || p.capturedAt > now + 60_000) return;
  const prior = chapter.readingPosition;
  if (!prior || prior.progressRevision !== p.progressRevision || p.capturedAt >= prior.capturedAt) chapter.readingPosition = p;
}

export async function listChapters(seriesId: string): Promise<Chapter[]> {
  const raw = await read(["chapters"], (t) => t.byIndex<Chapter>("chapters", "seriesId", seriesId));
  return sortChapters(raw.map((c) => repairChapter(c as Chapter & Record<string, unknown>)).filter((c): c is Chapter => !!c));
}

export async function addEventTx(t: Tx, e: Omit<ReadingEvent, "id">): Promise<void> {
  await t.put("events", { id: newId(), ...e });
}

export async function notifyProgressChanged(seriesId: string): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ "reading:revision": { seriesId, at: Date.now(), token: newId() } });
    }
  } catch {
    // The revision stored with each chapter still rejects stale automatic writes.
  }
}

function sameOrdinal(a: Chapter, b: Chapter): boolean {
  return a.ordinal !== undefined && b.ordinal !== undefined ? Math.abs(a.ordinal - b.ordinal) < 1e-6 : a.key === b.key;
}

/**
 * Manually marks chapters read or unread. Read state is per chapter identity, so the
 * same chapter held by another source of the series follows along.
 */
export async function markChapters(seriesId: string, chapterIds: string[], readState: boolean): Promise<void> {
  const now = Date.now();
  await write(["series", "chapters", "sources", "events"], async (t) => {
    const all = await t.byIndex<Chapter>("chapters", "seriesId", seriesId);
    const targets = all.filter((c) => chapterIds.includes(c.id));
    for (const target of targets) {
      for (const c of all.filter((x) => sameOrdinal(x, target))) {
        c.progressRevision = (c.progressRevision ?? 0) + 1;
        if (readState) {
          c.completedAt = now;
          c.completionSource = "manual";
          c.maxProgress = Math.max(c.maxProgress, 1);
          await t.put("chapters", c);
        } else {
          c.completedAt = undefined;
          c.completionSource = undefined;
          c.maxProgress = 0;
          await t.put("chapters", c);
        }
      }
      await addEventTx(t, {
        seriesId,
        chapterId: target.id,
        type: readState ? "manual-read" : "manual-unread",
        timestamp: now,
        chapterLabel: target.chapterLabel,
        hostname: sourceHost(target.url),
      });
    }
    await refreshSeriesTx(t, seriesId);
  });
  await notifyProgressChanged(seriesId);
}

/** Marks every known chapter up to and including the given one as read. */
export async function markReadUpTo(seriesId: string, chapterId: string): Promise<number> {
  const now = Date.now();
  const count = await write(["series", "chapters", "sources", "events"], async (t) => {
    const all = await t.byIndex<Chapter>("chapters", "seriesId", seriesId);
    const target = all.find((c) => c.id === chapterId);
    if (!target || target.ordinal === undefined) return 0;
    let n = 0;
    for (const c of all) {
      if (c.ordinal !== undefined && c.ordinal <= target.ordinal + 1e-6 && !c.completedAt) {
        c.progressRevision = (c.progressRevision ?? 0) + 1;
        c.completedAt = now;
        c.completionSource = "manual";
        c.maxProgress = 1;
        await t.put("chapters", c);
        n++;
      }
    }
    await addEventTx(t, { seriesId, chapterId, type: "manual-read", timestamp: now, chapterLabel: `Up to ${target.chapterLabel}`, hostname: sourceHost(target.url) });
    await refreshSeriesTx(t, seriesId);
    return n;
  });
  await notifyProgressChanged(seriesId);
  return count;
}

/**
 * Sets reading progress manually to a chapter label (e.g. "Chapter 50"), creating a
 * placeholder chapter on the preferred source when it is not known yet.
 */
export async function setProgressTo(seriesId: string, label: string): Promise<void> {
  const parsed = parseChapterLabel(label);
  if (parsed.ordinal === undefined) throw new Error("Enter a chapter number, e.g. 50 or 12.5");
  const now = Date.now();
  await write(["series", "chapters", "sources", "events"], async (t) => {
    const series = await t.get<{ preferredSourceId?: string }>("series", seriesId);
    const sources = (await t.byIndex<SeriesSource>("sources", "seriesId", seriesId)).filter((s) => !s.removedAt);
    const source = sources.find((s) => s.id === series?.preferredSourceId) ?? sources[0];
    if (!source) throw new Error("This series has no source");
    const all = await t.byIndex<Chapter>("chapters", "seriesId", seriesId);
    let target = all.find((c) => c.ordinal !== undefined && Math.abs(c.ordinal - parsed.ordinal!) < 1e-6);
    if (!target) {
      target = createChapter({ seriesId, sourceId: source.id, label: parsed.label, url: source.seriesUrl, now });
      target.userFields = ["label", "number"];
      await t.put("chapters", target);
      all.push(target);
    }
    for (const c of all) {
      if (c.ordinal === undefined) continue;
      const shouldRead = c.ordinal <= parsed.ordinal! + 1e-6;
      c.progressRevision = (c.progressRevision ?? 0) + 1;
      if (shouldRead) {
        c.completedAt = now;
        c.completionSource = "manual";
        c.maxProgress = 1;
        await t.put("chapters", c);
      } else {
        c.completedAt = undefined;
        c.completionSource = undefined;
        c.maxProgress = 0;
        await t.put("chapters", c);
      }
    }
    await addEventTx(t, { seriesId, chapterId: target.id, type: "manual-read", timestamp: now, chapterLabel: `Progress set to ${parsed.label}` });
    await refreshSeriesTx(t, seriesId, (s) => {
      s.currentChapterId = target!.id;
    });
  });
  await notifyProgressChanged(seriesId);
}

/** User correction of a chapter's label or number. Survives future detections. */
export async function editChapter(chapterId: string, edit: { label?: string; number?: number | null }): Promise<void> {
  await write(["series", "chapters", "sources"], async (t) => {
    const c = await t.get<Chapter>("chapters", chapterId);
    if (!c) return;
    if (edit.label !== undefined && edit.label.trim()) {
      const p = parseChapterLabel(edit.label);
      c.chapterLabel = p.label;
      c.title = p.label;
      if (!c.userFields.includes("number")) {
        c.ordinal = p.ordinal;
        c.chapterNumber = p.number;
      }
      // Display corrections must not change the detected source identity.
      if (!c.userFields.includes("label")) c.userFields.push("label");
    }
    if (edit.number !== undefined) {
      c.chapterNumber = edit.number ?? undefined;
      c.ordinal = edit.number ?? undefined;
      if (!c.userFields.includes("number")) c.userFields.push("number");
    }
    await t.put("chapters", c);
    await refreshSeriesTx(t, c.seriesId);
  });
}

export async function deleteChapter(chapterId: string): Promise<void> {
  await write(["series", "chapters", "sources", "events"], async (t) => {
    const c = await t.get<Chapter>("chapters", chapterId);
    if (!c) return;
    await t.delete("chapters", chapterId);
    await refreshSeriesTx(t, c.seriesId);
  });
}

export async function allChapters(): Promise<Chapter[]> {
  return read(["chapters"], (t) => t.getAll<Chapter>("chapters"));
}
