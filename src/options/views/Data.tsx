// Backup: export (metadata / full with covers / CSV), validated import with preview and
// conflict handling, and restore of recently removed series.

import { useEffect, useRef, useState } from "react";
import type { Series } from "../../shared/types/models";
import { applyImport, exportLibrary, parseBackup, previewImport, toCsv, type BackupFile, type ConflictMode, type ImportPreview } from "../../storage/backup";
import { listSeries, purgeSeriesNow, restoreSeries } from "../../storage/repositories/series";
import { publish } from "../../shared/bus";
import { relativeTime } from "../../shared/utils/format";
import { downloadFile } from "../../ui/download";
import { useToast } from "../../ui/toasts";
import { Dialog } from "../../ui/Menu";

const stamp = () => new Date().toISOString().slice(0, 10);

export function DataSection() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<{ file: BackupFile; preview: ImportPreview } | null>(null);
  const [error, setError] = useState<string>();
  const [importWarning, setImportWarning] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [mode, setMode] = useState<ConflictMode>("merge");
  const [importSettings, setImportSettings] = useState(false);
  const [removed, setRemoved] = useState<Series[]>([]);
  const [confirmPurge, setConfirmPurge] = useState<Series | null>(null);
  const selection = useRef(0);

  const loadRemoved = async () => setRemoved((await listSeries({ includeRemoved: true })).filter((s) => s.removedAt).sort((a, b) => b.removedAt! - a.removedAt!));
  useEffect(() => {
    void loadRemoved();
    return () => { selection.current++; };
  }, []);

  const doExport = async (kind: "json" | "full" | "csv") => {
    setBusy(true);
    try {
      const file = await exportLibrary({ includeCovers: kind === "full" });
      if (kind === "csv") downloadFile(`manwhatrack-${stamp()}.csv`, toCsv(file), "text/csv");
      else downloadFile(`manwhatrack-${kind === "full" ? "full-" : ""}${stamp()}.json`, JSON.stringify(file, null, kind === "full" ? 0 : 2), "application/json");
      toast.show(`Exported ${file.series.length} series`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Export failed.", { error: true });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    const request = ++selection.current;
    setParsed(null);
    setError(undefined);
    setImportWarning(undefined);
    setFileName(f?.name);
    if (!f) return;
    if (f.size > 500_000_000) return setError("Import file is too large.");
    try {
      const res = parseBackup(await f.text());
      if (request !== selection.current) return;
      if (!res.ok) return setError(res.error);
      const preview = await previewImport(res.file, res.invalid);
      if (request === selection.current) setParsed({ file: res.file, preview });
    } catch {
      if (request === selection.current) setError("The backup file could not be opened. Your library has not changed.");
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const r = await applyImport(parsed.file, mode, { importSettings });
      setImportWarning(r.settingsWarning);
      publish({ type: "library-changed" });
      toast.show(r.settingsWarning ?? `Imported: ${r.added} added, ${r.merged} updated, ${r.skipped} kept as they were`);
      setParsed(null);
      setFileName(undefined);
    } catch (e) {
      // The import runs in one transaction; a failure leaves the library unchanged.
      toast.show(`Import failed; nothing was changed. ${e instanceof Error ? e.message : ""}`, { error: true });
    } finally {
      setBusy(false);
    }
  };

  const p = parsed?.preview;
  return (
    <>
      <h1>Import & export</h1>
      <p className="lead">There is no account or cloud copy. Export regularly if your library matters to you.</p>

      <h2>Export</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn primary" disabled={busy} onClick={() => void doExport("json")}>Export library (JSON)</button>
        <button className="btn" disabled={busy} onClick={() => void doExport("full")}>Complete backup with covers</button>
        <button className="btn" disabled={busy} onClick={() => void doExport("csv")}>Export CSV</button>
      </div>
      <p className="small muted">JSON contains everything needed to restore: series, sources, chapters, reading positions, history, lists, tags, queue and settings. CSV is a readable summary.</p>

      <h2>Import</h2>
      {importWarning && <p role="status">{importWarning}</p>}
      <input type="file" disabled={busy} accept="application/json,.json" aria-label="Choose a ManwhaTrack backup file" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void onFile(file); }} />
      {fileName && <p className="small muted" style={{ overflowWrap: "anywhere" }}>Selected backup: {fileName}</p>}
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {p && (
        <div className="card stack" style={{ marginTop: 12 }}>
          <strong>Preview</strong>
          <div className="small">
            {p.series} series ({p.newSeries} new, {p.duplicates.length} already in your library) · {p.chapters} chapters · {p.events} history events
            {p.covers ? ` · ${p.covers} covers` : ""}
            {p.collections ? ` · ${p.collections} lists (${p.existingCollections} already exist)` : ""}
            {p.exportedAt ? ` · exported ${relativeTime(Date.parse(p.exportedAt))}` : ""}
          </div>
          {p.invalid > 0 && <div className="small" style={{ color: "var(--warn)" }}>{p.invalid} invalid records will be skipped.</div>}
          {(p.duplicates.length > 0 || p.existingCollections > 0) && (
            <>
              {p.duplicates.length > 0 && <details className="small">
                <summary>Matches with existing series</summary>
                <ul>{p.duplicates.slice(0, 50).map((d, i) => <li key={i}>{d.imported}{d.imported !== d.existing ? ` → ${d.existing}` : ""}</li>)}</ul>
              </details>}
              <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
                <legend className="small muted">When a series or list already exists</legend>
                <label className="check"><input type="radio" name="mode" checked={mode === "merge"} onChange={() => setMode("merge")} /> Merge (combine reading records, lists, tags and notes)</label>
                <label className="check"><input type="radio" name="mode" checked={mode === "keep"} onChange={() => setMode("keep")} /> Keep existing</label>
                <label className="check"><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Use imported</label>
              </fieldset>
            </>
          )}
          <label className="check small"><input type="checkbox" checked={importSettings} onChange={(e) => setImportSettings(e.target.checked)} /> Also import settings and site rules</label>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => void doImport()}>Import</button>
            <button className="btn" disabled={busy} onClick={() => { selection.current++; setParsed(null); setFileName(undefined); }}>Cancel</button>
          </div>
        </div>
      )}

      <h2>Recently removed</h2>
      {removed.length === 0 ? (
        <p className="small muted">Nothing removed. Removed series can be restored here for 30 days.</p>
      ) : (
        <table className="t">
          <tbody>
            {removed.map((s) => (
              <tr key={s.id}>
                <td>{s.title}</td>
                <td className="muted">removed {relativeTime(s.removedAt)}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn sm" onClick={async () => { await restoreSeries([s.id]); publish({ type: "library-changed" }); void loadRemoved(); }}>Restore</button>{" "}
                  <button className="btn sm danger" onClick={() => setConfirmPurge(s)}>Delete permanently</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirmPurge && (
        <Dialog title={`Delete “${confirmPurge.title}” permanently?`} onClose={() => setConfirmPurge(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Its sources, chapter progress and history are deleted from this device. This cannot be undone.</p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirmPurge(null)}>Cancel</button>
            <button className="btn danger solid" onClick={async () => { await purgeSeriesNow([confirmPurge.id]); setConfirmPurge(null); void loadRemoved(); }}>Delete permanently</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
