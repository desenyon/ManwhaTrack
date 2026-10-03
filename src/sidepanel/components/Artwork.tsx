import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Settings } from "../../shared/types/settings";
import { Icon } from "../../ui/icons";

function useArtworkVisibility<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let intersecting = false;
    const update = () => setVisible(intersecting && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { intersecting = !!entry?.isIntersecting; update(); });
    if (ref.current) observer.observe(ref.current);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  return { ref, visible };
}

/** Animate visible artwork only; CSS applies the saved motion preference. */
export function HandsScene({ className = "" }: { className?: string }) {
  const { ref, visible } = useArtworkVisibility<HTMLDivElement>();
  return <div ref={ref} className={`hands-scene ${className}`} data-visible={visible} aria-hidden="true">
    <img className="scene-clouds" src="assets/violet-clouds.png" alt="" />
    <img className="scene-hand scene-hand-left" src="assets/violet-hands-layer.png" alt="" />
    <img className="scene-hand scene-hand-right" src="assets/violet-hands-layer.png" alt="" />
  </div>;
}

/** Existing local pixel artwork stays in the wide-screen gutters, behind no controls. */
export function MarginScenery() {
  const { ref, visible } = useArtworkVisibility<HTMLDivElement>();
  return <div ref={ref} className="margin-scenery" data-visible={visible} aria-hidden="true">
    {["left", "right"].map(side => <div className={`margin-panel margin-${side}`} key={side}><span className="margin-clouds" style={{ backgroundImage: "url(assets/violet-clouds.png)" }} /><span className="margin-landscape" style={{ backgroundImage: "url(assets/violet-landscape.png)" }} /></div>)}
  </div>;
}

export function LibraryFooter({ count, motion, onMotion }: { count: number; motion: Settings["artworkMotion"]; onMotion: (motion: Settings["artworkMotion"]) => void }) {
  const { ref, visible } = useArtworkVisibility<HTMLElement>();
  const [height, setHeight] = useState(140);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const footer = ref.current;
    const scroll = footer?.closest<HTMLElement>(".scroll");
    const content = footer?.parentElement?.querySelector<HTMLElement>(".library-content");
    const caption = footer?.querySelector<HTMLElement>(".colophon-caption");
    if (!footer || !scroll || !content || !caption) return;
    const resize = () => setHeight(Math.round(Math.max(84, Math.min(360, scroll.clientHeight - content.getBoundingClientRect().height - caption.getBoundingClientRect().height - 62))));
    const observer = new ResizeObserver(resize);
    for (const el of [scroll, content, caption]) observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, [count, ref]);
  const playing = motion === "on" || motion === "system" && !reduced;
  return <footer ref={ref} data-visible={visible} style={{ "--landscape-height": `${height}px` } as CSSProperties} className={`colophon ${count <= 3 ? "colophon-roomy" : count <= 10 ? "colophon-balanced" : "colophon-compact"}`}>
    <div className="colophon-caption"><div><strong>Your collection, kept locally.</strong><p>Your library stays on this device.</p></div>
      <button className="btn sm ghost motion-control" aria-label={playing ? "Pause artwork animation" : "Play artwork animation"} title={!playing && motion === "system" && reduced ? "Your device prefers reduced motion. Play to enable artwork." : undefined} onClick={() => onMotion(playing ? "off" : "on")}><Icon name={playing ? "pause" : "play"} /><span>{playing ? "Pause" : "Play"}</span></button>
    </div>
    <div className="landscape-scene" aria-hidden="true"><img className="landscape-image" src="assets/violet-landscape.png" alt="" loading="lazy" /><span className="landscape-clouds" style={{ backgroundImage: "url(assets/violet-clouds.png)" }} /><span className="river-shimmer" /></div>
  </footer>;
}
