// Chapter label parsing and ordering. The original label is always preserved;
// numbers are only used for ordering and progress comparison.

export type ChapterKind = "numbered" | "prologue" | "epilogue" | "special" | "side";

export interface ParsedChapter {
  label: string;
  kind: ChapterKind;
  number?: number;
  part?: number;
  volume?: number;
  season?: number;
  /** Position within the main sequence; undefined for side stories, specials and epilogues. */
  ordinal?: number;
  key: string;
}

const CHAPTER_WORD = String.raw`(?:chapters?|chap|ch|episodes?|ep|epi|eps|第)`;
const NUM = String.raw`(\d{1,5}(?:[.,]\d{1,3})?)`;

const RE_CHAPTER = new RegExp(String.raw`(?:^|[^a-z])${CHAPTER_WORD}\s*\.?\s*[#:\-_]?\s*${NUM}`, "i");
const RE_HASH = new RegExp(String.raw`(?:^|\s)#\s*${NUM}(?!\d)`);
const RE_BARE = new RegExp(String.raw`^\s*${NUM}\s*(?:[:\-–—|].*)?$`);
const RE_SEASON = /\b(?:season\s*\.?\s*(\d{1,2})\b|s(\d{1,2})(?=\s*(?:ep|ch|e\d|[-:.\s]|$)))/i;
const RE_VOLUME = /\b(?:volume|vol)\s*\.?\s*(\d{1,3})\b/i;
const RE_PART = /\b(?:part|pt)\s*\.?\s*(\d{1,2})\b/i;
const RE_SIDE = /\b(?:side\s*story|side|extra|bonus|omake|gaiden)\b/i;
const RE_SPECIAL = /\b(?:special|announcement|notice|hiatus|q\s*&\s*a|illustration|afterword)\b/i;
const RE_PROLOGUE = /\b(?:prologue|prolog|pilot)\b/i;
const RE_EPILOGUE = /\b(?:epilogue|epilog|finale)\b/i;
const RE_ANY_NUM = /(\d{1,5}(?:\.\d{1,3})?)/;

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

/** Clean display label: collapses whitespace and trims noise, but keeps the author's wording. */
export function cleanChapterLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, "").slice(0, 160);
}

export function parseChapterLabel(raw: string): ParsedChapter {
  const label = cleanChapterLabel(raw);
  const season = matchInt(label, RE_SEASON);
  const volume = matchInt(label, RE_VOLUME);
  const part = matchInt(label, RE_PART);

  let number: number | undefined;
  const m = RE_CHAPTER.exec(label) ?? RE_HASH.exec(label) ?? RE_BARE.exec(label);
  if (m?.[1]) number = toNumber(m[1]);

  let kind: ChapterKind = "numbered";
  if (RE_SIDE.test(label)) kind = "side";
  else if (RE_SPECIAL.test(label) && number === undefined) kind = "special";
  else if (RE_PROLOGUE.test(label)) kind = "prologue";
  else if (RE_EPILOGUE.test(label)) kind = "epilogue";
  else if (number === undefined) kind = "special";

  if (kind === "side" && number === undefined) {
    const n = RE_ANY_NUM.exec(label.replace(RE_SEASON, "").replace(RE_VOLUME, ""));
    if (n?.[1]) number = toNumber(n[1]);
  }

  let ordinal: number | undefined;
  if (kind === "numbered" && number !== undefined) {
    ordinal = (season ?? 0) * 100000 + number + (part ? part / 1000 : 0);
  } else if (kind === "prologue") {
    ordinal = (season ?? 0) * 100000 - 0.5;
  }

  return { label, kind, number, part, volume, season, ordinal, key: chapterKeyOf(kind, label, number, season, part) };
}

function matchInt(s: string, re: RegExp): number | undefined {
  const m = re.exec(s);
  const g = m?.slice(1).find((x) => x !== undefined);
  return g ? Number(g) : undefined;
}

