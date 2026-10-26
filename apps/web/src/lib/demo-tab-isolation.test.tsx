// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyFocusPage, type FocusLayout } from '@mygitnotes/core/focus-page';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { focusViewStorageKey } from './focus-view.js';
import { focusDocumentClient, type FocusPageController } from './use-focus-page.js';
import { NO_COMMITTED, useCommittedLayer } from './use-committed-layer.js';
import { useNoteFocus } from './use-note-focus.js';
import { useWorkspaceSync } from './use-workspace-sync.js';
import { draftStore, type WorkspaceRepository } from './workspace-repositories.js';
import { updateWorkingNote } from './working-notes.js';
import type { NoteItem } from './types.js';
import type { WorkspaceDocumentClient } from './use-workspace-document.js';

/**
 * The demo and the person's own notes share one origin, so one `localStorage`, and a write in a demo tab reaches a tab
 * of the person's notes as a `storage` event. These tests are the real tab's side: the demo's keys all carry the `demo:`
 * namespace, and no listener of the real tab reacts to one.
 */
const config = { schema_version: 4, workspace: { title: 'Notes', default_notebook: 'notes~life' }, notebooks: [{ id: 'notes~life', title: 'Life', root: 'notes/life' }] };
const repository = (extra: Partial<WorkspaceRepository>): WorkspaceRepository => ({ id: 'github:me/notes@main', alias: 'notes', type: 'github', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life'], title: 'Notes', defaultNotebook: 'notes~life', preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '', ...extra });
const own = repository({});
const demo = repository({ id: 'edition:demo:scenarios@main', alias: 'demo', type: 'edition', write: false, demo: true, notebooks: ['demo~life'], defaultNotebook: 'demo~life' });
const note = (notebookId: string, title: string): NoteItem => ({ id: 'a', path: 'notes/life/a.md', notebookId, title, content: `# ${title}\n`, metadata: {}, tags: [] });
const DEMO_SCOPE = 'demo:edition:demo:scenarios@main:main';

function serve(repositories: WorkspaceRepository[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.startsWith('/api/workspace') ? { keyedConfig: config, local: false, defaultRepository: repositories[0]!.id, repositories, coreUpdate: false } : url.startsWith('/api/folders') || url.startsWith('/api/assets') ? [] : { page: { version: 2, focuses: [] }, revision: 'r', writable: true, path: 'f' };
      return new Response(JSON.stringify(body));
    }),
  );
}
/** Another tab’s write, heard here; waits long enough for a listener to have acted on it. */
const storageEvent = async (key: string) => {
  window.dispatchEvent(new StorageEvent('storage', { key }));
  await new Promise(resolve => setTimeout(resolve, 50));
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode; }) => createElement(MemoryRouter, null, createElement(QueryClientProvider, { client }, children));

beforeEach(() => {
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('does not reread a real scope’s working changes when a demo tab writes its own', async () => {
  serve([own]);
  updateWorkingNote(draftStore(own), 'notes/life/a.md', { note: note('notes~life', 'Mine'), base: null });
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const before = result.current.activeWorkingNotes;
  expect(Object.keys(before)).toHaveLength(1);

  updateWorkingNote(draftStore(demo), 'notes/life/a.md', { note: note('demo~life', 'Demo edit'), base: null });
  expect(localStorage.getItem(`gh_notes_working:${DEMO_SCOPE}`)).not.toBeNull();
  await storageEvent(`gh_notes_working:${DEMO_SCOPE}`);
  expect(result.current.activeWorkingNotes).toBe(before);
  expect(JSON.stringify(result.current.activeWorkingNotes)).not.toContain('Demo edit');

  // The control: a change to this tab’s own scope, heard from another tab, is read.
  updateWorkingNote(draftStore(own), 'notes/life/b.md', { note: { ...note('notes~life', 'Mine too'), path: 'notes/life/b.md' }, base: null });
  await storageEvent(`gh_notes_working:${own.id}:main`);
  await waitFor(() => expect(Object.keys(result.current.activeWorkingNotes)).toHaveLength(2));
});

it('lets a real tab’s committed layer stay empty when a demo tab commits locally', async () => {
  const { result } = renderHook(() => useCommittedLayer([own]), { wrapper });
  expect(result.current).toBe(NO_COMMITTED);
  localStorage.setItem(`gh_notes_local_commits:${DEMO_SCOPE}`, JSON.stringify({ version: 1, base: 'h', commits: [{ id: 'c'.repeat(40), parent: 'h', date: '2026-10-26T00:00:00Z', author: 'You (demo)', message: 'x', notes: { 'notes/life/a.md': { notebookId: 'demo~life', server: null, raw: '# Demo edit\n', blob: 'b'.repeat(40) } }, documents: {} }] }));
  await storageEvent(`gh_notes_local_commits:${DEMO_SCOPE}`);
  expect(result.current).toBe(NO_COMMITTED);
});

it('leaves a real notebook’s Focus view alone when a demo tab changes its own', async () => {
  const notebook = 'notes~life';
  const key = focusViewStorageKey(own.id, notebook);
  const tab = (path: string) => ({ kind: 'note' as const, path });
  const layout = (path: string): FocusLayout => ({ root: { kind: 'pane', id: 'p1', tabs: [tab(path)] } });
  const view = (path: string) => JSON.stringify({ current: layout(path), entries: {}, last: null });
  localStorage.setItem(key, view('notes/mine.md'));
  const controller: FocusPageController = { client: focusDocumentClient as WorkspaceDocumentClient<unknown>, repository: own.id, file: '.github-notes-focus.yaml', page: emptyFocusPage(), change: () => {}, save: async () => {}, reload: async () => {}, refresh: async () => {}, loading: false, saving: false, dirty: false, error: '', writable: true, setError: () => {}, diff: '' };
  const { result } = renderHook(() => useNoteFocus({ page: controller, notebookId: notebook, repository: own.id, scope: 'main', focusKey: 'current', writable: true, flushEditors: async () => true }), { wrapper });
  await waitFor(() => expect(result.current.layout).not.toBeNull());
  const before = result.current.layout;

  const demoKey = focusViewStorageKey(`demo:${demo.id}`, 'demo~life');
  expect(demoKey).not.toBe(key);
  localStorage.setItem(demoKey, view('notes/demo.md'));
  await storageEvent(demoKey);
  expect(result.current.layout).toBe(before);

  // The control: the same notebook’s own key, changed in another tab, is read.
  localStorage.setItem(key, view('notes/other.md'));
  await storageEvent(key);
  await waitFor(() => expect(JSON.stringify(result.current.layout)).toContain('notes/other.md'));
});
