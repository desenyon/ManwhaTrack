// Source health overview. Failing sources are never deleted automatically.

import { useEffect, useMemo, useState } from "react";
import type { Series, SeriesSource, SourceHealth } from "../../shared/types/models";
import { listSeries } from "../../storage/repositories/series";
import { listSources, sourceHealth, updateSource } from "../../storage/repositories/sources";
import { sendToWorker } from "../../shared/messages";
import { relativeTime } from "../../shared/utils/format";
import { subscribe } from "../../shared/bus";
import { useToast } from "../../ui/toasts";
import { Toggle } from "./General";

const ORDER: SourceHealth[] = ["failing", "stale", "unknown", "healthy"];
const LABEL: Record<SourceHealth, string> = { failing: "Not responding", stale: "Stale", unknown: "Not checked yet", healthy: "Healthy" };

export function SourcesSection() {
  const toast = useToast();
  const [data, setData] = useState<{ sources: SeriesSource[]; series: Map<string, Series> }>();
  const [filter, setFilter] = useState<SourceHealth | "all">("all");

  const load = async () => {
    const [sources, series] = await Promise.all([listSources(), listSeries()]);
    setData({ sources: sources.filter((s) => series.some((x) => x.id === s.seriesId)), series: new Map(series.map((s) => [s.id, s])) });
  };
  useEffect(() => {
    void load();
    return subscribe((m) => m.type === "library-changed" && void load());
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.sources
      .map((s) => ({ s, h: sourceHealth(s) }))
      .filter((x) => filter === "all" || x.h === filter)
      .sort((a, b) => ORDER.indexOf(a.h) - ORDER.indexOf(b.h) || a.s.hostname.localeCompare(b.s.hostname));
  }, [data, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of data?.sources ?? []) c[sourceHealth(s)] = (c[sourceHealth(s)] ?? 0) + 1;
    return c;
  }, [data]);

  return (
    <>
      <h1>Sources</h1>
      <p className="lead">How each tracked site responded to update checks. A source that stops responding is kept, along with all its progress.</p>
      <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All {data?.sources.length ?? 0}</button>
        {ORDER.map((h) => (
          <button key={h} className="chip" aria-pressed={filter === h} onClick={() => setFilter(h)}>{LABEL[h]} {counts[h] ?? 0}</button>
        ))}
        <span className="spacer" />
        <button className="btn" onClick={async () => { toast.show("Checking…"); const r = await sendToWorker<{ checked: number }>({ type: "updates/check" }); toast.show(`Checked ${r?.checked ?? 0} sources`); }}>Check now</button>
      </div>
      <table className="t sources-table">
        <thead><tr><th>Site</th><th>Series</th><th>Health</th><th>Last check</th><th>Updates</th></tr></thead>
        <tbody>
          {rows.map(({ s, h }) => (
            <tr key={s.id}>
              <td data-label="Site">{s.hostname}</td>
              <td data-label="Series">{data?.series.get(s.seriesId)?.title}</td>
              <td data-label="Health">
                <span className={`health ${h}`}>{LABEL[h]}</span>
                {s.lastError && s.consecutiveFailures > 0 && <div className="faint">{s.lastError}</div>}
              </td>
              <td className="muted" data-label="Last check">{relativeTime(s.lastCheckedAt)}</td>
              <td data-label="Updates">
                <Toggle label={`Check ${s.hostname} for updates`} checked={!s.disabled} onChange={v => { void updateSource(s.id, { disabled: !v }).then(load).catch(() => toast.show("Could not save this source preference.", { error: true })); }} />
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="muted" data-label="Sources">No sources.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
