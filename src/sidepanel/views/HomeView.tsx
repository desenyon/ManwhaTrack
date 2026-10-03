import { useState, type MouseEvent, type RefObject } from "react";
import type { Series } from "../../shared/types/models";
import type { Settings, SortKey } from "../../shared/types/settings";
import type { TabState } from "../../shared/messages";
import { inView, MORE_VIEWS, NO_FILTERS, PRIMARY_VIEWS, type Filters, type ViewId } from "../../shared/utils/library";
import { lastReadText } from "../../shared/utils/format";
import { shortChapterLabel } from "../../detection/normalization/chapter";
import { keepSeparate, mergeSeries } from "../../storage/repositories/sources";
import { publish } from "../../shared/bus";
import { Cover } from "../../ui/Cover";
import { useToast } from "../../ui/toasts";
import { NowReading } from "../components/NowReading";
import { FilterBar } from "../components/FilterBar";
import { SeriesRow, SeriesTile, continueText, LIBRARY_ROW_HEIGHT } from "../components/SeriesItem";
import { VirtualList } from "../components/VirtualList";
import { BatchBar } from "../components/BatchBar";
import { QueueView } from "./QueueView";
import type { Actions } from "../useActions";
import type { useLibrary } from "../../ui/hooks";
import type { Collection } from "../../shared/types/collections";
import { HandsScene, LibraryFooter } from "../components/Artwork";
import { ReadingTimer } from "../components/ReadingTimer";

const GRID_PAGE = 120;

export interface HomeProps {
  expanded?: boolean;
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
  collection?: Collection;
  collections: Collection[];
  collectionsError?: string;
  onReloadCollections: () => void;
  onOpenCollection: (id: string) => void;
  onManageLists: () => void;
  onAddToList: () => void;
  onOpenTime: () => void;
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
  onManual: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

export function HomeView(p: HomeProps) {
  const toast = useToast();
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  const { lib, settings, actions } = p;
  const layout = p.expanded ? settings.expandedLayout : settings.layout;

  const tabSeries = p.tab.state?.seriesId ? lib.byId.get(p.tab.state.seriesId) : undefined;
  const hero = !p.query
    ? lib.series
        .filter((s) => inView(s, "continue") && (!p.collection || p.collection.seriesIds.includes(s.id)))
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0]
    : undefined;
  const heroHidden = !settings.showFeaturedContinue || !hero || !!p.collection || (p.expanded && p.view !== "continue") || (tabSeries?.id === hero.id && p.tab.state?.observation.kind === "chapter");

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
  const isMoreView = MORE_VIEWS.some((v) => v.id === p.view) || !!p.collection;

  if (!lib.loaded) return <div className="empty" role="status"><h2>Opening your local library…</h2></div>;
  if (lib.error) {
    return (
      <div className="empty" role="alert">
        <h2>The local library could not be opened.</h2>
        <p>{lib.error}</p><button className="btn primary" onClick={() => void lib.reload()}>Retry</button>
      </div>
    );
  }

  const itemProps = (s: Series) => ({
    s,
    host: hostOf(s.id),
    selected: p.focusedId === s.id,
    checked: p.checked.has(s.id),
    selecting: p.selecting,
    onOpen: (x: Series) => (p.selecting ? onCheck(x, !p.checked.has(x.id)) : p.onOpenSeries(x.id)),
    onContinue,
    onMenu: p.onMenu,
    onCheck,
  });

