// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthControls } from './AuthControls.js';

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

it('shows the Google mark on a white backing and keeps the GitHub icon', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ authenticated: false, signInOptions: [{ id: 'github', label: 'GitHub', url: '/api/auth/github' }, { id: 'google', label: 'Google', url: '/api/auth/google' }] })));
  await act(async () => root.render(createElement(AuthControls, { connection: true })));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const google = container.querySelector('a[href="/api/auth/google"]')!;
  expect(google.textContent).toContain('Sign in with Google');
  expect(google.querySelector('span[style] svg')).not.toBeNull();
  expect(google.querySelectorAll('svg path')).toHaveLength(4);
  const github = container.querySelector('a[href="/api/auth/github"]')!;
  expect(github.querySelector('span[style]')).toBeNull();
  expect(github.querySelector('svg')).not.toBeNull();
});
