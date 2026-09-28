import { useEffect, useState } from "react";
import { DEFAULT_SHORTCUTS, type ShortcutAction } from "../../shared/types/settings";
import { displayShortcut, shortcutFromEvent } from "../../shared/utils/keys";
import { SHORTCUT_LABEL } from "../../sidepanel/components/ShortcutsHelp";
import type { SectionProps } from "./General";

// Browser shortcuts ManwhaTrack must not take over.
const RESERVED = new Set(["Mod+T", "Mod+W", "Mod+N", "Mod+L", "Mod+R", "Mod+Q", "Mod+F", "Mod+P", "Mod+S", "Mod+D", "Mod+H", "Mod+J", "Mod+C", "Mod+V", "Mod+X", "Mod+A", "Mod+Z", "Tab", "Shift+Tab"]);

export function ShortcutsSection({ settings, update }: SectionProps) {
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [warning, setWarning] = useState<string>();

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && capturing !== "back") {
        setCapturing(null);
        return;
      }
      const spec = shortcutFromEvent(e);
      if (!spec) return;
      if (RESERVED.has(spec)) {
        setWarning(`${displayShortcut(spec)} is a browser shortcut and can't be used.`);
        return;
      }
      const clash = (Object.keys(settings.shortcuts) as ShortcutAction[]).find((k) => k !== capturing && settings.shortcuts[k] === spec);
      if (clash) {
        setWarning(`${displayShortcut(spec)} is already used for “${SHORTCUT_LABEL[clash]}”.`);
        return;
      }
      setWarning(undefined);
      void update({ shortcuts: { ...settings.shortcuts, [capturing]: spec } });
      setCapturing(null);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [capturing, settings.shortcuts, update]);

  return (
    <>
      <h1>Keyboard shortcuts</h1>
      <p className="lead">Shortcuts work inside the side panel and never while typing in a field. Press <kbd>?</kbd> in the panel to see them.</p>
      <table className="t">
        <tbody>
          {(Object.keys(SHORTCUT_LABEL) as ShortcutAction[]).map((k) => (
            <tr key={k}>
              <td>{SHORTCUT_LABEL[k]}</td>
              <td><kbd>{displayShortcut(settings.shortcuts[k])}</kbd></td>
              <td style={{ textAlign: "right" }}>
                <button className="btn sm" onClick={() => { setWarning(undefined); setCapturing(k); }}>{capturing === k ? "Press keys…" : "Change"}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {warning && <p role="alert" style={{ color: "var(--danger)" }}>{warning}</p>}
      <button className="btn" style={{ marginTop: 12 }} onClick={() => void update({ shortcuts: { ...DEFAULT_SHORTCUTS } })}>Restore defaults</button>
      <h2>Browser-wide</h2>
      <p className="small muted">
        Opening ManwhaTrack and “Mark the current chapter read” can be given global shortcuts at chrome://extensions/shortcuts. In the address bar, type <kbd>mt</kbd> then a space to search your library.
      </p>
    </>
  );
}