  return (
    <><div className="library-home"><div className="library-content">
      <div className="folio-heading"><div><span className="section-title">{p.collection ? "Your list" : "A private reading collection"}</span><h1 className={p.collection ? "collection-title" : undefined} title={p.collection?.name}>{p.collection?.name ?? "Your library."}</h1>{p.collection && <p className="small muted">{p.collection.seriesIds.length} series · Stored on this device</p>}</div>{p.collection && <div className="list-page-actions"><button className="btn primary" onClick={p.onAddToList}>Add series</button><button className="btn ghost" onClick={p.onManageLists}>Manage lists</button></div>}</div>
      {settings.showReadingTimer && <ReadingTimer series={lib.series} onOpenTime={p.onOpenTime} />}
      <NowReading state={p.tab.state} series={tabSeries} onOpenSeries={p.onOpenSeries} onInspect={p.onInspect} />

      {dup && !p.query && (
        <div className="banner" role="region" aria-label="Possible duplicate">
          <span style={{ flex: "1 1 160px" }}>
            Possible duplicate: <strong>{dup[0].title}</strong> and <strong>{dup[1].title}</strong>
          </span>
          <button
            className="btn sm"
            onClick={async () => {
              if (!confirm(`Merge “${dup[1].title}” into “${dup[0].title}”? All sources and history will be preserved.`)) return;
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
        <section className="section featured-continue" aria-label="Continue reading">
          <HandsScene />
          <h2 className="section-title">Continue</h2>
          <div className="continue-card">
            <button className="icon-btn" style={{ width: "auto", height: "auto" }} onClick={() => p.onOpenSeries(hero.id)} aria-label={`Details for ${hero.title}`}>
              <Cover coverId={hero.coverId} title={hero.title} size="md" />
            </button>
            <div style={{ minWidth: 0 }}>
              <div className="featured-title">{hero.title}</div>
              <div className="series-progress">
                {hero.summary.continueLabel && <span className="meta-card tabular">{shortChapterLabel(hero.summary.continueLabel)}</span>}
                {hero.summary.continueKind === "resume" && !!hero.summary.currentProgress && <span className="meta-card tabular">{Math.round(hero.summary.currentProgress * 100)}% read</span>}
              </div>
              <div className="small faint">{lastReadText(hero.lastReadAt)}</div>
              {hero.summary.newCount > 0 && <span className="badge">+{hero.summary.newCount} new</span>}
            </div>
            <button className="btn primary" onClick={(e) => onContinue(hero, e)} onAuxClick={(e) => e.button === 1 && onContinue(hero, e)}>
              {continueText(hero)}
            </button>
          </div>
        </section>
      )}

      {!p.query && (
        <nav className="tabs" aria-label="Library views">
          {PRIMARY_VIEWS.map((v) => (
            <button key={v.id} className="tab" aria-pressed={p.view === v.id} onClick={() => p.setView(v.id)}>
              {v.label}
              {(v.id === "continue" || v.id === "new") && p.counts[v.id] ? <span className="count tabular">{p.counts[v.id]}</span> : null}
            </button>
          ))}
          <select
            className="tab"
            aria-label="Lists and library views"
            value={isMoreView ? p.view : ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "manage") p.onManageLists();
              else if (value.startsWith("collection:")) p.onOpenCollection(value.slice(11));
              else if (value) p.setView(value as ViewId);
            }}
            style={{ borderBottomColor: isMoreView ? "var(--accent)" : undefined }}
          >
            <option value="">Lists / All</option>
            <option value="manage">Create / manage lists…</option>
            {p.collections.length > 0 && <optgroup label="Your lists">{p.collections.map(c => <option key={c.id} value={`collection:${c.id}`}>{c.name} ({c.seriesIds.length})</option>)}</optgroup>}
            <optgroup label="Library">{MORE_VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {p.counts[v.id] ? ` (${p.counts[v.id]})` : ""}
              </option>
            ))}</optgroup>
          </select>
        </nav>
      )}

      {p.collectionsError && <div className="banner" role="alert"><span>{p.collectionsError}</span><button className="btn sm" onClick={p.onReloadCollections}>Retry lists</button></div>}

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
            layout={layout}
            onLayout={(layout) => void p.updateSettings(p.expanded ? { expandedLayout: layout } : { layout })}
            count={p.visible.length}
          />
          {p.visible.length === 0 && p.collection && !p.query ? p.collection.seriesIds.length === 0 ? <div className="empty"><h2>This list is empty.</h2><p>Add series from your library. Reading status and progress stay unchanged.</p><button className="btn" onClick={p.onAddToList}>Add series to this list</button></div> : <div className="empty"><h2>No series match this list’s filters.</h2><button className="btn" onClick={() => p.setFilters(NO_FILTERS)}>Clear filters</button></div> : p.visible.length === 0 ? (
            <EmptyState onManual={p.onManual} view={p.view} query={p.query} total={lib.series.length} />
          ) : layout === "grid" ? (
            <>
              <div className={`grid ${p.selecting ? "selecting" : ""}`} role="list" aria-label="Series">
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
              rowHeight={LIBRARY_ROW_HEIGHT}
              scrollRef={p.scrollRef}
              label="Series"
              selectingClass={p.selecting ? "selecting" : undefined}
              render={(s) => <SeriesRow key={s.id} {...itemProps(s)} />}
            />
          )}
        </>
      )}

      </div>
      {!p.query && <LibraryFooter count={p.visible.length} motion={settings.artworkMotion} onMotion={(artworkMotion) => void p.updateSettings({ artworkMotion })} />}
      </div>
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

function EmptyState({ view, query, total, onManual }: { view: ViewId; query: string; total: number; onManual: () => void }) {
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
        <button className="btn" onClick={onManual}>Track a series manually</button>
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
