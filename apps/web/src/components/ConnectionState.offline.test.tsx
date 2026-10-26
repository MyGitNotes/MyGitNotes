// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoProvider } from '../lib/demo.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { ConnectionState } from './AuthControls.js';

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('github-notes:language', 'en');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ authenticated: false })));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = (error: string, onRetry = vi.fn(), demo = false) => act(async () => root.render(createElement(I18nProvider, null, createElement(DemoProvider, { value: demo ? { scenario: 'trpg' } : null }, createElement(ConnectionState, { loading: false, error, onRetry })))));

it('says the app is offline, lists the drafts of what this session opened, and retries by itself when the connection returns', async () => {
  localStorage.setItem('gh_notes_working:repo-1:main', JSON.stringify({ 'notes/a.md': { note: { title: 'Meeting notes' }, base: null } }));
  localStorage.setItem('gh_notes_opened_scopes', JSON.stringify(['repo-1:main']));
  const onRetry = vi.fn();
  await mount('Failed to fetch', onRetry);
  expect(container.textContent).toContain('You are offline');
  expect(container.textContent).toContain('Drafts kept in this browser');
  expect(container.textContent).toContain('Meeting notes');
  expect(container.textContent).not.toContain('Failed to fetch');

  await act(async () => void window.dispatchEvent(new Event('online')));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('shows only a count of kept drafts, not their titles, when no session is on record', async () => {
  localStorage.setItem('gh_notes_working:repo-1:main', JSON.stringify({ 'notes/a.md': { note: { title: 'Meeting notes' }, base: null } }));
  localStorage.setItem('gh_notes_draft:repo-9:main:notes/b.md', JSON.stringify({ path: 'notes/b.md', content: 'x', metadata: { title: 'Someone else' }, savedAt: 1 }));
  await mount('Failed to fetch');
  expect(container.textContent).toContain('You are offline');
  expect(container.textContent).toContain('Drafts kept in this browser: 2');
  expect(container.textContent).not.toContain('Meeting notes');
  expect(container.textContent).not.toContain('Someone else');
});

it('says offline whenever the browser reports no connection, whatever the failure was', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await mount('The server answered 500');
  expect(container.textContent).toContain('You are offline');
});

it('keeps the server message for a failure that is not about the connection', async () => {
  await mount('The server answered 500');
  expect(container.textContent).toContain('The server answered 500');
  expect(container.textContent).not.toContain('You are offline');
});

const keepOwnAndDemoDrafts = () => {
  localStorage.setItem('gh_notes_working:repo-1:main', JSON.stringify({ 'notes/a.md': { note: { title: 'Meeting notes' }, base: null } }));
  localStorage.setItem('gh_notes_opened_scopes', JSON.stringify(['repo-1:main']));
  localStorage.setItem('gh_notes_working:demo:edition:demo:scenarios@main:main', JSON.stringify({ 'notes/b.md': { note: { title: 'Demo edit' }, base: null }, 'notes/c.md': { note: { title: 'Demo edit two' }, base: null } }));
};

it('does not count the demo’s drafts among the drafts of the person’s notes', async () => {
  keepOwnAndDemoDrafts();
  localStorage.removeItem('gh_notes_opened_scopes');
  await mount('Failed to fetch');
  expect(container.textContent).toContain('Drafts kept in this browser: 1');
  expect(container.textContent).not.toContain('Demo edit');
});

it('lists the person’s drafts by title in a tab that is not the demo, whatever the demo kept', async () => {
  keepOwnAndDemoDrafts();
  await mount('Failed to fetch');
  expect(container.textContent).toContain('Meeting notes');
  expect(container.textContent).not.toContain('Demo edit');
});

it('lists no title of the person’s notes in the demo, and counts only the demo’s own drafts', async () => {
  keepOwnAndDemoDrafts();
  await mount('Failed to fetch', vi.fn(), true);
  expect(container.textContent).toContain('You are offline');
  expect(container.textContent).not.toContain('Meeting notes');
  expect(container.textContent).not.toContain('Demo edit');
  expect(container.textContent).toContain('Drafts kept in this browser: 2');
});
