// Focused series detail: metadata editing, Continue, sources, chapter timeline, history, notes.
// Every manual edit is stored as a user override and survives future detections.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Chapter, Series, SeriesSource } from "../../shared/types/models";
import { SERIES_STATUSES } from "../../shared/types/models";
import { STATUS_LABEL } from "../../shared/utils/library";
import { formatDuration, relativeTime, shortDate } from "../../shared/utils/format";
import { search, buildSearchEntry } from "../../shared/utils/search";
import { editSeries, resetUserField } from "../../storage/repositories/series";
import { deleteChapter, editChapter, listChapters, markChapters, markReadUpTo, setProgressTo } from "../../storage/repositories/chapters";
import { mergeSeries, removeSource, sourceHealth, splitSource, updateSource } from "../../storage/repositories/sources";
import { removeCustomCover, setCustomCover } from "../../storage/repositories/covers";
import { publish, subscribe } from "../../shared/bus";
import { sendToWorker } from "../../shared/messages";
import { isSafeHttpUrl } from "../../detection/normalization/url";
import { moveChapter } from "../../storage/manual";
import { getCoverStatus, type CoverStatus } from "../../storage/cover-status";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import { Dialog, Menu, menuAtElement, type MenuState } from "../../ui/Menu";
import { useToast } from "../../ui/toasts";
import { updatesSupported } from "../../detection";
import { CollectionMembership } from "../components/Collections";
import { TagEditor } from "../components/TagEditor";
import { continueText, SourceBadge } from "../components/SeriesItem";
import { HandsScene } from "../components/Artwork";
import { EventList } from "./HistoryView";
import type { Actions } from "../useActions";
import type { useLibrary } from "../../ui/hooks";

const CHAPTER_PAGE = 100;
const HEALTH_TEXT = { healthy: "Healthy", stale: "Stale", failing: "Not responding", unknown: "Not checked yet" } as const;

