import { useMemo, useState } from "react";
import type { Collection } from "../../shared/types/collections";
import { assignCollections, createCollection, deleteCollection, updateCollection } from "../../storage/repositories/collections";
import { Dialog } from "../../ui/Menu";
import { useCollections } from "../../ui/useCollections";
import { useLibrary } from "../../ui/hooks";
import { Cover } from "../../ui/Cover";

function ErrorText({ error }: { error?: string }) { return error ? <p role="alert" className="small" style={{ color: "var(--danger)" }}>{error}</p> : null; }

export function CollectionsDialog({ onClose, onOpen, collection, onManual }: { onClose: () => void; onOpen?: (id: string) => void; collection?: Collection; onManual?: () => void }) {
  const lists = useCollections();
  const lib = useLibrary();
  const [editing, setEditing] = useState<Collection | undefined>(collection);
  const [name, setName] = useState(collection?.name ?? "");
  const [query, setQuery] = useState("");
  const [membership, setMembership] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<Collection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const members = useMemo(() => lib.series.filter(s => !s.removedAt && (!query.trim() || s.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [lib.series, query]);
  const reset = () => { setEditing(undefined); setConfirmDelete(undefined); setName(""); setQuery(""); setMembership({}); setError(undefined); };
  const apply = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await fn(); await lists.reload(); if (collection) onClose(); else reset(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save your list."); }
    finally { setBusy(false); }
  };
  return (
    <Dialog className="collection-dialog" title={confirmDelete ? "Delete list?" : collection ? "Add series to list" : editing ? "Edit list" : "Your lists"} onClose={() => { if (!busy) onClose(); }}>
      {confirmDelete ? <>
        <p>Delete “{confirmDelete.name}”? All its series and reading history stay in your library.</p>
        <ErrorText error={error} />
        <div className="actions"><button className="btn" disabled={busy} onClick={reset}>Cancel</button><button className="btn danger solid" disabled={busy} onClick={() => void apply(() => deleteCollection(confirmDelete.id))}>Delete list</button></div>
      </> : editing ? <>
        {collection ? <p className="small muted collection-picker-name">{collection.name}</p> : <label className="stack">List name<input className="input" maxLength={80} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>}
        <label className="stack" style={{ marginTop: 12 }}>Find series<input className="input" type="search" placeholder="Search your library" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} /></label>
        <p className="small muted">Check series to include in this list. A series can belong to several lists.</p>
        {lib.error && <p role="alert">Your series could not be loaded. <button className="btn sm" onClick={() => void lib.reload()}>Retry</button></p>}
        <div className="collection-choices" style={{ maxHeight: 260, overflowY: "auto" }}>
          {members.map(s => <label className="collection-choice row" key={s.id} style={{ padding: "7px 0", minWidth: 0 }}><input type="checkbox" aria-label={s.title} disabled={busy} checked={membership[s.id] ?? editing.seriesIds.includes(s.id)} onChange={e => setMembership(m => ({ ...m, [s.id]: e.target.checked }))} /><Cover coverId={s.coverId} title={s.title} /><span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{s.title}</span></label>)}
          {lib.loaded && !members.length && <p className="small muted">{query ? "No matching series." : "No series in your library yet. This list can stay empty."}</p>}
        </div>
        {collection && onManual && <button className="btn ghost" disabled={busy} onClick={() => { onClose(); onManual(); }}>Track a series manually</button>}
        <ErrorText error={error} />
        <div className="actions"><button className="btn" disabled={busy} onClick={collection ? onClose : reset}>{collection ? "Cancel" : "Back"}</button><button className="btn primary" disabled={busy || !name.trim() || !lib.loaded || !!lib.error} onClick={() => void apply(async () => {
          // Rename and membership share a single transaction in the repository.
          await updateCollection(editing.id, name, membership);
        })}>{busy ? "Saving…" : "Save list"}</button></div>
      </> : <>
        <p className="small muted" style={{ marginTop: 0 }}>Create your own lists without changing reading status or progress.</p>
        {lists.error && <p role="alert">{lists.error} <button className="btn sm" onClick={() => void lists.reload()}>Retry</button></p>}
        <div className="collection-manager" style={{ maxHeight: 300, overflowY: "auto" }}>
          {lists.collections.map(c => <div className="collection-row" key={c.id}>
            <div className="collection-row-main">
              <button disabled={busy} className="btn ghost collection-name" onClick={() => { if (onOpen) { onOpen(c.id); onClose(); } else { setEditing(c); setName(c.name); } }}><span className="collection-name-text">{c.name}</span><span className="faint tabular">{c.seriesIds.length}</span></button>
              <div className="collection-row-actions">
              <button className="btn sm" disabled={busy} onClick={() => { setEditing(c); setName(c.name); }}>Edit / add series</button>
              <button className="btn sm ghost danger" disabled={busy} onClick={() => setConfirmDelete(c)}>Delete</button>
              </div>
            </div>
          </div>)}
          {lists.loaded && !lists.collections.length && <p className="small muted">No lists yet. Create one below, then add series.</p>}
        </div>
        <form className="collection-create" onSubmit={e => { e.preventDefault(); void apply(() => createCollection(name)); }}>
          <label className="stack">New list name<input className="input" maxLength={80} value={name} disabled={busy} placeholder="e.g. Read weekly" onChange={e => setName(e.target.value)} /></label>
          <button className="btn" disabled={busy || !name.trim() || !lists.loaded || !!lists.error} type="submit">Create list</button>
        </form>
        <ErrorText error={error} />
        <div className="actions"><button className="btn primary" disabled={busy} onClick={onClose}>Done</button></div>
      </>}
    </Dialog>
  );
}


export function CollectionAssignmentDialog({ seriesIds, onClose, onSaved }: { seriesIds: string[]; onClose: () => void; onSaved?: () => void }) {
  const lists = useCollections();
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return <Dialog className="collection-dialog" title={seriesIds.length === 1 ? "Assign to lists" : `Assign ${seriesIds.length} series to lists`} onClose={() => { if (!busy) onClose(); }}>
    <p className="small muted" style={{ marginTop: 0 }}>A series can belong to several lists. Mixed selections keep their membership until changed.</p>
    {lists.error && <p role="alert">{lists.error}<button className="btn sm" onClick={() => void lists.reload()}>Retry</button></p>}
    <div className="collection-choices" style={{ maxHeight: 300, overflowY: "auto" }}>
      {lists.collections.map(c => {
        const count = seriesIds.filter(id => c.seriesIds.includes(id)).length;
        const mixed = changes[c.id] === undefined && count > 0 && count < seriesIds.length;
        const checked = changes[c.id] ?? count === seriesIds.length;
        return <label className="collection-choice row" key={c.id} style={{ padding: "8px 0", minWidth: 0 }}><input type="checkbox" disabled={busy} checked={checked} ref={el => { if (el) el.indeterminate = mixed; }} onChange={e => setChanges(m => ({ ...m, [c.id]: e.target.checked }))} /><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{c.name}</span><span className="faint small">{mixed ? "Some selected" : `${c.seriesIds.length} series`}</span></label>;
      })}
      {lists.loaded && !lists.collections.length && <p className="small muted">No lists yet. Create one below.</p>}
    </div>
    <form className="collection-create" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(undefined);
      try { const c = await createCollection(name); setChanges(m => ({ ...m, [c.id]: true })); setName(""); await lists.reload(); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not create this list."); }
      finally { setBusy(false); }
    }}><label className="stack">New list name<input className="input" maxLength={80} value={name} disabled={busy} placeholder="e.g. Read weekly" onChange={e => setName(e.target.value)} /></label><button className="btn sm" disabled={busy || !name.trim() || !lists.loaded || !!lists.error} type="submit">Create list</button></form>
    <ErrorText error={error} />
    <div className="actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !lists.loaded || !!lists.error} onClick={async () => {
      setBusy(true); setError(undefined);
      try { await assignCollections(seriesIds, Object.entries(changes).map(([collectionId, included]) => ({ collectionId, included }))); onSaved?.(); onClose(); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not assign these series."); }
      finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Save assignments"}</button></div>
  </Dialog>;
}

export function CollectionMembership({ seriesId }: { seriesId: string }) {
  const lists = useCollections();
  const [open, setOpen] = useState(false);
  const membership = lists.collections.filter(c => c.seriesIds.includes(seriesId));
  return <><div className="row" style={{ flexWrap: "wrap", gap: 6 }}><span className="small muted" style={{ overflowWrap: "anywhere" }}>{lists.error ? lists.error : membership.length ? membership.map(c => c.name).join(" · ") : "No lists assigned"}</span><button className="btn sm" onClick={() => setOpen(true)}>Assign to lists</button></div>{open && <CollectionAssignmentDialog seriesIds={[seriesId]} onClose={() => setOpen(false)} onSaved={() => void lists.reload()} />}</>;
}
