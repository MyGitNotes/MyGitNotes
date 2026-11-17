// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFocusPage, type FocusLayout, focusPanes, type FocusTab } from '@mygitnotes/core/focus-page';
import { CURRENT_FOCUS } from './focus-view.js';
import { focusDocumentClient, type FocusPageController } from './use-focus-page.js';
import type { WorkspaceDocumentClient } from './use-workspace-document.js';

/*
 * A Focus tab whose path the lists no longer show is not taken for a deleted note (docs/specs/2026-11-15-builtin-live-editor
 * §20.4): another person renamed or moved the live note, so the lists show it at its target. The server is asked where
 * the note is; the tab follows it there, and is hidden, and dropped by the next layout change, only once the server says
 * the note is gone. A question the server could not answer (offline) keeps the tab.
 */

const lists = vi.hoisted(() => ({ paths: new Set<string>(), updatedAt: 1, loading: false, withheld: [] as string[] }));
const read = vi.hoisted(() => vi.fn<(path: string, notebookId?: string) => Promise<unknown>>());
vi.mock('./use-note-queries.js', () => ({ useNoteLookup: (refs: { notebookId: string; path: string; }[]) => ({ notes: lists.loading ? [] : refs.filter(ref => lists.paths.has(ref.path)).map(ref => ({ ...ref, title: ref.path })), committed: [], loading: lists.loading && refs.length > 0, paused: false, error: '', updatedAt: lists.updatedAt, withheld: lists.withheld.filter(path => refs.some(ref => ref.path === path)).map(path => `nb:${path}`) }) }));
vi.mock('./api.js', async importOriginal => ({ ...(await importOriginal<typeof import('./api.js')>()), readNote: read }));

const { ApiError } = await import('./api.js');
const { useNoteFocus } = await import('./use-note-focus.js');

const REPOSITORY = 'github:owner/kb@main', NOTEBOOK = 'nb', SCOPE = 'whereabouts-test';
const storageKey = `github-notes:focus-view:${REPOSITORY}:${NOTEBOOK}`;
const IDEAS = 'notes/projects/ideas.md', RENAMED = 'notes/projects/ideas-next.md', OTHER = 'notes/other.md', ARCHIVED = 'notes/archive/ideas-next.md';
const note = (path: string): FocusTab => ({ kind: 'note', path });
const tabPaths = (layout: FocusLayout | null | undefined) => layout ? focusPanes(layout).flatMap(pane => pane.tabs.map(tab => tab.path)) : [];
const stored = () => JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { current: FocusLayout; entries: Record<string, { shown: Record<string, string | null>; }>; } | null;
const movedTo = (path: string) => new ApiError('This live note was checked in and filed.', 404, undefined, undefined, false, { movedTo: path });

function controller(): FocusPageController {
  return { client: focusDocumentClient as WorkspaceDocumentClient<unknown>, repository: 'local:/workspace', file: '.github-notes-focus.yaml', page: emptyFocusPage(), change: () => {}, save: async () => {}, reload: async () => {}, refresh: async () => {}, loading: false, saving: false, dirty: false, error: '', writable: true, setError: () => {}, diff: '' };
}
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);
const open = () => renderHook(() => useNoteFocus({ page: controller(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, flushEditors: async () => true }), { wrapper });
/** The lists are read again (a rename's frontmatter change, a window focus, the live interval): `paths` is what they show now. */
const refetch = (paths: string[]) => {
  lists.paths = new Set(paths);
  lists.updatedAt += 1;
};

beforeEach(() => {
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lists.paths = new Set([IDEAS, OTHER]);
  lists.updatedAt = 1;
  lists.loading = false;
  lists.withheld = [];
  read.mockReset();
  const layout: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: [note(IDEAS), note(OTHER)] } };
  localStorage.setItem(storageKey, JSON.stringify({ current: layout, entries: { [CURRENT_FOCUS]: { activePane: 'p1', shown: { p1: `note:${IDEAS}` }, recent: ['p1'], history: {}, ratios: {}, hideToolbar: {} } }, last: CURRENT_FOCUS }));
});
afterEach(() => localStorage.clear());

