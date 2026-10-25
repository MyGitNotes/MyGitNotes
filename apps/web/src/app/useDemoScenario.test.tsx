// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DemoProvider } from '../lib/demo.js';
import { APP_ROOT_SEGMENTS, parseWorkspaceRoute } from '../lib/routes.js';
import { demoScenarioNotice, setDemoScenarioNotice } from '../lib/demo-storage.js';
import { useDemoScenario } from './useDemoScenario.js';
import type { WorkspaceConfig } from '../lib/types.js';

const config = { schema_version: 4, workspace: { title: 'Demo', default_notebook: 'demo~contract-zh-tw' }, notebooks: [{ id: 'demo~contract-zh-tw', title: '契約' }, { id: 'demo~trpg-zh-tw', title: '跑團' }] } as unknown as WorkspaceConfig;
const inDemo = (demo: boolean) => ({ children }: { children: ReactNode; }) => createElement(DemoProvider, { value: demo ? { scenario: 'x' } : null }, children);
const run = (pathname: string, options: { demo?: boolean; loading?: boolean; config?: WorkspaceConfig | null; } = {}) => {
  const navigate = vi.fn();
  renderHook(() => useDemoScenario({ config: options.config === undefined ? config : options.config, loading: options.loading ?? false, pathname, navigate }), { wrapper: inDemo(options.demo ?? true) });
  return navigate;
};
afterEach(() => setDemoScenarioNotice(null));

it('replaces /<scenario> with the route of its notebook', () => {
  expect(run('/trpg')).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw', { replace: true });
});

it('opens the default notebook and says so for an unknown scenario', () => {
  expect(run('/nope')).toHaveBeenCalledWith('/notebooks/demo~contract-zh-tw', { replace: true });
  expect(demoScenarioNotice()).toEqual({ slug: 'nope', title: '契約' });
});

it('leaves the app’s own paths, the demo root and deeper routes alone', () => {
  for (const pathname of ['/', '/settings', '/notebooks', '/notebooks/demo~trpg-zh-tw', '/assets']) expect(run(pathname)).not.toHaveBeenCalled();
  expect(demoScenarioNotice()).toBeNull();
});

it('leaves every static app route alone, so none is read as a scenario', () => {
  for (const segment of APP_ROOT_SEGMENTS) expect(run(`/${segment}`), segment).not.toHaveBeenCalled();
  for (const pathname of ['/files', '/graph', '/screen', '/index', '/index.html']) expect(run(pathname), pathname).not.toHaveBeenCalled();
  // Whatever the route parser accepts as a one-segment app page is one of those segments.
  for (const word of ['notes', 'notebooks', 'assets', 'files', 'agent', 'graph', 'settings', 'screen', 'index', 'index.html', 'trpg']) {
    const route = parseWorkspaceRoute(`/${word}`, '');
    const isPage = route.valid && (route.tab !== 'notes' || route.legacyScreen || ['notes', 'notebooks', 'index', 'index.html'].includes(word));
    if (isPage) expect(run(`/${word}`), word).not.toHaveBeenCalled();
  }
  expect(demoScenarioNotice()).toBeNull();
});

it('waits for the workspace and does nothing outside the demo', () => {
  expect(run('/trpg', { loading: true })).not.toHaveBeenCalled();
  expect(run('/trpg', { config: null })).not.toHaveBeenCalled();
  expect(run('/trpg', { demo: false })).not.toHaveBeenCalled();
});
