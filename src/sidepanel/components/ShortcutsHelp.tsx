import type { Settings, ShortcutAction } from "../../shared/types/settings";
import { displayShortcut } from "../../shared/utils/keys";
import { Dialog } from "../../ui/Menu";

export const SHORTCUT_LABEL: Record<ShortcutAction, string> = {
  search: "Search",
  next: "Next item",
  prev: "Previous item",
  open: "Continue selected",
  favorite: "Favorite",
  markRead: "Mark read",
  markUnread: "Mark unread",
  back: "Back / close",
  palette: "Command palette",
};

export function ShortcutsHelp({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <dl className="kv" style={{ fontSize: 13 }}>
        {(Object.keys(SHORTCUT_LABEL) as ShortcutAction[]).map((k) => (
          <div key={k} style={{ display: "contents" }}>
            <dt><kbd>{displayShortcut(settings.shortcuts[k])}</kbd></dt>
            <dd>{SHORTCUT_LABEL[k]}</dd>
          </div>
        ))}
        <dt><kbd>?</kbd></dt>
        <dd>Show this list</dd>
      </dl>
      <p className="small muted">Arrow keys also move through the list. Shortcuts can be changed in Settings.</p>
      <div className="actions">
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
