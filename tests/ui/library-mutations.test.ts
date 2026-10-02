// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createSeries } from '../../src/storage/schema';

const records = vi.hoisted(() => ({ series: [] as unknown[], queue: [] as string[] }));
vi.mock('../../src/storage/repositories/series', () => ({ listSeries: async () => records.series }));
vi.mock('../../src/storage/repositories/sources', () => ({ listSources: async () => [] }));
vi.mock('../../src/storage/repositories/queue', () => ({ getQueue: async () => records.queue }));
vi.mock('../../src/shared/bus', () => ({ publish: vi.fn(), subscribe: () => () => undefined }));
import { useLibrary } from '../../src/ui/hooks';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let lib: ReturnType<typeof useLibrary>;
function Harness() { lib = useLibrary(); return null; }
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

it('restores only the failed series while a later unrelated edit succeeds', async () => {
  const a = createSeries({ title: 'First' }), b = createSeries({ title: 'Second' });
  records.series = [a, b]; records.queue = [];
  await act(async () => root.render(createElement(Harness)));
  let results: boolean[] = [];
  await act(async () => {
    results = await Promise.all([
      lib.mutate([a.id], s => ({ ...s, favorite: true }), async () => { throw new Error('disk failure'); }),
      lib.mutate([b.id], s => ({ ...s, pinned: true }), async () => undefined),
    ]);
  });
  expect(results).toEqual([false, true]);
  expect(lib.byId.get(a.id)?.favorite).toBe(false);
  expect(lib.byId.get(b.id)?.pinned).toBe(true);
});

it('serializes queue edits against the restored queue after failure', async () => {
  records.series = []; records.queue = ['first'];
  await act(async () => root.render(createElement(Harness)));
  const persisted: string[][] = [];
  await act(async () => {
    const failed = lib.mutateQueue(q => [...q, 'failed'], async () => { throw new Error('disk failure'); });
    const next = lib.mutateQueue(q => [...q, 'second'], async q => { persisted.push(q); });
    expect(await failed).toBe(false);
    expect(await next).toBe(true);
  });
  expect(persisted).toEqual([['first', 'second']]);
  expect(lib.queue).toEqual(['first', 'second']);
});
