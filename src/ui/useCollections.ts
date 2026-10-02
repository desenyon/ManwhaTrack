import { useCallback, useEffect, useRef, useState } from "react";
import type { Collection } from "../shared/types/collections";
import { subscribe } from "../shared/bus";
import { listCollections } from "../storage/repositories/collections";

export function useCollections() {
  const [data, setData] = useState<{ collections: Collection[]; loaded: boolean; error?: string }>({ collections: [], loaded: false });
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const collections = await listCollections();
      if (current === generation.current) setData({ collections, loaded: true });
    } catch {
      if (current === generation.current) setData(d => ({ ...d, loaded: true, error: "Your lists could not be loaded." }));
    }
  }, []);
  useEffect(() => {
    void reload();
    const unsubscribe = subscribe(msg => { if (msg.type === "library-changed") void reload(); });
    return () => { generation.current++; unsubscribe(); };
  }, [reload]);
  return { ...data, reload };
}