export function SeriesView({ id, lib, actions, onBack, onOpenSeries }: { id: string; lib: ReturnType<typeof useLibrary>; actions: Actions; onBack: () => void; onOpenSeries: (id: string) => void }) {
  const s = lib.byId.get(id);
  const sources = useMemo(() => lib.sourcesBySeries.get(id) ?? [], [lib.sourcesBySeries, id]);
  const toast = useToast();
  const [coverStatus, setCoverStatus] = useState<CoverStatus>();
  const [chapterError, setChapterError] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<null | "title" | "aliases" | "cover" | "merge" | "progress" | { chapter: Chapter }>(null);

  const loadChapters = useCallback(async () => {
    try { setChapters(await listChapters(id)); setChapterError(false); setCoverStatus(await getCoverStatus(id)); }
    catch { setChapterError(true); }
  }, [id]);
  useEffect(() => {
    void loadChapters();
    return subscribe((m) => m.type === "library-changed" && (!m.seriesIds || m.seriesIds.includes(id)) && void loadChapters());
  }, [id, loadChapters]);

  const allTags = useMemo(() => [...new Set(lib.series.flatMap((x) => x.tags))].sort(), [lib.series]);

  if (!s) {
    return (
      <>
        <Header title="Series" onBack={onBack} />
        <div className="empty"><p>This series is no longer in the library.</p></div>
      </>
    );
  }

  const save = async (edit: Parameters<typeof editSeries>[1], patch: Partial<Series>) => {
    await actions.edit([s.id], patch, () => editSeries(s.id, edit));
  };
  const changed = () => publish({ type: "library-changed", seriesIds: [s.id] });

  const moreMenu = (el: Element) =>
    setMenu(
      menuAtElement(el, [
        { label: lib.queue.includes(s.id) ? "Remove from queue" : "Add to queue", onSelect: () => void actions.toggleQueue(s) },
        { label: s.pinned ? "Unpin" : "Pin", onSelect: () => void actions.togglePin(s) },
        { label: "Check for new chapters", onSelect: () => void actions.checkUpdates([s.id]) },
        { label: "Merge with another series…", onSelect: () => setDialog("merge") },
        { label: s.hidden ? "Show in views" : "Hide from views", onSelect: () => void save({ hidden: !s.hidden }, { hidden: !s.hidden }) },
        { kind: "separator" },
        {
          label: "Remove from library",
          danger: true,
          onSelect: () => {
            void actions.remove([s.id]);
            onBack();
          },
        },
      ]),
    );

  const coverMenu = (el: Element) =>
    setMenu(
      menuAtElement(el, [
        { label: "Refresh cover", onSelect: async () => { const r = await sendToWorker<{ ok: boolean; error?: string }>({ type: "cover/refresh", seriesId: s.id }); toast.show(r?.ok ? "Cover updated" : r?.error ?? "Cover could not be downloaded.", { error: !r?.ok }); } },
        { label: "Choose another detected image…", onSelect: () => setDialog("cover"), disabled: !sources.some((x) => x.coverCandidates.length) },
        { label: "Upload local image…", onSelect: () => pickFile(async (blob) => { await setCustomCover(s.id, blob); changed(); toast.show("Cover changed"); }) },
        { label: "Remove custom cover", disabled: !s.userFields.includes("cover"), onSelect: async () => { await removeCustomCover(s.id); changed(); } },
      ]),
    );

  const sm = s.summary;
  const readTime = s.totalReadingTimeMs;

  return (
    <>
      <div className="series-detail">
      <Header title={s.title} onBack={onBack} onMore={moreMenu} />
      {coverStatus?.state === "failed" && <div className="banner" role="status"><span>Cover could not be downloaded.</span><button className="btn sm" onClick={async () => {
        const r = await sendToWorker<{ ok: boolean; error?: string }>({ type: "cover/refresh", seriesId: id });
        toast.show(r?.ok ? "Cover updated" : r?.error ?? "Cover could not be downloaded.", { error: !r?.ok });
        void loadChapters();
      }}>Retry cover</button></div>}
      {coverStatus?.state === "pending" && <p className="section small muted" role="status">Caching cover locally…</p>}
      <div className="detail-layout">
      <div className="detail-head">
        <button className="icon-btn" style={{ width: "auto", height: "auto" }} aria-label="Change cover" onClick={(e) => coverMenu(e.currentTarget)}>
          <Cover coverId={s.coverId} title={s.title} size="lg" />
        </button>
        <h1 style={{ minWidth: 0 }}>{s.title}</h1>
      </div>
      <HandsScene className="detail-art" />

      <div className="detail-actions">
        <div className="row reading-actions">
          {sm.continueKind !== "none" && (
            <button className="btn primary" style={{ flex: 1 }} onClick={(e) => void actions.continueSeries(s, { newTab: e.metaKey || e.ctrlKey ? true : undefined })} onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void actions.continueSeries(s, { newTab: true }); } }}>
              {continueText(s)}{sm.continueLabel ? ` · ${sm.continueLabel}` : ""}
            </button>
          )}
          <button className="btn" onClick={() => setDialog("progress")}>Set progress</button>
        </div>
      </div>

      <section className="detail-progress" aria-label="Reading position">
        <dl className="progress-facts">
          <div><dt>Last completed</dt><dd className="tabular">
            {sm.lastCompletedLabel ? `${sm.lastCompletedLabel} read` : "Nothing read yet"}
            {sm.caughtUp ? " · Caught up" : sm.newCount > 0 ? ` · ${sm.newCount} new` : ""}
          </dd></div>
          <div><dt>Current chapter</dt><dd>{sm.currentLabel ? `${sm.currentLabel}${sm.currentCompleted ? " (read)" : sm.currentProgress ? ` · ${Math.round(sm.currentProgress * 100)}% read` : ""}` : "Not opened yet"}</dd></div>
          <div><dt>Latest known</dt><dd>{sm.latestKnownLabel ?? "Unknown"}{sources.some((x) => x.storyEnded) ? " · story ended" : ""}</dd></div>
          <div><dt>Last read</dt><dd>{s.lastReadAt ? relativeTime(s.lastReadAt) : "Not started"}</dd></div>
        </dl>
      </section>

      <section className="detail-metadata library-metadata stack">
        <h2 className="section-title">Library details</h2>
        <div className="row small" style={{ flexWrap: "wrap", gap: 4 }}>
          <button className="btn sm ghost" onClick={() => setDialog("title")}>Edit title</button>
          {s.userFields.includes("title") && s.detectedTitle && s.detectedTitle !== s.title && (
            <button className="btn sm ghost" title={`Detected: ${s.detectedTitle}`} onClick={async () => { await resetUserField(s.id, "title"); changed(); }}>Use detected title</button>
          )}
        </div>
        {s.alternateTitles.length > 0 && <div className="small muted" style={{ marginTop: 2 }}>Also: {s.alternateTitles.slice(0, 4).join(" · ")}{s.alternateTitles.length > 4 ? ` +${s.alternateTitles.length - 4}` : ""}</div>}
        <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => setDialog("aliases")}>Edit aliases</button>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <label className="sr-only" htmlFor="status">Status</label>
          <select id="status" className="select" value={s.status} onChange={(e) => void actions.setStatus(s, e.target.value as Series["status"])}>
            {SERIES_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
          <label className="sr-only" htmlFor="rating">Rating</label>
          <select id="rating" className="select" value={s.personalRating ?? ""} onChange={(e) => void save({ personalRating: e.target.value === "" ? null : Number(e.target.value) }, { personalRating: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">No rating</option>
            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 10</option>)}
          </select>
          <button className="icon-btn fav-toggle" aria-pressed={s.favorite} aria-label={s.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => void actions.toggleFavorite(s)}>
            <Icon name={s.favorite ? "starFill" : "star"} />
          </button>
        </div>
        <div className="detail-field"><h3>Lists</h3><CollectionMembership seriesId={s.id} /></div>
        <div className="detail-field"><h3>Tags</h3><TagEditor tags={s.tags} suggestions={allTags} onChange={(tags) => void save({ tags }, { tags })} /></div>
        <dl className="kv detail-secondary"><dt>Reading time</dt><dd>{readTime > 0 ? `${formatDuration(readTime)} (active)` : "Not measured yet"}</dd><dt>Tracked since</dt><dd>{shortDate(s.discoveredAt)}</dd></dl>
      </section>

      <details className="panel detail-sources" open>
        <summary>Sources <span className="faint">{sources.length}</span></summary>
        {sources.map((src) => (
          <SourceRow key={src.id} src={src} series={s} canRemove={sources.length > 1} onChanged={changed} onOpenSeries={onOpenSeries} actions={actions} />
        ))}
      </details>

      <details className="panel detail-chapters" open>
        <summary>Chapters <span className="faint">{chapters.length}</span></summary>
        {chapterError && <p role="alert">Chapter history could not be opened. <button className="btn sm" onClick={() => void loadChapters()}>Retry</button></p>}
        <ChapterTimeline series={s} chapters={chapters} actions={actions} onEdit={(c) => setDialog({ chapter: c })} onChanged={() => { changed(); void loadChapters(); }} />
      </details>

      <details className="panel detail-history">
        <summary>Reading history</summary>
        <EventList seriesId={s.id} />
      </details>

      <div className="panel detail-notes">
        <h3 style={{ marginBottom: 6 }}><label htmlFor="notes">Notes</label></h3>
        <NotesField key={s.id} value={s.notes ?? ""} onSave={(notes) => void save({ notes }, { notes: notes || undefined })} />
      </div>
      </div>
      </div>

      {menu && <Menu state={menu} onClose={() => setMenu(null)} />}

      {dialog === "title" && (
        <TextDialog title="Edit title" initial={s.title} onClose={() => setDialog(null)} onSave={(title) => save({ title }, { title })} hint="Your title is kept even when the site shows a different one." />
      )}
      {dialog === "aliases" && (
        <TextDialog title="Alternate titles" initial={s.alternateTitles.join("\n")} multiline onClose={() => setDialog(null)} onSave={(v) => { const alternateTitles = v.split(/\n|;/).map((x) => x.trim()).filter(Boolean); return save({ alternateTitles }, { alternateTitles }); }} hint="One per line. Used for search and duplicate detection." />
      )}
      {dialog === "progress" && (
        <TextDialog
          title="Set reading progress"
          initial={sm.lastCompletedLabel ?? ""}
          hint="Enter a number or full label, e.g. Season 2 Chapter 8. Chapters up to this position are marked read."
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            try {
              await setProgressTo(s.id, v);
              changed();
            } catch (e) {
              toast.show(e instanceof Error ? e.message : "Could not set progress.", { error: true });
            }
          }}
        />
      )}
      {dialog === "cover" && (
        <Dialog title="Choose a detected image" onClose={() => setDialog(null)}>
          <div className="candidates">
            {[...new Set(sources.flatMap((x) => x.coverCandidates))].filter(isSafeHttpUrl).map((u) => (
              <button key={u} aria-label="Use this image as cover" onClick={async () => {
                setDialog(null);
                const r = await sendToWorker<{ ok: boolean; error?: string }>({ type: "cover/refresh", seriesId: s.id, url: u });
                toast.show(r?.ok ? "Cover changed" : r?.error ?? "Cover could not be downloaded.", { error: !r?.ok });
              }}>
                <img src={u} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")} />
              </button>
            ))}
          </div>
          <p className="small faint">Images load directly from the source site. The chosen one is saved on this device.</p>
          <div className="actions"><button className="btn" onClick={() => setDialog(null)}>Cancel</button></div>
        </Dialog>
      )}
      {dialog === "merge" && <MergeDialog series={s} lib={lib} onClose={() => setDialog(null)} onMerged={() => toast.show("Series merged")} />}
      {dialog && typeof dialog === "object" && "chapter" in dialog && (
        <ChapterEditDialog chapter={dialog.chapter} destinations={lib.series.filter((other) => other.id !== s.id && !other.removedAt)} onMoved={onOpenSeries} onClose={() => setDialog(null)} onSaved={() => { changed(); void loadChapters(); }} />
      )}
    </>
  );
}

