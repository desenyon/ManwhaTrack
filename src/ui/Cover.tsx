// Displays a locally cached cover blob. Never loads remote images; never shows a broken icon.

import { useEffect, useState } from "react";
import { getCover } from "../storage/repositories/covers";

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function loadCoverUrl(id: string): Promise<string | null> {
  const cached = urls.get(id);
  if (cached) return Promise.resolve(cached);
  let p = pending.get(id);
  if (!p) {
    p = getCover(id)
      .then((c) => {
        if (!c?.blob) return null;
        const u = URL.createObjectURL(c.blob);
        urls.set(id, u);
        return u;
      })
      .catch(() => null)
      .finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

export function useCoverUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(id ? urls.get(id) ?? null : null);
  useEffect(() => {
    let live = true;
    if (!id) {
      setUrl(null);
      return;
    }
    setUrl(urls.get(id) ?? null);
    void loadCoverUrl(id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

export function Cover({ coverId, title, size, children }: { coverId?: string; title: string; size?: "md" | "lg"; children?: React.ReactNode }) {
  const url = useCoverUrl(coverId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = (title.trim()[0] ?? "?").toUpperCase();
  return (
    <div className={`cover ${size ?? ""}`}>
      {url && failedUrl !== url ? <img src={url} alt={`Cover of ${title}`} loading="lazy" decoding="async" onError={() => setFailedUrl(url)} /> : <span aria-hidden="true">{initial}</span>}
      {children}
    </div>
  );
}
