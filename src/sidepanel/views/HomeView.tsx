import { useState, type MouseEvent, type RefObject } from "react";
import type { Series } from "../../shared/types/models";
import type { Settings, SortKey } from "../../shared/types/settings";
import type { TabState } from "../../shared/messages";
import { inView, MORE_VIEWS, PRIMARY_VIEWS, type Filters, type ViewId } from "../../shared/utils/library";
import { lastReadText } from "../../shared/utils/format";
import { shortChapterLabel } from "../../detection/normalization/chapter";
import { keepSeparate, mergeSeries } from "../../storage/repositories/sources";
import { publish } from "../../shared/bus";
import { Cover } from "../../ui/Cover";
import { useToast } from "../../ui/toasts";
import { NowReading } from "../components/NowReading";
import { FilterBar } from "../components/FilterBar";
import { SeriesRow, SeriesTile, continueText } from "../components/SeriesItem";
import { VirtualList } from "../components/VirtualList";
import { BatchBar } from "../components/BatchBar";
import { QueueView } from "./QueueView";
import type { Actions } from "../useActions";
import type { useLibrary } from "../../ui/hooks";

const ROW_H = 68;
const GRID_PAGE = 120;

export interface HomeProps {
  lib: ReturnType<typeof useLibrary>;
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => Promise<void>;
  actions: Actions;
  tab: { tabId?: number; state?: TabState };
  view: ViewId;
  setView: (v: ViewId) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  visible: Series[];
  counts: Partial<Record<ViewId, number>>;
  query: string;
  focusedId?: string;
  setFocusedId: (id: string | undefined) => void;
  selecting: boolean;
  setSelecting: (v: boolean) => void;
  checked: Set<string>;
  setChecked: (s: Set<string>) => void;
  duplicates: [Series, Series][];
  hosts: string[];
  tags: string[];
  onOpenSeries: (id: string) => void;
  onMenu: (s: Series, x: number, y: number) => void;
  onInspect: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

export function HomeView(p: HomeProps) {
  const toast = useToast();
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  const { lib, settings, actions } = p;

  const tabSeries = p.tab.state?.seriesId ? lib.byId.get(p.tab.state.seriesId) : undefined;
  const hero = !p.query
    ? lib.series
        .filter((s) => inView(s, "continue"))
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0]
    : undefined;
  // The Continue tab already lists these; the hero only helps from other views.
  const heroHidden = !hero || p.view === "continue" || (tabSeries?.id === hero.id && p.tab.state?.observation.kind === "chapter");

  const onContinue = (s: Series, e: MouseEvent) => {
    const modifier = e.metaKey || e.ctrlKey || e.button === 1;
    void actions.continueSeries(s, { newTab: modifier ? true : undefined });
  };
  const onCheck = (s: Series, v: boolean) => {
    const next = new Set(p.checked);
    if (v) next.add(s.id);
    else next.delete(s.id);
    p.setChecked(next);
  };
  const hostOf = (id: string) => {
    const srcs = lib.sourcesBySeries.get(id);
    const s = lib.byId.get(id);
    return (srcs?.find((x) => x.id === s?.preferredSourceId) ?? srcs?.[0])?.hostname;
  };

  const dup = p.duplicates[0];
  const isMoreView = MORE_VIEWS.some((v) => v.id === p.view);

  if (!lib.loaded) return null;
  if (lib.error) {
    return (
      <div className="empty" role="alert">
        <h2>The local library could not be opened.</h2>
        <p>{lib.error}</p>
      </div>
    );
  }

  const itemProps = (s: Series) => ({
    s,
    host: hostOf(s.id),
    selected: p.focusedId === s.id,
    checked: p.checked.has(s.id),
    onOpen: (x: Series) => (p.selecting ? onCheck(x, !p.checked.has(x.id)) : p.onOpenSeries(x.id)),
    onContinue,
    onMenu: p.onMenu,
    onCheck,
  });

