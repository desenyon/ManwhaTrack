// Series actions shared by rows, tiles, detail view, keyboard shortcuts and the palette.
// Local operations update the UI optimistically and roll back if persistence fails.

import { useCallback, useMemo } from "react";
import type { Series, SeriesStatus } from "../shared/types/models";
import type { Settings } from "../shared/types/settings";
import { editSeries, removeSeries, restoreSeries } from "../storage/repositories/series";
import { markChapters } from "../storage/repositories/chapters";
import { addToQueue, removeFromQueue } from "../storage/repositories/queue";
import { sendToWorker } from "../shared/messages";
import { publish } from "../shared/bus";
import { STATUS_LABEL } from "../shared/utils/library";
import { shortChapterLabel } from "../detection/normalization/chapter";
import type { useLibrary } from "../ui/hooks";
import { useToast } from "../ui/toasts";

type Lib = ReturnType<typeof useLibrary>;

export function useActions(lib: Lib, settings: Settings, activeTabId: number | undefined) {
  const toast = useToast();

  const continueSeries = useCallback(
    async (s: Series, opts: { newTab?: boolean; url?: string } = {}) => {
      const newTab = opts.newTab ?? settings.continueIn === "new";
      const res = await sendToWorker<{ ok: boolean; error?: string }>({ type: "continue/open", seriesId: s.id, newTab, tabId: newTab ? undefined : activeTabId, url: opts.url });
      if (res && !res.ok) toast.show(res.error ?? "Could not open this series.", { error: true });
    },
    [settings.continueIn, activeTabId, toast],
  );

  const markRead = useCallback(
    async (s: Series, read: boolean) => {
      const target = read
        ? s.summary.currentCompleted === false
          ? s.currentChapterId
          : s.summary.continueKind === "next" || s.summary.continueKind === "resume"
            ? s.summary.continueChapterId
            : s.currentChapterId
        : s.lastCompletedChapterId;
      if (!target) {
        toast.show(read ? "No chapter to mark read yet." : "No read chapter to mark unread.", { error: true });
        return;
      }
      try {
        await markChapters(s.id, [target], read);
        publish({ type: "library-changed", seriesIds: [s.id] });
        void sendToWorker({ type: "badge/refresh" });
        const label = read ? (target === s.currentChapterId ? s.summary.currentLabel : s.summary.continueLabel) : s.summary.lastCompletedLabel;
        toast.show(`${read ? "Marked read" : "Marked unread"}: ${shortChapterLabel(label) || "chapter"}`, {
          undo: async () => {
            await markChapters(s.id, [target], !read);
            publish({ type: "library-changed", seriesIds: [s.id] });
          },
        });
      } catch {
        toast.show("Could not save the change.", { error: true });
      }
    },
    [toast],
  );

  const edit = useCallback(
    async (ids: string[], patch: Partial<Series>, persist: () => Promise<unknown>, failText = "Could not save the change.") => {
      const ok = await lib.mutate(ids, (s) => ({ ...s, ...patch }), persist);
      if (!ok) toast.show(failText, { error: true });
    },
    [lib, toast],
  );

  const toggleFavorite = useCallback((s: Series) => edit([s.id], { favorite: !s.favorite }, () => editSeries(s.id, { favorite: !s.favorite })), [edit]);
  const togglePin = useCallback((s: Series) => edit([s.id], { pinned: !s.pinned }, () => editSeries(s.id, { pinned: !s.pinned })), [edit]);
  const setStatus = useCallback(
    (s: Series, status: SeriesStatus) =>
      edit([s.id], { status }, async () => {
        await editSeries(s.id, { status });
        toast.show(`${s.title} → ${STATUS_LABEL[status]}`);
      }),
    [edit, toast],
  );

  const remove = useCallback(
    async (ids: string[]) => {
      const titles = ids.map((id) => lib.byId.get(id)?.title).filter(Boolean);
      const ok = await lib.mutate(ids, (s) => ({ ...s, removedAt: Date.now() }), () => removeSeries(ids));
      if (!ok) return toast.show("Could not remove.", { error: true });
      toast.show(ids.length === 1 ? `Removed “${titles[0]}”` : `Removed ${ids.length} series`, {
        undo: async () => {
          await restoreSeries(ids);
          publish({ type: "library-changed", seriesIds: ids });
        },
      });
    },
    [lib, toast],
  );

  const toggleQueue = useCallback(
    async (s: Series) => {
      const inQueue = lib.queue.includes(s.id);
      lib.setQueueLocal(inQueue ? lib.queue.filter((x) => x !== s.id) : [...lib.queue, s.id]);
      await (inQueue ? removeFromQueue(s.id) : addToQueue(s.id));
      toast.show(inQueue ? "Removed from queue" : "Added to queue");
      publish({ type: "library-changed" });
    },
    [lib, toast],
  );

  const checkUpdates = useCallback(
    async (ids?: string[]) => {
      toast.show(ids ? "Checking for new chapters…" : "Checking sources for new chapters…");
      const res = await sendToWorker<{ ok: boolean; checked: number }>({ type: "updates/check", seriesIds: ids });
      if (res?.ok) toast.show(res.checked ? `Checked ${res.checked} source${res.checked === 1 ? "" : "s"}` : "Nothing to check right now");
    },
    [toast],
  );

  return useMemo(
    () => ({ continueSeries, markRead, toggleFavorite, togglePin, setStatus, remove, toggleQueue, checkUpdates, edit }),
    [continueSeries, markRead, toggleFavorite, togglePin, setStatus, remove, toggleQueue, checkUpdates, edit],
  );
}

export type Actions = ReturnType<typeof useActions>;
