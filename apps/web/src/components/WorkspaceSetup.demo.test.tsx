// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceGate } from './WorkspaceSetup.js';
import { DemoProvider, useDemo } from '../lib/demo.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { WebFeaturesProvider } from '../lib/web-features.js';

vi.mock('./AuthControls.js', () => ({ AuthControls: () => createElement('a', { href: '/api/auth/github' }, 'Sign in with GitHub'), ConnectionState: () => createElement('p', null, 'Opening workspace') }));

let root: Root;
let container: HTMLElement;
let requests: string[];
let calls: { url: string; policy?: string; }[];
let cookies: string[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const demoRepository = { id: 'edition:demo:scenarios@main', demo: true, write: false };

/**
 * `session` answers the probe a demo page sends as itself; `account` answers the one sent without a Referer, which the
 * server takes for the browser's own request. A deployment that cannot tell them apart answers both alike.
 */
function serve(session: unknown, workspace: unknown = { repositories: [demoRepository] }, account: unknown = session) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push(url);
    cookies.push(document.cookie);
    calls.push({ url, policy: init?.referrerPolicy });
    if (url === '/api/auth/session') {
      return init?.referrerPolicy === 'no-referrer' ? (account === 'down' ? json({}, 503) : json(account)) : json(session);
    }
    if (url === '/api/workspace') return json(workspace);
    throw new Error(`Unexpected request ${url}`);
  });
}
/** What the workspace sees of the demo context. */
const DemoState = () => createElement('p', null, `workspace signedIn=${String(useDemo()?.signedIn)} scenario=${useDemo()?.scenario}`);
const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)));
async function render(child: ReactNode = createElement('p', null, 'workspace')) {
  await act(async () => root.render(createElement(I18nProvider, null, createElement(DemoProvider, { value: { scenario: 'trpg' } }, createElement(WorkspaceGate, null, child)))));
  await settle();
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  localStorage.setItem('github-notes:language', 'zh-TW');
  document.cookie = 'mygitnotes_demo=; Max-Age=0; Path=/';
  requests = [];
  calls = [];
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
  expect(requests).toEqual(['/api/auth/session', '/api/auth/session', '/api/workspace']);
});

it('says the demo is not available, with a sign-in link, when the deployment offers none', async () => {
  serve({ authenticated: false });
  await render();
  expect(container.textContent).toContain('目前沒有提供示範');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/');
  expect(container.textContent).not.toContain('workspace');
});

it('opens the workspace for a signed-in browser whose demo page the server recognised, with no notice, and says in the demo context that they are signed in', async () => {
  serve({ authenticated: false, demo: true, demoPage: true }, undefined, { authenticated: true, login: 'alice', demo: true });
  await render(createElement(DemoState));
  expect(container.textContent).toBe('workspace signedIn=true scenario=trpg');
  expect(requests).toEqual(['/api/auth/session', '/api/auth/session', '/api/workspace']);
});

it('says in the demo context that a visitor who is not signed in is not', async () => {
  serve({ authenticated: false, demo: true, demoPage: true });
  await render(createElement(DemoState));
  expect(container.textContent).toBe('workspace signedIn=false scenario=trpg');
});

it('sends one probe as the demo page and one with no Referer, and nothing else without one', async () => {
  serve({ authenticated: false, demo: true, demoPage: true }, undefined, { authenticated: true, demo: true });
  await render();
  expect(calls.filter(call => call.url === '/api/auth/session')).toHaveLength(2);
  expect(calls.filter(call => call.policy === 'no-referrer')).toEqual([{ url: '/api/auth/session', policy: 'no-referrer' }]);
  expect(calls.filter(call => call.policy === undefined).map(call => call.url).sort()).toEqual(['/api/auth/session', '/api/workspace']);
});

it('does not open for a signed-in browser whose page the server did not recognise, and says why instead of showing their notes', async () => {
  serve({ authenticated: true, login: 'alice', demo: true }, { repositories: [{ id: 'github:me/notes@main', write: true }] }, { authenticated: true, login: 'alice', demo: true });
  await render();
  expect(container.textContent).toContain('瀏覽器沒有告訴網站');
  expect(container.textContent).not.toContain('workspace');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/');
  expect(container.textContent).toContain('前往我的筆記');
  expect(requests).not.toContain('/api/workspace');
});

it('does not open when the demo probe lacks demoPage while the account probe is signed in, even if the demo probe says nothing of a session', async () => {
  serve({ authenticated: false, demo: true }, undefined, { authenticated: true, demo: true });
  await render();
  expect(container.textContent).toContain('瀏覽器沒有告訴網站');
  expect(container.textContent).not.toContain('workspace');
  expect(requests).not.toContain('/api/workspace');
});

it('does not open when the demo probe itself is signed in, whatever it says of the page', async () => {
  serve({ authenticated: true, demo: true, demoPage: true }, undefined, { authenticated: true, demo: true });
  await render();
  expect(container.textContent).toContain('瀏覽器沒有告訴網站');
  expect(requests).not.toContain('/api/workspace');
});

it('does not open when the workspace answer holds any repository that is not the demo’s, and shows none of it', async () => {
  serve({ authenticated: false, demo: true, demoPage: true }, { repositories: [demoRepository, { id: 'github:me/notes@main', write: true }] }, { authenticated: true, demo: true });
  await render();
  expect(container.textContent).toContain('瀏覽器沒有告訴網站');
  expect(container.textContent).not.toContain('workspace');
});

it('opens for a visitor who is not signed in even when the browser sends no Referer, as before', async () => {
  serve({ authenticated: false, demo: true }, undefined, { authenticated: false, demo: true });
  await render();
  expect(container.textContent).toBe('workspace');
});

it('opens when the probe without a Referer cannot be read, treating the visitor as not signed in', async () => {
  serve({ authenticated: false, demo: true, demoPage: true }, undefined, 'down');
  await render(createElement(DemoState));
  expect(container.textContent).toBe('workspace signedIn=false scenario=trpg');
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

it('shows an edition’s sign-in intro on the demo’s notices too', async () => {
  serve({ authenticated: false, demo: true }, { repositories: [] });
  await act(async () => root.render(createElement(I18nProvider, null, createElement(WebFeaturesProvider, { features: [{ id: 'pro', signInIntro: () => ({ tagline: '有記憶的筆記本', description: '第一次登入，就會有一本你自己的筆記本。', points: [] }) }] }, createElement(DemoProvider, { value: { scenario: 'trpg' } }, createElement(WorkspaceGate, null, createElement('p', null, 'workspace')))))));
  await settle();
  await settle();
  expect(container.textContent).toContain('Cookie');
  expect(container.textContent).toContain('有記憶的筆記本');
  expect(container.textContent).toContain('第一次登入，就會有一本你自己的筆記本。');
});
