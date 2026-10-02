// Settings live in chrome.storage.local (never sync). Falls back to memory outside the extension.

import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, type Settings, type SiteRule } from "../../shared/types/settings";

interface KV {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const memory = new Map<string, unknown>();
const memoryKV: KV = {
  async get(keys) {
    const list = keys === null ? [...memory.keys()] : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (memory.has(k)) out[k] = structuredClone(memory.get(k));
    return out;
  },
  async set(items) {
    for (const [k, v] of Object.entries(items)) memory.set(k, structuredClone(v));
  },
  async remove(keys) {
    for (const k of Array.isArray(keys) ? keys : [keys]) memory.delete(k);
  },
};

export function localKV(): KV {
  return typeof chrome !== "undefined" && chrome.storage?.local ? (chrome.storage.local as unknown as KV) : memoryKV;
}

const SETTINGS_KEY = "settings";

export function repairSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  const s: Settings = { ...DEFAULT_SETTINGS, ...r };
  if (!["system", "light", "dark"].includes(s.theme)) s.theme = "system";
  if (!["system", "on", "off"].includes(s.artworkMotion)) s.artworkMotion = "system";
  if (!["list", "grid"].includes(s.layout)) s.layout = "list";
  if (!["list", "grid"].includes(s.expandedLayout)) s.expandedLayout = "grid";
  if (!["current", "new"].includes(s.continueIn)) s.continueIn = "current";
  if (!["off", "favorites", "all"].includes(s.notifications)) s.notifications = "off";
  s.completionThreshold = clampNum(s.completionThreshold, 0.5, 1, DEFAULT_SETTINGS.completionThreshold);
  s.updateIntervalHours = clampNum(s.updateIntervalHours, 2, 168, DEFAULT_SETTINGS.updateIntervalHours);
  s.ignoredHosts = Array.isArray(s.ignoredHosts) ? s.ignoredHosts.filter((h) => typeof h === "string") : [];
  s.sortByView = s.sortByView && typeof s.sortByView === "object" ? s.sortByView : {};
  s.shortcuts = { ...DEFAULT_SHORTCUTS, ...(s.shortcuts && typeof s.shortcuts === "object" ? s.shortcuts : {}) };
  s.siteRules = Array.isArray(s.siteRules) ? s.siteRules.filter(isSiteRule) : [];
  for (const k of ["showTrackingToast", "updateChecks", "badge", "trackIncognito", "debug"] as const) s[k] = s[k] === true || (s[k] !== false && DEFAULT_SETTINGS[k]);
  return s;
}

function isSiteRule(r: unknown): r is SiteRule {
  const x = r as SiteRule;
  return !!x && typeof x.id === "string" && typeof x.host === "string" && !!x.selectors && typeof x.selectors === "object";
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

export async function getSettings(): Promise<Settings> {
  const res = await localKV().get(SETTINGS_KEY);
  return repairSettings(res[SETTINGS_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = repairSettings({ ...(await getSettings()), ...patch });
  await localKV().set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return () => undefined;
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[SETTINGS_KEY]) cb(repairSettings(changes[SETTINGS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ---- small extension state (not library data) ----

export async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const res = await localKV().get(key);
  return (res[key] as T | undefined) ?? fallback;
}

export async function setLocal(key: string, value: unknown): Promise<void> {
  await localKV().set({ [key]: value });
}
