// Locates the element that holds chapter pages (usually a stack of tall images).

import { qs, qsa } from "../metadata/dom";

const KNOWN_READER_SELECTORS = [
  "#readerarea",
  ".reading-content",
  "#_imageList",
  ".viewer_img",
  ".container-chapter-reader",
  ".chapter-content",
  ".chapter-images",
  ".reader-area",
  "#chapter-reader",
  "#chapter_images",
  ".read-container",
  ".reader-main",
  "[data-reader]",
];

const NOISE_ANCESTOR = /(?:^|[\s_-])(?:header|footer|nav|sidebar|comment|comments|related|recommend|widget|ads?|banner|popular|menu)(?:$|[\s_-])/i;

function sizeHint(img: HTMLImageElement): number {
  const rect = img.getBoundingClientRect?.();
  if (rect && rect.width > 0) return rect.width;
  const attr = Number(img.getAttribute("width"));
  if (attr > 0) return attr;
  if (img.naturalWidth > 0) return img.naturalWidth;
  return -1;
}

function looksDecorative(img: HTMLImageElement): boolean {
  const src = (img.getAttribute("src") ?? "") + (img.getAttribute("data-src") ?? "");
  if (/(?:logo|avatar|icon|emoji|sprite|badge|flag|gravatar|spinner|loading\.gif)/i.test(src)) return true;
  const w = sizeHint(img);
  return w >= 0 && w < 250;
}

function inNoise(el: Element): boolean {
  let cur: Element | null = el.parentElement;
  for (let i = 0; cur && i < 8; i++) {
    const tag = cur.tagName;
    if (tag === "HEADER" || tag === "FOOTER" || tag === "NAV" || tag === "ASIDE") return true;
    const idc = `${cur.id} ${typeof cur.className === "string" ? cur.className : ""}`;
    if (NOISE_ANCESTOR.test(idc)) return true;
    cur = cur.parentElement;
  }
  return false;
}

export interface ReaderGuess {
  element: HTMLElement;
  imageCount: number;
  via: "known-selector" | "image-cluster";
}

export function findReaderContainer(doc: Document): ReaderGuess | null {
  for (const sel of KNOWN_READER_SELECTORS) {
    const el = qs<HTMLElement>(doc, sel);
    if (!el) continue;
    const imgs = qsa(el, "img, canvas", 2000).length;
    if (imgs >= 2) return { element: el, imageCount: imgs, via: "known-selector" };
  }

  const imgs = qsa<HTMLImageElement>(doc.body ?? doc, "img", 1500).filter((i) => !looksDecorative(i) && !inNoise(i));
  if (imgs.length < 3) return null;

  const counts = new Map<HTMLElement, number>();
  for (const img of imgs) {
    let cur = img.parentElement;
    for (let depth = 0; cur && depth < 4 && cur !== doc.body; depth++) {
      counts.set(cur, (counts.get(cur) ?? 0) + 1);
      cur = cur.parentElement;
    }
  }
  let best: HTMLElement | null = null;
  let bestCount = 0;
  for (const [el, n] of counts) {
    // Prefer the deepest element that still holds most of the page images.
    if (n > bestCount || (n === bestCount && best && best.contains(el))) {
      best = el;
      bestCount = n;
    }
  }
  if (!best || bestCount < 3 || bestCount < imgs.length * 0.6) return null;
  // Images must look like a vertical stack of pages rather than a grid of covers with links.
  const linked = qsa(best, "a img", 200).length;
  if (linked > bestCount * 0.5) return null;
  return { element: best, imageCount: bestCount, via: "image-cluster" };
}

/** Reading progress through a container: 0 at its top edge, 1 once its bottom reaches the viewport bottom. */
export function containerProgress(el: HTMLElement, viewportHeight: number): number {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  const seen = viewportHeight - rect.top;
  return Math.max(0, Math.min(1, seen / rect.height));
}
