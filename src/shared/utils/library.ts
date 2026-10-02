// Library views, composable filters and sorting. Pure functions over loaded records.

import type { Series, SeriesSource, SeriesStatus } from "../types/models";
import type { SortKey } from "../types/settings";

export type ViewId =
  | "continue"
  | "recent"
  | "new"
  | "reading"
  | "planning"
  | "on-hold"
  | "completed"
  | "dropped"
  | "favorites"
  | "pinned"
  | "queue"
  | "all"
  | `collection:${string}`;

export const PRIMARY_VIEWS: { id: ViewId; label: string }[] = [
  { id: "continue", label: "Continue" },
  { id: "new", label: "New" },

];

export const MORE_VIEWS: { id: ViewId; label: string }[] = [
  { id: "all", label: "All series" },
  { id: "reading", label: "Reading" },
  { id: "favorites", label: "Favorites" },
  { id: "recent", label: "Recently read" },
  { id: "planning", label: "Plan to read" },
  { id: "on-hold", label: "On hold" },
  { id: "completed", label: "Completed" },
  { id: "dropped", label: "Dropped" },
  { id: "pinned", label: "Pinned" },
  { id: "queue", label: "Queue" },
];

export const STATUS_LABEL: Record<SeriesStatus, string> = {
  reading: "Reading",
  planning: "Plan to read",
  "on-hold": "On hold",
  completed: "Completed",
  dropped: "Dropped",
};

export const SORT_LABEL: Record<SortKey, string> = {
  "recent-read": "Recently read",
  "recent-added": "Recently added",
  "title-asc": "Title A–Z",
  "title-desc": "Title Z–A",
  progress: "Chapter progress",
  "update-newest": "Newest update",
  "update-oldest": "Oldest update",
  source: "Source",
  rating: "Rating",
};

export const DEFAULT_SORT: Partial<Record<ViewId, SortKey>> = {
  continue: "recent-read",
  recent: "recent-read",
  new: "update-newest",
  all: "title-asc",
  planning: "recent-added",
};

const DAY = 86_400_000;

export function inView(s: Series, view: ViewId, now = Date.now(), queue: string[] = []): boolean {
  if (s.removedAt) return false;
  if (s.hidden && view !== "all") return false;
  switch (view) {
    case "continue":
      return (
        (s.status === "reading" || s.status === "on-hold") &&
        !s.summary.caughtUp &&
        (s.summary.continueKind === "resume" || s.summary.continueKind === "next" || (s.summary.continueKind === "last" && !s.summary.caughtUp))
      );
    case "recent":
      return !!s.lastReadAt && now - s.lastReadAt < 30 * DAY;
    case "new":
      return s.summary.newCount > 0 && s.status === "reading" && !!s.lastReadAt;
    case "reading":
    case "planning":
    case "on-hold":
    case "completed":
    case "dropped":
      return s.status === view;
    case "favorites":
      return s.favorite;
    case "pinned":
      return s.pinned;
    case "queue":
      return queue.includes(s.id);
    case "all":
      return true;
    default:
      return false;
  }
}

export interface Filters {
  hosts: string[];
  tags: string[];
  statuses: SeriesStatus[];
  favorite: boolean;
  pinned: boolean;
  hasUpdates: boolean;
  unread: boolean;
  readRecently: boolean;
  inactive: boolean;
  caughtUp: boolean;
}

export const NO_FILTERS: Filters = {
  hosts: [],
  tags: [],
  statuses: [],
  favorite: false,
  pinned: false,
  hasUpdates: false,
  unread: false,
  readRecently: false,
  inactive: false,
  caughtUp: false,
};

export function activeFilterCount(f: Filters): number {
  return f.hosts.length + f.tags.length + f.statuses.length + [f.favorite, f.pinned, f.hasUpdates, f.unread, f.readRecently, f.inactive, f.caughtUp].filter(Boolean).length;
}

export function matchesFilters(s: Series, f: Filters, hostsOf: (id: string) => string[], now = Date.now()): boolean {
  if (f.hosts.length && !hostsOf(s.id).some((h) => f.hosts.includes(h))) return false;
  if (f.tags.length && !f.tags.every((t) => s.tags.some((x) => x.toLowerCase() === t.toLowerCase()))) return false;
  if (f.statuses.length && !f.statuses.includes(s.status)) return false;
  if (f.favorite && !s.favorite) return false;
  if (f.pinned && !s.pinned) return false;
  if (f.hasUpdates && !(s.summary.newCount > 0 && (s.summary.newestChapterDiscoveredAt ?? 0) > now - 7 * DAY)) return false;
  if (f.unread && s.summary.newCount === 0) return false;
  if (f.readRecently && !(s.lastReadAt && now - s.lastReadAt < 7 * DAY)) return false;
  if (f.inactive && s.lastReadAt && now - s.lastReadAt < 30 * DAY) return false;
  if (f.caughtUp && !s.summary.caughtUp) return false;
  return true;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function sortSeries(list: Series[], key: SortKey, primaryHost: (id: string) => string = () => ""): Series[] {
  const cmp: Record<SortKey, (a: Series, b: Series) => number> = {
    "recent-read": (a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0),
    "recent-added": (a, b) => b.discoveredAt - a.discoveredAt,
    "title-asc": (a, b) => collator.compare(a.title, b.title),
    "title-desc": (a, b) => collator.compare(b.title, a.title),
    progress: (a, b) => progressRatio(b) - progressRatio(a),
    "update-newest": (a, b) => (b.summary.newestChapterDiscoveredAt ?? 0) - (a.summary.newestChapterDiscoveredAt ?? 0),
    "update-oldest": (a, b) => (a.summary.newestChapterDiscoveredAt ?? Infinity) - (b.summary.newestChapterDiscoveredAt ?? Infinity),
    source: (a, b) => collator.compare(primaryHost(a.id), primaryHost(b.id)),
    rating: (a, b) => (b.personalRating ?? -1) - (a.personalRating ?? -1),
  };
  const c = cmp[key];
  // Pinned series always come first: pinning is UI priority, independent of sort.
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || c(a, b) || collator.compare(a.title, b.title));
}

function progressRatio(s: Series): number {
  const done = s.summary.lastCompletedOrdinal ?? 0;
  const latest = s.summary.latestKnownOrdinal;
  return latest ? done / latest : 0;
}

export function hostsBySeries(sources: SeriesSource[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of sources) m.set(s.seriesId, [...(m.get(s.seriesId) ?? []), s.hostname]);
  return m;
}

/** Pairs of series that look like the same work and haven't been kept separate. */
export function findDuplicates(series: Series[]): [Series, Series][] {
  const byKey = new Map<string, Series[]>();
  for (const s of series) {
    if (s.removedAt) continue;
    for (const k of s.titleKeys) byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const seen = new Set<string>();
  const out: [Series, Series][] = [];
  for (const group of byKey.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const id = [a.id, b.id].sort().join("|");
        if (seen.has(id) || a.keptSeparateFrom.includes(b.id) || b.keptSeparateFrom.includes(a.id)) continue;
        seen.add(id);
        out.push(a.discoveredAt <= b.discoveredAt ? [a, b] : [b, a]);
      }
    }
  }
  return out;
}
