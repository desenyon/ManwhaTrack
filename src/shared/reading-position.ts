import type { ReadingPosition } from "./types/models";

/** A hostile page or backup cannot inject selectors, scripts or unbounded coordinates. */
export function sanitizeReadingPosition(raw: unknown): ReadingPosition | undefined {
  if (!raw || typeof raw !== "object") return;
  const p = raw as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (p.version !== 1 || !finite(p.capturedAt) || p.capturedAt < 0 ||
    !finite(p.progressRevision) || !Number.isInteger(p.progressRevision) || p.progressRevision < 0 ||
    !finite(p.readerHeight) || p.readerHeight <= 0 || p.readerHeight > 10_000_000 ||
    !finite(p.viewportHeight) || p.viewportHeight <= 0 || p.viewportHeight > 100_000 ||
    !finite(p.readerOffset) || p.readerOffset < 0 || p.readerOffset > p.readerHeight) return;
  if (p.imageIndex !== undefined && (!finite(p.imageIndex) || !Number.isInteger(p.imageIndex) || p.imageIndex < 0 || p.imageIndex > 100_000)) return;
  if (p.imageOffset !== undefined && (!finite(p.imageOffset) || p.imageOffset < 0 || p.imageOffset > 1 || p.imageIndex === undefined)) return;
  return {
    version: 1, capturedAt: p.capturedAt, progressRevision: p.progressRevision,
    readerOffset: p.readerOffset, readerHeight: p.readerHeight, viewportHeight: p.viewportHeight,
    ...(p.imageIndex !== undefined ? { imageIndex: p.imageIndex as number } : {}),
    ...(p.imageOffset !== undefined ? { imageOffset: p.imageOffset as number } : {}),
  };
}
