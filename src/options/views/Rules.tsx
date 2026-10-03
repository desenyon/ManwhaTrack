// Local site rules for unsupported sites. Stored in chrome.storage.local only.

import { useState } from "react";
import type { SiteRule, SiteRuleSelectors } from "../../shared/types/settings";
import { Toggle, type SectionProps } from "./General";
import { useToast } from "../../ui/toasts";

const FIELDS: { key: keyof SiteRuleSelectors; label: string; placeholder: string }[] = [
  { key: "seriesTitle", label: "Series title", placeholder: "h1.series-title" },
  { key: "cover", label: "Cover image", placeholder: ".cover img" },
  { key: "chapterList", label: "Chapter list", placeholder: "ul.chapters" },
  { key: "chapterTitle", label: "Chapter title", placeholder: "h1.chapter-heading" },
  { key: "readerContainer", label: "Reader container", placeholder: "#reader" },
  { key: "nextChapter", label: "Next chapter link", placeholder: "a.next" },
  { key: "prevChapter", label: "Previous chapter link", placeholder: "a.prev" },
  { key: "seriesUrl", label: "Link to series page", placeholder: ".breadcrumb a:nth-child(2)" },
];

function validSelector(s: string | undefined): boolean {
  if (!s) return true;
  try {
    document.createDocumentFragment().querySelector(s);
    return true;
  } catch {
    return false;
  }
}

function validRegex(s: string | undefined): boolean {
  if (!s) return true;
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
}

const emptyRule = (host = ""): SiteRule => ({ id: crypto.randomUUID(), host, selectors: {}, enabled: true, updatedAt: Date.now() });

export function RulesSection({ settings, update, prefillHost }: SectionProps & { prefillHost?: string }) {
  const toast = useToast();
  const [editing, setEditing] = useState<SiteRule | null>(() => {
    if (!prefillHost) return null;
    return settings.siteRules.find((r) => r.host === prefillHost) ?? emptyRule(prefillHost);
  });

  const saveRule = async (rule: SiteRule) => {
    const others = settings.siteRules.filter((r) => r.id !== rule.id);
    await update({ siteRules: [...others, { ...rule, host: rule.host.trim().toLowerCase(), updatedAt: Date.now() }] });
    setEditing(null);
    toast.show("Site rule saved. Reload the site to apply it.");
  };

  const invalid = editing
    ? !editing.host.trim() || !FIELDS.every((f) => validSelector(editing.selectors[f.key])) || !validRegex(editing.chapterPathPattern)
    : false;

  return (
    <>
      <h1>Site rules</h1>
      <p className="lead">For sites ManwhaTrack doesn't detect well, tell it where things are with CSS selectors. Empty fields fall back to automatic detection.</p>

      {!editing && (
        <>
          {settings.siteRules.length === 0 ? (
            <p className="muted">No site rules yet.</p>
          ) : (
            <table className="t">
              <thead><tr><th>Site</th><th>Selectors</th><th>Enabled</th><th /></tr></thead>
              <tbody>
                {settings.siteRules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.host}</td>
                    <td className="muted">{Object.values(r.selectors).filter(Boolean).length} set</td>
                    <td>
                      <Toggle label={`Enable rule for ${r.host}`} checked={r.enabled} onChange={v => void update({ siteRules: settings.siteRules.map(x => x.id === r.id ? { ...x, enabled: v } : x) })} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn sm" onClick={() => setEditing(r)}>Edit</button>{" "}
                      <button className="btn sm danger" onClick={() => { if (confirm(`Delete the local rule for ${r.host}? Automatic detection will be used instead.`)) void update({ siteRules: settings.siteRules.filter((x) => x.id !== r.id) }); }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setEditing(emptyRule())}>Add site rule</button>
        </>
      )}

      {editing && (
        <div className="card stack">
          <div className="form-grid">
            <label htmlFor="rule-host">Site</label>
            <input id="rule-host" className="input" placeholder="example.com or *.example.com" value={editing.host} onChange={(e) => setEditing({ ...editing, host: e.target.value })} />
            <label htmlFor="rule-path">Chapter URL pattern</label>
            <input id="rule-path" className="input" placeholder="/read/.+/\d+ (regular expression, optional)" value={editing.chapterPathPattern ?? ""} onChange={(e) => setEditing({ ...editing, chapterPathPattern: e.target.value || undefined })} aria-invalid={!validRegex(editing.chapterPathPattern)} />
            {FIELDS.map((f) => (
              <FieldRow key={f.key} f={f} value={editing.selectors[f.key]} onChange={(v) => setEditing({ ...editing, selectors: { ...editing.selectors, [f.key]: v || undefined } })} />
            ))}
          </div>
          {invalid && <p className="small" style={{ color: "var(--danger)" }}>Enter a site and fix any invalid selector or pattern.</p>}
          <p className="small muted">Tip: open the side panel's Detection Inspector on a page of this site to check the result after saving.</p>
          <div className="row">
            <button className="btn primary" disabled={invalid} onClick={() => void saveRule(editing)}>Save rule</button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

function FieldRow({ f, value, onChange }: { f: (typeof FIELDS)[number]; value?: string; onChange: (v: string) => void }) {
  const id = `rule-${f.key}`;
  return (
    <>
      <label htmlFor={id}>{f.label}</label>
      <input id={id} className="input" placeholder={f.placeholder} value={value ?? ""} aria-invalid={!validSelector(value)} onChange={(e) => onChange(e.target.value)} />
    </>
  );
}
