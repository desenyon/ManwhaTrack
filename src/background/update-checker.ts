// Local new-chapter checking. Requests go directly to the original websites, one per
// host per run, with per-source intervals and exponential backoff after failures.
// There is no central service.

import type { Series, SeriesSource } from "../shared/types/models";
import type { SiteRule } from "../shared/types/settings";
import { listSeries } from "../storage/repositories/series";
import { listSources } from "../storage/repositories/sources";
import { getSettings } from "../storage/repositories/settings";
import { applyUpdateCheck } from "../storage/tracking";
import { fetchText } from "./net";
import { closeOffscreen, parseInOffscreen } from "./offscreen";
import { notifyNewChapters } from "./notifications";
import { refreshBadge } from "./badge";
import { publish } from "../shared/bus";
import { debug, warn } from "./log";
import { isSafeHttpUrl } from "../detection/normalization/url";
import { adapterById, updatesSupported } from "../detection";
import { chaptersFromMangadexFeed, mangadexSeriesId } from "../detection/adapters/mangadex";

const HOUR = 3_600_000;
const MAX_PER_RUN = 8;
const SPACING_MS = 1500;
const LOCK_KEY = "updates:lock";

export function isDue(src: SeriesSource, intervalHours: number, now: number): boolean {
  if (src.disabled) return false;
  const backoff = Math.pow(2, Math.min(src.consecutiveFailures ?? 0, 5));
  return !src.lastCheckedAt || now - src.lastCheckedAt >= intervalHours * HOUR * backoff;
}

/** Picks which sources to check: due ones, favorites first, oldest check first, one per host. */
export function planChecks(
  series: Series[],
  sources: SeriesSource[],
  intervalHours: number,
  now: number,
  opts: { force?: boolean; seriesIds?: string[] } = {},
): SeriesSource[] {
  const byId = new Map(series.map((s) => [s.id, s]));
  const eligible = sources.filter((src) => {
    const s = byId.get(src.seriesId);
    if (!s || s.removedAt || s.hidden || s.status === "dropped") return false;
    if (s.status === "completed" && src.storyEnded) return false;
    if (opts.seriesIds && !opts.seriesIds.includes(s.id)) return false;
    if (!isSafeHttpUrl(src.seriesUrl) || src.disabled) return false;
    if (!updatesSupported(src)) return false;
    return opts.force || isDue(src, intervalHours, now);
  });
  eligible.sort((a, b) => {
    const fa = byId.get(a.seriesId)?.favorite ? 0 : 1;
    const fb = byId.get(b.seriesId)?.favorite ? 0 : 1;
    return fa - fb || (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0);
  });
  const hosts = new Set<string>();
  const out: SeriesSource[] = [];
  const limit = opts.seriesIds ? 20 : MAX_PER_RUN;
  for (const src of eligible) {
    // A manual refresh of specific series may hit one host more than once, still sequentially.
    if (!opts.seriesIds && hosts.has(src.hostname)) continue;
    hosts.add(src.hostname);
    out.push(src);
    if (out.length >= limit) break;
  }
  return out;
}

/** MangaDex pages are client-rendered; its public API lists chapters directly. */
async function checkMangadex(src: SeriesSource): Promise<void> {
  const id = mangadexSeriesId(src.seriesUrl);
  if (!id) {
    await applyUpdateCheck(src.id, { ok: false, error: "Series page appears to have moved." });
    return;
  }
  const url = `https://api.mangadex.org/manga/${id}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=100&includeExternalUrl=0&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic`;
  const res = await fetchText(url, { maxBytes: 3_000_000 });
  if (!res.ok) {
    await applyUpdateCheck(src.id, { ok: false, error: `This source has not responded (HTTP ${res.status}).`, notFound: res.status === 404 });
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    await applyUpdateCheck(src.id, { ok: false, error: "This source returned an unexpected response." });
    return;
  }
  const out = await applyUpdateCheck(src.id, { ok: true, chapters: chaptersFromMangadexFeed(json) });
  if (out.series && out.newChapters.length) await notifyNewChapters(out.series, out.newChapters);
}

async function acquireLock(): Promise<boolean> {
  const res = await chrome.storage.session.get(LOCK_KEY);
  const held = res[LOCK_KEY] as number | undefined;
  if (held && Date.now() - held < 5 * 60_000) return false;
  await chrome.storage.session.set({ [LOCK_KEY]: Date.now() });
  return true;
}

async function checkSource(src: SeriesSource, siteRules: SiteRule[]): Promise<void> {
  try {
    if (adapterById(src.adapterId)?.updates === "mangadex-api") return await checkMangadex(src);
    const page = await fetchText(src.seriesUrl, { referer: `${new URL(src.seriesUrl).origin}/` });
    if (!page.ok) {
      const moved = page.status === 404 || page.status === 410;
      await applyUpdateCheck(src.id, {
        ok: false,
        error: moved ? "Series page appears to have moved." : `This source has not responded (HTTP ${page.status}).`,
        notFound: moved,
      });
      return;
    }
    const obs = await parseInOffscreen(page.text, page.finalUrl, siteRules);
    let chapters = obs?.series?.chapterList ?? [];
    // Madara sites often load the chapter list separately.
    if (!chapters.length && (src.adapterId === "madara" || obs?.adapterId === "madara")) {
      const base = page.finalUrl.endsWith("/") ? page.finalUrl : `${page.finalUrl}/`;
      const ajax = await fetchText(`${base}ajax/chapters/`, { method: "POST", referer: base });
      if (ajax.ok) {
        const listObs = await parseInOffscreen(`<html><body><ul>${ajax.text}</ul></body></html>`, page.finalUrl, siteRules);
        chapters = listObs?.series?.chapterList ?? [];
      }
    }
    if (!obs || (obs.kind !== "series" && !chapters.length)) {
      await applyUpdateCheck(src.id, { ok: false, error: "Could not detect a chapter list on the series page." });
      return;
    }
    const res = await applyUpdateCheck(src.id, {
      ok: true,
      chapters,
      title: obs.series?.title,
      finalUrl: page.redirected ? page.finalUrl : undefined,
      storyEnded: obs.series?.storyEnded,
    });
    debug("update check", src.hostname, res.newChapters.length);
    if (res.series && res.newChapters.length) await notifyNewChapters(res.series, res.newChapters);
  } catch (err) {
    warn("update check", err);
    const timeout = err instanceof Error && err.name === "AbortError";
    await applyUpdateCheck(src.id, { ok: false, error: timeout ? "This source has not responded recently." : "This source could not be reached." });
  }
}

export async function runUpdateChecks(opts: { force?: boolean; seriesIds?: string[] } = {}): Promise<number> {
  const settings = await getSettings();
  if (!settings.updateChecks && !opts.force) return 0;
  if (!(await acquireLock())) return 0;
  try {
    const [series, sources] = await Promise.all([listSeries(), listSources()]);
    const plan = planChecks(series, sources, settings.updateIntervalHours, Date.now(), opts);
    for (let i = 0; i < plan.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, SPACING_MS));
      const src = plan[i]!;
      await checkSource(src, settings.siteRules);
      publish({ type: "library-changed", seriesIds: [src.seriesId] });
    }
    await chrome.storage.local.set({ "updates:lastRunAt": Date.now() });
    return plan.length;
  } finally {
    await chrome.storage.session.remove(LOCK_KEY);
    await closeOffscreen();
    await refreshBadge();
  }
}