function Header({ title, onBack, onMore }: { title: string; onBack: () => void; onMore?: (el: Element) => void }) {
  return (
    <div className="topbar">
      <button className="icon-btn" aria-label="Back to library" onClick={onBack}><Icon name="back" /></button>
      <strong className="truncate" style={{ flex: 1 }}>{title}</strong>
      {onMore && <button className="icon-btn" aria-label="More actions" onClick={(e) => onMore(e.currentTarget)}><Icon name="more" /></button>}
    </div>
  );
}

function NotesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      id="notes"
      className="textarea"
      rows={3}
      placeholder="e.g. Wait until Season 3 finishes."
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
    />
  );
}

function TextDialog({ title, initial, hint, multiline, onClose, onSave }: { title: string; initial: string; hint?: string; multiline?: boolean; onClose: () => void; onSave: (v: string) => unknown }) {
  const [v, setV] = useState(initial);
  const submit = async () => {
    if (!v.trim() && !multiline) return;
    await onSave(v.trim());
    onClose();
  };
  return (
    <Dialog title={title} onClose={onClose}>
      {multiline ? (
        <textarea className="textarea" rows={5} aria-label={title} value={v} onChange={(e) => setV(e.target.value)} />
      ) : (
        <input className="input" style={{ width: "100%" }} aria-label={title} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
      )}
      {hint && <p className="small muted">{hint}</p>}
      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void submit()}>Save</button>
      </div>
    </Dialog>
  );
}

