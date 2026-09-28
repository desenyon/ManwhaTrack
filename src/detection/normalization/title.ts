// Title cleanup and normalization. Normalized titles are for candidate matching only;
// they never replace what the user sees.

const PRESENTATION_SUFFIX = /\s*[([]\s*(?:manhwa|manhua|manga|webtoon|comic|official|uncensored|raw|english|eng|colored|colou?r)\s*[)\]]\s*$/i;

export function normalizeTitle(raw: string): string {
  let s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(PRESENTATION_SUFFIX, "");
  }
  return s
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SITE_NOISE = [
  /\bread\s+(?:free\s+)?(?:manhwa|manhua|manga|webtoons?|comics?)\s+online\b.*$/i,
  /\b(?:manhwa|manhua|manga|webtoon)\s+online(?:\s+(?:for\s+)?free)?\b.*$/i,
  /\bread\s+online(?:\s+(?:for\s+)?free)?\b.*$/i,
  /\bin\s+english\b.*$/i,
  /\bfree\s+online\b.*$/i,
  /^\s*read\s+/i,
  /\s*[-–—|:]\s*(?:manhwa|manhua|manga|webtoon)\s*$/i,
];

const SPECIAL_TAIL = /\s*[-–—|:,]\s*\b(?:side\s*story|prologue|epilogue|special|extra|bonus)\b(?:\s*\d+)?\s*$/i;
const SPECIAL_HEAD = /^\s*\b(?:side\s*story|prologue|epilogue|special|extra|bonus)\b(?:\s*\d+)?\s*[-–—|:,]\s*/i;
const CHAPTER_TAIL = /\s*[-–—|:,]?\s*\b(?:chapters?|chap|ch|episodes?|ep)\.?\s*[#:\-_]?\s*\d+(?:\.\d+)?\b.*$/i;
const CHAPTER_HEAD = /^\s*\b(?:chapters?|chap|ch|episodes?|ep)\.?\s*[#:\-_]?\s*\d+(?:\.\d+)?\s*[-–—|:,]\s*/i;

/**
 * Turns raw page text (document.title, og:title, headings) into a plausible series title.
 * Strips site names, chapter markers and SEO noise. Returns "" when nothing useful remains.
 */
export function cleanSeriesTitle(raw: string, siteName?: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = stripSiteName(s, siteName);
  s = s.replace(CHAPTER_HEAD, "");
  s = s.replace(CHAPTER_TAIL, "").replace(SPECIAL_TAIL, "").replace(SPECIAL_HEAD, "");
  for (const re of SITE_NOISE) s = s.replace(re, "");
  s = s.replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, "").trim();
  if (/^(?:home|chapter|manga|manhwa|webtoon|read|index|page \d+)$/i.test(s)) return "";
  return s.slice(0, 200);
}

function stripSiteName(s: string, siteName?: string): string {
  if (siteName) {
    const esc = siteName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (esc) s = s.replace(new RegExp(String.raw`\s*[-–—|:•»]\s*${esc}\s*$`, "i"), "").replace(new RegExp(String.raw`^${esc}\s*[-–—|:•»]\s*`, "i"), "");
  }
  // "Title - Chapter 5 - SiteName": drop a trailing segment that looks like a domain or brand.
  const parts = s.split(/\s+[|–—•»]\s+|\s+-\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1] ?? "";
    if (/\.(?:com|net|org|io|gg|me|co|to|xyz|site|online|info|club|cc|tv|app)$/i.test(last) || /\b(?:scans?|comics?|toons?|manga|manhwa|webtoons?)$/i.test(last)) {
      parts.pop();
      s = parts.join(" - ");
    }
  }
  return s;
}

/** Plausibility filter used before trusting a candidate title. */
export function isPlausibleTitle(s: string): boolean {
  if (s.length < 2 || s.length > 200) return false;
  if (!/\p{L}|\p{N}/u.test(s)) return false;
  if (/^(?:404|not found|error|page not found|just a moment|attention required|access denied)/i.test(s)) return false;
  return true;
}

/** Levenshtein distance with an early exit once `max` is exceeded. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** Similarity in [0,1] between two normalized titles, for duplicate suggestions. */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = Math.max(a.length, b.length);
  const d = editDistance(a, b, Math.ceil(longer * 0.4));
  const lev = 1 - d / longer;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  return Math.max(lev, jaccard);
}
