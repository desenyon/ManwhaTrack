// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ add: vi.fn(), publish: vi.fn() }));
vi.mock('../../src/storage/manual', () => ({ addManualSeries: api.add }));
vi.mock('../../src/shared/bus', () => ({ publish: api.publish }));
import { ManualSeriesDialog } from '../../src/sidepanel/components/ManualSeriesDialog';
import { createSeries } from '../../src/storage/schema';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(HTMLDialogElement.prototype, { showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); }, close(this: HTMLDialogElement) { this.removeAttribute('open'); } });
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); vi.clearAllMocks(); });

it('blocks an unsafe address without writing or inventing a replacement', async () => {
  await act(async () => root.render(createElement(ManualSeriesDialog, { initial: { title: 'Local title', url: 'javascript:alert(1)' }, onClose: vi.fn(), onAdded: vi.fn() })));
  expect(host.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe('javascript:alert(1)');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.add).not.toHaveBeenCalled();
});

it('retains the entered fields after failure and publishes only after successful retry', async () => {
  const added = vi.fn(), series = createSeries({ title: 'Correct title' });
  api.add.mockRejectedValueOnce(new Error('Local storage is unavailable.')).mockResolvedValueOnce(series);
  await act(async () => root.render(createElement(ManualSeriesDialog, { initial: { title: 'Correct title', url: 'https://reading.example/series' }, onClose: vi.fn(), onAdded: added })));
  const submit = async () => { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Local storage is unavailable.');
  expect(host.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe('https://reading.example/series');
  expect(added).not.toHaveBeenCalled(); expect(api.publish).not.toHaveBeenCalled();
  await submit();
  expect(api.add).toHaveBeenLastCalledWith({ title: 'Correct title', url: 'https://reading.example/series', status: 'planning' });
  expect(api.publish).toHaveBeenCalledWith({ type: 'library-changed', seriesIds: [series.id] });
  expect(added).toHaveBeenCalledWith(series);
});