function SourceRow({ src, series, canRemove, onChanged, onOpenSeries, actions }: { src: SeriesSource; series: Series; canRemove: boolean; onChanged: () => void; onOpenSeries: (id: string) => void; actions: Actions }) {
  const toast = useToast();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const health = sourceHealth(src);
  const preferred = series.preferredSourceId === src.id || (!series.preferredSourceId && series.sourceIds[0] === src.id);
  return (
    <div className="source">
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <SourceBadge host={src.hostname} />
          {preferred && <span className="badge neutral">Preferred</span>}
          {src.disabled && <span className="badge neutral">Updates off</span>}
        </div>
        <div className="small faint source-hostname">{src.hostname}</div>
        <div className="small">
          {updatesSupported(src) ? <span className={`health ${health}`}>{HEALTH_TEXT[health]}</span> : <span className="health unknown">Update checks aren't available for this site</span>}
          {src.lastCheckedAt && <span className="faint"> · checked {relativeTime(src.lastCheckedAt)}</span>}
        </div>
        {src.lastError && src.consecutiveFailures > 0 && <div className="small faint">{src.lastError}</div>}
        {src.sourceTitle && src.sourceTitle !== series.title && <div className="small faint truncate">Listed as “{src.sourceTitle}”</div>}
      </div>
      <div className="row" style={{ gap: 2 }}>
        <button className="btn sm" onClick={() => void actions.continueSeries(series, { url: src.seriesUrl, newTab: true })}>Open</button>
        <button className="icon-btn" aria-label={`More actions for ${src.hostname}`} onClick={(e) => setMenu(menuAtElement(e.currentTarget, [
          { label: "Make preferred source", disabled: preferred, onSelect: async () => { await editSeries(series.id, { preferredSourceId: src.id }); onChanged(); } },
          { label: "Check for new chapters", onSelect: () => void actions.checkUpdates([series.id]) },
          { label: src.disabled ? "Enable update checks" : "Disable update checks", onSelect: async () => { await updateSource(src.id, { disabled: !src.disabled }); onChanged(); } },
          { kind: "separator" },
          { label: "Split into separate series", disabled: !canRemove, onSelect: async () => { try { const id = await splitSource(src.id); onChanged(); if (id) { toast.show("Split into a new series"); onOpenSeries(id); } } catch (e) { toast.show(e instanceof Error ? e.message : "Could not split.", { error: true }); } } },
          { label: "Remove source (keep progress)", danger: true, disabled: !canRemove, onSelect: async () => { if (!confirm(`Remove ${src.hostname}? Chapter progress will be kept.`)) return; try { await removeSource(src.id); onChanged(); toast.show(`Removed ${src.hostname}`); } catch (e) { toast.show(e instanceof Error ? e.message : "Could not remove.", { error: true }); } } },
        ]))}>
          <Icon name="more" />
        </button>
      </div>
      {menu && <Menu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function ChapterTimeline({ series, chapters, actions, onEdit, onChanged }: { series: Series; chapters: Chapter[]; actions: Actions; onEdit: (c: Chapter) => void; onChanged: () => void }) {
  const [limit, setLimit] = useState(CHAPTER_PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const desc = useMemo(() => [...chapters].reverse(), [chapters]);
  if (!chapters.length) return <p className="muted small">No chapters known yet. Open a chapter or the series page and they appear here.</p>;

  const bulk = async (read: boolean) => {
    await markChapters(series.id, [...selected], read);
    setSelected(new Set());
    onChanged();
  };

  return (
    <>
      {selected.size > 0 && (
        <div className="row chapter-selection" style={{ marginBottom: 6 }}>
          <span className="small">{selected.size} selected</span>
          <button className="btn sm" onClick={() => void bulk(true)}>Mark read</button>
          <button className="btn sm" onClick={() => void bulk(false)}>Mark unread</button>
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <ul className="chapters">
        {desc.slice(0, limit).map((c) => {
          const state = c.completedAt ? "done" : c.maxProgress > 0.02 || c.lastOpenedAt ? "part" : "";
          const date = c.completedAt ?? c.lastOpenedAt;
          return (
            <li key={c.id}>
              <input type="checkbox" aria-label={`Select ${c.chapterLabel}`} checked={selected.has(c.id)} onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(c.id);
                else next.delete(c.id);
                setSelected(next);
              }} />
              <span className={`state ${state}`} aria-label={c.completedAt ? "Read" : state ? "Started" : "Unread"}>{c.completedAt ? "✓" : state ? "◐" : "·"}</span>
              <button className="chapter-link" onClick={() => void actions.continueSeries(series, { url: c.url })} title={c.url}>
                <span>{c.chapterLabel}</span>
                <span className="chapter-context">{series.currentChapterId === c.id ? "Current · " : ""}{c.completedAt ? "Read" : c.lastOpenedAt ? `${Math.round(c.maxProgress * 100)}% read` : c.inferred ? "Unconfirmed link" : "Not opened"}</span>
              </button>
              <span className="faint tabular">{date ? shortDate(date) : ""}</span>
              <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label={`Actions for ${c.chapterLabel}`} onClick={(e) => setMenu(menuAtElement(e.currentTarget, [
                { label: "Open", onSelect: () => void actions.continueSeries(series, { url: c.url }) },
                { label: c.completedAt ? "Mark unread" : "Mark read", onSelect: async () => { await markChapters(series.id, [c.id], !c.completedAt); onChanged(); } },
                { label: "Mark all up to here read", disabled: c.ordinal === undefined, onSelect: async () => { await markReadUpTo(series.id, c.id); onChanged(); } },
                { label: "Edit label / number…", onSelect: () => onEdit(c) },
                { kind: "separator" },
                { label: "Delete chapter record", danger: true, disabled: !!c.lastOpenedAt, onSelect: async () => { if (!confirm(`Delete ${c.chapterLabel}?`)) return; await deleteChapter(c.id); onChanged(); } },
              ]))}>
                <Icon name="more" />
              </button>
            </li>
          );
        })}
      </ul>
      {desc.length > limit && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setLimit((l) => l + CHAPTER_PAGE)}>Show {Math.min(CHAPTER_PAGE, desc.length - limit)} more</button>}
      {menu && <Menu state={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

function ChapterEditDialog({ chapter, onClose, onSaved, destinations, onMoved }: { chapter: Chapter; onClose: () => void; onSaved: () => void; destinations: Series[]; onMoved: (id: string) => void }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState(chapter.chapterLabel);
  const [num, setNum] = useState(chapter.ordinal !== undefined ? String(chapter.chapterNumber ?? chapter.ordinal) : "");
  return (
    <Dialog title="Edit chapter" onClose={() => { if (!busy) onClose(); }}>
      <div className="stack">
        <label className="stack" style={{ gap: 4 }}>
          <span className="small muted">Label</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="small muted">Number used for ordering (blank for specials)</span>
          <input className="input" inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value)} />
        </label>
      </div>
      {destinations.length > 0 && <div className="stack" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <label className="stack"><span>Move to another series</span><select className="select" value={target} disabled={busy} onChange={(e) => { setTarget(e.target.value); setError(undefined); }}><option value="">Choose an existing series</option>{destinations.map((series) => <option key={series.id} value={series.id}>{series.title}</option>)}</select></label>
        {target && <><p className="small muted" style={{ margin: 0 }}>Move {chapter.chapterLabel} to “{destinations.find((series) => series.id === target)?.title}”? Its progress and reading history are preserved. This corrects its series association for future detection. Unsaved label changes are not included.</p><button className="btn" disabled={busy} onClick={async () => {
          setBusy(true); setError(undefined);
          try {
            await moveChapter(chapter.id, target);
            publish({ type: "library-changed", seriesIds: [chapter.seriesId, target] });
            onSaved(); onClose(); onMoved(target);
          } catch (err) { setError(err instanceof Error ? err.message : "Could not move this chapter."); }
          finally { setBusy(false); }
        }}>{busy ? "Moving…" : "Move chapter"}</button></>}
      </div>}
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      <div className="actions">
        <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={busy || !label.trim() || (num.trim() !== "" && !Number.isFinite(Number(num)))}
          onClick={async () => {
            const original = String(chapter.chapterNumber ?? chapter.ordinal ?? "");
            const n = num.trim() === "" ? null : Number(num.trim());
            const numberChanged = num.trim() !== original && (n === null || Number.isFinite(n));
            setBusy(true); setError(undefined);
            try { await editChapter(chapter.id, {
              label: label !== chapter.chapterLabel ? label : undefined,
              number: numberChanged ? n : undefined,
            });
            onSaved();
            onClose(); } catch (err) { setError(err instanceof Error ? err.message : "Could not save this chapter."); } finally { setBusy(false); }
          }}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}

function MergeDialog({ series, lib, onClose, onMerged }: { series: Series; lib: ReturnType<typeof useLibrary>; onClose: () => void; onMerged: () => void }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Series>();
  const candidates = useMemo(() => {
    const others = lib.series.filter((x) => x.id !== series.id);
    if (!q.trim()) return others.filter((x) => x.titleKeys.some((k) => series.titleKeys.includes(k))).slice(0, 8);
    const entries = others.map((x) => buildSearchEntry(x, lib.sourcesBySeries.get(x.id)));
    return search(entries, q, 8).map((r) => lib.byId.get(r.id)).filter((x): x is Series => !!x);
  }, [q, lib, series]);

  return (
    <Dialog title={`Merge into “${series.title}”`} onClose={onClose}>
      {!pick ? (
        <>
          <input className="input" style={{ width: "100%" }} placeholder="Find the other series…" aria-label="Find series to merge" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="events" style={{ marginTop: 6 }}>
            {candidates.map((c) => (
              <li key={c.id}>
                <button className="btn ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => setPick(c)}>
                  <span className="truncate">{c.title}</span>
                  <span className="faint small">{(lib.sourcesBySeries.get(c.id) ?? []).map((x) => x.hostname).join(", ")}</span>
                </button>
              </li>
            ))}
            {!candidates.length && <li className="muted small">No matching series.</li>}
          </ul>
        </>
      ) : (
        <p style={{ marginTop: 0 }}>
          “{pick.title}” will be merged into “{series.title}”. All sources, chapters, history, notes, tags and progress are kept. You can split sources apart later.
        </p>
      )}
      <div className="actions">
        <button className="btn" onClick={pick ? () => setPick(undefined) : onClose}>{pick ? "Back" : "Cancel"}</button>
        {pick && (
          <button
            className="btn primary"
            onClick={async () => {
              await mergeSeries(series.id, pick.id);
              publish({ type: "library-changed" });
              onMerged();
              onClose();
            }}
          >
            Merge
          </button>
        )}
      </div>
    </Dialog>
  );
}

/** Opens a file picker and returns a resized local cover image. */
function pickFile(onPicked: (asset: { blob: Blob; mimeType: string; width?: number; height?: number; origin: "custom" }) => void | Promise<void>) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 360 / bmp.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.88));
    await onPicked({ blob: blob ?? file, mimeType: blob?.type ?? file.type, width: canvas.width, height: canvas.height, origin: "custom" });
  };
  input.click();
}
