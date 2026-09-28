// Detection Inspector: shows what ManwhaTrack concluded about the current page and why.

import type { Series } from "../../shared/types/models";
import type { TabState } from "../../shared/messages";
import { confidenceLabel } from "../../detection/types";
import { sendToWorker } from "../../shared/messages";
import { useToast } from "../../ui/toasts";
import { Icon } from "../../ui/icons";

export function InspectorView({ state, series, onBack, onOpenSeries }: { state?: TabState; series?: Series; onBack: () => void; onOpenSeries: (id: string) => void }) {
  const toast = useToast();
  const obs = state?.observation;
  return (
    <div className="inspector">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="back" /></button>
        <strong>Detection Inspector</strong>
      </div>
      {!state || !obs ? (
        <div className="empty">
          <h2>Could not detect this page.</h2>
          <p>Either the page has no reading signals, or it has not finished loading. Reload the page and open the inspector again.</p>
        </div>
      ) : (
        <div className="section stack">
          <dl className="kv">
            <dt>Page kind</dt>
            <dd style={{ textTransform: "capitalize" }}>{obs.kind}</dd>
            <dt>Series</dt>
            <dd>{obs.series?.title ?? <span className="faint">not found</span>}</dd>
            <dt>Chapter</dt>
            <dd>{obs.chapter?.label ?? <span className="faint">—</span>}</dd>
            <dt>Cover</dt>
            <dd>{obs.series?.coverUrl ? "detected" : <span className="faint">not found</span>}</dd>
            <dt>Series URL</dt>
            <dd>{obs.series ? <code>{obs.series.canonicalSeriesUrl}</code> : "—"}{obs.series?.seriesUrlInferred ? <span className="faint"> (inferred)</span> : null}</dd>
            <dt>Reader</dt>
            <dd>{obs.readerSelector ? <code>{obs.readerSelector}</code> : <span className="faint">—</span>}</dd>
            <dt>Next / prev</dt>
            <dd>{obs.chapter?.nextUrl ? "next ✓" : "next —"} · {obs.chapter?.prevUrl ? "prev ✓" : "prev —"}</dd>
            <dt>Chapter list</dt>
            <dd>{obs.series?.chapterList.length ?? 0} links</dd>
            <dt>Confidence</dt>
            <dd>{confidenceLabel(obs.confidence)} <span className="faint tabular">({obs.confidence.toFixed(2)})</span></dd>
            <dt>Adapter</dt>
            <dd><code>{obs.adapterId}</code></dd>
            <dt>Tracked</dt>
            <dd>{series ? <button className="btn sm ghost" onClick={() => onOpenSeries(series.id)}>{series.title}</button> : "No"}</dd>
          </dl>
          <details>
            <summary className="small muted">Evidence</summary>
            <ul className="evidence">
              {obs.evidence.map((e, i) => (
                <li key={i}>
                  {e.weight >= 0 ? "+" : ""}{e.weight.toFixed(2)} {e.signal}{e.detail ? ` — ${e.detail}` : ""}
                </li>
              ))}
            </ul>
          </details>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn sm" onClick={() => void sendToWorker({ type: "tab/redetect", tabId: state.tabId })}>Detect again</button>
            {!series && obs.series && (
              <button
                className="btn sm primary"
                onClick={async () => {
                  const r = await sendToWorker<{ ok: boolean; error?: string }>({ type: "tab/track", tabId: state.tabId });
                  toast.show(r?.ok ? "Tracking this series" : r?.error ?? "Could not detect this page.", { error: !r?.ok });
                }}
              >
                Track anyway
              </button>
            )}
            <button className="btn sm" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#rules?host=${encodeURIComponent(obs.hostname)}`) })}>
              Create site rule…
            </button>
          </div>
          <p className="small faint">Nothing on this screen is sent anywhere. Site rules are stored on this device.</p>
        </div>
      )}
    </div>
  );
}
