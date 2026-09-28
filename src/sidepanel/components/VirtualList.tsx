// Fixed-height row virtualization. Large libraries never render thousands of rows at once.

import { useEffect, useState, useRef, type ReactNode, type RefObject } from "react";

const OVERSCAN = 8;

export function VirtualList<T>({
  items,
  rowHeight,
  scrollRef,
  render,
  label,
  selectingClass,
}: {
  items: T[];
  rowHeight: number;
  scrollRef: RefObject<HTMLElement | null>;
  render: (item: T, index: number) => ReactNode;
  label: string;
  selectingClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });

  useEffect(() => {
    const scroller = scrollRef.current;
    const el = ref.current;
    if (!scroller || !el) return;
    const update = () => {
      const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const top = scroller.scrollTop - offset;
      const start = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
      const end = Math.min(items.length, Math.ceil((top + scroller.clientHeight) / rowHeight) + OVERSCAN);
      setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [items.length, rowHeight, scrollRef]);

  const visible = items.slice(range.start, Math.max(range.end, range.start + 1));
  return (
    <div ref={ref} className={`list ${selectingClass ?? ""}`} role="listbox" aria-label={label} style={{ height: items.length * rowHeight }}>
      <div style={{ transform: `translateY(${range.start * rowHeight}px)` }}>{visible.map((it, i) => render(it, range.start + i))}</div>
    </div>
  );
}
