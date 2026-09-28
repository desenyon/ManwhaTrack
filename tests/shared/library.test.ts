import { describe, expect, it } from "vitest";
import { createSeries } from "../../src/storage/schema";
import { findDuplicates, inView, matchesFilters, NO_FILTERS, sortSeries } from "../../src/shared/utils/library";
import { buildSearchEntry, search } from "../../src/shared/utils/search";
import { titleKeysFor } from "../../src/storage/schema";
import type { Series } from "../../src/shared/types/models";

function mk(title: string, patch: Partial<Series> = {}): Series {
  const s = createSeries({ title });
  return { ...s, ...patch, summary: { ...s.summary, ...(patch.summary ?? {}) } };
}

describe("views", () => {
  const now = Date.now();
  it("Continue shows series with a reading position that are being read", () => {
    expect(inView(mk("A", { summary: { continueKind: "resume" } as Series["summary"] }), "continue", now)).toBe(true);
    expect(inView(mk("B", { status: "dropped", summary: { continueKind: "resume" } as Series["summary"] }), "continue", now)).toBe(false);
    expect(inView(mk("C", { summary: { continueKind: "series" } as Series["summary"] }), "continue", now)).toBe(false);
    expect(inView(mk("D", { summary: { continueKind: "next", caughtUp: true } as Series["summary"] }), "continue", now)).toBe(false);
  });
  it("removed and hidden series stay out of views", () => {
    expect(inView(mk("A", { removedAt: 1 }), "all", now)).toBe(false);
    expect(inView(mk("A", { hidden: true }), "reading", now)).toBe(false);
  });
  it("favorites and pinned are independent", () => {
    const pinned = mk("P", { pinned: true });
    expect(inView(pinned, "pinned", now)).toBe(true);
    expect(inView(pinned, "favorites", now)).toBe(false);
  });
});

describe("filters and sorting", () => {
  it("composes filters", () => {
    const s = mk("A", { tags: ["Murim"], favorite: true, summary: { newCount: 2 } as Series["summary"] });
    const hosts = () => ["asura.gg"];
    expect(matchesFilters(s, { ...NO_FILTERS, tags: ["murim"], favorite: true, unread: true, hosts: ["asura.gg"] }, hosts)).toBe(true);
    expect(matchesFilters(s, { ...NO_FILTERS, hosts: ["other.com"] }, hosts)).toBe(false);
    expect(matchesFilters(s, { ...NO_FILTERS, caughtUp: true }, hosts)).toBe(false);
  });
  it("sorts naturally, pinned first", () => {
    const list = [mk("Tower 10"), mk("Tower 2"), mk("alpha"), mk("Zed", { pinned: true })];
    expect(sortSeries(list, "title-asc").map((s) => s.title)).toEqual(["Zed", "alpha", "Tower 2", "Tower 10"]);
    expect(sortSeries(list, "title-desc").map((s) => s.title)[0]).toBe("Zed");
  });
});

describe("local search", () => {
  const lib = [mk("Omniscient Reader's Viewpoint"), mk("Solo Leveling", { tags: ["Action"] }), mk("Tower of God", { notes: "wait for season 3" })];
  const entries = lib.map((s) => buildSearchEntry(s, []));
  const titles = (q: string) => search(entries, q).map((r) => lib.find((s) => s.id === r.id)!.title);
  it("matches prefixes, tags and notes", () => {
    expect(titles("omni")).toEqual(["Omniscient Reader's Viewpoint"]);
    expect(titles("action")).toEqual(["Solo Leveling"]);
    expect(titles("season")).toEqual(["Tower of God"]);
  });
  it("tolerates typos", () => {
    expect(titles("solo levling")).toEqual(["Solo Leveling"]);
    expect(titles("omnicsient")).toEqual(["Omniscient Reader's Viewpoint"]);
  });
  it("requires every word to match", () => {
    expect(titles("solo tower")).toEqual([]);
  });
});

describe("duplicate suggestions", () => {
  it("pairs shared title keys unless kept separate", () => {
    const a = mk("Solo Leveling");
    const b = mk("Only I Level Up", { alternateTitles: ["Solo Leveling"] });
    b.titleKeys = titleKeysFor(b.title, b.alternateTitles);
    expect(findDuplicates([a, b])).toHaveLength(1);
    b.keptSeparateFrom = [a.id];
    expect(findDuplicates([a, b])).toHaveLength(0);
  });
});
