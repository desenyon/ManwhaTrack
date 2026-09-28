import { useState } from "react";

export function TagEditor({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => {
    const v = t.trim();
    if (v && !tags.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...tags, v]);
    setDraft("");
  };
  const listId = "tag-suggestions";
  return (
    <div className="tags">
      {tags.map((t) => (
        <span key={t} className="chip">
          {t}
          <button className="x" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <input
        className="input"
        style={{ height: 24, width: 110, fontSize: 12 }}
        placeholder="Add tag"
        aria-label="Add tag"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !tags.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
