// The service worker has no DOMParser, so fetched pages are parsed in an offscreen document.

import type { PageObservation } from "../detection/types";
import type { OffscreenParseMessage } from "../shared/messages";
import type { SiteRule } from "../shared/types/settings";

const PATH = "offscreen.html";
let creating: Promise<void> | null = null;

async function ensureDocument(): Promise<void> {
  const url = chrome.runtime.getURL(PATH);
  const contexts = await chrome.runtime.getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType], documentUrls: [url] });
  if (contexts && contexts.length) return;
  creating ??= chrome.offscreen
    .createDocument({ url: PATH, reasons: ["DOM_PARSER" as chrome.offscreen.Reason], justification: "Parse tracked series pages to find new chapters." })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export async function parseInOffscreen(html: string, url: string, siteRules: SiteRule[]): Promise<PageObservation | null> {
  await ensureDocument();
  const msg: OffscreenParseMessage = { target: "offscreen", type: "offscreen/parse", html, url, siteRules };
  const res = (await chrome.runtime.sendMessage(msg)) as { observation?: PageObservation } | undefined;
  return res?.observation ?? null;
}

export async function closeOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Not open.
  }
}
