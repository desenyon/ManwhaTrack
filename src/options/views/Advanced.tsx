import { useState } from "react";
import { Setting, Toggle, type SectionProps } from "./General";

export function AdvancedSection({ settings, update }: SectionProps) {
  const [host, setHost] = useState("");
  return (
    <>
      <h1>Advanced</h1>
      <Setting title="Debug mode" desc="Prints detection and tracking details to this extension's own console. Nothing is sent anywhere.">
        <Toggle label="Debug mode" checked={settings.debug} onChange={(v) => void update({ debug: v })} />
      </Setting>
      <Setting
        title="Track in Incognito windows"
        desc="Off by default. Also requires “Allow in Incognito” on chrome://extensions. When on, Incognito reading is added to this same library on this device."
      >
        <Toggle label="Track in Incognito windows" checked={settings.trackIncognito} onChange={(v) => void update({ trackIncognito: v })} />
      </Setting>

      <h2>Sites to ignore</h2>
      <p className="small muted">ManwhaTrack will not look at pages on these sites at all.</p>
      <div className="row">
        <input className="input" placeholder="example.com" aria-label="Site to ignore" value={host} onChange={(e) => setHost(e.target.value)} />
        <button
          className="btn"
          disabled={!/^[\w.*-]+\.[a-z]{2,}$/i.test(host.trim())}
          onClick={() => {
            void update({ ignoredHosts: [...new Set([...settings.ignoredHosts, host.trim().toLowerCase()])] });
            setHost("");
          }}
        >
          Add
        </button>
      </div>
      <ul>
        {settings.ignoredHosts.map((h) => (
          <li key={h} className="row">
            {h}
            <button className="btn sm ghost" onClick={() => void update({ ignoredHosts: settings.ignoredHosts.filter((x) => x !== h) })}>Remove</button>
          </li>
        ))}
      </ul>
    </>
  );
}
