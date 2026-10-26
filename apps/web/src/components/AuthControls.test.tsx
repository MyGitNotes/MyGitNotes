// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountControls, AuthControls } from './AuthControls.js';
import { DemoProvider } from '../lib/demo.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { WebFeaturesProvider } from '../lib/web-features.js';

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it('stacks outlined sign-in buttons with the official provider marks', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ authenticated: false, signInOptions: [{ id: 'github', label: 'GitHub', url: '/api/auth/github' }, { id: 'google', label: 'Google', url: '/api/auth/google' }, { id: 'gitlab', label: 'GitLab', url: '/api/auth/gitlab' }] })));
  await act(async () => root.render(createElement(AuthControls, { connection: true })));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const google = container.querySelector('a[href="/api/auth/google"]')!;
  expect(google.textContent).toContain('Sign in with Google');
  expect(google.querySelectorAll('svg path')).toHaveLength(4);
  expect(google.querySelector('span[style]')).toBeNull();
  const github = container.querySelector('a[href="/api/auth/github"]')!;
  expect(github.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  const gitlab = container.querySelector('a[href="/api/auth/gitlab"]')!;
  expect(gitlab.querySelectorAll('svg path').length).toBeGreaterThan(0);
  for (const link of [google, github, gitlab]) {
    expect(link.className).toContain('ui-button');
    expect(link.className).not.toContain('ui-button-primary');
    expect(link.className).toContain('w-full');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  }
  expect(google.parentElement!.className).toContain('flex-col');
});

it('forgets which repositories the session opened when the person signs out', async () => {
  localStorage.setItem('gh_notes_opened_scopes', JSON.stringify(['repo-1:main']));
  localStorage.setItem('github-notes:language', 'en');
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(JSON.stringify(String(input) === '/api/auth/session' ? { authenticated: true, login: 'visitor' } : {})));
  await act(async () => root.render(createElement(I18nProvider, null, createElement(AuthControls))));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const signOut = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.includes('Sign out'))!;
  await act(async () => signOut.click());
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  expect(localStorage.getItem('gh_notes_opened_scopes')).toBeNull();
  expect(reload).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('renders nothing in the demo and asks the server for no session, so no sign-in or sign-out link leaves a demo page', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ authenticated: true, login: 'visitor', signInOptions: [{ id: 'github', label: 'GitHub', url: '/api/auth/github' }] })));
  await act(async () => root.render(createElement(I18nProvider, null, createElement(DemoProvider, { value: { scenario: 'trpg' } }, createElement(AuthControls)))));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  expect(container.innerHTML).toBe('');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('renders nothing in the demo for a signed-out visitor either, and for the connection screen’s sign-in buttons', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ authenticated: false, signInOptions: [{ id: 'github', label: 'GitHub', url: '/api/auth/github' }] })));
  await act(async () => root.render(createElement(I18nProvider, null, createElement(DemoProvider, { value: { scenario: 'trpg' } }, createElement(AuthControls, { connection: true })))));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  expect(container.querySelector('a')).toBeNull();
});

it('shows an edition’s account controls in place of the community ones, except in the demo', async () => {
  const features = [{ id: 'pro', accountControls: () => createElement('span', null, 'Edition menu') }];
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ authenticated: false, signInOptions: [] })));
  const mount = (demo: boolean) => act(async () => root.render(createElement(I18nProvider, null, createElement(WebFeaturesProvider, { features }, createElement(DemoProvider, { value: demo ? { scenario: 'trpg' } : null }, createElement(AccountControls, { local: false }))))));
  await mount(false);
  expect(container.textContent).toBe('Edition menu');
  await mount(true);
  expect(container.textContent).toBe('');
});
