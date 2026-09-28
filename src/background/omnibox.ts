// "mt <query>" in the address bar: local search of tracked series, Enter continues reading.

import { listSeries } from "../storage/repositories/series";
import { listSources } from "../storage/repositories/sources";
import { buildSearchEntry, search } from "../shared/utils/search";
import { shortChapterLabel } from "../detection/normalization/chapter";
import { isSafeHttpUrl } from "../detection/normalization/url";
import type { Series } from "../shared/types/models";

function xml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

async function matches(query: string): Promise<Series[]> {
  const [series, sources] = await Promise.all([listSeries(), listSources()]);
  const bySeries = new Map<string, typeof sources>();
  for (const s of sources) bySeries.set(s.seriesId, [...(bySeries.get(s.seriesId) ?? []), s]);
  const byId = new Map(series.map((s) => [s.id, s]));
  if (!query.trim()) {
    return series
      .filter((s) => s.summary.continueUrl)
      .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
      .slice(0, 6);
  }
  const entries = series.map((s) => buildSearchEntry(s, bySeries.get(s.id)));
  return search(entries, query, 6)
    .map((r) => byId.get(r.id))
    .filter((s): s is Series => !!s);
}

function describe(s: Series): string {
  const ch = s.summary.continueLabel ? shortChapterLabel(s.summary.continueLabel) : "";
  const action = s.summary.continueKind === "series" ? "Open series" : `Continue ${ch}`.trim();
  return `<match>${xml(s.title)}</match> <dim>— ${xml(action)}</dim>`;
}

export function registerOmnibox(): void {
  chrome.omnibox.setDefaultSuggestion({ description: "Search your ManwhaTrack library" });

  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const found = await matches(text);
    suggest(found.map((s) => ({ content: `mt:${s.id}`, description: describe(s) })));
  });

  chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
    let target: Series | undefined;
    if (text.startsWith("mt:")) target = (await listSeries()).find((s) => s.id === text.slice(3));
    else target = (await matches(text))[0];
    const url = target?.summary.continueUrl;
    if (!url || !isSafeHttpUrl(url)) return;
    if (disposition === "currentTab") await chrome.tabs.update({ url });
    else await chrome.tabs.create({ url, active: disposition === "newForegroundTab" });
  });
}
