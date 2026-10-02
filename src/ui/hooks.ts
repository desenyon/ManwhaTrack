import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Series, SeriesSource } from "../shared/types/models";
import type { Settings } from "../shared/types/settings";
import { DEFAULT_SETTINGS } from "../shared/types/settings";
import { listSeries } from "../storage/repositories/series";
import { listSources } from "../storage/repositories/sources";
import { getQueue } from "../storage/repositories/queue";
import { getSettings, onSettingsChanged, saveSettings } from "../storage/repositories/settings";
import { publish, subscribe } from "../shared/bus";

export interface LibraryData {
  series: Series[];
  sources: SeriesSource[];
  queue: string[];
  loaded: boolean;
  error?: string;
}

/** Loads the whole library from IndexedDB and keeps it fresh via change notifications. */
export function useLibrary() {
  const [data, setData] = useState<LibraryData>({ series: [], sources: [], queue: [], loaded: false });
  const dataRef = useRef(data);
  dataRef.current = data;
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const queueWrites = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const [series, sources, queue] = await Promise.all([listSeries(), listSources(), getQueue()]);
      setData({ series, sources, queue, loaded: true });
    } catch (err) {
      setData((d) => ({ ...d, loaded: true, error: err instanceof Error ? err.message : "The local library could not be opened." }));
    }
  }, []);

  useEffect(() => {
    void reload();
    return subscribe((msg) => {
      if (msg.type !== "library-changed") return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void reload(), 120);
    });
  }, [reload]);

  /**
   * Optimistic local update: applies `patch` immediately, persists, and rolls back on failure.
   */
  const mutate = useCallback(
    (ids: string[], patch: (s: Series) => Series, persist: () => Promise<unknown>): Promise<boolean> => {
      const operation = async () => {
        const before = new Map(dataRef.current.series.filter((s) => ids.includes(s.id)).map((s) => [s.id, s]));
        dataRef.current = { ...dataRef.current, series: dataRef.current.series.map((s) => ids.includes(s.id) ? patch(s) : s) };
        setData((d) => ({ ...d, series: d.series.map((s) => ids.includes(s.id) ? patch(s) : s) }));
        try {
          await persist();
          publish({ type: "library-changed", seriesIds: ids });
          return true;
        } catch {
          dataRef.current = { ...dataRef.current, series: dataRef.current.series.map((s) => before.get(s.id) ?? s) };
          setData((d) => ({ ...d, series: d.series.map((s) => before.get(s.id) ?? s) }));
          return false;
        }
      };
      const pending = mutationQueue.current.then(operation, operation);
      mutationQueue.current = pending;
      return pending;
    }, [],
  );

  const mutateQueue = useCallback((change: (queue: string[]) => string[], persist: (next: string[]) => Promise<unknown>): Promise<boolean> => {
    const operation = async () => {
      const before = [...dataRef.current.queue];
      const next = change(before);
      dataRef.current = { ...dataRef.current, queue: next };
      setData((d) => ({ ...d, queue: next }));
      try {
        await persist(next);
        publish({ type: "library-changed" });
        return true;
      } catch {
        dataRef.current = { ...dataRef.current, queue: before };
        setData((d) => ({ ...d, queue: before }));
        return false;
      }
    };
    const pending = queueWrites.current.then(operation, operation);
    queueWrites.current = pending;
    return pending;
  }, []);

  const byId = useMemo(() => new Map(data.series.map((s) => [s.id, s])), [data.series]);
  const sourcesBySeries = useMemo(() => {
    const m = new Map<string, SeriesSource[]>();
    for (const s of data.sources) m.set(s.seriesId, [...(m.get(s.seriesId) ?? []), s]);
    return m;
  }, [data.sources]);

  return { ...data, byId, sourcesBySeries, reload, mutate, mutateQueue, setQueueLocal: (queue: string[]) => setData((d) => ({ ...d, queue })) };
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    void getSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, []);
  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSettings(await saveSettings(patch));
  }, []);
  return [settings, update];
}

export function useTheme(theme: Settings["theme"]): void {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
