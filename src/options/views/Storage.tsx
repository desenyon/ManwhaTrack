import { useEffect, useState } from "react";
import { clearDetectedCovers, clearUnusedCovers, coverUsage } from "../../storage/repositories/covers";
import { clearAllHistory } from "../../storage/repositories/history";
import { listSeries } from "../../storage/repositories/series";
import { closeDb, DB_NAME } from "../../storage/db";
import { sendToWorker } from "../../shared/messages";
import { publish } from "../../shared/bus";
import { formatBytes } from "../../shared/utils/format";
import { Dialog } from "../../ui/Menu";
import { useToast } from "../../ui/toasts";

export function StorageSection() {
  const toast = useToast();
  const [usage, setUsage] = useState<{ total?: number; covers: number; coverCount: number; series: number }>();
  const [confirm, setConfirm] = useState<null | "history" | "covers" | "reset">(null);
  const [resetText, setResetText] = useState("");
  const [rebuilding, setRebuilding] = useState<string>();

  const load = async () => {
    const [est, cu, series] = await Promise.all([navigator.storage?.estimate?.().catch(() => undefined), coverUsage(), listSeries()]);
    setUsage({ total: est?.usage, covers: cu.bytes, coverCount: cu.count, series: series.length });
  };
  useEffect(() => {
    void load();
  }, []);

  const rebuild = async () => {
    const missing = (await listSeries()).filter((s) => !s.coverId);
    let ok = 0;
    for (let i = 0; i < missing.length; i++) {
      setRebuilding(`${i + 1} / ${missing.length}`);
      const r = await sendToWorker<{ ok: boolean }>({ type: "cover/refresh", seriesId: missing[i]!.id });
      if (r?.ok) ok++;
    }
    setRebuilding(undefined);
    toast.show(missing.length ? `Downloaded ${ok} of ${missing.length} missing covers` : "Every series already has a cover");
    void load();
  };

  return (
    <>
      <h1>Storage & privacy</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <strong>Your library is stored on this device.</strong>
        <p style={{ margin: "6px 0 0" }} className="muted">
          ManwhaTrack has no account and no server. It contacts only the reading sites you visit: to read the page you opened, to download a series cover, and — if enabled — to check tracked series pages for new chapters. Reading analytics stay on this device. There is no usage telemetry or external error reporting.
        </p>
      </div>

      <dl className="facts">
        <dt>Tracked series</dt>
        <dd>{usage?.series ?? "…"}</dd>
        <dt>Storage used (estimate)</dt>
        <dd>{usage?.total !== undefined ? formatBytes(usage.total) : "…"}</dd>
        <dt>Cover cache</dt>
        <dd>{usage ? `${formatBytes(usage.covers)} · ${usage.coverCount} image${usage.coverCount === 1 ? "" : "s"}` : "…"}</dd>
        <dt>Metadata and history</dt>
        <dd>{usage?.total !== undefined ? formatBytes(Math.max(0, usage.total - usage.covers)) : "…"}</dd>
      </dl>

      <h2>Covers</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn" onClick={async () => { const n = await clearUnusedCovers(); toast.show(`Removed ${n} unused cover${n === 1 ? "" : "s"}`); void load(); }}>Clear unused covers</button>
        <button className="btn" disabled={!!rebuilding} onClick={() => void rebuild()}>{rebuilding ? `Downloading ${rebuilding}…` : "Rebuild cover cache"}</button>
        <button className="btn danger" onClick={() => setConfirm("covers")}>Clear cached covers</button>
      </div>
      <p className="small muted">Clearing cached covers keeps every series; covers download again when you revisit them or rebuild the cache. Uploaded covers are kept.</p>

      <h2>History and reset</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn danger" onClick={() => setConfirm("history")}>Clear reading history</button>
        <button className="btn danger" onClick={() => setConfirm("reset")}>Reset extension…</button>
      </div>

      {confirm === "covers" && (
        <Dialog title="Clear cached covers?" onClose={() => setConfirm(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Downloaded covers are removed. Series stay; covers return when pages are revisited.</p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn danger solid" onClick={async () => { await clearDetectedCovers(); publish({ type: "library-changed" }); setConfirm(null); void load(); }}>Clear covers</button>
          </div>
        </Dialog>
      )}
      {confirm === "history" && (
        <Dialog title="Clear all reading history?" onClose={() => setConfirm(null)}>
          <p className="muted" style={{ marginTop: 0 }}>The event log and dated analytics are cleared. Library, chapter progress and Continue positions are kept.</p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn danger solid" onClick={async () => { await clearAllHistory(); publish({ type: "library-changed" }); setConfirm(null); toast.show("Reading history cleared"); }}>Clear history</button>
          </div>
        </Dialog>
      )}
      {confirm === "reset" && (
        <Dialog title="Reset ManwhaTrack?" onClose={() => setConfirm(null)}>
          <p style={{ marginTop: 0 }}>This deletes the entire library, progress, history, covers and settings from this device. Export a backup first if you might want it back.</p>
          <label className="stack small" style={{ gap: 4 }}>
            Type RESET to confirm
            <input className="input" value={resetText} onChange={(e) => setResetText(e.target.value)} />
          </label>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className="btn danger solid"
              disabled={resetText !== "RESET"}
              onClick={async () => {
                await closeDb();
                await new Promise<void>((resolve) => {
                  const r = indexedDB.deleteDatabase(DB_NAME);
                  r.onsuccess = r.onerror = r.onblocked = () => resolve();
                });
                await chrome.storage.local.clear();
                await chrome.storage.session.clear();
                chrome.runtime.reload();
              }}
            >
              Delete everything
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
