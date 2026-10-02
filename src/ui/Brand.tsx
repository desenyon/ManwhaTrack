/** A single bookmark silhouette stays legible at toolbar sizes. */
export function Brand() {
  return <span className="brand" aria-label="ManwhaTrack">
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="currentColor" />
      <path d="M10 7h12v19l-6-4-6 4V7Z" fill="var(--accent-text)" />
    </svg>
    <span className="wordmark">ManwhaTrack</span>
  </span>;
}
