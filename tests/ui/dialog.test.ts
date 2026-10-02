// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from '../../src/ui/Menu';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const show = vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open', ''); });
const close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute('open'); });
Object.assign(HTMLDialogElement.prototype, { showModal: show, close });
const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); document.querySelectorAll('[data-trigger]').forEach(el => el.remove()); vi.clearAllMocks(); });

it('opens once, preserves input focus across callback changes, and restores the trigger', async () => {
  const trigger = document.createElement('button');
  trigger.dataset.trigger = '';
  document.body.append(trigger);
  trigger.focus();
  const render = (onClose: () => void) => createElement(Dialog, { title: 'Edit title', onClose, children: createElement('input', { 'aria-label': 'Title' }) });
  await act(async () => root.render(render(vi.fn())));
  const input = host.querySelector('input')!;
  expect(document.activeElement).toBe(input);
  input.value = 'A corrected title';
  await act(async () => root.render(render(vi.fn())));
  expect(show).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('A corrected title');
  await act(async () => root.render(null));
  expect(close).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(trigger);
});

it('uses the latest close callback for native Escape cancellation', async () => {
  const oldClose = vi.fn(), latestClose = vi.fn();
  await act(async () => root.render(createElement(Dialog, { title: 'Confirm', onClose: oldClose, children: createElement('button', {}, 'Cancel') })));
  await act(async () => root.render(createElement(Dialog, { title: 'Confirm', onClose: latestClose, children: createElement('button', {}, 'Cancel') })));
  const event = new Event('cancel', { bubbles: false, cancelable: true });
  await act(async () => host.querySelector('dialog')!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(oldClose).not.toHaveBeenCalled();
  expect(latestClose).toHaveBeenCalledOnce();
});

it('cycles Tab and Shift+Tab at the modal edges without focusing browser chrome', async () => {
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  await act(async () => root.render(createElement(Dialog, { title: 'Edit', onClose: vi.fn(), children: [createElement('input', { key: 'first' }), createElement('button', { key: 'last' }, 'Save')] })));
  const first = host.querySelector('input')!, last = host.querySelector('button')!;
  last.focus();
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  await act(async () => last.dispatchEvent(tab));
  expect(tab.defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
  const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  await act(async () => first.dispatchEvent(back));
  expect(back.defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
  rects.mockRestore();
});
