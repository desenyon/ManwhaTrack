import { useEffect, useState } from "react";
import type { TabState } from "../shared/messages";
import { selectReadingActivity } from "../shared/utils/reading-time";

/** The live clock uses measured content-script samples; it never invents elapsed time. */
export function useReadingActivity() {
  const [states, setStates] = useState<TabState[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let cancelled = false, generation = 0;
    const refresh = async () => {
      const version = ++generation;
      const raw = await chrome.storage.session.get(null).catch(() => ({}));
      if (!cancelled && version === generation) setStates(Object.entries(raw).filter(([key]) => key.startsWith("tab:")).map(([, value]) => value as TabState));
    };
    void refresh();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "session" && Object.keys(changes).some(k => k.startsWith("tab:"))) void refresh(); };
    chrome.storage.onChanged.addListener(listener);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; clearInterval(clock); chrome.storage.onChanged.removeListener(listener); };
  }, []);
  return selectReadingActivity(states, Math.max(now, Date.now()));
}
