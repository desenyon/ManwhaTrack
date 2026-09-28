import { useEffect, useState } from "react";
import { allChapters } from "../../storage/repositories/chapters";
import { allEvents } from "../../storage/repositories/history";
import { listSeries } from "../../storage/repositories/series";
import { listSources } from "../../storage/repositories/sources";
import { computeStats, type ReadingStats } from "../../shared/utils/stats";
import { formatDuration, relativeTime, shortDate } from "../../shared/utils/format";

function Bars({ data, label, fmt }: { data: { t: number; count: number }[]; label: string; fmt: (t: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((a, d) => a + d.count, 0);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="small muted" style={{ marginBottom: 4 }}>{label} · {total} total</figcaption>
      <div className="bars" role="img" aria-label={`${label}: ${data.map((d) => `${fmt(d.t)} ${d.count}`).join(", ")}`}>
        {data.map((d) => (
          <div key={d.t} style={{ height: `${(d.count / max) * 100}%` }} title={`${fmt(d.t)}: ${d.count} chapter${d.count === 1 ? "" : "s"}`} />
        ))}
      </div>
      <div className="bars-axis"><span>{fmt(data[0]?.t ?? 0)}</span><span>{fmt(data[data.length - 1]?.t ?? 0)}</span></div>
    </figure>
  );
}

export function StatsSection() {
  const [stats, setStats] = useState<ReadingStats>();
  useEffect(() => {
    void Promise.all([listSeries(), allChapters(), allEvents(), listSources()]).then(([s, c, e, src]) => setStats(computeStats(s, c, e, src)));
  }, []);
  if (!stats) return <h1>Statistics</h1>;
  return (
    <>
      <h1>Statistics</h1>
      <p className="lead">Computed on this device from what ManwhaTrack recorded.</p>
      <dl className="facts">
        <dt>Chapters read</dt>
        <dd>{stats.chaptersRead}</dd>
        <dt>Series started</dt>
        <dd>{stats.seriesStarted}</dd>
        <dt>Series completed</dt>
        <dd>{stats.seriesCompleted}</dd>
        <dt>Measured reading time</dt>
        <dd>{stats.measuredReadingMs ? formatDuration(stats.measuredReadingMs) : "—"}</dd>
      </dl>
      <p className="small faint">Reading time only counts while a chapter tab is visible and you're active on it, so it undercounts rather than overcounts.</p>

      <h2>Chapters finished</h2>
      <div className="stack" style={{ gap: 18 }}>
        <Bars data={stats.byDay.map((d) => ({ t: d.day, count: d.count }))} label="Last 30 days" fmt={(t) => shortDate(t)} />
        <Bars data={stats.byWeek.map((d) => ({ t: d.week, count: d.count }))} label="Last 12 weeks" fmt={(t) => `wk of ${shortDate(t)}`} />
      </div>

      <h2>Most read</h2>
      {stats.mostRead.length ? (
        <table className="t">
          <tbody>{stats.mostRead.map((m) => <tr key={m.series.id}><td>{m.series.title}</td><td className="tabular" style={{ textAlign: "right" }}>{m.chapters} chapter{m.chapters === 1 ? "" : "s"}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted small">No finished chapters yet.</p>}

      <h2>Recently active sources</h2>
      {stats.activeSources.length ? (
        <table className="t">
          <tbody>{stats.activeSources.map((s) => <tr key={s.hostname}><td>{s.hostname}</td><td className="muted">{s.events} event{s.events === 1 ? "" : "s"}</td><td className="muted" style={{ textAlign: "right" }}>{relativeTime(s.lastActive)}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted small">No reading activity in the last 30 days.</p>}
    </>
  );
}
