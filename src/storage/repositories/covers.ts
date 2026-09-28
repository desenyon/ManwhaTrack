// Locally cached cover images. Remote cover URLs are kept only as source metadata.

import type { CoverAsset, Series } from "../../shared/types/models";
import { read, req, write, type Tx } from "../db";
import { newId } from "../schema";
import { getSeriesTx, putSeriesTx } from "./series";

export async function getCover(id: string): Promise<CoverAsset | undefined> {
  return read(["covers"], (t) => t.get<CoverAsset>("covers", id));
}

export async function getCovers(ids: string[]): Promise<Map<string, CoverAsset>> {
  return read(["covers"], async (t) => {
    const out = new Map<string, CoverAsset>();
    const found = await Promise.all(ids.map((id) => t.get<CoverAsset>("covers", id)));
    for (const c of found) if (c) out.set(c.id, c);
    return out;
  });
}

async function referencedCoverIds(t: Tx): Promise<Set<string>> {
  const refs = new Set<string>();
  for (const s of await t.getAll<Series>("series")) {
    if (s.coverId) refs.add(s.coverId);
    if (s.detectedCoverId) refs.add(s.detectedCoverId);
  }
  return refs;
}

async function deleteIfUnreferenced(t: Tx, id: string | undefined): Promise<void> {
  if (!id) return;
  const refs = await referencedCoverIds(t);
  if (!refs.has(id)) await t.delete("covers", id);
}

export type NewCover = Omit<CoverAsset, "id" | "capturedAt">;

/** Stores a newly detected cover. Replaces the displayed cover only if the user hasn't chosen one. */
export async function setDetectedCover(seriesId: string, asset: NewCover): Promise<string | undefined> {
  return write(["series", "covers"], async (t) => {
    const s = await getSeriesTx(t, seriesId);
    if (!s) return undefined;
    const id = newId();
    await t.put("covers", { ...asset, id, origin: "detected", capturedAt: Date.now() } satisfies CoverAsset);
    const old = s.detectedCoverId;
    s.detectedCoverId = id;
    if (!s.userFields.includes("cover") || !s.coverId) s.coverId = id;
    s.updatedAt = Date.now();
    await putSeriesTx(t, s);
    await deleteIfUnreferenced(t, old);
    return id;
  });
}

/** Sets a user-chosen cover (uploaded file or a chosen detected candidate). */
export async function setCustomCover(seriesId: string, asset: NewCover): Promise<void> {
  await write(["series", "covers"], async (t) => {
    const s = await getSeriesTx(t, seriesId);
    if (!s) return;
    const id = newId();
    await t.put("covers", { ...asset, id, origin: "custom", capturedAt: Date.now() } satisfies CoverAsset);
    const old = s.coverId;
    s.coverId = id;
    if (!s.userFields.includes("cover")) s.userFields.push("cover");
    s.updatedAt = Date.now();
    await putSeriesTx(t, s);
    await deleteIfUnreferenced(t, old);
  });
}

export async function removeCustomCover(seriesId: string): Promise<void> {
  await write(["series", "covers"], async (t) => {
    const s = await getSeriesTx(t, seriesId);
    if (!s) return;
    const old = s.coverId;
    s.coverId = s.detectedCoverId;
    s.userFields = s.userFields.filter((f) => f !== "cover");
    await putSeriesTx(t, s);
    if (old !== s.detectedCoverId) await deleteIfUnreferenced(t, old);
  });
}

/** Deletes cover blobs that no series references. Returns the number deleted. */
export async function clearUnusedCovers(): Promise<number> {
  return write(["series", "covers"], async (t) => {
    const refs = await referencedCoverIds(t);
    let n = 0;
    for (const k of await req(t.store("covers").getAllKeys())) {
      if (!refs.has(String(k))) {
        await t.delete("covers", k);
        n++;
      }
    }
    return n;
  });
}

/** Clears detected (re-downloadable) covers. Custom uploads are kept. Series are never deleted. */
export async function clearDetectedCovers(): Promise<number> {
  return write(["series", "covers"], async (t) => {
    const covers = await t.getAll<CoverAsset>("covers");
    const detected = new Set(covers.filter((c) => c.origin !== "custom").map((c) => c.id));
    for (const s of await t.getAll<Series>("series")) {
      let changed = false;
      if (s.detectedCoverId && detected.has(s.detectedCoverId)) {
        s.detectedCoverId = undefined;
        changed = true;
      }
      if (s.coverId && detected.has(s.coverId)) {
        s.coverId = undefined;
        changed = true;
      }
      if (changed) await t.put("series", s);
    }
    for (const id of detected) await t.delete("covers", id);
    return detected.size;
  });
}

export interface CoverUsage {
  count: number;
  bytes: number;
}

export async function coverUsage(): Promise<CoverUsage> {
  const covers = await read(["covers"], (t) => t.getAll<CoverAsset>("covers"));
  return { count: covers.length, bytes: covers.reduce((a, c) => a + (c.blob?.size ?? 0), 0) };
}