function chapterKeyOf(kind: ChapterKind, label: string, number?: number, season?: number, part?: number): string {
  const s = season ? `s${season}:` : "";
  const p = part ? `:p${part}` : "";
  if (number !== undefined && (kind === "numbered" || kind === "side")) {
    return `${kind === "side" ? "side:" : ""}${s}${number}${p}`;
  }
  if (kind === "prologue") return `${s}prologue`;
  return `${kind}:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/**
 * Extracts a chapter token from a URL path or query, e.g. /chapter-12-5/ → "Chapter 12.5".
 * Returns undefined when the URL has no chapter-like token.
 */
export function chapterLabelFromUrl(url: URL): string | undefined {
  // An explicit number in the query wins: on webtoons.com "/episode-2/viewer?episode_no=3"
  // the path slug is the episode's display title, the query is its identity.
  for (const key of ["episode_no", "chapter", "ch", "episode", "ep", "chapter_no"]) {
    const v = url.searchParams.get(key);
    if (v && /^\d{1,5}(?:\.\d{1,3})?$/.test(v)) return `Chapter ${Number(v)}`;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    path = url.pathname.toLowerCase();
  }
  const m =
    /(?:^|[/\-_])(?:chapter|chap|ch|episode|ep)[-_/.]?(\d{1,5})(?:[-_.](\d{1,2}))?(?=[/\-_.]|$)/.exec(path);
  if (m?.[1]) {
    const hasDecimal = m[2] !== undefined && isDecimalSuffix(path, m.index + m[0].length);
    const n = hasDecimal ? `${Number(m[1])}.${m[2]}` : `${Number(m[1])}`;
    return `Chapter ${n}`;
  }
  return undefined;
}

/** "chapter-12-5/" is 12.5, but "chapter-12-5-the-return" is chapter 12 with a slug. */
function isDecimalSuffix(path: string, end: number): boolean {
  const rest = path.slice(end);
  return rest === "" || rest.startsWith("/") || rest.startsWith(".");
}

export function urlLooksLikeChapter(url: URL): boolean {
  return chapterLabelFromUrl(url) !== undefined;
}

export interface Orderable {
  ordinal?: number;
  chapterLabel?: string;
  label?: string;
  discoveredAt?: number;
}

/**
 * Comparator for chapters: main sequence numerically, then epilogues, specials and side
 * stories in discovery order. Never lexical.
 */
export function compareChapters(a: Orderable, b: Orderable): number {
  const ao = a.ordinal;
  const bo = b.ordinal;
  if (ao !== undefined && bo !== undefined) return ao - bo || tieBreak(a, b);
  if (ao !== undefined) return -1;
  if (bo !== undefined) return 1;
  const ra = rankUnordered(a.chapterLabel ?? a.label ?? "");
  const rb = rankUnordered(b.chapterLabel ?? b.label ?? "");
  if (ra !== rb) return ra - rb;
  return tieBreak(a, b);
}

function rankUnordered(label: string): number {
  if (RE_EPILOGUE.test(label)) return 0;
  if (RE_SIDE.test(label)) {
    const n = RE_ANY_NUM.exec(label);
    return 1 + (n?.[1] ? Number(n[1]) / 100000 : 0);
  }
  return 2;
}

function tieBreak(a: Orderable, b: Orderable): number {
  const d = (a.discoveredAt ?? 0) - (b.discoveredAt ?? 0);
  if (d !== 0) return d;
  const la = a.chapterLabel ?? a.label ?? "";
  const lb = b.chapterLabel ?? b.label ?? "";
  return la < lb ? -1 : la > lb ? 1 : 0;
}

/** Short display form: "Ch. 12.5" when numbered, otherwise the label itself. */
export function shortChapterLabel(label: string | undefined, ordinal?: number): string {
  if (!label) return "";
  const p = parseChapterLabel(label);
  if (p.kind === "numbered" && p.number !== undefined) {
    const s = p.season ? `S${p.season} ` : "";
    const part = p.part ? ` pt ${p.part}` : "";
    return `${s}Ch. ${p.number}${part}`;
  }
  if (ordinal !== undefined && p.kind === "prologue") return "Prologue";
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}

/** Correct only a joined numeric prefix whose explicit chapter URL proves the identity. */
export function correctJoinedChapterLabel(label: string, href: string): string | undefined {
  let url: URL;
  try { url = new URL(href); } catch { return; }
  const identity = chapterLabelFromUrl(url);
  const expected = identity && parseChapterLabel(identity).number;
  const digits = /^Chapter\s+(\d+)(?=[.:]\s*\D)/i.exec(label)?.[1];
  if (expected === undefined || !digits || digits === String(expected) || !digits.startsWith(String(expected))) return;
  return identity;
}
