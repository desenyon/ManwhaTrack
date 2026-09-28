// Same-origin change notifications between the service worker, side panel and options page.
// BroadcastChannel never leaves the extension's origin.

export type BusMessage =
  | { type: "library-changed"; seriesIds?: string[] }
  | { type: "tab-state-changed"; tabId: number }
  | { type: "toast"; text: string; undo?: { kind: "remove-series"; seriesId: string } };

const CHANNEL = "manwhatrack";
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel(CHANNEL);
  return channel;
}

export function publish(msg: BusMessage): void {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    // Channel closed (context shutting down); receivers will refresh on next open.
  }
}

export function subscribe(cb: (msg: BusMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (ev: MessageEvent<BusMessage>) => cb(ev.data);
  return () => ch.close();
}
