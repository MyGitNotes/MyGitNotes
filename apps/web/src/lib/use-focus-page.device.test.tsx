// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('a Focus draft an old tab writes after this device keeps its own layout', () => {
  const focus = (id: string, name: string, notebookId: string, tabs: string[] = []): FocusPage['focuses'][number] => ({ id, notebookId, name, root: { kind: 'pane', id: 'p1', tabs: tabs.map(path => ({ kind: 'note' as const, path })) } });
  /** The page with its notebooks named by local id, as storage keeps it, or by key, as the browser does. */
  const page = (notebookId: string, ...focuses: [string, string, string[]?][]): FocusPage => ({ version: 2, focuses: focuses.map(([id, name, tabs]) => focus(id, name, notebookId, tabs)) });
  const committed = (n: string) => page(n, ['f1', 'Reading', ['notes/a.md']]);
  /** The old tab still holds the committed page and writes a draft of it with one change, as it did before migration. */
  const oldDraft = (draftPage: FocusPage) => localStorage.setItem(draftKey, JSON.stringify({ page: draftPage, base: committed('n'), revision: 'r1', id: 'd2', ancestors: [] }));

  it('takes the change the old tab made to another Focus and keeps the Focus this device added', async () => {
    serve(committed('kb~n'));
    // This device added "Writing" after adopting the old tab's first draft; the old tab then renamed "Reading".
    localStorage.setItem(deviceKey, JSON.stringify({ page: page('n', ['f1', 'Reading', ['notes/a.md']], ['f2', 'Writing', ['notes/b.md']]) }));
    oldDraft(page('n', ['f1', 'Reading list', ['notes/a.md']]));
    const hook = renderHook(() => useFocusPage(repo, () => {}, true));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.page).toEqual(page('kb~n', ['f1', 'Reading list', ['notes/a.md']], ['f2', 'Writing', ['notes/b.md']]));
    expect(localStorage.getItem(draftKey)).toBeNull();
    expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(page('n', ['f1', 'Reading list', ['notes/a.md']], ['f2', 'Writing', ['notes/b.md']]));
  });

  it('keeps this device’s layout, and the old draft for recovery, when both changed the same Focus', async () => {
    serve(committed('kb~n'));
    const mine = page('n', ['f1', 'Reading', ['notes/a.md', 'notes/c.md']], ['f2', 'Writing']);
    localStorage.setItem(deviceKey, JSON.stringify({ page: mine }));
    const hook = renderHook(() => useFocusPage(repo, () => {}, true));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    // The old tab writes its draft while this one is open: the storage event reloads the layout.
    oldDraft(page('n', ['f1', 'Reading', ['notes/d.md']]));
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: draftKey })));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.page).toEqual(page('kb~n', ['f1', 'Reading', ['notes/a.md', 'notes/c.md']], ['f2', 'Writing']));
    expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(mine);
    expect(JSON.parse(localStorage.getItem(draftKey)!).page).toEqual(page('n', ['f1', 'Reading', ['notes/d.md']]));
  });

  it('keeps a Focus this device removed, which the old draft still holds as it was', () => {
    localStorage.setItem(deviceKey, JSON.stringify({ page: page('n', ['f2', 'Writing']) }));
    oldDraft(page('n', ['f1', 'Reading', ['notes/a.md']], ['f3', 'New in old tab']));
    adoptDeviceDrafts(WORKSPACE_DOCUMENT_CLIENTS, [repo]);
    expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(page('n', ['f2', 'Writing'], ['f3', 'New in old tab']));
    expect(localStorage.getItem(draftKey)).toBeNull();
  });

  it('keeps both when the merged page would name two Focuses alike', () => {
    localStorage.setItem(deviceKey, JSON.stringify({ page: page('n', ['f1', 'Reading', ['notes/a.md']], ['f2', 'Same']) }));
    oldDraft(page('n', ['f1', 'Reading', ['notes/a.md']], ['f3', 'Same']));
    adoptDeviceDrafts(WORKSPACE_DOCUMENT_CLIENTS, [repo]);
    expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(page('n', ['f1', 'Reading', ['notes/a.md']], ['f2', 'Same']));
    expect(localStorage.getItem(draftKey)).not.toBeNull();
  });

  it('merges an edit made from a layout another tab replaced before this one heard of it (old tab C, new tabs A and B)', async () => {
    serve(committed('kb~n'));
    const b = renderHook(() => useFocusPage(repo, () => {}, true));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    // In an earlier task, C added "Old tab" and A adopted it into the device layout; B has not heard of it yet.
    localStorage.setItem(deviceKey, JSON.stringify({ page: page('n', ['f1', 'Reading', ['notes/a.md']], ['f3', 'Old tab']) }));
    act(() => b.result.current.change(page('kb~n', ['f1', 'Reading', ['notes/a.md']], ['f2', 'Mine'])));
    const both = page('n', ['f1', 'Reading', ['notes/a.md']], ['f3', 'Old tab'], ['f2', 'Mine']);
    expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(both);
    expect(b.result.current.page).toEqual(page('kb~n', ['f1', 'Reading', ['notes/a.md']], ['f3', 'Old tab'], ['f2', 'Mine']));
    expect(b.result.current.error).toBe('');
    // B's next edit starts from what it wrote, so it is no conflict.
    act(() => b.result.current.change(page('kb~n', ['f1', 'Reading', ['notes/a.md']], ['f3', 'Old tab'])));
    expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(page('n', ['f1', 'Reading', ['notes/a.md']], ['f3', 'Old tab']));
  });

  it('writes nothing over a layout another tab changed the same Focus in: the edit waits as a draft and the view shows the stored one', async () => {
    serve(committed('kb~n'));
    const b = renderHook(() => useFocusPage(repo, () => {}, true));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    const theirs = page('n', ['f1', 'Reading', ['notes/x.md']]);
    localStorage.setItem(deviceKey, JSON.stringify({ page: theirs }));
    act(() => b.result.current.change(page('kb~n', ['f1', 'Reading', ['notes/y.md']])));
    expect(JSON.parse(localStorage.getItem(deviceKey)!).page).toEqual(theirs);
    expect(JSON.parse(localStorage.getItem(draftKey)!).page).toEqual(page('n', ['f1', 'Reading', ['notes/y.md']]));
    expect(b.result.current.page).toEqual(page('kb~n', ['f1', 'Reading', ['notes/x.md']]));
    expect(b.result.current.error).toBe('focus.conflict');
  });
});
