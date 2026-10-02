// Downloads cover images once and caches them locally as small blobs.

import { fetchImage } from "./net";
import { getCover, setCustomCover, setDetectedCover, type NewCover } from "../storage/repositories/covers";
import { getSeries } from "../storage/repositories/series";
import { listSources } from "../storage/repositories/sources";
import { isSafeHttpUrl } from "../detection/normalization/url";
import { publish } from "../shared/bus";
import { warn } from "./log";
import { getCoverStatus, setCoverStatus } from "../storage/cover-status";

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
      const now = Date.now();
      let attemptedDownload = false;
      try {
        const series = await getSeries(seriesId);
        if (!series || series.removedAt) return;
        const previous = await getCoverStatus(seriesId);
        const cached = series.detectedCoverId ? await getCover(series.detectedCoverId) : undefined;
        if (previous?.url === url && ((previous.state === "ready" && cached?.blob) || (previous.state === "pending" && now - previous.attemptedAt < 120_000) || (previous.state === "failed" && now < (previous.retryAfter ?? 0)))) {
          return;
        }
        await setCoverStatus(seriesId, { state: "pending", url, attemptedAt: now });
        attemptedDownload = true;
        const asset = await downloadCover(url, referer);
        await setDetectedCover(seriesId, asset);
        await setCoverStatus(seriesId, { state: "ready", url, attemptedAt: now });
        publish({ type: "library-changed", seriesIds: [seriesId] });
      } catch (err) {
        warn("cover", err);
        if (attemptedDownload) await setCoverStatus(seriesId, { state: "failed", url, attemptedAt: now, retryAfter: now + 15 * 60_000, error: "Cover could not be downloaded. Retry from the series details." }).catch(diagnosticError => warn("cover diagnostics", diagnosticError));
        publish({ type: "library-changed", seriesIds: [seriesId] });
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
  const url = chosenUrl ?? src?.coverUrl ?? src?.coverCandidates[0];
  if (!url) return { ok: false, error: "No cover has been detected for this series yet." };
  const attemptedAt = Date.now();
  try {
    await setCoverStatus(seriesId, { state: "pending", url, attemptedAt });
    if (chosenUrl) {
      const asset = await downloadCover(chosenUrl, src?.seriesUrl);
      await setCustomCover(seriesId, { ...asset, origin: "custom" });
    } else {
      await setDetectedCover(seriesId, await downloadCover(url, src?.seriesUrl));
    }
    await setCoverStatus(seriesId, { state: "ready", url, attemptedAt });
    publish({ type: "library-changed", seriesIds: [seriesId] });
    return { ok: true };
  } catch (err) {
    const error = "Cover could not be downloaded. The source may be unavailable.";
    await setCoverStatus(seriesId, { state: "failed", url, attemptedAt, error, retryAfter: attemptedAt + 15 * 60_000 }).catch(diagnosticError => warn("cover diagnostics", diagnosticError));
    publish({ type: "library-changed", seriesIds: [seriesId] });
    return { ok: false, error };
  }
}
