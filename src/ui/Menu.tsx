// Native-feeling context menu: opens at a point or under an anchor, arrow-key navigable.

import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from "react";

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
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      setPos({
        left: Math.max(4, Math.min(state.x, innerWidth - r.width - 4)),
        top: Math.max(4, Math.min(state.y + r.height > innerHeight - 4 ? state.y - r.height : state.y, innerHeight - r.height - 4)),
      });
    };
    place();
    el.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
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

export function Dialog({ title, children, onClose, labelledBy, className = "" }: { title: string; children: ReactNode; onClose: () => void; labelledBy?: string; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const generatedId = useId();
  const id = labelledBy ?? generatedId;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("input, textarea, select, button.primary, button")?.focus();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog className={`dialog ${className}`} aria-labelledby={id} ref={ref}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],[tabindex]")].filter(el => !el.matches(":disabled") && el.tabIndex >= 0 && !el.hidden && el.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (!first || !last) { e.preventDefault(); e.currentTarget.focus(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }}
      onCancel={(e) => { e.preventDefault(); closeRef.current(); }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeRef.current();
      }}>
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
