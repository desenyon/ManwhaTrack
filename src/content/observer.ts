// Watches for client-side route changes and late-loading content without rerunning
// detection on every mutation: mutation bursts are debounced, and re-detection on the
// same URL is capped.

const DEBOUNCE_MS = 800;
const MAX_SAME_URL_RERUNS = 4;

export interface PageWatcher {
  stop(): void;
  /** Called after a detection run: stop watching DOM churn once the result is solid. */
  settle(solid: boolean): void;
}

export function watchPage(onChange: (reason: "url" | "dom") => void): PageWatcher {
  let lastUrl = location.href;
  let reruns = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | null = null;

  const checkUrl = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      reruns = 0;
      ensureObserver();
      onChange("url");
      return true;
    }
    return false;
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (checkUrl()) return;
      if (reruns >= MAX_SAME_URL_RERUNS) return;
      reruns++;
      onChange("dom");
    }, DEBOUNCE_MS);
  };

  function ensureObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver((records) => {
      // Ignore attribute-only churn and tiny text updates.
      if (records.some((r) => r.addedNodes.length > 0)) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const nav = (globalThis as { navigation?: EventTarget }).navigation;
  const onNav = () => setTimeout(checkUrl, 50);
  nav?.addEventListener("currententrychange", onNav);
  addEventListener("popstate", onNav);
  addEventListener("hashchange", onNav);
  ensureObserver();

  return {
    stop() {
      observer?.disconnect();
      observer = null;
      if (timer) clearTimeout(timer);
      nav?.removeEventListener("currententrychange", onNav);
      removeEventListener("popstate", onNav);
      removeEventListener("hashchange", onNav);
    },
    settle(solid) {
      if (solid) reruns = MAX_SAME_URL_RERUNS;
      // Without the Navigation API, keep a mutation observer so pushState routes are noticed.
      if (solid && nav) {
        observer?.disconnect();
        observer = null;
      }
    },
  };
}
