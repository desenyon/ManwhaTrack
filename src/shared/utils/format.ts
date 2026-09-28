const DAY = 86_400_000;

export function relativeTime(ts: number | undefined, now = Date.now()): string {
  if (!ts) return "never";
  const d = now - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  const today = startOfDay(now);
  if (ts >= today) return `${Math.floor(d / 3_600_000)}h ago`;
  if (ts >= today - DAY) return "yesterday";
  if (ts >= today - 6 * DAY) return `${Math.ceil((today - ts) / DAY)}d ago`;
  return shortDate(ts, now);
}

export function lastReadText(ts: number | undefined, now = Date.now()): string {
  if (!ts) return "Not started";
  const r = relativeTime(ts, now);
  return r === "yesterday" ? "Last read yesterday" : `Last read ${r}`;
}

export function shortDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function timeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayHeading(ts: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (ts >= today) return "Today";
  if (ts >= today - DAY) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function percent(p: number | undefined): string {
  return `${Math.round((p ?? 0) * 100)}%`;
}
