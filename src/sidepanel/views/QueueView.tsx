// Reading queue: drag-and-drop plus keyboard-accessible reordering. Never changes progress.

import { useState } from "react";
import type { Series } from "../../shared/types/models";
import { moveInQueue, removeFromQueue, setQueue } from "../../storage/repositories/queue";
import { publish } from "../../shared/bus";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import { progressText, continueText } from "../components/SeriesItem";
import type { Actions } from "../useActions";
import type { useLibrary } from "../../ui/hooks";

export function QueueView({ lib, actions, onOpenSeries }: { lib: ReturnType<typeof useLibrary>; actions: Actions; onOpenSeries: (id: string) => void }) {
  const [dragId, setDragId] = useState<string>();
  const items = lib.queue.map((id) => lib.byId.get(id)).filter((s): s is Series => !!s && !s.removedAt);

  const save = async (next: string[]) => {
    lib.setQueueLocal(next);
    await setQueue(next);
    publish({ type: "library-changed" });
  };

  if (!items.length) {
    return (
      <div className="empty">
        <h2>The queue is empty.</h2>
        <p>Add series from their menu with “Add to queue”.</p>
      </div>
    );
  }

  return (
    <ol className="queue" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Reading queue">
      {items.map((s, i) => (
        <li
          key={s.id}
          draggable
          className={dragId === s.id ? "dragging" : undefined}
          onDragStart={(e) => {
            setDragId(s.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragId(undefined)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragId && dragId !== s.id) lib.setQueueLocal(moveInQueue(lib.queue, dragId, lib.queue.indexOf(s.id) - lib.queue.indexOf(dragId)));
          }}
          onDrop={(e) => {
            e.preventDefault();
            void save(lib.queue);
          }}
        >
          <span className="handle" aria-hidden="true"><Icon name="drag" /></span>
          <Cover coverId={s.coverId} title={s.title} />
          <div style={{ minWidth: 0 }}>
            <button className="btn ghost" style={{ padding: 0, height: "auto", fontWeight: 600, maxWidth: "100%" }} onClick={() => onOpenSeries(s.id)}>
              <span className="truncate">{i + 1}. {s.title}</span>
            </button>
            <div className="small muted">{progressText(s)}</div>
          </div>
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn" aria-label={`Move ${s.title} up`} disabled={i === 0} onClick={() => void save(moveInQueue(lib.queue, s.id, -1))}>
              <Icon name="up" />
            </button>
            <button className="icon-btn" aria-label={`Move ${s.title} down`} disabled={i === items.length - 1} onClick={() => void save(moveInQueue(lib.queue, s.id, 1))}>
              <Icon name="down" />
            </button>
            <button className="btn sm primary" onClick={() => void actions.continueSeries(s)}>{continueText(s)}</button>
            <button
              className="icon-btn"
              aria-label={`Remove ${s.title} from queue`}
              onClick={async () => {
                lib.setQueueLocal(lib.queue.filter((x) => x !== s.id));
                await removeFromQueue(s.id);
                publish({ type: "library-changed" });
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}
