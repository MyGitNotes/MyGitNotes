// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { DemoProvider } from '../lib/demo.js';
import { APP_ROOT_SEGMENTS, parseWorkspaceRoute } from '../lib/routes.js';
import { demoScenarioNotice, setDemoScenarioNotice } from '../lib/demo-storage.js';
import { useDemoScenario } from './useDemoScenario.js';
import type { WorkspaceConfig } from '../lib/types.js';

const config = { schema_version: 4, workspace: { title: 'Demo', default_notebook: 'demo~contract-zh-tw' }, notebooks: [{ id: 'demo~contract-zh-tw', title: '契約', root: '' }, { id: 'demo~trpg-zh-tw', title: '跑團', root: 'trpg-zh-tw/' }] } as unknown as WorkspaceConfig;
const inDemo = (demo: boolean) => ({ children }: { children: ReactNode; }) => createElement(DemoProvider, { value: demo ? { scenario: 'x' } : null }, children);
const run = (pathname: string, options: { demo?: boolean; loading?: boolean; config?: WorkspaceConfig | null; guides?: string[]; restored?: boolean; focuses?: { id: string; notebookId: string; }[] | null; } = {}) => {
  const navigate = vi.fn();
  const hasGuide = vi.fn(async (_notebookId: string, path: string) => (options.guides ?? []).includes(path));
  const hasRestoredView = vi.fn(() => options.restored ?? false);
  renderHook(() => useDemoScenario({ config: options.config === undefined ? config : options.config, loading: options.loading ?? false, pathname, navigate, hasGuide, hasRestoredView, focuses: options.focuses === undefined ? [] : options.focuses }), { wrapper: inDemo(options.demo ?? true) });
  return navigate;
};
afterEach(() => setDemoScenarioNotice(null));

it('replaces /<scenario> with the route of its notebook when it has no guide note', async () => {
  const navigate = run('/trpg');
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw', { replace: true }));
});

it('opens the notebook’s index.md, named relative to its root, when it has one', async () => {
  const navigate = run('/trpg', { guides: ['trpg-zh-tw/index.md'] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw/notes/index.md', { replace: true }));
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('finds the guide of a notebook whose root is the repository root', async () => {
  const navigate = run('/contract', { guides: ['index.md'] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~contract-zh-tw/notes/index.md', { replace: true }));
});

it('keeps the notebook page for a visitor whose Focus view is restored', async () => {
  const navigate = run('/trpg', { guides: ['trpg-zh-tw/index.md'], restored: true });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw', { replace: true }));
});

it('opens the notebook with its Focus shown when the Focus file names one for it, whatever the guide', async () => {
  const navigate = run('/trpg', { guides: ['trpg-zh-tw/index.md'], focuses: [{ id: 'trpg-zh-tw-table', notebookId: 'demo~trpg-zh-tw' }] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw?focus=trpg-zh-tw-table', { replace: true }));
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('picks the first Focus of the notebook in the file, and ignores the Focuses of other notebooks', async () => {
  const navigate = run('/trpg', { focuses: [{ id: 'contract-review', notebookId: 'demo~contract-zh-tw' }, { id: 'trpg-b', notebookId: 'demo~trpg-zh-tw' }, { id: 'trpg-a', notebookId: 'demo~trpg-zh-tw' }] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw?focus=trpg-b', { replace: true }));
});

it('opens the guide when the Focus file names none for the notebook', async () => {
  const navigate = run('/trpg', { guides: ['trpg-zh-tw/index.md'], focuses: [{ id: 'contract-review', notebookId: 'demo~contract-zh-tw' }] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw/notes/index.md', { replace: true }));
});

it('lets a restored view win over the notebook’s Focus', async () => {
  const navigate = run('/trpg', { restored: true, focuses: [{ id: 'trpg-zh-tw-table', notebookId: 'demo~trpg-zh-tw' }] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw', { replace: true }));
});

it('waits for the Focus file to load before choosing where to go', async () => {
  const navigate = vi.fn();
  const hasGuide = vi.fn(async () => true);
  const hasRestoredView = vi.fn(() => false);
  type Focuses = { id: string; notebookId: string; }[] | null;
  const { rerender } = renderHook(({ focuses }: { focuses: Focuses; }) => useDemoScenario({ config, loading: false, pathname: '/trpg', navigate, hasGuide, hasRestoredView, focuses }), { wrapper: inDemo(true), initialProps: { focuses: null as Focuses } });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(navigate).not.toHaveBeenCalled();
  rerender({ focuses: [{ id: 'trpg-zh-tw-table', notebookId: 'demo~trpg-zh-tw' }] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~trpg-zh-tw?focus=trpg-zh-tw-table', { replace: true }));
});

it('still opens the default notebook for an unknown scenario while the Focus file loads', async () => {
  const navigate = run('/nope', { focuses: null });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~contract-zh-tw', { replace: true }));
});

it('opens the default notebook and says so for an unknown scenario, without its guide', async () => {
  const navigate = run('/nope', { guides: ['index.md'] });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/demo~contract-zh-tw', { replace: true }));
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
