// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { useWorkspaceSync } from './use-workspace-sync.js';
import { DemoProvider } from './demo.js';
import { draftStore, type WorkspaceRepository } from './workspace-repositories.js';
import { updateWorkingNote } from './working-notes.js';
import type { NoteItem } from './types.js';

const config = { schema_version: 4, workspace: { title: 'Demo', default_notebook: 'demo~contract-en' }, notebooks: [{ id: 'demo~contract-en', title: 'Contract', root: 'notes/contract-en' }] };
const repository = (extra: Partial<WorkspaceRepository>): WorkspaceRepository => ({ id: 'edition:demo:scenarios@main', alias: 'demo', type: 'edition', branch: 'main', revision: 'a'.repeat(40), write: false, notebooks: ['demo~contract-en'], title: 'Demo', defaultNotebook: 'demo~contract-en', preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '', ...extra });
const draft: NoteItem = { id: 'a', path: 'notes/contract-en/a.md', notebookId: 'demo~contract-en', title: 'A', content: '# A edited\n', metadata: {}, tags: [] };

function serve(repositories: WorkspaceRepository[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.startsWith('/api/workspace') ? { keyedConfig: config, local: false, defaultRepository: repositories[0].id, repositories, coreUpdate: false } : url.startsWith('/api/folders') || url.startsWith('/api/assets') ? [] : { page: { version: 2, focuses: [] }, revision: 'r', writable: false, path: 'f' };
      return new Response(JSON.stringify(body));
    }),
  );
}
const wrapper = (demo: boolean) => ({ children }: { children: ReactNode; }) => createElement(MemoryRouter, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(DemoProvider, { value: demo ? { scenario: 'contract' } : null }, children)));

beforeEach(() => localStorage.clear());
// Unmount before the stubs go: a hook left mounted keeps loading folders and pages, and React then renders after jsdom is torn down.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('lets a demo repository be edited and committed locally while the server still owns file changes', async () => {
  const demo = repository({ demo: true });
  serve([demo]);
  updateWorkingNote(draftStore(demo), draft.path, { note: draft, base: null });
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper: wrapper(true) });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.canWriteNotebook('demo~contract-en')).toBe(true);
  expect(result.current.canChangeFiles('demo~contract-en')).toBe(false);
  expect(Object.keys(result.current.activeWorkingNotes)).toHaveLength(1);
});

it('leaves a read-only repository that is not a demo read-only, with its drafts out of Changes', async () => {
  const plain = repository({});
  serve([plain]);
  updateWorkingNote(draftStore(plain), draft.path, { note: draft, base: null });
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper: wrapper(false) });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.canWriteNotebook('demo~contract-en')).toBe(false);
  expect(result.current.canChangeFiles('demo~contract-en')).toBe(false);
  expect(result.current.activeWorkingNotes).toEqual({});
});

it('treats a writable repository exactly as before', async () => {
  const writable = repository({ write: true, id: 'github:me/notes@main', alias: 'notes', notebooks: ['notes~life'] });
  serve([writable]);
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper: wrapper(false) });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.canWriteNotebook('notes~life')).toBe(true);
  expect(result.current.canChangeFiles('notes~life')).toBe(true);
});

it('refuses to show the demo as a signed-in person’s notebooks when the session ended in this tab', async () => {
  serve([repository({ demo: true })]);
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper: wrapper(false) });
  await waitFor(() => expect(result.current.loadError).toMatch(/session ended|登入已結束/));
  expect(result.current.config).toBeNull();
});

it('refuses to show a signed-in person’s own repositories on the demo page when a refresh answers without the demo', async () => {
  serve([repository({ write: true, id: 'github:me/notes@main', alias: 'notes', notebooks: ['notes~life'] })]);
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper: wrapper(true) });
  await waitFor(() => expect(result.current.loadError).toMatch(/signed in|已登入/));
  expect(result.current.config).toBeNull();
  expect(result.current.canWriteNotebook('notes~life')).toBe(false);
});
