import type { Settings } from "../../shared/types/settings";
import { sendToWorker } from "../../shared/messages";
import { useToast } from "../../ui/toasts";

export interface SectionProps {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />;
}

export function Setting({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div>{title}</div>
      <div>{children}</div>
      {desc && <div className="desc">{desc}</div>}
    </div>
  );
}

export function GeneralSection({ settings, update }: SectionProps) {
  const toast = useToast();

  const setNotifications = async (mode: Settings["notifications"]) => {
    if (mode !== "off") {
      // Requested only when the user turns the feature on.
      const granted = await chrome.permissions.request({ permissions: ["notifications"] }).catch(() => false);
      if (!granted) {
        toast.show("Notifications were not allowed, so they stay off.", { error: true });
        return;
      }
    }
    await update({ notifications: mode });
    void sendToWorker({ type: "notifications/changed" });
  };

  return (
    <>
      <h1>General</h1>
      <p className="lead">ManwhaTrack tracks series and chapters automatically as you read.</p>

      <Setting title="Theme">
        <select className="select" value={settings.theme} onChange={(e) => void update({ theme: e.target.value as Settings["theme"] })}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Setting>
      <Setting title="Library layout">
        <select className="select" value={settings.layout} onChange={(e) => void update({ layout: e.target.value as Settings["layout"] })}>
          <option value="list">Compact list</option>
          <option value="grid">Grid</option>
        </select>
      </Setting>
      <Setting title="Continue opens in" desc="Ctrl/⌘-click or middle-click always opens a new tab.">
        <select className="select" value={settings.continueIn} onChange={(e) => void update({ continueIn: e.target.value as Settings["continueIn"] })}>
          <option value="current">Current tab</option>
          <option value="new">New tab</option>
        </select>
      </Setting>
      <Setting title="Chapter counts as read at" desc="Measured through the chapter's reader area, not the whole page. Clicking the site's Next Chapter link also marks it read.">
        <select className="select" value={settings.completionThreshold} onChange={(e) => void update({ completionThreshold: Number(e.target.value) })}>
          {[0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1].map((v) => (
            <option key={v} value={v}>{Math.round(v * 100)}%</option>
          ))}
        </select>
      </Setting>
      <Setting title="Show “Tracking …” confirmation" desc="A small note with Undo in the page corner when a new series is added.">
        <Toggle label="Show tracking confirmation" checked={settings.showTrackingToast} onChange={(v) => void update({ showTrackingToast: v })} />
      </Setting>

      <h2>New chapters</h2>
      <Setting title="Check tracked sources occasionally" desc="While Chrome is open, ManwhaTrack requests series pages directly from their sites — a few per run, one per site, with longer waits after errors.">
        <Toggle label="Check for new chapters" checked={settings.updateChecks} onChange={(v) => void update({ updateChecks: v })} />
      </Setting>
      <Setting title="Minimum time between checks of one source">
        <select className="select" value={settings.updateIntervalHours} disabled={!settings.updateChecks} onChange={(e) => void update({ updateIntervalHours: Number(e.target.value) })}>
          {[6, 12, 24, 48, 168].map((h) => (
            <option key={h} value={h}>{h < 24 ? `${h} hours` : h === 168 ? "1 week" : `${h / 24} day${h > 24 ? "s" : ""}`}</option>
          ))}
        </select>
      </Setting>
      <Setting title="Toolbar badge" desc="Number of series with new chapters.">
        <Toggle label="Toolbar badge" checked={settings.badge} onChange={(v) => void update({ badge: v })} />
      </Setting>
      <Setting title="Notifications" desc="Chrome will ask for permission when you turn this on.">
        <select className="select" value={settings.notifications} onChange={(e) => void setNotifications(e.target.value as Settings["notifications"])}>
          <option value="off">Off</option>
          <option value="favorites">Only favorites</option>
          <option value="all">All tracked series</option>
        </select>
      </Setting>
    </>
  );
}
