// Inline 16px stroke icons; one consistent set, no icon dependency.

import type { ReactElement } from "react";

const paths: Record<string, ReactElement> = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></>,
  more: <><circle cx="3.5" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12.5" cy="8" r=".9" fill="currentColor" /></>,
  star: <path d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" />,
  starFill: <path d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" fill="currentColor" />,
  pin: <><path d="M6 2h4l-.5 4 2.5 2v1.5H4V8l2.5-2z" /><path d="M8 9.5V14" /></>,
  check: <path d="m3 8.5 3 3 7-7" />,
  back: <path d="M10 3 5 8l5 5" />,
  chevron: <path d="m6 3 5 5-5 5" />,
  down: <path d="m4 6 4 4 4-4" />,
  play: <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />,
  settings: <><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>,
  grid: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>,
  list: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  refresh: <><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v3h-3" /></>,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  external: <><path d="M9 2.5h4.5V7" /><path d="M13.5 2.5 7.5 8.5" /><path d="M12 9.5v4H2.5V4h4" /></>,
  drag: <><circle cx="6" cy="4" r=".8" fill="currentColor" /><circle cx="10" cy="4" r=".8" fill="currentColor" /><circle cx="6" cy="8" r=".8" fill="currentColor" /><circle cx="10" cy="8" r=".8" fill="currentColor" /><circle cx="6" cy="12" r=".8" fill="currentColor" /><circle cx="10" cy="12" r=".8" fill="currentColor" /></>,
  filter: <path d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z" />,
  select: <><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="m5.5 8 2 2 3-4" /></>,
  history: <><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v2.5H5" /><path d="M8 5v3l2 1.5" /></>,
  chart: <><path d="M2 2v12h12" /><path d="m4 10 3-4 3 2 3-5" /></>,
  clock: <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.5V8l2.5 1.5" /></>,
  pause: <path d="M5.5 4v8M10.5 4v8" />,
  queue: <path d="M2.5 4h8M2.5 8h8M2.5 12h5M12.5 10v4M10.5 12h4" />,
  inspect: <><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5 6h6M5 8.5h3.5" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  up: <path d="m4 10 4-4 4 4" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {paths[name]}
    </svg>
  );
}
