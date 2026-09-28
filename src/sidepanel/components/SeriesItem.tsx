import { memo, type MouseEvent } from "react";
import type { Series } from "../../shared/types/models";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import { percent, relativeTime } from "../../shared/utils/format";
import { shortChapterLabel } from "../../detection/normalization/chapter";

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
  if (s.summary.newCount > 0) return <span className="badge">{s.summary.newCount} new</span>;
  if (s.summary.caughtUp) return <span className="badge ok">Caught up</span>;
  return null;
}

interface ItemProps {
  s: Series;
  host?: string;
  selected: boolean;
  checked?: boolean;
  onOpen: (s: Series) => void;
  onContinue: (s: Series, e: MouseEvent) => void;
  onMenu: (s: Series, x: number, y: number) => void;
  onCheck?: (s: Series, checked: boolean) => void;
}

export const SeriesRow = memo(function SeriesRow({ s, host, selected, checked, onOpen, onContinue, onMenu, onCheck }: ItemProps) {
  const canContinue = s.summary.continueKind !== "none";
  return (
    <div
      className="srow"
      role="option"
      aria-selected={selected}
      data-id={s.id}
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
          <span className="title truncate">{s.title}</span>
          <span className="flags">
            {s.pinned && <Icon name="pin" label="Pinned" />}
            {s.favorite && <span className="fav"><Icon name="starFill" label="Favorite" /></span>}
          </span>
        </div>
        <div className="meta">
          <span className="tabular truncate">{progressText(s)}</span>
          <UpdateBadge s={s} />
        </div>
        <div className="meta faint hide-narrow">
          {host && <span className="truncate">{host}</span>}
          {host && <span className="sep" />}
          <span className="truncate">{s.lastReadAt ? relativeTime(s.lastReadAt) : "not started"}</span>
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

export const SeriesTile = memo(function SeriesTile({ s, selected, onOpen, onContinue, onMenu }: ItemProps) {
  return (
    <div
      className="tile"
      role="option"
      aria-selected={selected}
      data-id={s.id}
      tabIndex={-1}
      onClick={() => onOpen(s)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(s, e.clientX, e.clientY);
      }}
    >
      <Cover coverId={s.coverId} title={s.title}>
        {s.summary.newCount > 0 && (
          <span className="corner">
            <UpdateBadge s={s} />
          </span>
        )}
      </Cover>
      <div className="title">
        {s.favorite && <span className="sr-only">Favorite. </span>}
        {s.title}
      </div>
      <div className="row meta">
        <span className="truncate tabular">{progressText(s)}</span>
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
          >
            <Icon name="play" />
          </button>
        )}
      </div>
    </div>
  );
});
