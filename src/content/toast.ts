// A small, temporary confirmation ("Tracking X · Undo"). Shown only when a series is
// newly tracked, never over reading content for long, and removable via Settings.

const DURATION_MS = 5000;

export function showTrackingToast(text: string, onUndo: () => void): void {
  document.getElementById("manwhatrack-toast-host")?.remove();
  const host = document.createElement("div");
  host.id = "manwhatrack-toast-host";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .t{display:flex;align-items:center;gap:12px;max-width:340px;padding:9px 10px 9px 14px;border-radius:8px;
      font:13px/1.3 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f3f4f6;
      background:#1f2328;border:1px solid #30363d;box-shadow:0 4px 16px rgba(0,0,0,.25);
      animation:in .16s ease-out}
    .x{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    button{all:unset;cursor:pointer;padding:3px 8px;border-radius:5px;color:#9ec1ff;font-weight:600}
    button:hover{background:#2d333b} button:focus-visible{outline:2px solid #9ec1ff}
    @keyframes in{from{opacity:0;transform:translateY(6px)}}
    @media (prefers-reduced-motion:reduce){.t{animation:none}}`;
  const box = document.createElement("div");
  box.className = "t";
  box.setAttribute("role", "status");
  const label = document.createElement("span");
  label.className = "x";
  label.textContent = text;
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "Undo";
  undo.addEventListener("click", () => {
    onUndo();
    host.remove();
  });
  box.append(label, undo);
  root.append(style, box);
  document.documentElement.append(host);

  let timer = setTimeout(() => host.remove(), DURATION_MS);
  box.addEventListener("mouseenter", () => clearTimeout(timer));
  box.addEventListener("mouseleave", () => {
    timer = setTimeout(() => host.remove(), 2000);
  });
}
