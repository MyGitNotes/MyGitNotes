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
