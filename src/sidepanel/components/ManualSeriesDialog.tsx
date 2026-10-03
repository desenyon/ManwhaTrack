import { useState } from "react";
import { SERIES_STATUSES, type Series, type SeriesStatus } from "../../shared/types/models";
import { STATUS_LABEL } from "../../shared/utils/library";
import { isSafeHttpUrl } from "../../detection/normalization/url";
import { addManualSeries } from "../../storage/manual";
import { publish } from "../../shared/bus";
import { Dialog } from "../../ui/Menu";

export function ManualSeriesDialog({ initial, onClose, onAdded }: { initial: { title?: string; url?: string }; onClose: () => void; onAdded: (series: Series) => void | Promise<void> }) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [url, setUrl] = useState(initial.url ?? "");
  const [status, setStatus] = useState<SeriesStatus>("planning");
  const [format, setFormat] = useState<"manhwa" | "novel">("manhwa");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const valid = title.trim().length > 0 && title.trim().length <= 200 && isSafeHttpUrl(url.trim());
  return (
    <Dialog title="Track a series manually" onClose={() => { if (!busy) onClose(); }}>
      <p className="small muted">Use this fallback when automatic detection misses a series. Enter its actual source page address.</p>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || busy) return;
        setBusy(true); setError(undefined);
        try {
          const series = await addManualSeries({ title, url, status, format });
          publish({ type: "library-changed", seriesIds: [series.id] });
          await onAdded(series);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save this series.");
        } finally { setBusy(false); }
      }}>
        <label className="stack"><span>Title</span><input className="input" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} disabled={busy} /></label>
        <label className="stack"><span>Source page address</span><input className="input" type="url" value={url} placeholder="https://…" required onChange={(e) => setUrl(e.target.value)} disabled={busy} aria-describedby="manual-url-help" /></label>
        <p id="manual-url-help" className="small muted" style={{ margin: 0 }}>Only http and https addresses are accepted. Your library stays on this device.</p>
        <label className="stack"><span>Status</span><select className="select" value={status} onChange={(e) => setStatus(e.target.value as SeriesStatus)} disabled={busy}>{SERIES_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}</select></label>
        <label className="stack"><span>Format</span><select className="select" value={format} onChange={e => setFormat(e.target.value as "manhwa" | "novel")} disabled={busy}><option value="manhwa">Manhwa / comic</option><option value="novel">Web novel</option></select></label>
        {error && <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}
        <div className="actions"><button className="btn" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} type="submit">{busy ? "Saving…" : "Track series"}</button></div>
      </form>
    </Dialog>
  );
}
