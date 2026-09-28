// Ranks likely cover/poster images. Order of trust: adapter → structured data → og:image →
// image adjacent to the title → strongest portrait-shaped image.

import { imgSrc, jsonLd, ldString, ldTypes, meta, qs, qsa } from "../metadata/dom";

const DECORATIVE = /(?:logo|avatar|icon|emoji|sprite|badge|flag|gravatar|spinner|placeholder|loading|banner|ads?[/_-])/i;

function usable(src: string | undefined): src is string {
  return !!src && !DECORATIVE.test(src) && !/\.svg(?:\?|$)/i.test(src);
}

function portraitScore(img: HTMLImageElement): number {
  const rect = img.getBoundingClientRect?.();
  let w = rect && rect.width > 0 ? rect.width : Number(img.getAttribute("width")) || img.naturalWidth || 0;
  let h = rect && rect.height > 0 ? rect.height : Number(img.getAttribute("height")) || img.naturalHeight || 0;
  if (!w || !h) {
    w = 0;
    h = 0;
  }
  if (w < 100 || h < 130) return 0;
  const ratio = h / w;
  if (ratio < 1.15 || ratio > 1.9) return 0;
  return w * h;
}

export function coverCandidates(doc: Document, base: string, titleEl?: Element | null, adapterFirst: string[] = []): string[] {
  const out: string[] = [];
  const push = (s: string | undefined) => {
    if (usable(s) && !out.includes(s)) out.push(s);
  };

  adapterFirst.forEach(push);

  for (const o of jsonLd(doc)) {
    const types = ldTypes(o);
    if (types.some((t) => /Book|Comic|CreativeWork|Series|Manga|Product/i.test(t))) push(absolute(ldString(o.image), base));
  }

  push(absolute(meta(doc, "og:image"), base));
  push(absolute(meta(doc, "twitter:image"), base));

  for (const sel of ['img[itemprop="image"]', ".summary_image img", ".thumb img", ".cover img", '[class*="cover"] img', '[class*="poster"] img']) {
    push(imgSrc(qs(doc, sel), base));
  }

  if (titleEl) {
    let cur: Element | null = titleEl.parentElement;
    for (let i = 0; cur && i < 4; i++) {
      const img = qs<HTMLImageElement>(cur, "img");
      if (img) {
        push(imgSrc(img, base));
        break;
      }
      cur = cur.parentElement;
    }
  }

  const portraits = qsa<HTMLImageElement>(doc, "main img, article img, #content img, .content img, body img", 300)
    .map((img) => ({ img, s: portraitScore(img) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  for (const p of portraits) push(imgSrc(p.img, base));

  return out.slice(0, 6);
}

function absolute(v: string | undefined, base: string): string | undefined {
  if (!v) return undefined;
  try {
    const u = new URL(v, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
