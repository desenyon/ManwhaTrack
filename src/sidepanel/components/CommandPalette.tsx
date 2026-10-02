// Cmd/Ctrl+K: a compact list of commands plus local series search. Deliberately small.

import { useMemo, useState } from "react";
import type { Series } from "../../shared/types/models";
import { search, type SearchEntry } from "../../shared/utils/search";
import { Dialog } from "../../ui/Menu";
import { shortChapterLabel } from "../../detection/normalization/chapter";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  commands,
  entries,
  byId,
  onContinue,
  onClose,
}: {
  commands: Command[];
  entries: SearchEntry[];
  byId: Map<string, Series>;
  onContinue: (s: Series) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const results: Command[] = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const cmds = ql ? commands.filter((c) => c.label.toLowerCase().includes(ql)) : commands;
    const series = ql
      ? search(entries, q, 8)
          .map((r) => byId.get(r.id))
          .filter((s): s is Series => !!s)
          .map((s) => ({
            id: `s:${s.id}`,
            label: `Continue ${s.title}`,
            hint: s.summary.continueLabel ? shortChapterLabel(s.summary.continueLabel) : undefined,
            run: () => onContinue(s),
          }))
      : [];
    const found = new Set(series.map(c => c.id.slice(2)));
    return [...series, ...cmds.filter(c => !c.id.startsWith("c:") || !found.has(c.id.slice(2)))].slice(0, 14);
  }, [q, commands, entries, byId, onContinue]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <Dialog title="Command palette" onClose={onClose} labelledBy="palette-title">
      <div className="palette" style={{ margin: "-4px -14px -14px" }}>
        <input
          aria-label="Type a command or series"
          placeholder="Type a command or series…"
          value={q}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[sel] ? `pc-${sel}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[sel]);
            }
          }}
        />
        <ul id="palette-list" role="listbox">
          {results.map((c, i) => (
            <li key={c.id} id={`pc-${i}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              <span className="truncate" style={{ flex: 1 }}>{c.label}</span>
              {c.hint && <span className="small faint">{c.hint}</span>}
            </li>
          ))}
          {!results.length && <li className="muted">No matches</li>}
        </ul>
      </div>
    </Dialog>
  );
}
