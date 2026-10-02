// Per-tab page state, kept in chrome.storage.session so it survives service-worker
// restarts but never touches disk. Used for Now Reading, the Detection Inspector and menus.

import type { TabState } from "../shared/messages";

const key = (tabId: number) => `tab:${tabId}`;
// Chrome storage has no atomic object patch. Serialize each tab's read/write
// operations so a progress checkpoint cannot overwrite a newer clock sample.
const writes = new Map<number, Promise<void>>();
function writeTab(tabId: number, operation: () => Promise<void>): Promise<void> {
  const pending = (writes.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(operation);
  writes.set(tabId, pending);
  const clean = () => { if (writes.get(tabId) === pending) writes.delete(tabId); };
  void pending.then(clean, clean);
  return pending;
}

export async function getTabState(tabId: number): Promise<TabState | undefined> {
  const res = await chrome.storage.session.get(key(tabId));
  return res[key(tabId)] as TabState | undefined;
}

export async function setTabState(state: TabState): Promise<void> {
  await writeTab(state.tabId, async () => { await chrome.storage.session.set({ [key(state.tabId)]: state }); });
}

export async function patchTabState(tabId: number, patch: Partial<TabState>): Promise<void> {
  await writeTab(tabId, async () => {
    const cur = await getTabState(tabId);
    if (cur) await chrome.storage.session.set({ [key(tabId)]: { ...cur, ...patch, updatedAt: Date.now() } });
  });
}

/** Forgets page state. Pending Continue expectations survive navigation unless the tab closed. */
export async function clearTabState(tabId: number, opts: { tabClosed?: boolean } = {}): Promise<void> {
  await writeTab(tabId, async () => { await chrome.storage.session.remove(opts.tabClosed ? [key(tabId), expectKey(tabId), `resume:${tabId}`] : [key(tabId)]); });
}

// ---- Continue expectations: used to notice moved or missing pages ----

export interface Expectation {
  seriesId: string;
  sourceId?: string;
  url: string;
  at: number;
}

const expectKey = (tabId: number) => `expect:${tabId}`;

export async function expectNavigation(tabId: number, e: Expectation): Promise<void> {
  await chrome.storage.session.set({ [expectKey(tabId)]: e });
}

export async function takeExpectation(tabId: number): Promise<Expectation | undefined> {
  const res = await chrome.storage.session.get(expectKey(tabId));
  const e = res[expectKey(tabId)] as Expectation | undefined;
  if (e) await chrome.storage.session.remove(expectKey(tabId));
  return e && Date.now() - e.at < 2 * 60_000 ? e : undefined;
}
