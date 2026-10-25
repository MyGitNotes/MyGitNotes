// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { announceUpdate, resetUpdateStore } from '../pwa/update-store.js';
import { UpdateNotice } from './UpdateNotice.js';

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('github-notes:language', 'en');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetUpdateStore();
  vi.unstubAllGlobals();
});

const mount = () => act(async () => root.render(createElement(I18nProvider, null, createElement(UpdateNotice))));
const button = (name: string) => [...container.querySelectorAll('button')].find(candidate => candidate.textContent === name)!;

it('shows nothing until a newer version waits', async () => {
  await mount();
  expect(container.textContent).toBe('');
});

it('offers the new version, and swaps only after Reload is pressed', async () => {
  const worker = { postMessage: vi.fn() };
  let swapped = () => {};
  vi.stubGlobal('navigator', { serviceWorker: { addEventListener: (_type: string, listener: () => void) => void (swapped = listener) } });
  await mount();
  await act(async () => announceUpdate(worker, true));
  expect(container.querySelector('[role=status]')?.textContent).toContain('A new version is available');
  expect(worker.postMessage).not.toHaveBeenCalled();

  await act(async () => button('Reload').click());
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  expect(swapped).toBeTypeOf('function');
});

it('hides the notice for now when the person chooses Later, and leaves the waiting worker alone', async () => {
  const worker = { postMessage: vi.fn() };
  await mount();
  await act(async () => announceUpdate(worker, true));
  await act(async () => button('Later').click());
  expect(container.textContent).toBe('');
  expect(worker.postMessage).not.toHaveBeenCalled();
});
