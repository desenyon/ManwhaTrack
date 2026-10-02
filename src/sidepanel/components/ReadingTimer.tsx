import type { Series } from "../../shared/types/models";
import { formatReadingClock } from "../../shared/utils/reading-time";
import { useReadingActivity } from "../../ui/useReadingActivity";
import { Icon } from "../../ui/icons";

export function ReadingTimer({ series, onOpenTime }: { series: Series[]; onOpenTime?: () => void }) {
  const activity = useReadingActivity();
  const current = series.find(s => s.id === activity?.seriesId && !s.removedAt);
  const active = !!current && !!activity?.active;
  return <section className="reading-timer" aria-label="Reading timer" data-active={active}>
    <Icon name="clock" />
    <div className="timer-context"><span className="timer-label">{current ? active ? "Reading" : "Paused" : "Reading time"}</span><span className="truncate" title={current?.title}>{current?.title ?? "Open a chapter to start"}</span></div>
    <output role="timer" aria-live="off" aria-label="Reading session time" className="reading-clock">{formatReadingClock(current ? activity?.sessionMs ?? 0 : 0)}</output>
    {onOpenTime && <button className="icon-btn" title="Time tracking" aria-label="Time tracking" onClick={onOpenTime}><Icon name="external" /></button>}
  </section>;
}
