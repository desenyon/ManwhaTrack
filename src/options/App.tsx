import { useEffect, useLayoutEffect, useState } from "react";
import { Brand } from "../ui/Brand";
import { useSettings, useTheme } from "../ui/hooks";
import { GeneralSection } from "./views/General";
import { DataSection } from "./views/Data";
import { StorageSection } from "./views/Storage";
import { RulesSection } from "./views/Rules";
import { SourcesSection } from "./views/Sources";
import { StatsSection } from "./views/Stats";
import { ShortcutsSection } from "./views/Shortcuts";
import { AdvancedSection } from "./views/Advanced";

const SECTIONS = [
  ["general", "General"],
  ["data", "Import & export"],
  ["storage", "Storage & privacy"],
  ["sources", "Sources"],
  ["stats", "Statistics"],
  ["rules", "Site rules"],
  ["shortcuts", "Shortcuts"],
  ["advanced", "Advanced"],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

function sectionFromHash(): { id: SectionId; params: URLSearchParams } {
  const [id, query] = location.hash.slice(1).split("?");
  const known = SECTIONS.some(([s]) => s === id);
  return { id: known ? (id as SectionId) : "general", params: new URLSearchParams(query ?? "") };
}

export function App() {
  const [settings, update] = useSettings();
  useTheme(settings.theme);
  useEffect(() => { document.documentElement.dataset.scrollbars = settings.showScrollbars ? "visible" : "hidden"; }, [settings.showScrollbars]);
  const [route, setRoute] = useState(sectionFromHash);
  useLayoutEffect(() => { window.scrollTo({ top: 0 }); }, [route.id]);

  useEffect(() => {
    const onHash = () => setRoute(sectionFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = `${SECTIONS.find(([s]) => s === route.id)?.[1]} · ManwhaTrack`;
  }, [route.id]);

  return (
    <div className="opts">
      <nav aria-label="Settings sections">
        <div style={{ padding: "0 10px 12px" }}><Brand /></div>
        <a href="library.html">Open full library ↗</a>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-current={route.id === id ? "page" : undefined}>{label}</a>
        ))}
      </nav>
      <main>
        {route.id === "general" && <GeneralSection settings={settings} update={update} />}
        {route.id === "data" && <DataSection />}
        {route.id === "storage" && <StorageSection />}
        {route.id === "sources" && <SourcesSection />}
        {route.id === "stats" && <StatsSection />}
        {route.id === "rules" && <RulesSection settings={settings} update={update} prefillHost={route.params.get("host") ?? undefined} />}
        {route.id === "shortcuts" && <ShortcutsSection settings={settings} update={update} />}
        {route.id === "advanced" && <AdvancedSection settings={settings} update={update} />}
      </main>
    </div>
  );
}
