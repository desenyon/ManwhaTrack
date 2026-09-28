// Local-only debug logging, enabled from Settings → Advanced → Debug mode.
// Nothing is ever transmitted; reading data is only printed when debug mode is on.

import { getSettings } from "../storage/repositories/settings";

let enabled: boolean | null = null;

export async function refreshDebugFlag(): Promise<void> {
  enabled = (await getSettings()).debug;
}

export function debug(...args: unknown[]): void {
  if (enabled) console.debug("[ManwhaTrack]", ...args);
}

export function warn(context: string, err: unknown): void {
  // Errors are logged without page content; message only.
  const msg = err instanceof Error ? err.message : String(err);
  if (enabled) console.warn(`[ManwhaTrack] ${context}:`, err);
  else console.warn(`[ManwhaTrack] ${context}: ${msg.slice(0, 200)}`);
}
