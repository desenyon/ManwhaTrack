// Native-feeling context menu: opens at a point or under an anchor, arrow-key navigable.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem =
  | { kind?: "item"; label: string; onSelect: () => void; danger?: boolean; hint?: string; disabled?: boolean }
  | { kind: "separator" }
  | { kind: "label"; label: string };

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function Menu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(state.x, innerWidth - r.width - 4)),
      top: state.y + r.height > innerHeight - 4 ? Math.max(4, state.y - r.height) : state.y,
    });
    el.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [state]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
        next?.focus();
      }
    };
    addEventListener("mousedown", onDown, true);
    addEventListener("keydown", onKey, true);
    addEventListener("blur", onClose);
    return () => {
      removeEventListener("mousedown", onDown, true);
      removeEventListener("keydown", onKey, true);
      removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div className="menu" role="menu" ref={ref} style={pos}>
      {state.items.map((it, i) => {
        if (it.kind === "separator") return <hr key={i} />;
        if (it.kind === "label") return <div key={i} className="menu-label">{it.label}</div>;
        return (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : undefined}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.label}
            {it.hint && <span className="kbd">{it.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function menuAtElement(el: Element, items: MenuItem[]): MenuState {
  const r = el.getBoundingClientRect();
  return { x: r.right - 180, y: r.bottom + 4, items };
}

export function Dialog({ title, children, onClose, labelledBy }: { title: string; children: ReactNode; onClose: () => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button.primary, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  const id = labelledBy ?? "dialog-title";
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
