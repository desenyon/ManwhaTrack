// Direct requests to reading sites (covers, update checks). Many image CDNs reject
// requests without a same-site Referer, so a temporary session rule adds one for the
// duration of the request — scoped to requests initiated by this extension only.

const TIMEOUT_MS = 20_000;
let nextRuleId = Math.floor(Math.random() * 1_000_000) + 1000;

async function withReferer<T>(url: string, referer: string | undefined, fn: () => Promise<T>): Promise<T> {
  const dnr = chrome.declarativeNetRequest;
  if (!referer || !dnr?.updateSessionRules) return fn();
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return fn();
  }
  const id = nextRuleId++;
  const rule: chrome.declarativeNetRequest.Rule = {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [{ header: "referer", operation: "set" as chrome.declarativeNetRequest.HeaderOperation, value: referer }],
    },
    condition: {
      requestDomains: [host],
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ["xmlhttprequest", "other"] as chrome.declarativeNetRequest.ResourceType[],
    },
  };
  try {
    await dnr.updateSessionRules({ addRules: [rule] });
  } catch {
    return fn();
  }
  try {
    return await fn();
  } finally {
    await dnr.updateSessionRules({ removeRuleIds: [id] }).catch(() => undefined);
  }
}

export interface FetchedText {
  ok: boolean;
  status: number;
  text: string;
  finalUrl: string;
  redirected: boolean;
}

export async function fetchText(url: string, opts: { referer?: string; method?: "GET" | "POST"; maxBytes?: number } = {}): Promise<FetchedText> {
  return withReferer(url, opts.referer, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        credentials: "omit",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      const text = res.ok ? (await res.text()).slice(0, opts.maxBytes ?? 4_000_000) : "";
      return { ok: res.ok, status: res.status, text, finalUrl: res.url || url, redirected: res.redirected };
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function fetchImage(url: string, referer?: string): Promise<Blob> {
  return withReferer(url, referer, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { credentials: "omit", signal: ctrl.signal, headers: { Accept: "image/avif,image/webp,image/*" } });
      if (!res.ok) throw new Error(`Cover could not be downloaded (HTTP ${res.status}).`);
      const blob = await res.blob();
      if (!/^image\//.test(blob.type) && !(await looksLikeImage(blob))) throw new Error("Cover could not be downloaded: not an image.");
      if (blob.size > 8_000_000) throw new Error("Cover could not be downloaded: file too large.");
      return blob;
    } finally {
      clearTimeout(timer);
    }
  });
}

async function looksLikeImage(blob: Blob): Promise<boolean> {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const sig = (arr: number[], off = 0) => arr.every((v, i) => b[off + i] === v);
  return sig([0xff, 0xd8, 0xff]) || sig([0x89, 0x50, 0x4e, 0x47]) || sig([0x47, 0x49, 0x46]) || (sig([0x52, 0x49, 0x46, 0x46]) && sig([0x57, 0x45, 0x42, 0x50], 8));
}
