// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DemoProvider } from '../lib/demo.js';
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

it('waits for the workspace and does nothing outside the demo', () => {
  expect(run('/trpg', { loading: true })).not.toHaveBeenCalled();
  expect(run('/trpg', { config: null })).not.toHaveBeenCalled();
  expect(run('/trpg', { demo: false })).not.toHaveBeenCalled();
});
