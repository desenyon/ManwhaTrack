// Multi-select actions. Deletion needs an explicit confirmation naming the count, then offers Undo.

import { useState } from "react";
import type { Series, SeriesStatus } from "../../shared/types/models";
import { SERIES_STATUSES } from "../../shared/types/models";
import { STATUS_LABEL } from "../../shared/utils/library";
import { batchEdit } from "../../storage/repositories/series";
import { setProgressTo } from "../../storage/repositories/chapters";
import { exportLibrary } from "../../storage/backup";
import { publish } from "../../shared/bus";
import { CollectionAssignmentDialog } from "./Collections";
import { Dialog } from "../../ui/Menu";
import { useToast } from "../../ui/toasts";
import { downloadFile } from "../../ui/download";

export function BatchBar({ selected, onClear, onRemove }: { selected: Series[]; onClear: () => void; onRemove: (ids: string[]) => void }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<null | "add-tag" | "remove-tag" | "progress" | "delete" | "collections">(null);
  const [value, setValue] = useState("");
  const ids = selected.map((s) => s.id);

  const apply = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      publish({ type: "library-changed", seriesIds: ids });
      toast.show(done);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not apply the change.", { error: true });
    }
  };

  const close = () => {
    setDialog(null);
    setValue("");
  };

  return (
    <div className="batchbar" role="toolbar" aria-label="Selection actions">
      <strong className="tabular">{selected.length} selected</strong>
      <select
        className="select"
        aria-label="Set status"
        value=""
        disabled={!selected.length}
        onChange={(e) => {
          const st = e.target.value as SeriesStatus;
          if (st) void apply(() => batchEdit(ids, () => ({ status: st })), `Status set to ${STATUS_LABEL[st]}`);
        }}
      >
        <option value="">Status…</option>
        {SERIES_STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </select>
      <button className="btn sm" disabled={!selected.length} onClick={() => setDialog("collections")}>Assign to lists</button>
      <button className="btn sm" disabled={!selected.length} onClick={() => setDialog("add-tag")}>Add tag</button>
      <button className="btn sm" disabled={!selected.length} onClick={() => setDialog("remove-tag")}>Remove tag</button>
      <button className="btn sm" disabled={!selected.length} onClick={() => apply(() => batchEdit(ids, () => ({ favorite: true })), "Added to favorites")}>Favorite</button>
      <button className="btn sm" disabled={!selected.length} onClick={() => apply(() => batchEdit(ids, () => ({ favorite: false })), "Removed from favorites")}>Unfavorite</button>
      <button className="btn sm" disabled={!selected.length} onClick={() => setDialog("progress")}>Mark read up to…</button>
      <button
        className="btn sm"
        disabled={!selected.length}
        onClick={async () => {
          const file = await exportLibrary({ seriesIds: ids });
          downloadFile(`manwhatrack-selection-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(file, null, 2), "application/json");
        }}
      >
        Export
      </button>
      <span className="spacer" />
      <button className="btn sm danger" disabled={!selected.length} onClick={() => setDialog("delete")}>Remove…</button>
      <button className="btn sm ghost" onClick={onClear}>Done</button>

      {dialog === "collections" && <CollectionAssignmentDialog seriesIds={ids} onClose={close} />}

      {(dialog === "add-tag" || dialog === "remove-tag") && (
        <Dialog title={dialog === "add-tag" ? `Add tag to ${selected.length} series` : `Remove tag from ${selected.length} series`} onClose={close}>
          <input className="input" style={{ width: "100%" }} aria-label="Tag" value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="actions">
            <button className="btn" onClick={close}>Cancel</button>
            <button
              className="btn primary"
              disabled={!value.trim()}
              onClick={() => {
                const tag = value.trim();
                void apply(
                  () => batchEdit(ids, (s) => ({ tags: dialog === "add-tag" ? [...s.tags, tag] : s.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) })),
                  dialog === "add-tag" ? `Tagged ${selected.length} series` : `Removed tag from ${selected.length} series`,
                );
                close();
              }}
            >
              Apply
            </button>
          </div>
        </Dialog>
      )}

      {dialog === "progress" && (
        <Dialog title={`Mark chapters read for ${selected.length} series`} onClose={close}>
          <p className="muted small" style={{ marginTop: 0 }}>Every known chapter up to this number is marked read in each selected series.</p>
          <input className="input" inputMode="decimal" style={{ width: "100%" }} aria-label="Chapter number" placeholder="e.g. 50" value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="actions">
            <button className="btn" onClick={close}>Cancel</button>
            <button
              className="btn primary"
              disabled={!/^\d+(\.\d+)?$/.test(value.trim())}
              onClick={() => {
                const v = value.trim();
                void apply(async () => {
                  for (const id of ids) await setProgressTo(id, v);
                }, `Marked read up to ${v}`);
                close();
              }}
            >
              Mark read
            </button>
          </div>
        </Dialog>
      )}

      {dialog === "delete" && (
        <Dialog title={`Remove ${selected.length} series?`} onClose={close}>
          <p className="muted" style={{ marginTop: 0 }}>
            They disappear from the library. You can undo right away or restore them later from Settings → Data for 30 days.
          </p>
          <div className="actions">
            <button className="btn" onClick={close}>Cancel</button>
            <button
              className="btn danger solid"
              onClick={() => {
                onRemove(ids);
                close();
                onClear();
              }}
            >
              Remove {selected.length} series
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
