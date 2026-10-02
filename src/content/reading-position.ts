import type { ReadingPosition } from "../shared/types/models";

/** Viewport top inside the actual reader, with an image-relative anchor when available. */
export function captureReadingPosition(container: HTMLElement | null, revision: number, now = Date.now()): ReadingPosition | undefined {
  const rect = container?.isConnected ? container.getBoundingClientRect() : null;
  const height = rect?.height ?? document.documentElement.scrollHeight;
  if (!height || height > 10_000_000 || (rect && (rect.bottom <= 0 || rect.top >= innerHeight))) return;
  const offset = Math.max(0, Math.min(height, rect ? -rect.top : scrollY));
  const result: ReadingPosition = { version: 1, capturedAt: now, progressRevision: revision, readerOffset: offset, readerHeight: height, viewportHeight: innerHeight };
  if (container) {
    const images = [...container.querySelectorAll("img")];
    const index = images.findIndex(image => { const r = image.getBoundingClientRect(); return r.height > 0 && r.top <= 0 && r.bottom > 0; });
    if (index >= 0) {
      const r = images[index]!.getBoundingClientRect();
      result.imageIndex = index;
      result.imageOffset = Math.max(0, Math.min(1, -r.top / r.height));
    }
  }
  return result;
}

/** Restore only after a local explicit Resume request. No location is placed in a URL. */
export function restoreReadingPosition(
  position: ReadingPosition,
  getContainer: () => HTMLElement | null,
  stillCurrent: () => boolean,
): { done: Promise<{ userInput: boolean }>; cancel: () => void } {
  const started = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let finished = false;
  let lastTarget = -1;
  let stable = 0;
  let resolve!: (result: { userInput: boolean }) => void;
  const done = new Promise<{ userInput: boolean }>(r => { resolve = r; });
  const inputs = ["wheel", "touchstart", "pointerdown", "keydown"];
  const finish = (userInput: boolean) => {
    if (finished) return;
    finished = true;
    if (timer) clearInterval(timer);
    for (const type of inputs) removeEventListener(type, onInput, true);
    removeEventListener("pagehide", cancel);
    resolve({ userInput });
  };
  const cancel = () => finish(false);
  const onInput = () => finish(true);
  const step = () => {
    if (!stillCurrent() || Date.now() - started >= 12_000) { cancel(); return; }
    const reader = getContainer();
    const rect = reader?.isConnected ? reader.getBoundingClientRect() : null;
    const height = rect?.height ?? document.documentElement.scrollHeight;
    // Wait for late SPA reader markup rather than restoring into a temporary shell.
    if (height < innerHeight * 1.5 && position.readerHeight >= position.viewportHeight * 1.5) return;
    const readerTop = rect ? rect.top + scrollY : 0;
    let target = readerTop + position.readerOffset / position.readerHeight * height;
    const images = reader ? [...reader.querySelectorAll("img")] : [];
    const image = position.imageIndex !== undefined ? images[position.imageIndex] : undefined;
    if (image && position.imageOffset !== undefined) {
      const r = image.getBoundingClientRect();
      if (!r.height) return;
      target = r.top + scrollY + r.height * position.imageOffset;
    } else if (position.imageIndex !== undefined && !image) return;
    target = Math.max(0, Math.min(target, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
    if (Math.abs(target - lastTarget) > 1) {
      lastTarget = target;
      stable = 0;
      window.scrollTo({ top: target, behavior: "instant" });
    } else stable++;
    // Keep correcting while image dimensions settle. Timeout bounds broken/lazy images.
    if (Date.now() - started >= 1500 && stable >= 5 && images.every(img => img.complete)) cancel();
  };
  for (const type of inputs) addEventListener(type, onInput, { capture: true, passive: true });
  addEventListener("pagehide", cancel);
  timer = setInterval(step, 150);
  step();
  return { done, cancel };
}
