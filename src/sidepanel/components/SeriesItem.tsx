import { memo, type MouseEvent } from "react";
import type { Series } from "../../shared/types/models";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import { percent, relativeTime } from "../../shared/utils/format";
import { shortChapterLabel } from "../../detection/normalization/chapter";
import { sourceLabel } from "../../shared/utils/source-label";

export const LIBRARY_ROW_HEIGHT = 88;

export function progressText(s: Series): string {
  const sm = s.summary;
  if (sm.currentLabel) {
    const ch = shortChapterLabel(sm.currentLabel, sm.currentOrdinal);
    if (sm.currentCompleted) return `${ch} read`;
    return sm.currentProgress && sm.currentProgress > 0.02 ? `${ch} · ${percent(sm.currentProgress)}` : ch;
  }
  if (sm.lastCompletedLabel) return `${shortChapterLabel(sm.lastCompletedLabel)} read`;
  return "Not started";
}

export function continueText(s: Series): string {
  switch (s.summary.continueKind) {
    case "next":
      return "Continue";
    case "resume":
      return "Resume";
    case "last":
      return "Reopen";
    case "series":
      return "Open";
    default:
      return "Open";
  }
}

export function UpdateBadge({ s }: { s: Series }) {
  if (s.summary.newCount > 0) return <span className="badge">+{s.summary.newCount} new</span>;
  if (s.summary.caughtUp) return <span className="badge ok">Caught up</span>;
  return null;
}

export function SeriesProgress({ s, updates = true }: { s: Series; updates?: boolean }) {
  const sm = s.summary;
  const label = sm.currentLabel ?? sm.lastCompletedLabel;
  return <div className="series-progress">
    <span className="meta-card tabular" title={label}>{label ? shortChapterLabel(label, sm.currentOrdinal) : "Not started"}</span>
    {" "}
    {(sm.currentCompleted || (!sm.currentLabel && sm.lastCompletedLabel)) ? <span className="meta-card read-state">read</span> : !!sm.currentProgress && <span className="meta-card tabular">{percent(sm.currentProgress)} read</span>}
    {updates && <UpdateBadge s={s} />}
  </div>;
}

export function SourceBadge({ host }: { host: string }) {
  return <span className="source-badge" title={host}>{sourceLabel(host)}</span>;
}

interface ItemProps {
  s: Series;
  host?: string;
  selected: boolean;
  checked?: boolean;
  selecting?: boolean;
  onOpen: (s: Series) => void;
  onContinue: (s: Series, e: MouseEvent) => void;
  onMenu: (s: Series, x: number, y: number) => void;
  onCheck?: (s: Series, checked: boolean) => void;
}

export const SeriesRow = memo(function SeriesRow({ s, host, selected, checked, selecting, onOpen, onContinue, onMenu, onCheck }: ItemProps) {
  const canContinue = s.summary.continueKind !== "none";
  return (
    <div
      className="srow"
      role="listitem"
      data-focused={selected}
      tabIndex={0}
      onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === " ") { e.preventDefault(); onOpen(s); } }}
      data-id={s.id}
      aria-label={`${s.title}, ${progressText(s)}`}
      onClick={() => onOpen(s)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(s, e.clientX, e.clientY);
      }}
    >
      <div className="check-cell" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" aria-label={`Select ${s.title}`} checked={!!checked} onChange={(e) => onCheck?.(s, e.target.checked)} />
      </div>
      <Cover coverId={s.coverId} title={s.title} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 4 }}>
          <button className="title truncate series-title" aria-label={`${selecting ? (checked ? "Deselect" : "Select") : "Details for"} ${s.title}`} onClick={(e) => { e.stopPropagation(); onOpen(s); }}>{s.title}</button>
          <span className="flags">
            {s.pinned && <Icon name="pin" label="Pinned" />}
            {s.favorite && <span className="fav"><Icon name="starFill" label="Favorite" /></span>}
          </span>
        </div>
        <SeriesProgress s={s} updates={false} />
        <div className="series-source-line">
          {host && <SourceBadge host={host} />}
          <UpdateBadge s={s} />
          <span className="faint truncate read-recency">{s.lastReadAt ? relativeTime(s.lastReadAt) : "not started"}</span>
        </div>
      </div>
      <div className="actions">
        {canContinue && (
          <button
            className="btn sm primary"
            onClick={(e) => {
              e.stopPropagation();
              onContinue(s, e);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.stopPropagation();
                onContinue(s, e);
              }
            }}
            aria-label={`${continueText(s)} ${s.title}${s.summary.continueLabel ? `, ${s.summary.continueLabel}` : ""}`}
            title={s.summary.continueLabel ? `${continueText(s)}: ${s.summary.continueLabel}` : undefined}
          >
            <Icon name="play" className="narrow-only" />
            <span className="wide-only">{continueText(s)}</span>
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={`More actions for ${s.title}`}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(s, r.right - 180, r.bottom + 4);
          }}
        >
          <Icon name="more" />
        </button>
      </div>
    </div>
  );
});

export const SeriesTile = memo(function SeriesTile({ s, host, selected, checked, selecting, onCheck, onOpen, onContinue, onMenu }: ItemProps) {
  return (
    <div
      className="tile"
      role="listitem"
      data-focused={selected}
      tabIndex={0}
      onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === " ") { e.preventDefault(); onOpen(s); } }}
      data-id={s.id}
      aria-label={`${s.title}, ${progressText(s)}`}
      onClick={() => onOpen(s)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(s, e.clientX, e.clientY);
      }}
    >
      <div className="check-cell" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${s.title}`} checked={!!checked} onChange={(e) => onCheck?.(s, e.target.checked)} /></div>
      <Cover coverId={s.coverId} title={s.title}>
        {s.summary.newCount > 0 && (
          <span className="corner">
            <UpdateBadge s={s} />
          </span>
        )}
      </Cover>
      <div className="title">
        <span className="flags">{s.pinned && <Icon name="pin" label="Pinned" />}{s.favorite && <Icon name="starFill" label="Favorite" />}</span>
        <button className="series-title" aria-label={`${selecting ? (checked ? "Deselect" : "Select") : "Details for"} ${s.title}`} onClick={(e) => { e.stopPropagation(); onOpen(s); }}>{s.title}</button>
      </div>
      <div className="row tile-progress">
        <SeriesProgress s={s} />
        <span className="spacer" />
        {s.summary.continueKind !== "none" && (
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            aria-label={`${continueText(s)} ${s.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onContinue(s, e);
            }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); onContinue(s, e); } }}
          >
            <Icon name="play" />
          </button>
        )}
      </div>
      <div className="tile-footer">{host && <SourceBadge host={host} />}<button className="icon-btn" aria-label={`More actions for ${s.title}`} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onMenu(s, r.right - 180, r.bottom + 4); }}><Icon name="more" /></button></div>
    </div>
  );
});
