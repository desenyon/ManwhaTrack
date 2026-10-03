import { describe, expect, it } from "vitest";
import { getSettings, repairSettings, saveSettings } from "../../src/storage/repositories/settings";

describe("library appearance preferences", () => {
  it("adds safe defaults to older settings without changing their existing choices", () => {
    const s = repairSettings({ theme: "dark", layout: "list", expandedLayout: "list", artworkMotion: "off" });
    expect(s).toMatchObject({ theme: "dark", expandedLayout: "list", artworkMotion: "off", expandedCardSize: "comfortable", ambientBackground: true, showReadingTimer: true, showFeaturedContinue: true, showScrollbars: false });
  });
  it("repairs invalid appearance values while retaining explicit off choices", () => {
    expect(repairSettings({ expandedCardSize: "huge", ambientBackground: false, showReadingTimer: false, showFeaturedContinue: false, showScrollbars: true })).toMatchObject({ expandedCardSize: "comfortable", ambientBackground: false, showReadingTimer: false, showFeaturedContinue: false, showScrollbars: true });
  });
  it("persists independent layout and appearance choices", async () => {
    await saveSettings({ layout: "list", expandedLayout: "grid", expandedCardSize: "large", ambientBackground: false, showReadingTimer: false, showScrollbars: true });
    await saveSettings({ showFeaturedContinue: false });
    expect(await getSettings()).toMatchObject({ layout: "list", expandedLayout: "grid", expandedCardSize: "large", ambientBackground: false, showReadingTimer: false, showFeaturedContinue: false, showScrollbars: true });
  });
  it("keeps both preferences when controls are changed together", async () => {
    await saveSettings({ expandedCardSize: "comfortable", ambientBackground: true });
    await Promise.all([saveSettings({ expandedCardSize: "large" }), saveSettings({ ambientBackground: false })]);
    expect(await getSettings()).toMatchObject({ expandedCardSize: "large", ambientBackground: false });
  });
});
