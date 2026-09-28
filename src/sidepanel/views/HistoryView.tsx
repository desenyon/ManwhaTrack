// Reading history: an append-oriented log. Clearing it never touches the library or progress.

import { useCallback, useEffect, useState } from "react";
import type { ReadingEvent, Series } from "../../shared/types/models";
import { clearAllHistory, clearSeriesHistory, deleteEvent, listEvents } from "../../storage/repositories/history";
import { dayHeading, percent, startOfDay, timeOfDay } from "../../shared/utils/format";
import { subscribe } from "../../shared/bus";
import { Dialog } from "../../ui/Menu";
import { Icon } from "../../ui/icons";

const PAGE = 150;

export function eventText(e: ReadingEvent): string {
  const ch = e.chapterLabel ?? "a chapter";
  switch (e.type) {
    case "opened":
      return `Opened ${ch}`;
    case "completed":
      return `Finished ${ch}`;
    case "progress":
      return `Read ${percent(e.progress)} of ${ch}`;
    case "manual-read":
      return ch.startsWith("Up to") || ch.startsWith("Progress") ? `Marked read: ${ch}` : `Marked ${ch} read`;
    case "manual-unread":
      return `Marked ${ch} unread`;
  }
}

export function EventList({ seriesId, byId, onOpenSeries }: { seriesId?: string; byId?: Map<string, Series>; onOpenSeries?: (id: string) => void }) {
  const [events, setEvents] = useState<ReadingEvent[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => setEvents(await listEvents({ seriesId, limit: limit + 1 })), [seriesId, limit]);
  useEffect(() => {
    void load();
    return subscribe((m) => m.type === "library-changed" && void load());
  }, [load]);

  const shown = events.slice(0, limit);
  let lastDay = -1;
  return (
    <>
      {shown.length === 0 ? (
        <p className="muted small">No reading history{seriesId ? " for this series" : ""}.</p>
      ) : (
        <ul className="events">
          {shown.map((e) => {
            const day = startOfDay(e.timestamp);
            const header = day !== lastDay ? <li className="day" key={`d${day}`}>{dayHeading(e.timestamp)}</li> : null;
            lastDay = day;
            const series = byId?.get(e.seriesId);
            return [
              header,
              <li className="e" key={e.id}>
                <span className="faint tabular">{timeOfDay(e.timestamp)}</span>
                <span className="truncate">
                  {eventText(e)}
                  {series && !seriesId && (
                    <>
                      {" · "}
                      <button className="btn ghost sm" style={{ padding: 0, height: "auto" }} onClick={() => onOpenSeries?.(series.id)}>{series.title}</button>
                    </>
                  )}
                </span>
                <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Delete this event" onClick={async () => {
                  await deleteEvent(e.id);
                  void load();
                }}>
                  <Icon name="close" />
                </button>
              </li>,
            ];
          })}
        </ul>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        {events.length > limit && <button className="btn sm" onClick={() => setLimit((l) => l + PAGE)}>Show older</button>}
        <span className="spacer" />
        {shown.length > 0 && <button className="btn sm danger" onClick={() => setConfirm(true)}>{seriesId ? "Clear this series' history" : "Clear all history"}</button>}
      </div>
      {confirm && (
        <Dialog title={seriesId ? "Clear this series' history?" : "Clear all reading history?"} onClose={() => setConfirm(false)}>
          <p className="muted" style={{ marginTop: 0 }}>
            Only the event log is cleared. Your library, chapter progress and Continue positions stay as they are.
          </p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
            <button
              className="btn danger solid"
              onClick={async () => {
                await (seriesId ? clearSeriesHistory(seriesId) : clearAllHistory());
                setConfirm(false);
                void load();
              }}
            >
              Clear history
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function HistoryView({ byId, onBack, onOpenSeries }: { byId: Map<string, Series>; onBack: () => void; onOpenSeries: (id: string) => void }) {
  return (
    <>
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="back" /></button>
        <strong>Reading history</strong>
      </div>
      <div className="section">
        <EventList byId={byId} onOpenSeries={onOpenSeries} />
      </div>
    </>
  );
}
