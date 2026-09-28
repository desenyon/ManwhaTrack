// Compact awareness of the page beside the panel. No overlay is injected into the site.

import type { Series } from "../../shared/types/models";
import type { TabState } from "../../shared/messages";
import { CONFIDENCE } from "../../detection/types";
import { percent } from "../../shared/utils/format";
import { sendToWorker } from "../../shared/messages";
import { Cover } from "../../ui/Cover";
import { useToast } from "../../ui/toasts";

export function NowReading({ state, series, onOpenSeries, onInspect }: { state?: TabState; series?: Series; onOpenSeries: (id: string) => void; onInspect: () => void }) {
  const toast = useToast();
  if (!state) return null;
  const obs = state.observation;

  if (series && obs.kind === "chapter" && state.chapterId) {
    const p = state.progress ?? (series.currentChapterId === state.chapterId ? series.summary.currentProgress : 0) ?? 0;
    const done = series.currentChapterId === state.chapterId && series.summary.currentCompleted;
    return (
      <section className="now" aria-label="Now reading">
        <Cover coverId={series.coverId} title={series.title} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="section-title" style={{ margin: 0 }}>Now reading</div>
          <div className="truncate" style={{ fontWeight: 600 }}>{series.title}</div>
          <div className="small muted tabular">
            {obs.chapter?.label} · {done ? "Read" : `${percent(p)} read`}
          </div>
          <div className="progress" aria-hidden="true"><i style={{ width: percent(done ? 1 : p) }} /></div>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <button
            className="btn sm"
            onClick={async () => {
              const r = await sendToWorker<{ ok: boolean }>({ type: "tab/mark-current", tabId: state.tabId, read: !done });
              if (!r?.ok) toast.show("Could not update this chapter.", { error: true });
            }}
          >
            {done ? "Mark unread" : "Mark read"}
          </button>
          <button className="btn sm ghost" onClick={() => onOpenSeries(series.id)}>Details</button>
        </div>
      </section>
    );
  }

  if (series && obs.kind === "series") {
    return (
      <section className="now" aria-label="Current page">
        <Cover coverId={series.coverId} title={series.title} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="section-title" style={{ margin: 0 }}>This page</div>
          <div className="truncate" style={{ fontWeight: 600 }}>{series.title}</div>
          <div className="small muted">Tracked series page</div>
        </div>
        <button className="btn sm ghost" onClick={() => onOpenSeries(series.id)}>Details</button>
      </section>
    );
  }

  const trackable = (obs.kind === "series" || obs.kind === "chapter") && obs.series && obs.confidence >= CONFIDENCE.observe;
  if (trackable) {
    return (
      <section className="now" aria-label="Current page">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="section-title" style={{ margin: 0 }}>Possibly a manhwa page</div>
          <div className="truncate" style={{ fontWeight: 600 }}>{obs.series?.title}</div>
          <div className="small muted">Not tracked automatically: detection was not confident.</div>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <button
            className="btn sm primary"
            onClick={async () => {
              const r = await sendToWorker<{ ok: boolean; error?: string }>({ type: "tab/track", tabId: state.tabId });
              toast.show(r?.ok ? `Tracking ${obs.series?.title}` : r?.error ?? "Could not detect this page.", { error: !r?.ok });
            }}
          >
            Track
          </button>
          <button className="btn sm ghost" onClick={onInspect}>Inspect</button>
        </div>
      </section>
    );
  }
  return null;
}
