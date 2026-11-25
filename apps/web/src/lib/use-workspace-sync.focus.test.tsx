// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import type { FocusPage } from '@mygitnotes/core/focus-page';
import { useWorkspaceSync } from './use-workspace-sync.js';
import { focusDocumentClient } from './use-focus-page.js';
import { deviceDocumentKey, documentDraftKey } from './use-workspace-document.js';
import type { WorkspaceRepository } from './workspace-repositories.js';
import { I18nProvider } from './i18n/index.js';

const config = { schema_version: 4, workspace: { title: 'KB', default_notebook: 'kb~life' }, notebooks: [{ id: 'kb~life', title: 'Life', root: 'notes/life' }, { id: 'journal~days', title: 'Days', root: 'notes/days' }] };
const repository = (id: string, alias: string, notebook: string): WorkspaceRepository => ({ id, alias, type: 'github', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: [notebook], title: alias, defaultNotebook: notebook, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' });
const kb = repository('github:me/kb@main', 'kb', 'kb~life'), journal = repository('github:me/journal@main', 'journal', 'journal~days');
const page = (notebookId: string, name: string): FocusPage => ({ version: 2, focuses: [{ id: 'f1', notebookId, name, root: { kind: 'pane', id: 'p1', tabs: [] } }] });
const requests: string[] = [];

beforeEach(() => {
  localStorage.clear();
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      const body = url.startsWith('/api/workspace') ? { keyedConfig: config, local: false, defaultRepository: kb.id, repositories: [kb, journal], coreUpdate: false } : url.startsWith('/api/folders') || url.startsWith('/api/assets') ? [] : { page: { version: 2, focuses: [] }, revision: 'r', writable: true, path: '.github-notes-focus.yaml' };
      return new Response(JSON.stringify(body));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const wrapper = ({ children }: { children: ReactNode; }) => createElement(MemoryRouter, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(I18nProvider, null, children)));

it('lists no online Focus layout in Changes: a change and the old drafts of every repository stay on this device', async () => {
  // Drafts an earlier version left waiting in Changes, one per repository, the closed one's included.
  localStorage.setItem(documentDraftKey(focusDocumentClient, kb.id), JSON.stringify({ page: page('life', 'Old kb'), base: { version: 2, focuses: [] }, revision: 'r0' }));
  localStorage.setItem(documentDraftKey(focusDocumentClient, journal.id), JSON.stringify({ page: page('days', 'Old journal'), base: { version: 2, focuses: [] }, revision: 'r0' }));
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await waitFor(() => expect(result.current.focus.loading).toBe(false));
  expect(result.current.pendingDocuments).toEqual([]);
  expect(result.current.gitStatus).toMatchObject({ isClean: true, modified: [], untracked: [] });
  expect(result.current.focus.page).toEqual(page('kb~life', 'Old kb'));
  expect(localStorage.getItem(documentDraftKey(focusDocumentClient, journal.id))).toBeNull();
  expect(JSON.parse(localStorage.getItem(deviceDocumentKey(focusDocumentClient, journal.id))!).page).toEqual(page('days', 'Old journal'));

  act(() => result.current.focus.change(page('kb~life', 'Arranged'), result.current.focus.page));
  expect(result.current.focus.page).toEqual(page('kb~life', 'Arranged'));
  expect(result.current.pendingDocuments).toEqual([]);
  expect(result.current.gitStatus?.isClean).toBe(true);
  expect(result.current.draftsUnder('kb~life', ['notes/life'])).toEqual([]);
  expect(requests.filter(request => request.startsWith('PUT') || request.startsWith('POST'))).toEqual([]);
});
