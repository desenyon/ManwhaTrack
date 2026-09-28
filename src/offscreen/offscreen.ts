// Offscreen document: parses fetched series pages with DOMParser for update checks.
// Parsed documents are inert (no scripts run, no subresources load).

import { detectPage } from "../detection";
import type { OffscreenParseMessage } from "../shared/messages";

chrome.runtime.onMessage.addListener((msg: OffscreenParseMessage, _sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "offscreen/parse") return false;
  try {
    const doc = new DOMParser().parseFromString(msg.html, "text/html");
    const observation = detectPage(doc, new URL(msg.url), { siteRules: msg.siteRules });
    sendResponse({ observation });
  } catch {
    sendResponse({ observation: null });
  }
  return false;
});
