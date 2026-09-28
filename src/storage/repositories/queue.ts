// Optional reading queue. Membership never changes progress or status.

import { read, write } from "../db";

type QueueRecord = { key: "queue"; value: string[] };

export async function getQueue(): Promise<string[]> {
  const rec = await read(["meta"], (t) => t.get<QueueRecord>("meta", "queue"));
  return Array.isArray(rec?.value) ? rec.value.filter((x) => typeof x === "string") : [];
}

export async function setQueue(ids: string[]): Promise<void> {
  await write(["meta"], (t) => t.put("meta", { key: "queue", value: [...new Set(ids)] }));
}

export async function addToQueue(id: string): Promise<void> {
  const q = await getQueue();
  if (!q.includes(id)) await setQueue([...q, id]);
}

export async function removeFromQueue(id: string): Promise<void> {
  await setQueue((await getQueue()).filter((x) => x !== id));
}

export function moveInQueue(queue: string[], id: string, delta: number): string[] {
  const i = queue.indexOf(id);
  if (i < 0) return queue;
  const j = Math.max(0, Math.min(queue.length - 1, i + delta));
  const next = [...queue];
  next.splice(i, 1);
  next.splice(j, 0, id);
  return next;
}
