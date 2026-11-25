// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyFocusPage, type FocusPage } from '@mygitnotes/core/focus-page';
import { focusDocumentClient, useFocusPage } from './use-focus-page.js';
import { adoptDeviceDrafts, deviceDocumentKey, documentDraftKey, pendingDocumentDrafts } from './use-workspace-document.js';
import { CHANGES_DOCUMENT_CLIENTS, WORKSPACE_DOCUMENT_CLIENTS } from './workspace-document-clients.js';
vi.mock('./i18n/index.js', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const empty = emptyFocusPage();
/** A Focus page as stored, naming its notebook by local id, and as the browser names it, by key. */
const stored = (name: string): FocusPage => ({ version: 2, focuses: [{ id: 'f1', notebookId: 'n', name, root: { kind: 'pane', id: 'p1', tabs: [] } }] });
const keyed = (name: string): FocusPage => ({ version: 2, focuses: [{ id: 'f1', notebookId: 'kb~n', name, root: { kind: 'pane', id: 'p1', tabs: [] } }] });
const repo = { id: 'github:me/kb@main', alias: 'kb' };
const draftKey = documentDraftKey(focusDocumentClient, repo.id), deviceKey = deviceDocumentKey(focusDocumentClient, repo.id);
const requests: string[] = [];
/** The repository's committed Focus file holds `committed`; a PUT answers a new revision. */
function serve(committed: FocusPage) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init?.method ?? 'GET');
      const page = init?.method === 'PUT' ? JSON.parse(String(init.body)).page : committed;
      return new Response(JSON.stringify({ page, revision: init?.method === 'PUT' ? 'r2' : 'r1', writable: true, path: '.github-notes-focus.yaml' }));
    }),
  );
}
beforeEach(() => {
  localStorage.clear();
  requests.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

it('keeps an online Focus change on this device: no draft, nothing pending, nothing sent', async () => {
  serve(keyed('Repo'));
  const hook = renderHook(() => useFocusPage(repo, () => {}, true));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.page).toEqual(keyed('Repo'));
  act(() => hook.result.current.change(keyed('Mine')));
  expect(hook.result.current.page).toEqual(keyed('Mine'));
  expect(hook.result.current.dirty).toBe(false);
  expect(hook.result.current.diff).toBe('');
  expect(localStorage.getItem(draftKey)).toBeNull();
  expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(stored('Mine'));
  expect(pendingDocumentDrafts(WORKSPACE_DOCUMENT_CLIENTS, [repo])).toEqual([]);
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(requests).toEqual(['GET']);
});

it("restores this device's layout on reload, over the repository's committed one", async () => {
  serve(keyed('Repo'));
  localStorage.setItem(deviceKey, JSON.stringify({ page: stored('Mine') }));
  const hook = renderHook(() => useFocusPage(repo, () => {}, true));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.page).toEqual(keyed('Mine'));
  expect(hook.result.current.error).toBe('');
  expect(hook.result.current.writable).toBe(true);
});

it('adopts a Focus draft an earlier version left pending as the device layout, so it leaves Changes', async () => {
  serve(keyed('Repo'));
  // An old draft whose base no longer matches the repository: it was a conflict in Changes, now it is simply this device's layout.
  localStorage.setItem(draftKey, JSON.stringify({ page: stored('Old draft'), base: empty, revision: 'r0', id: 'd1', ancestors: [] }));
  const hook = renderHook(() => useFocusPage(repo, () => {}, true));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.page).toEqual(keyed('Old draft'));
  expect(hook.result.current.error).toBe('');
  expect(hook.result.current.dirty).toBe(false);
  expect(localStorage.getItem(draftKey)).toBeNull();
  expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(stored('Old draft'));
});

it('adopts the old Focus drafts of every repository at once, leaving an unreadable one for Settings to discard', () => {
  const other = { id: 'github:me/journal@main', alias: 'journal' }, broken = { id: 'github:me/broken@main', alias: 'broken' };
  localStorage.setItem(draftKey, JSON.stringify({ page: stored('Old'), base: empty, revision: 'r0' }));
  localStorage.setItem(documentDraftKey(focusDocumentClient, broken.id), '{not json');
  adoptDeviceDrafts(WORKSPACE_DOCUMENT_CLIENTS, [repo, other, broken]);
  expect(localStorage.getItem(draftKey)).toBeNull();
  expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(stored('Old'));
  expect(localStorage.getItem(deviceDocumentKey(focusDocumentClient, other.id))).toBeNull();
  expect(localStorage.getItem(documentDraftKey(focusDocumentClient, broken.id))).toBe('{not json');
  expect(pendingDocumentDrafts(CHANGES_DOCUMENT_CLIENTS, [repo, other, broken])).toEqual([]);
});

it('still saves a local workspace Focus change to the repository', async () => {
  serve(keyed('Repo'));
  const saved = vi.fn();
  const hook = renderHook(() => useFocusPage(repo, saved, false));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  act(() => hook.result.current.change(keyed('Mine')));
  expect(hook.result.current.dirty).toBe(true);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(requests).toEqual(['GET', 'PUT']);
  expect(hook.result.current.dirty).toBe(false);
  expect(localStorage.getItem(draftKey)).toBeNull();
  expect(localStorage.getItem(deviceKey)).toBeNull();
});
