import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Series } from "../shared/types/models";
import type { SortKey } from "../shared/types/settings";
import { SERIES_STATUSES } from "../shared/types/models";
import { DEFAULT_SORT, MORE_VIEWS, findDuplicates, inView, matchesFilters, NO_FILTERS, sortSeries, STATUS_LABEL, type Filters, type ViewId } from "../shared/utils/library";
import { buildSearchEntry, search } from "../shared/utils/search";
import { displayShortcut, isTypingTarget, matchesShortcut } from "../shared/utils/keys";
import { sendToWorker } from "../shared/messages";
import { editSeries } from "../storage/repositories/series";
import { useLibrary, useSettings, useTheme, useDebounced } from "../ui/hooks";
import { Icon } from "../ui/icons";
import { Menu, type MenuItem, type MenuState } from "../ui/Menu";
import { useActions } from "./useActions";
import { useActiveTab } from "./useActiveTab";
import { HomeView } from "./views/HomeView";
import { SeriesView } from "./views/SeriesView";
import { InspectorView } from "./views/InspectorView";
import { HistoryView } from "./views/HistoryView";
import { TimeView } from "./views/TimeView";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { ManualSeriesDialog } from "./components/ManualSeriesDialog";
import { isSafeHttpUrl } from "../detection/normalization/url";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { Brand } from "../ui/Brand";
import { useCollections } from "../ui/useCollections";
import { CollectionsDialog, CollectionAssignmentDialog } from "./components/Collections";

type Route = { name: "home" } | { name: "series"; id: string } | { name: "inspector" } | { name: "history" } | { name: "time" };

function readSession<T>(key: string, fallback: T): T {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Per-viewer convenience only.
  }
}

