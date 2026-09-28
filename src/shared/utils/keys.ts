// Keyboard shortcut matching for customizable shortcuts like "Shift+R" or "Mod+K".

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function matchesShortcut(e: KeyboardEvent, spec: string): boolean {
  if (!spec) return false;
  const parts = spec.split("+").map((p) => p.trim());
  const key = parts.pop() ?? "";
  const want = new Set(parts.map((p) => p.toLowerCase()));
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (want.has("mod") !== mod) return false;
  if (want.has("shift") !== e.shiftKey) return false;
  if (want.has("alt") !== e.altKey) return false;
  if (!want.has("mod")) {
    if (want.has("ctrl") !== e.ctrlKey) return false;
    if (want.has("meta") !== e.metaKey) return false;
  }
  const k = key.length === 1 ? key.toLowerCase() : key;
  const ek = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === ek) return true;
  // Arrow aliases used by default navigation keys.
  return (k === "j" && ek === "ArrowDown" && !e.shiftKey) || (k === "k" && ek === "ArrowUp" && !e.shiftKey && !mod);
}

export function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (isMac() ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key.length === 1 ? (parts.length ? e.key.toUpperCase() : e.key.toLowerCase()) : e.key);
  return parts.join("+");
}

export function displayShortcut(spec: string): string {
  return spec.replace("Mod", isMac() ? "⌘" : "Ctrl").replace("Escape", "Esc").replace("ArrowDown", "↓").replace("ArrowUp", "↑");
}

/** Typing into inputs must never trigger single-key shortcuts. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}
