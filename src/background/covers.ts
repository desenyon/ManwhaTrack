// Downloads cover images once and caches them locally as small blobs.

import { fetchImage } from "./net";
import { setCustomCover, setDetectedCover, type NewCover } from "../storage/repositories/covers";
import { getSeries } from "../storage/repositories/series";
import { listSources } from "../storage/repositories/sources";
import { isSafeHttpUrl } from "../detection/normalization/url";
import { publish } from "../shared/bus";
import { warn } from "./log";

const MAX_WIDTH = 360;
const inflight = new Map<string, Promise<void>>();

async function downscale(blob: Blob): Promise<{ blob: Blob; width?: number; height?: number }> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return { blob };
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_WIDTH / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    if (scale === 1 && blob.size < 150_000) {
      bmp.close();
      return { blob, width: w, height: h };
    }
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob, width: bmp.width, height: bmp.height };
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
    return { blob: out.size < blob.size ? out : blob, width: w, height: h };
  } catch {
    return { blob };
  }
}

export async function downloadCover(url: string, referer?: string): Promise<NewCover> {
  if (!isSafeHttpUrl(url)) throw new Error("Cover could not be downloaded: invalid address.");
  const raw = await fetchImage(url, referer);
  const { blob, width, height } = await downscale(raw);
  return { blob, mimeType: blob.type || raw.type || "image/jpeg", width, height, sourceUrl: url, origin: "detected" };
}

/** Caches the detected cover for a series. Failures are recorded, never fatal. */
export function cacheDetectedCover(seriesId: string, url: string, referer?: string): Promise<void> {
  const k = `${seriesId}|${url}`;
  let p = inflight.get(k);
  if (!p) {
    p = (async () => {
      try {
        const asset = await downloadCover(url, referer);
        await setDetectedCover(seriesId, asset);
        publish({ type: "library-changed", seriesIds: [seriesId] });
      } catch (err) {
        warn("cover", err);
      } finally {
        inflight.delete(k);
      }
    })();
    inflight.set(k, p);
  }
  return p;
}

/** Refresh cover: re-download from the preferred source, or use a chosen candidate as a custom cover. */
export async function refreshCover(seriesId: string, chosenUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const series = await getSeries(seriesId);
  if (!series) return { ok: false, error: "Series not found." };
  const sources = await listSources(seriesId);
  const src = sources.find((s) => s.id === series.preferredSourceId) ?? sources[0];
  try {
    if (chosenUrl) {
      const asset = await downloadCover(chosenUrl, src?.seriesUrl);
      await setCustomCover(seriesId, { ...asset, origin: "custom" });
    } else {
      const url = src?.coverUrl ?? src?.coverCandidates[0];
      if (!url) return { ok: false, error: "No cover has been detected for this series yet." };
      await setDetectedCover(seriesId, await downloadCover(url, src?.seriesUrl));
    }
    publish({ type: "library-changed", seriesIds: [seriesId] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Cover could not be downloaded." };
  }
}
