import { expect, it, vi } from "vitest";
import { getTabState, patchTabState, setTabState, clearTabState } from "../../src/background/tabs";
import type { TabState } from "../../src/shared/messages";
it("keeps both the paused clock and progress when their updates arrive together", async () => {
  const data: Record<string, unknown> = {};
  vi.stubGlobal("chrome", { storage: { session: {
    get: async (key: string) => { const result = structuredClone({ [key]: data[key] }); await Promise.resolve(); return result; },
    set: async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); },
    remove: async (keys: string[]) => { for (const key of keys) delete data[key]; },
  } } });
  try {
    await setTabState({ tabId: 7, chapterId: "c", seriesId: "s", progress: 0, updatedAt: 1 } as TabState);
    const paused = { active: false, sessionMs: 3400, sampledAt: 10, chapterId: "c" };
    await Promise.all([patchTabState(7, { readingActivity: paused }), patchTabState(7, { progress: .4 })]);
    expect(await getTabState(7)).toMatchObject({ readingActivity: paused, progress: .4 });
    await Promise.all([patchTabState(7, { progress: .5 }), clearTabState(7)]);
    expect(await getTabState(7)).toBeUndefined();
  } finally { vi.unstubAllGlobals(); }
});