export function App({ expanded = false }: { expanded?: boolean }) {
  const lib = useLibrary();
  const collections = useCollections();
  const [settings, updateSettings] = useSettings();
  useTheme(settings.theme);
  useEffect(() => { document.documentElement.dataset.artworkMotion = settings.artworkMotion; }, [settings.artworkMotion]);
  const tab = useActiveTab();
  const actions = useActions(lib, expanded ? { ...settings, continueIn: "new" } : settings, expanded ? undefined : tab.tabId);

  const [route, setRoute] = useState<Route>(() => ({ name: expanded && location.hash === "#time" ? "time" : "home" }));
  useEffect(() => {
    if (expanded) history.replaceState(null, "", `${location.pathname}${location.search}${route.name === "time" ? "#time" : ""}`);
  }, [expanded, route.name]);
  const [view, setViewState] = useState<ViewId>(() => readSession("view", "continue"));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 60);
  const [focusedId, setFocusedId] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [palette, setPalette] = useState(false);
  const [manual, setManual] = useState<{ title?: string; url?: string }>();
  const [help, setHelp] = useState(false);
  const [manageLists, setManageLists] = useState(false);
  const [assignLists, setAssignLists] = useState<string[]>();
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didDefaultView = useRef(false);

  const openManual = async () => {
    try {
      const active = tab.tabId !== undefined ? await chrome.tabs.get(tab.tabId) : undefined;
      setManual(active?.url && isSafeHttpUrl(active.url) ? { title: active.title, url: active.url } : {});
    } catch { setManual({}); }
  };

  const setView = (v: ViewId) => {
    setViewState(v);
    writeSession("view", v);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const openCollection = (id: string) => {
    setRoute({ name: "home" });
    setQuery("");
    setFilters(NO_FILTERS);
    setView(`collection:${id}`);
  };
  const currentCollection = view.startsWith("collection:") ? collections.collections.find(c => c.id === view.slice(11)) : undefined;
  useEffect(() => {
    if (collections.loaded && !collections.error && view.startsWith("collection:") && !currentCollection) setView("all");
  }, [collections.loaded, collections.error, currentCollection, view]);
  const openExpanded = () => void chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
  const openTime = () => { if (expanded) setRoute({ name: "time" }); else void chrome.tabs.create({ url: chrome.runtime.getURL("library.html#time") }); };

  // Land on "Continue" when there is something to continue; otherwise show everything.
  useEffect(() => {
    if (!lib.loaded || didDefaultView.current) return;
    didDefaultView.current = true;
    if (view === "continue" && !lib.series.some((s) => inView(s, "continue"))) setViewState("all");
  }, [lib.loaded, lib.series, view]);

  // Context menu "Open in ManwhaTrack" asks the panel to focus a series.
  useEffect(() => {
    const check = async () => {
      const r = await chrome.storage.session.get("panel:focusSeries");
      const id = r["panel:focusSeries"] as string | undefined;
      if (id) {
        await chrome.storage.session.remove("panel:focusSeries");
        setRoute({ name: "series", id });
      }
    };
    void check();
    const onChange = (c: Record<string, chrome.storage.StorageChange>, area: string) => area === "session" && c["panel:focusSeries"]?.newValue && void check();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const sort: SortKey = settings.sortByView[view] ?? DEFAULT_SORT[view] ?? "recent-read";
  const setSort = (s: SortKey) => void updateSettings({ sortByView: { ...settings.sortByView, [view]: s } });

  const hostsOf = useCallback((id: string) => (lib.sourcesBySeries.get(id) ?? []).map((s) => s.hostname), [lib.sourcesBySeries]);
  const entries = useMemo(() => lib.series.map((s) => buildSearchEntry(s, lib.sourcesBySeries.get(s.id))), [lib.series, lib.sourcesBySeries]);

  const visible = useMemo(() => {
    const now = Date.now();
    const memberIds = currentCollection ? new Set(currentCollection.seriesIds) : undefined;
    if (debouncedQuery.trim()) {
      return search(entries, debouncedQuery)
        .map((r) => lib.byId.get(r.id))
        .filter((s): s is Series => !!s && !s.removedAt && (!memberIds || memberIds.has(s.id)) && matchesFilters(s, filters, hostsOf, now));
    }
    const list = lib.series.filter((s) => (memberIds ? memberIds.has(s.id) && !s.removedAt : inView(s, view, now, lib.queue)) && matchesFilters(s, filters, hostsOf, now));
    return sortSeries(list, sort, (id) => hostsOf(id)[0] ?? "");
  }, [debouncedQuery, entries, lib.byId, lib.series, lib.queue, view, filters, hostsOf, sort, currentCollection]);

  const counts = useMemo(() => {
    const now = Date.now();
    const out: Partial<Record<ViewId, number>> = {};
    for (const v of ["continue", "new", "recent", "reading", "planning", "on-hold", "completed", "dropped", "favorites", "pinned", "queue"] as ViewId[]) {
      out[v] = lib.series.filter((s) => inView(s, v, now, lib.queue)).length;
    }
    return out;
  }, [lib.series, lib.queue]);

  const duplicates = useMemo(() => findDuplicates(lib.series), [lib.series]);
  const hosts = useMemo(() => [...new Set(lib.sources.map((s) => s.hostname))].sort(), [lib.sources]);
  const tags = useMemo(() => [...new Set(lib.series.flatMap((s) => s.tags))].sort(), [lib.series]);

  const openSeries = useCallback((id: string) => {
    setRoute({ name: "series", id });
    setFocusedId(id);
  }, []);

  const seriesMenu = useCallback(
    (s: Series, x: number, y: number) => {
      const items: MenuItem[] = [
        { label: s.summary.continueKind === "series" ? "Open series page" : "Continue", onSelect: () => void actions.continueSeries(s), hint: "Enter" },
        { label: "Open in new tab", onSelect: () => void actions.continueSeries(s, { newTab: true }) },
        { kind: "separator" },
        { label: "Mark read", onSelect: () => void actions.markRead(s, true), hint: displayShortcut(settings.shortcuts.markRead) },
        { label: "Mark unread", onSelect: () => void actions.markRead(s, false), disabled: !s.lastCompletedChapterId, hint: displayShortcut(settings.shortcuts.markUnread) },
        { label: s.favorite ? "Remove favorite" : "Favorite", onSelect: () => void actions.toggleFavorite(s), hint: displayShortcut(settings.shortcuts.favorite) },
        { label: s.pinned ? "Unpin" : "Pin", onSelect: () => void actions.togglePin(s) },
        { label: lib.queue.includes(s.id) ? "Remove from queue" : "Add to queue", onSelect: () => void actions.toggleQueue(s) },
        { label: "Assign to lists…", onSelect: () => setAssignLists([s.id]) },
        { kind: "label", label: "Status" },
        ...SERIES_STATUSES.map((st) => ({ label: `${st === s.status ? "✓ " : ""}${STATUS_LABEL[st]}`, onSelect: () => void actions.setStatus(s, st) })),
        { kind: "separator" },
        ...(() => {
          const srcs = lib.sourcesBySeries.get(s.id) ?? [];
          const preferred = srcs.find((x) => x.id === s.preferredSourceId) ?? srcs[0];
          const items: MenuItem[] = [];
          if (preferred) items.push({ label: `Open source (${preferred.hostname})`, onSelect: () => void actions.continueSeries(s, { url: preferred.seriesUrl }) });
          if (srcs.length > 1) {
            items.push({ kind: "label", label: "Preferred source" });
            for (const src of srcs) {
              items.push({
                label: `${src.id === preferred?.id ? "✓ " : ""}${src.hostname}`,
                onSelect: () => void actions.edit([s.id], { preferredSourceId: src.id }, () => editSeries(s.id, { preferredSourceId: src.id })),
              });
            }
          }
          return items;
        })(),
        { label: "Edit / details", onSelect: () => openSeries(s.id) },
        { label: "View history", onSelect: () => openSeries(s.id) },
        { label: "Check for new chapters", onSelect: () => void actions.checkUpdates([s.id]) },
        { kind: "separator" },
        { label: "Remove", danger: true, onSelect: () => void actions.remove([s.id]) },
      ];
      setMenu({ x, y, items });
    },
    [actions, lib.queue, lib.sourcesBySeries, openSeries, settings.shortcuts],
  );

  const focusedSeries = focusedId ? lib.byId.get(focusedId) : undefined;
  const tabSeries = tab.state?.seriesId ? lib.byId.get(tab.state.seriesId) : undefined;

  const commands: Command[] = useMemo(() => {
    const top = lib.series.filter((s) => inView(s, "continue")).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)).slice(0, 3);
    return [
      ...top.map((s) => ({ id: `c:${s.id}`, label: `Continue ${s.title}`, run: () => void actions.continueSeries(s) })),
      { id: "manual", label: "Track a series manually", run: () => void openManual() },
      { id: "library", label: "Open Library", run: () => { setRoute({ name: "home" }); setView("all"); } },
      { id: "expanded", label: "Open full library", run: openExpanded },
      { id: "lists", label: "Create / manage lists", run: () => setManageLists(true) },
      { id: "new", label: "Show New Chapters", run: () => { setRoute({ name: "home" }); setView("new"); } },
      { id: "queue", label: "Show Queue", run: () => { setRoute({ name: "home" }); setView("queue"); } },
      { id: "mark", label: "Mark Current Chapter Read", run: () => tab.tabId !== undefined && void sendToWorker({ type: "tab/mark-current", tabId: tab.tabId, read: true }) },
      { id: "refresh-current", label: "Refresh Current Series", run: () => tabSeries && void actions.checkUpdates([tabSeries.id]) },
      { id: "check-all", label: "Check All Sources for Updates", run: () => void actions.checkUpdates() },
      { id: "history", label: "Reading History", run: () => setRoute({ name: "history" }) },
      { id: "time", label: "Time tracking", run: openTime },
      { id: "inspect", label: "Detection Inspector", run: () => setRoute({ name: "inspector" }) },
      { id: "select", label: "Select Multiple Series", run: () => setSelecting(true) },
      { id: "export", label: "Export Library", run: () => void chrome.tabs.create({ url: chrome.runtime.getURL("options.html#data") }) },
      { id: "stats", label: "Reading Statistics", run: () => void chrome.tabs.create({ url: chrome.runtime.getURL("options.html#stats") }) },
      { id: "settings", label: "Open Settings", run: () => void chrome.runtime.openOptionsPage() },
      { id: "shortcuts", label: "Keyboard Shortcuts", run: () => setHelp(true) },
    ];
  }, [lib.series, actions, tab.tabId, tabSeries, expanded]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const sc = settings.shortcuts;
      if (matchesShortcut(e, sc.palette)) {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (menu || palette || help || document.querySelector("dialog[open]")) return;
      if (matchesShortcut(e, sc.back)) {
        if (isTypingTarget(e.target) && query) {
          setQuery("");
          return;
        }
        if (selecting) setSelecting(false);
        else if (route.name !== "home") setRoute({ name: "home" });
        else (e.target as HTMLElement)?.blur?.();
        return;
      }
      if (isTypingTarget(e.target)) {
        if (e.target === searchRef.current && (e.key === "ArrowDown" || e.key === "Enter")) {
          e.preventDefault();
          if (e.key === "Enter" && visible[0]) void actions.continueSeries(visible[0]);
          else {
            setFocusedId(visible[0]?.id);
            if (visible[0]) scrollIntoView(visible[0].id, scrollRef.current, 0);
          }
        }
        return;
      }
      if (e.key === "?" ) {
        setHelp(true);
        return;
      }
      if (matchesShortcut(e, sc.search)) {
        e.preventDefault();
        setRoute({ name: "home" });
        searchRef.current?.focus();
        return;
      }
      if (route.name !== "home") return;
      const idx = visible.findIndex((s) => s.id === focusedId);
      const move = (d: number) => {
        e.preventDefault();
        const next = visible[Math.max(0, Math.min(visible.length - 1, idx + d))];
        if (next) {
          setFocusedId(next.id);
          scrollIntoView(next.id, scrollRef.current, visible.indexOf(next));
        }
      };
      if (matchesShortcut(e, sc.next) || e.key === "ArrowDown") return move(1);
      if (matchesShortcut(e, sc.prev) || e.key === "ArrowUp") return move(idx < 0 ? 1 : -1);
      if (!focusedSeries) return;
      // Let focused buttons and links handle their own Enter/Space.
      const t = e.target as HTMLElement | null;
      if (t && ["BUTTON", "A"].includes(t.tagName) && (e.key === "Enter" || e.key === " ")) return;
      if (matchesShortcut(e, sc.open)) {
        e.preventDefault();
        void actions.continueSeries(focusedSeries, { newTab: e.metaKey || e.ctrlKey ? true : undefined });
      } else if (matchesShortcut(e, sc.favorite)) void actions.toggleFavorite(focusedSeries);
      else if (matchesShortcut(e, sc.markUnread)) void actions.markRead(focusedSeries, false);
      else if (matchesShortcut(e, sc.markRead)) void actions.markRead(focusedSeries, true);
      else if (e.key === "o") openSeries(focusedSeries.id);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [settings.shortcuts, menu, palette, help, route, visible, focusedId, focusedSeries, actions, query, selecting, openSeries]);

  const appMenu = (el: Element) => {
    const r = el.getBoundingClientRect();
    setMenu({
      x: r.right - 200,
      y: r.bottom + 4,
      items: [
        { label: "Track a series manually…", onSelect: () => void openManual() },
        { label: "Create / manage lists…", onSelect: () => setManageLists(true) },
        { label: "Open full library", onSelect: openExpanded },
        { label: "Check all sources for updates", onSelect: () => void actions.checkUpdates() },
        { label: selecting ? "Stop selecting" : "Select multiple", onSelect: () => setSelecting(!selecting) },
        { label: "Reading history", onSelect: () => setRoute({ name: "history" }) },
        { label: "Time tracking", onSelect: openTime },
        { label: "Detection Inspector", onSelect: () => setRoute({ name: "inspector" }) },
        { kind: "separator" },
        { label: "Command palette", hint: displayShortcut(settings.shortcuts.palette), onSelect: () => setPalette(true) },
        { label: "Keyboard shortcuts", hint: "?", onSelect: () => setHelp(true) },
        { label: "Import / export", onSelect: () => void chrome.tabs.create({ url: chrome.runtime.getURL("options.html#data") }) },
        { label: "Settings", onSelect: () => void chrome.runtime.openOptionsPage() },
      ],
    });
  };

  return (
    <div className={`app${expanded ? " expanded" : ""}`}>
      {(route.name === "home" || expanded) && (
        <header className="topbar">
          <Brand />
          {route.name === "home" ? <div className="search" role="search">
            <Icon name="search" />
            <input
              ref={searchRef}
              className="input"
              type="search"
              placeholder={currentCollection ? "Search this list" : "Search library"}
              aria-label="Search library"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!query && <kbd aria-hidden="true">{displayShortcut(settings.shortcuts.search)}</kbd>}
          </div> : <button className="btn ghost" onClick={() => setRoute({ name: "home" })}>Library</button>}
          {!expanded && <button className="icon-btn expand-library" aria-label="Expand library" title="Open full library in a tab" onClick={openExpanded}><Icon name="external" /></button>}
          <button className="icon-btn" aria-label="Menu" onClick={(e) => appMenu(e.currentTarget)}>
            <Icon name="more" />
          </button>
        </header>
      )}
      {expanded && <aside className="library-rail" aria-label="Library navigation">
        <span className="section-title">Library</span>
        {[{ id: "continue" as ViewId, label: "Continue" }, { id: "new" as ViewId, label: "New chapters" }, ...MORE_VIEWS].map(v => <button key={v.id} aria-pressed={route.name === "home" && view === v.id} onClick={() => { setRoute({ name: "home" }); setQuery(""); setView(v.id); }}>{v.label}{counts[v.id] ? <span className="count">{counts[v.id]}</span> : null}</button>)}
        <button aria-pressed={route.name === "time"} onClick={openTime}><Icon name="clock" />Time tracking</button>
        <div className="rail-heading"><span className="section-title">Your lists</span><button className="icon-btn" aria-label="Create or manage lists" onClick={() => setManageLists(true)}><Icon name="plus" /></button></div>
        {collections.collections.map(c => <button key={c.id} aria-pressed={route.name === "home" && currentCollection?.id === c.id} onClick={() => openCollection(c.id)}><span className="truncate">{c.name}</span><span className="count">{c.seriesIds.length}</span></button>)}
        {!collections.collections.length && <p className="small muted">Create lists to organize your library.</p>}
        <hr className="divider" /><button onClick={() => void chrome.runtime.openOptionsPage()}>Settings & backup</button>
        <p className="small faint">Stored on this device.<br />No account. No server.</p>
      </aside>}
      <main className="scroll" ref={scrollRef} key={route.name === "series" ? route.id : route.name}>
        {route.name === "home" && (
          <HomeView
            expanded={expanded}
            lib={lib}
            settings={settings}
            updateSettings={updateSettings}
            actions={actions}
            tab={tab}
            view={view}
            setView={setView}
            sort={sort}
            setSort={setSort}
            filters={filters}
            setFilters={setFilters}
            visible={visible}
            counts={counts}
            query={debouncedQuery.trim()}
            collection={currentCollection}
            collections={collections.collections}
            collectionsError={collections.error}
            onReloadCollections={() => void collections.reload()}
            onOpenCollection={openCollection}
            onManageLists={() => setManageLists(true)}
            onOpenTime={openTime}
            focusedId={focusedId}
            setFocusedId={setFocusedId}
            selecting={selecting}
            setSelecting={setSelecting}
            checked={checked}
            setChecked={setChecked}
            duplicates={duplicates}
            hosts={hosts}
            tags={tags}
            onOpenSeries={openSeries}
            onMenu={seriesMenu}
            onInspect={() => setRoute({ name: "inspector" })}
            onManual={() => void openManual()}
            scrollRef={scrollRef}
          />
        )}
        {route.name === "series" && <SeriesView id={route.id} lib={lib} actions={actions} onBack={() => setRoute({ name: "home" })} onOpenSeries={openSeries} />}
        {route.name === "inspector" && <InspectorView onManual={() => void openManual()} state={tab.state} series={tabSeries} onBack={() => setRoute({ name: "home" })} onOpenSeries={openSeries} />}
        {route.name === "history" && <HistoryView byId={lib.byId} onBack={() => setRoute({ name: "home" })} onOpenSeries={openSeries} />}
        {route.name === "time" && <TimeView series={lib.series} onBack={() => setRoute({ name: "home" })} onOpenSeries={openSeries} />}
      </main>
      {menu && <Menu state={menu} onClose={() => setMenu(null)} />}
      {palette && <CommandPalette commands={commands} entries={entries} byId={lib.byId} onContinue={(s) => void actions.continueSeries(s)} onClose={() => setPalette(false)} />}
      {manual && <ManualSeriesDialog initial={manual} onClose={() => setManual(undefined)} onAdded={async (series) => { await lib.reload(); setManual(undefined); openSeries(series.id); }} />}
      {help && <ShortcutsHelp settings={settings} onClose={() => setHelp(false)} />}
      {manageLists && <CollectionsDialog onClose={() => setManageLists(false)} onOpen={openCollection} />}
      {assignLists && <CollectionAssignmentDialog seriesIds={assignLists} onClose={() => setAssignLists(undefined)} />}
    </div>
  );
}

function scrollIntoView(id: string, scroller: HTMLElement | null, index: number): void {
  const el = scroller?.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (el) {
    el.scrollIntoView({ block: "nearest" });
    (el as HTMLElement).focus({ preventScroll: true });
    return;
  }
  // Virtualized row not rendered yet: jump near it, then it renders.
  const list = scroller?.querySelector<HTMLElement>(".list");
  if (scroller && list) {
    const rowHeight = Number.parseFloat(getComputedStyle(list).getPropertyValue("--row-h"));
    scroller.scrollTop = list.offsetTop + index * rowHeight - scroller.clientHeight / 2;
    requestAnimationFrame(() => scroller.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
  }
}
