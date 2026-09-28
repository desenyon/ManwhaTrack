// Sort + composable filters. Basic filters are inline chips, not a giant modal.

import { useState } from "react";
import type { SortKey } from "../../shared/types/settings";
import { SERIES_STATUSES, type SeriesStatus } from "../../shared/types/models";
import { activeFilterCount, NO_FILTERS, SORT_LABEL, STATUS_LABEL, type Filters } from "../../shared/utils/library";
import { Icon } from "../../ui/icons";

const TOGGLES: { key: keyof Filters; label: string }[] = [
  { key: "hasUpdates", label: "Has updates" },
  { key: "unread", label: "Unread chapters" },
  { key: "favorite", label: "Favorite" },
  { key: "pinned", label: "Pinned" },
  { key: "readRecently", label: "Read this week" },
  { key: "inactive", label: "Inactive 30d+" },
  { key: "caughtUp", label: "Caught up" },
];

export function FilterBar({
  sort,
  onSort,
  filters,
  onFilters,
  hosts,
  tags,
  layout,
  onLayout,
  count,
}: {
  sort: SortKey;
  onSort: (s: SortKey) => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
  hosts: string[];
  tags: string[];
  layout: "list" | "grid";
  onLayout: (l: "list" | "grid") => void;
  count: number;
}) {
  const [open, setOpen] = useState(activeFilterCount(filters) > 0);
  const n = activeFilterCount(filters);
  const toggleIn = <K extends "hosts" | "tags" | "statuses">(key: K, v: Filters[K][number]) => {
    const list = filters[key] as string[];
    onFilters({ ...filters, [key]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] });
  };

  return (
    <>
      <div className="toolbar">
        <span className="small faint tabular" aria-live="polite">{count} series</span>
        <span className="spacer" />
        <label className="sr-only" htmlFor="sort">Sort</label>
        <select id="sort" className="select" value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>{SORT_LABEL[k]}</option>
          ))}
        </select>
        <button className="icon-btn" aria-pressed={open || n > 0} aria-expanded={open} aria-label={`Filters${n ? ` (${n} active)` : ""}`} onClick={() => setOpen(!open)}>
          <Icon name="filter" />
        </button>
        <button className="icon-btn" aria-label={layout === "list" ? "Show as grid" : "Show as list"} onClick={() => onLayout(layout === "list" ? "grid" : "list")}>
          <Icon name={layout === "list" ? "grid" : "list"} />
        </button>
      </div>
      {open && (
        <div className="toolbar" style={{ paddingTop: 0 }} role="group" aria-label="Filters">
          {TOGGLES.map((t) => (
            <button key={t.key} className="chip" aria-pressed={!!filters[t.key]} onClick={() => onFilters({ ...filters, [t.key]: !filters[t.key] })}>
              {t.label}
            </button>
          ))}
          <select className="select" aria-label="Filter by status" value="" onChange={(e) => e.target.value && toggleIn("statuses", e.target.value as SeriesStatus)}>
            <option value="">Status…</option>
            {SERIES_STATUSES.map((s) => (
              <option key={s} value={s}>{filters.statuses.includes(s) ? "✓ " : ""}{STATUS_LABEL[s]}</option>
            ))}
          </select>
          {hosts.length > 1 && (
            <select className="select" aria-label="Filter by source" value="" onChange={(e) => e.target.value && toggleIn("hosts", e.target.value)}>
              <option value="">Source…</option>
              {hosts.map((h) => (
                <option key={h} value={h}>{filters.hosts.includes(h) ? "✓ " : ""}{h}</option>
              ))}
            </select>
          )}
          {tags.length > 0 && (
            <select className="select" aria-label="Filter by tag" value="" onChange={(e) => e.target.value && toggleIn("tags", e.target.value)}>
              <option value="">Tag…</option>
              {tags.map((t) => (
                <option key={t} value={t}>{filters.tags.includes(t) ? "✓ " : ""}{t}</option>
              ))}
            </select>
          )}
          {[...filters.statuses.map((v) => ["statuses", v, STATUS_LABEL[v]] as const), ...filters.hosts.map((v) => ["hosts", v, v] as const), ...filters.tags.map((v) => ["tags", v, `#${v}`] as const)].map(([k, v, label]) => (
            <span key={`${k}${v}`} className="chip" aria-pressed="true">
              {label}
              <button className="x" aria-label={`Remove filter ${label}`} onClick={() => toggleIn(k, v as never)}>×</button>
            </span>
          ))}
          {n > 0 && (
            <button className="btn sm ghost" onClick={() => onFilters(NO_FILTERS)}>Clear</button>
          )}
        </div>
      )}
    </>
  );
}