describe('a Focus tab the lists no longer show', () => {
  it('stays while the server is asked, and follows the note another person renamed to where it lies, still shown in its pane', async () => {
    let answer!: (error: unknown) => void;
    read.mockImplementation(() => new Promise((_, reject) => void (answer = reject)));
    const hook = open();
    expect(tabPaths(hook.result.current.layout)).toEqual([IDEAS, OTHER]);
    // Someone renamed Ideas: the lists, read again, show it at its target.
    refetch([OTHER, RENAMED]);
    hook.rerender();
    // Not hidden while nobody knows where it is: its editor stays mounted, and reads that it moved.
    expect(tabPaths(hook.result.current.layout)).toEqual([IDEAS, OTHER]);
    expect(hook.result.current.entry?.shown.p1).toBe(`note:${IDEAS}`);
    await waitFor(() => expect(read).toHaveBeenCalledWith(IDEAS, NOTEBOOK));
    await act(async () => answer(movedTo(RENAMED)));
    await waitFor(() => expect(tabPaths(hook.result.current.layout)).toEqual([RENAMED, OTHER]));
    expect(hook.result.current.entry?.shown.p1).toBe(`note:${RENAMED}`);
    expect(tabPaths(stored()?.current)).toEqual([RENAMED, OTHER]);
    expect(stored()?.entries[CURRENT_FOCUS].shown.p1).toBe(`note:${RENAMED}`);
  });

  it('follows each later retarget too, from the target it was at', async () => {
    read.mockImplementation(async path => {
      throw movedTo(path === IDEAS ? RENAMED : ARCHIVED);
    });
    const hook = open();
    refetch([OTHER, RENAMED]);
    hook.rerender();
    await waitFor(() => expect(tabPaths(hook.result.current.layout)).toEqual([RENAMED, OTHER]));
    // Moved again: its earlier target leads to where it is now.
    refetch([OTHER, ARCHIVED]);
    hook.rerender();
    expect(tabPaths(hook.result.current.layout)).toEqual([RENAMED, OTHER]);
    await waitFor(() => expect(tabPaths(hook.result.current.layout)).toEqual([ARCHIVED, OTHER]));
    expect(hook.result.current.entry?.shown.p1).toBe(`note:${ARCHIVED}`);
  });

  it('is not dropped by a layout change made while the server is asked, and is dropped by the next one once the server says the note is gone', async () => {
    let answer!: (error: unknown) => void;
    read.mockImplementation(() => new Promise((_, reject) => void (answer = reject)));
    const hook = open();
    refetch([OTHER, 'notes/third.md']);
    hook.rerender();
    await waitFor(() => expect(read).toHaveBeenCalledWith(IDEAS, NOTEBOOK));
    // A layout change while the answer is on its way keeps the tab in what it writes.
    await act(async () => void await hook.result.current.place(CURRENT_FOCUS, note('notes/third.md'), 'p1'));
    expect(tabPaths(stored()?.current)).toEqual([IDEAS, OTHER, 'notes/third.md']);
    // Gone, the server says, without saying where: hidden now, and dropped by the next layout change.
    await act(async () => answer(new ApiError('Note not found', 404)));
    await waitFor(() => expect(tabPaths(hook.result.current.layout)).toEqual([OTHER, 'notes/third.md']));
    await act(async () => void await hook.result.current.close('note:notes/third.md', 'p1'));
    expect(tabPaths(stored()?.current)).toEqual([OTHER]);
  });

  it('is kept when the server cannot be asked (offline), through a layout change too', async () => {
    read.mockRejectedValue(new TypeError('Failed to fetch'));
    const hook = open();
    refetch([OTHER, 'notes/third.md']);
    hook.rerender();
    await waitFor(() => expect(read).toHaveBeenCalled());
    await act(async () => {});
    expect(tabPaths(hook.result.current.layout)).toEqual([IDEAS, OTHER]);
    await act(async () => void await hook.result.current.place(CURRENT_FOCUS, note('notes/third.md'), 'p1'));
    expect(tabPaths(stored()?.current)).toEqual([IDEAS, OTHER, 'notes/third.md']);
  });

  it('is hidden at once where this browser deleted the note (a draft deletion), without asking', async () => {
    const hook = open();
    lists.withheld = [IDEAS];
    refetch([OTHER]);
    hook.rerender();
    expect(tabPaths(hook.result.current.layout)).toEqual([OTHER]);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('a second window of the same person', () => {
  it('relocates a tab still at an earlier target to where the note is, and the first window follows instead of losing it', async () => {
    read.mockImplementation(async () => {
      throw movedTo(ARCHIVED);
    });
    const first = open();
    expect(tabPaths(first.result.current.layout)).toEqual([IDEAS, OTHER]);
    // The second window reads the lists afresh: Ideas lies at a later target now.
    refetch([OTHER, ARCHIVED, 'notes/third.md']);
    const second = open();
    await waitFor(() => expect(tabPaths(second.result.current.layout)).toEqual([ARCHIVED, OTHER]));
    expect(second.result.current.entry?.shown.p1).toBe(`note:${ARCHIVED}`);
    // Going about its business there (here: a layout change) never drops the tab.
    await act(async () => void await second.result.current.place(CURRENT_FOCUS, note('notes/third.md'), 'p1'));
    expect(tabPaths(stored()?.current)).toEqual([ARCHIVED, OTHER, 'notes/third.md']);
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: storageKey })));
    await waitFor(() => expect(tabPaths(first.result.current.layout)).toEqual([ARCHIVED, OTHER, 'notes/third.md']));
  });
});