  return (
    <>
      <NowReading state={p.tab.state} series={tabSeries} onOpenSeries={p.onOpenSeries} onInspect={p.onInspect} />

      {dup && !p.query && (
        <div className="banner" role="region" aria-label="Possible duplicate">
          <span style={{ flex: "1 1 160px" }}>
            Possible duplicate: <strong>{dup[0].title}</strong> and <strong>{dup[1].title}</strong>
          </span>
          <button
            className="btn sm"
            onClick={async () => {
              await mergeSeries(dup[0].id, dup[1].id);
              publish({ type: "library-changed" });
              toast.show(`Merged into “${dup[0].title}”`);
            }}
          >
            Merge
          </button>
          <button
            className="btn sm ghost"
            onClick={async () => {
              await keepSeparate(dup[0].id, dup[1].id);
              publish({ type: "library-changed" });
            }}
          >
            Keep separate
          </button>
        </div>
      )}

      {hero && !heroHidden && (
        <section className="section" aria-label="Continue reading">
          <h2 className="section-title">Continue</h2>
          <div className="continue-card">
            <button className="icon-btn" style={{ width: "auto", height: "auto" }} onClick={() => p.onOpenSeries(hero.id)} aria-label={`Details for ${hero.title}`}>
              <Cover coverId={hero.coverId} title={hero.title} size="md" />
            </button>
            <div style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 650 }}>{hero.title}</div>
              <div className="small muted tabular">
                {hero.summary.continueLabel ? shortChapterLabel(hero.summary.continueLabel) : ""} {hero.summary.continueKind === "resume" && hero.summary.currentProgress ? `· ${Math.round(hero.summary.currentProgress * 100)}% read` : ""}
              </div>
              <div className="small faint">{lastReadText(hero.lastReadAt)}</div>
            </div>
            <button className="btn primary" onClick={(e) => onContinue(hero, e)} onAuxClick={(e) => e.button === 1 && onContinue(hero, e)}>
              {continueText(hero)}
            </button>
          </div>
        </section>
      )}

      {!p.query && (
        <div className="tabs" role="tablist" aria-label="Library views">
          {PRIMARY_VIEWS.map((v) => (
            <button key={v.id} role="tab" className="tab" aria-selected={p.view === v.id} onClick={() => p.setView(v.id)}>
              {v.label}
              {(v.id === "continue" || v.id === "new") && p.counts[v.id] ? <span className="count tabular">{p.counts[v.id]}</span> : null}
            </button>
          ))}
          <select
            className="tab"
            aria-label="More views"
            aria-selected={isMoreView}
            value={isMoreView ? p.view : ""}
            onChange={(e) => e.target.value && p.setView(e.target.value as ViewId)}
            style={{ appearance: "none", borderBottomColor: isMoreView ? "var(--accent)" : undefined }}
          >
            <option value="">More</option>
            {MORE_VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {p.counts[v.id] ? ` (${p.counts[v.id]})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {p.view === "queue" && !p.query ? (
        <QueueView lib={lib} actions={actions} onOpenSeries={p.onOpenSeries} />
      ) : (
        <>
          <FilterBar
            sort={p.sort}
            onSort={p.setSort}
            filters={p.filters}
            onFilters={p.setFilters}
            hosts={p.hosts}
            tags={p.tags}
            layout={settings.layout}
            onLayout={(layout) => void p.updateSettings({ layout })}
            count={p.visible.length}
          />
          {p.visible.length === 0 ? (
            <EmptyState view={p.view} query={p.query} total={lib.series.length} />
          ) : settings.layout === "grid" ? (
            <>
              <div className="grid" role="listbox" aria-label="Series">
                {p.visible.slice(0, gridLimit).map((s) => (
                  <SeriesTile key={s.id} {...itemProps(s)} />
                ))}
              </div>
              {p.visible.length > gridLimit && (
                <div style={{ padding: "0 10px 12px" }}>
                  <button className="btn" style={{ width: "100%" }} onClick={() => setGridLimit((n) => n + GRID_PAGE)}>
                    Show more ({p.visible.length - gridLimit})
                  </button>
                </div>
              )}
            </>
          ) : (
            <VirtualList
              items={p.visible}
              rowHeight={ROW_H}
              scrollRef={p.scrollRef}
              label="Series"
              selectingClass={p.selecting ? "selecting" : undefined}
              render={(s) => <SeriesRow key={s.id} {...itemProps(s)} />}
            />
          )}
        </>
      )}

      {p.selecting && (
        <BatchBar
          selected={p.visible.filter((s) => p.checked.has(s.id))}
          onClear={() => {
            p.setChecked(new Set());
            p.setSelecting(false);
          }}
          onRemove={(ids) => void actions.remove(ids)}
        />
      )}
    </>
  );
}

function EmptyState({ view, query, total }: { view: ViewId; query: string; total: number }) {
  if (query) {
    return (
      <div className="empty">
        <h2>No series match “{query}”.</h2>
        <p>Search looks at titles, alternate titles, tags, notes and source sites.</p>
      </div>
    );
  }
  if (total === 0) {
    return (
      <div className="empty">
        <h2>No series tracked yet.</h2>
        <p>Open a manhwa and it will appear here automatically.</p>
      </div>
    );
  }
  const text: Partial<Record<ViewId, string>> = {
    continue: "Nothing in progress. Open a chapter and it will show up here.",
    new: "No updates. New chapters appear here after sources are checked.",
    favorites: "No favorites yet. Use the star in a series' menu.",
    pinned: "Nothing pinned.",
    recent: "Nothing read in the last 30 days.",
  };
  return (
    <div className="empty">
      <p>{text[view] ?? "No series in this view."}</p>
    </div>
  );
}
