// Small, defensive DOM readers. Everything here treats the page as hostile input:
// only textContent and attributes are read, never HTML.

import { absoluteUrl } from "../normalization/url";

export function text(el: Element | null | undefined, max = 300): string {
  if (!el) return "";
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function qs<T extends Element = Element>(root: ParentNode, selector: string): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

export function qsa<T extends Element = Element>(root: ParentNode, selector: string, limit = 5000): T[] {
  try {
    const list = root.querySelectorAll<T>(selector);
    const out: T[] = [];
    for (let i = 0; i < list.length && i < limit; i++) {
      const el = list[i];
      if (el) out.push(el);
    }
    return out;
  } catch {
    return [];
  }
}

export function meta(doc: Document, key: string): string | undefined {
  const el =
    qs<HTMLMetaElement>(doc, `meta[property="${key}"]`) ?? qs<HTMLMetaElement>(doc, `meta[name="${key}"]`);
  const v = el?.getAttribute("content")?.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, 500) : undefined;
}

export function canonicalLink(doc: Document, base: string): string | undefined {
  return absoluteUrl(qs<HTMLLinkElement>(doc, 'link[rel="canonical"]')?.getAttribute("href"), base);
}

export function hrefOf(a: Element | null | undefined, base: string): string | undefined {
  return a ? absoluteUrl(a.getAttribute("href"), base) : undefined;
}

/** Image source, honouring common lazy-loading attributes. */
export function imgSrc(img: Element | null | undefined, base: string): string | undefined {
  if (!img) return undefined;
  for (const attr of ["data-src", "data-lazy-src", "data-original", "data-cfsrc", "data-url", "src"]) {
    const v = img.getAttribute(attr)?.trim();
    if (v && !v.startsWith("data:")) {
      const abs = absoluteUrl(v, base);
      if (abs) return abs;
    }
  }
  const srcset = img.getAttribute("data-srcset") ?? img.getAttribute("srcset");
  if (srcset) {
    const first = srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
    if (first) return absoluteUrl(first, base);
  }
  return undefined;
}

type JsonObject = Record<string, unknown>;

export function jsonLd(doc: Document): JsonObject[] {
  const out: JsonObject[] = [];
  for (const s of qsa(doc, 'script[type="application/ld+json"]', 20)) {
    const raw = s.textContent ?? "";
    if (raw.length > 200_000) continue;
    try {
      collect(JSON.parse(raw), out, 0);
    } catch {
      // Malformed structured data is common; ignore it.
    }
  }
  return out;
}

function collect(v: unknown, out: JsonObject[], depth: number): void {
  if (depth > 4 || out.length > 50) return;
  if (Array.isArray(v)) {
    for (const x of v) collect(x, out, depth + 1);
  } else if (v && typeof v === "object") {
    const o = v as JsonObject;
    out.push(o);
    if (Array.isArray(o["@graph"])) collect(o["@graph"], out, depth + 1);
  }
}

export function ldTypes(o: JsonObject): string[] {
  const t = o["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

export function ldString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (Array.isArray(v)) return ldString(v[0]);
  if (v && typeof v === "object") {
    const o = v as JsonObject;
    return ldString(o.url ?? o.contentUrl ?? o.name ?? o["@id"]);
  }
  return undefined;
}

export interface Crumb {
  text: string;
  href?: string;
}

export function breadcrumbs(doc: Document, base: string): Crumb[] {
  const containers = qsa(
    doc,
    'nav[aria-label*="readcrumb" i], .breadcrumb, .breadcrumbs, ol.breadcrumb, [itemtype*="BreadcrumbList"], #breadcrumbs',
    5,
  );
  for (const c of containers) {
    const items = qsa(c, "li", 20);
    const crumbs = (items.length >= 2 ? items : qsa(c, "a, span, [aria-current]", 20).filter((el) => !el.querySelector("a")))
      .map((el) => {
        const a = el.tagName === "A" ? el : el.querySelector("a");
        return { text: text(el, 200), href: a ? hrefOf(a, base) : undefined };
      })
      .filter((c) => c.text && !/^[/>»›|\s]+$/.test(c.text));
    if (crumbs.length >= 2) return dedupeCrumbs(crumbs);
  }
  for (const o of jsonLd(doc)) {
    if (!ldTypes(o).includes("BreadcrumbList") || !Array.isArray(o.itemListElement)) continue;
    const crumbs: Crumb[] = [];
    for (const it of o.itemListElement as JsonObject[]) {
      const item = it.item as JsonObject | string | undefined;
      const name = ldString(it.name) ?? (typeof item === "object" ? ldString(item?.name) : undefined);
      const href = typeof item === "string" ? item : ldString(item?.["@id"] ?? item?.url);
      if (name) crumbs.push({ text: name.slice(0, 200), href: href ? absoluteUrl(href, base) : undefined });
    }
    if (crumbs.length >= 2) return crumbs;
  }
  return [];
}

function dedupeCrumbs(crumbs: Crumb[]): Crumb[] {
  const out: Crumb[] = [];
  for (const c of crumbs) {
    const prev = out[out.length - 1];
    if (prev && prev.text === c.text) {
      prev.href ??= c.href;
      continue;
    }
    out.push(c);
  }
  return out;
}

/** Returns the value next to a label such as "Alternative:" or "Status". */
export function labelledValue(doc: Document, labels: RegExp): string | undefined {
  const candidates = qsa(doc, "dt, th, b, strong, h5, .summary-heading, .imptdt, .infotable td, span, label, div", 1500);
  for (const el of candidates) {
    const t = text(el, 60);
    if (!t || t.length > 40 || !labels.test(t)) continue;
    const inline = t.replace(labels, "").replace(/^[\s:：-]+/, "").trim();
    if (inline.length > 1) return inline;
    const sib = el.nextElementSibling ?? el.parentElement?.nextElementSibling;
    const v = text(sib, 400);
    if (v) return v;
    const parentText = text(el.parentElement, 400).replace(t, "").replace(/^[\s:：-]+/, "").trim();
    if (parentText) return parentText;
  }
  return undefined;
}

/** A short, reasonably stable CSS path for an element, used for diagnostics and re-lookup. */
export function cssPath(el: Element | null): string | undefined {
  if (!el) return undefined;
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 4; depth++) {
    if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    const cls = Array.from(cur.classList)
      .filter((c) => /^[A-Za-z][\w-]*$/.test(c) && c.length < 40)
      .slice(0, 2);
    parts.unshift(cur.tagName.toLowerCase() + cls.map((c) => `.${c}`).join(""));
    if (cls.length && depth >= 1) break;
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}
