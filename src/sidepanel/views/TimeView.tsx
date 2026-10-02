import { useEffect, useMemo, useState } from "react";
import type { Chapter, Series } from "../../shared/types/models";
import { allChapters } from "../../storage/repositories/chapters";
import { subscribe } from "../../shared/bus";
import { formatReadingClock } from "../../shared/utils/reading-time";
import { Icon } from "../../ui/icons";
import { ReadingTimer } from "../components/ReadingTimer";

export function TimeView({ series, onBack, onOpenSeries }: { series: Series[]; onBack: () => void; onOpenSeries: (id: string) => void }) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [limit, setLimit] = useState(50);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try { const data = await allChapters(); if (!cancelled) { setChapters(data); setLoaded(true); setError(false); } }
      catch { if (!cancelled) setError(true); }
    };
    void load();
    const off = subscribe(m => { if (m.type === "library-changed") void load(); });
    return () => { cancelled = true; off(); };
  }, []);
  const measured = useMemo(() => {
    const live = new Set(series.filter(s => !s.removedAt).map(s => s.id));
    return chapters.filter(c => live.has(c.seriesId) && c.readingTimeMs > 0);
  }, [chapters, series]);
  const rows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of measured) totals.set(c.seriesId, (totals.get(c.seriesId) ?? 0) + c.readingTimeMs);
    return series.flatMap(s => totals.has(s.id) ? [{ series: s, ms: totals.get(s.id)! }] : []).sort((a, b) => b.ms - a.ms);
  }, [series, measured]);
  const total = rows.reduce((sum, r) => sum + r.ms, 0);
  const selectedChapters = measured.filter(c => c.seriesId === selected).sort((a, b) => b.readingTimeMs - a.readingTimeMs);
  return <div className="time-view">
    <div className="topbar"><button className="icon-btn" aria-label="Back to library" onClick={onBack}><Icon name="back" /></button><strong>Time tracking</strong></div>
    <div className="time-content">
      <span className="section-title">Recorded on this device</span><h1>Reading time.</h1>
      <p className="muted">Only active reading counts. The timer pauses outside the reader, in the background, or after 90 seconds without activity.</p>
      <ReadingTimer series={series} />
      <dl className="time-totals"><div><dt>All-time reading</dt><dd data-testid="total-reading-time">{loaded && !error ? formatReadingClock(total) : "—"}</dd></div><div><dt>Chapters with measured time</dt><dd>{loaded && !error ? measured.length : "—"}</dd></div></dl>
      {error ? <p role="alert">Recorded reading time could not be opened. <button className="btn sm" onClick={() => location.reload()}>Retry</button></p> : !loaded ? <p role="status">Opening recorded time…</p> : !rows.length ? <div className="empty"><h2>No reading time recorded yet.</h2><p>Open a tracked chapter and keep its reader in view.</p></div> : <>
        <h2 className="section-title">Time by series</h2>
        <div className="time-breakdown">{rows.slice(0, limit).map(r => <div className="time-series" key={r.series.id}>
          <button className="time-series-name" aria-expanded={selected === r.series.id} onClick={() => setSelected(selected === r.series.id ? undefined : r.series.id)}><span className="truncate">{r.series.title}</span><Icon name={selected === r.series.id ? "up" : "down"} /></button>
          <span className="reading-clock">{formatReadingClock(r.ms)}</span><span className="time-meter" aria-hidden="true"><i style={{ width: `${r.ms / rows[0]!.ms * 100}%` }} /></span>
          {selected === r.series.id && <div className="time-chapters"><button className="btn sm" onClick={() => onOpenSeries(r.series.id)}>Series details</button>{selectedChapters.slice(0, 100).map(c => <div key={c.id}><span>{c.chapterLabel}</span><span className="reading-clock">{formatReadingClock(c.readingTimeMs)}</span></div>)}{selectedChapters.length > 100 && <p className="small muted">Showing the 100 chapters with most recorded time.</p>}</div>}
        </div>)}</div>
        {rows.length > limit && <button className="btn" onClick={() => setLimit(n => n + 50)}>Show 50 more</button>}
      </>}
    </div>
  </div>;
}
