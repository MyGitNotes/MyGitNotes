// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoBanner, remainingText } from './DemoBanner.js';
import { DemoProvider, useDemo } from '../lib/demo.js';
import { DEMO_TTL_MS, noteDemoWrite, readDemoRecord, registerDemoRepositories, setDemoScenarioNotice } from '../lib/demo-storage.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { WebFeaturesProvider } from '../lib/web-features.js';

let root: Root;
let container: HTMLElement;
const REPO = 'edition:demo:scenarios@main', SCOPE = `demo:${REPO}:main`;
const mount = (demo: boolean, features: Parameters<typeof WebFeaturesProvider>[0]['features'] = [], signedIn?: boolean) => act(async () => root.render(createElement(WebFeaturesProvider, { features }, createElement(I18nProvider, null, createElement(DemoProvider, { value: demo ? { scenario: 'trpg', ...(signedIn === undefined ? {} : { signedIn }) } : null }, createElement(DemoBanner))))));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
  localStorage.clear();
  localStorage.setItem('github-notes:language', 'en');
  registerDemoRepositories([{ id: REPO, branch: 'main', alias: 'demo', demo: true, revision: 'h', notebooks: ['demo~trpg-en'] }]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setDemoScenarioNotice(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('renders nothing outside the demo', async () => {
  await mount(false);
  expect(container.innerHTML).toBe('');
});

it('says the data stays in this browser for 24 hours after the first change, with a reset and a sign-in call to action', async () => {
  await mount(true);
  expect(container.textContent).toContain('cleared 24 hours after your first change');
  expect(container.textContent).toContain('Reset demo');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/');
  expect(container.textContent).toContain('Sign in to keep your own notes');
});

it('offers a signed-in person their own notes in place of signing in, linked to the app and not to the demo', async () => {
  await mount(true, [], true);
  const link = [...container.querySelectorAll('a')].find(candidate => candidate.textContent === 'Open my notes');
  expect(link?.getAttribute('href')).toBe('/');
  expect(container.textContent).not.toContain('Sign in to keep your own notes');
  expect(container.textContent).toContain('Reset demo');
});

it('still offers to sign in to a visitor who is not signed in', async () => {
  await mount(true, [], false);
  expect(container.textContent).toContain('Sign in to keep your own notes');
  expect(container.textContent).not.toContain('Open my notes');
});

it('gives an edition’s call to action the same demo context, so it can tell a signed-in person', async () => {
  const Seen = () => createElement('a', { href: '/signup' }, useDemo()?.signedIn ? 'Back to my notes' : 'Create a free account');
  await mount(true, [{ id: 'pro', demoCallToAction: Seen }], true);
  expect(container.textContent).toContain('Back to my notes');
});

it('counts down once the first change is kept', async () => {
  act(() => noteDemoWrite(SCOPE, Date.now()));
  vi.setSystemTime(1_000_000 + 60 * 60 * 1000);
  await mount(true);
  expect(container.textContent).toContain('cleared in 23 h');
});

it('resets at once after the visitor confirms, and not when they decline', async () => {
  act(() => noteDemoWrite(SCOPE, Date.now()));
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  await mount(true);
  const reset = [...container.querySelectorAll('button')].find(button => button.textContent === 'Reset demo') as HTMLButtonElement;
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  act(() => reset.click());
  expect(readDemoRecord(SCOPE)).toBeDefined();
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
  act(() => reset.click());
  expect(readDemoRecord(SCOPE)).toBeUndefined();
  expect(reload).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it('shows an edition’s call to action in place of the community one', async () => {
  await mount(true, [{ id: 'pro', demoCallToAction: () => createElement('a', { href: '/signup' }, 'Create a free account') }]);
  expect(container.textContent).toContain('Create a free account');
  expect(container.textContent).not.toContain('Sign in to keep your own notes');
});

it('names an unknown scenario and the notebook opened instead', async () => {
  await mount(true);
  act(() => setDemoScenarioNotice({ slug: 'nope', title: 'Contract' }));
  expect(container.textContent).toContain('There is no “nope” demo; here is Contract.');
});

it('words the time left in hours, then minutes', () => {
  const t = ((key: string, params?: Record<string, number>) => `${key}:${JSON.stringify(params)}`) as never;
  expect(remainingText(DEMO_TTL_MS, t)).toBe('demo.hours:{"hours":24}');
  expect(remainingText(30 * 60_000, t)).toBe('demo.minutes:{"minutes":30}');
  expect(remainingText(10, t)).toBe('demo.minutes:{"minutes":1}');
});
