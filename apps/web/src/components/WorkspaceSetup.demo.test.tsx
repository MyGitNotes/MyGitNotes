// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceGate } from './WorkspaceSetup.js';
import { DemoProvider } from '../lib/demo.js';
import { I18nProvider } from '../lib/i18n/index.js';

vi.mock('./AuthControls.js', () => ({ AuthControls: () => createElement('a', { href: '/api/auth/github' }, 'Sign in with GitHub'), ConnectionState: () => createElement('p', null, 'Opening workspace') }));

let root: Root;
let container: HTMLElement;
let requests: string[];
let cookies: string[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const demoRepository = { id: 'edition:demo:scenarios@main', demo: true, write: false };

function serve(session: unknown, workspace: unknown = { repositories: [demoRepository] }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input);
    requests.push(url);
    cookies.push(document.cookie);
    if (url === '/api/auth/session') return json(session);
    if (url === '/api/workspace') return json(workspace);
    throw new Error(`Unexpected request ${url}`);
  });
}
const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)));
async function render() {
  await act(async () => root.render(createElement(I18nProvider, null, createElement(DemoProvider, { value: { scenario: 'trpg' } }, createElement(WorkspaceGate, null, createElement('p', null, 'workspace'))))));
  await settle();
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  localStorage.setItem('github-notes:language', 'zh-TW');
  document.cookie = 'mygitnotes_demo=; Max-Age=0; Path=/';
  requests = [];
  cookies = [];
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

it('writes the language cookie before any request, then opens the workspace for a signed-out visitor without a sign-in screen', async () => {
  serve({ authenticated: false, demo: true });
  await render();
  expect(container.textContent).toBe('workspace');
  expect(cookies[0]).toContain('mygitnotes_demo=zh-tw');
  expect(requests).toEqual(['/api/auth/session', '/api/workspace']);
});

it('says the demo is not available, with a sign-in link, when the deployment offers none', async () => {
  serve({ authenticated: false });
  await render();
  expect(container.textContent).toContain('目前沒有提供示範');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/');
  expect(container.textContent).not.toContain('workspace');
});

it('tells a signed-in browser it opens their own notes instead of the demo', async () => {
  serve({ authenticated: true, demo: true });
  await render();
  expect(container.textContent).toContain('你已經登入');
  expect(container.textContent).not.toContain('workspace');
  expect(requests).toEqual(['/api/auth/session']);
});

it('asks for cookies when the workspace comes back without the demo repository, and tries again on request', async () => {
  serve({ authenticated: false, demo: true }, { repositories: [] });
  await render();
  expect(container.textContent).toContain('Cookie');
  serve({ authenticated: false, demo: true });
  await act(async () => ([...container.querySelectorAll('button')].find(candidate => candidate.textContent === '再試一次') as HTMLButtonElement).click());
  await settle();
  await settle();
  expect(container.textContent).toBe('workspace');
});
