// Instant local search with basic typo tolerance. No remote search service.

import type { Series, SeriesSource } from "../types/models";
import { editDistance, normalizeTitle } from "../../detection/normalization/title";

interface Field {
  words: string[];
  text: string;
  weight: number;
}

export interface SearchEntry {
  id: string;
  fields: Field[];
}

function field(values: (string | undefined)[], weight: number): Field {
  const text = normalizeTitle(values.filter(Boolean).join(" "));
  return { text, words: text.split(" ").filter(Boolean), weight };
}

export function buildSearchEntry(s: Series, sources: SeriesSource[] = []): SearchEntry {
  return {
    id: s.id,
    fields: [
      field([s.title, ...s.alternateTitles], 1),
      field(sources.map((x) => x.sourceTitle), 0.9),
      field([...s.tags, ...(s.genres ?? []), s.format === "novel" ? "novel" : "manhwa"], 0.8),
      field(sources.map((x) => x.hostname.replace(/\./g, " ")), 0.6),
      field([s.notes], 0.4),
    ],
  };
}

function tokenScore(token: string, f: Field): number {
  let best = 0;
  for (const w of f.words) {
    if (w === token) return 3;
    if (w.startsWith(token)) best = Math.max(best, 2.5);
    else if (w.includes(token) && token.length >= 3) best = Math.max(best, 2);
    else if (token.length >= 4) {
      const max = token.length >= 7 ? 2 : 1;
      const d = editDistance(token, w.slice(0, token.length + max), max);
      if (d <= max) best = Math.max(best, 1.5 - d * 0.25);
    }
  }
  return best;
}

export function scoreEntry(entry: SearchEntry, query: string): number {
  const q = normalizeTitle(query);
  if (!q) return 0;
  const tokens = q.split(" ");
  let total = 0;
  for (const t of tokens) {
    let best = 0;
    for (const f of entry.fields) best = Math.max(best, tokenScore(t, f) * f.weight);
    if (best === 0) return 0;
    total += best;
  }
  if (entry.fields[0]?.text.includes(q)) total += 2;
  if (entry.fields[0]?.text.startsWith(q)) total += 1;
  return total;
}

export function search(entries: SearchEntry[], query: string, limit = Infinity): { id: string; score: number }[] {
  const out: { id: string; score: number }[] = [];
  for (const e of entries) {
    const score = scoreEntry(e, query);
    if (score > 0) out.push({ id: e.id, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
