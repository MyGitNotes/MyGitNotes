// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyFocusPage, FOCUS_MAX_TABS, FocusError, type FocusLayout, focusPanes, type FocusTab } from '@mygitnotes/core/focus-page';
import { useNoteFocus } from './use-note-focus.js';
import { CURRENT_FOCUS } from './focus-view.js';
import { focusDocumentClient, type FocusPageController } from './use-focus-page.js';
import type { WorkspaceDocumentClient } from './use-workspace-document.js';

const SCOPE = 'use-note-focus-test', REPOSITORY = 'github:owner/kb@main', NOTEBOOK = 'kb~life';
const storageKey = `github-notes:focus-view:${REPOSITORY}:${NOTEBOOK}`;

function fakeController(): FocusPageController {
  return { client: focusDocumentClient as WorkspaceDocumentClient<unknown>, repository: 'local:/workspace', file: '.github-notes-focus.yaml', page: emptyFocusPage(), change: () => {}, save: async () => {}, reload: async () => {}, refresh: async () => {}, loading: false, saving: false, dirty: false, error: '', writable: true, setError: () => {}, diff: '' };
}
/** The tabs of the `index`-th pane in pane order. */
const tabsAt = (layout: FocusLayout | null | undefined, index: number) => layout ? focusPanes(layout)[index]?.tabs : undefined;
const tab = (id: string): FocusTab => ({ kind: 'note', path: `notes/${id}.compilation.yml` });

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => localStorage.clear());

describe('useNoteFocus place', () => {
  it('rejects with the FocusError instead of only resolving false when the Focus is already full', async () => {
    const layout: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: Array.from({ length: FOCUS_MAX_TABS }, (_, index) => tab(`compilation-${index}`)) } };
    localStorage.setItem(storageKey, JSON.stringify({ current: layout, entries: {}, last: null, dock: { left: 320, bottom: 280, collapsed: false } }));

    const { result } = renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, flushEditors: async () => true }), { wrapper });
    await waitFor(() => expect(tabsAt(result.current.layout, 0)?.length).toBe(FOCUS_MAX_TABS));

    const attempt = result.current.place(CURRENT_FOCUS, tab('compilation-new'), 'p1');
    await expect(attempt).rejects.toBeInstanceOf(FocusError);
    await expect(attempt.catch(caught => caught)).resolves.toMatchObject({ code: 'tab-limit' });
    // The rejection is the caller's only signal; the layout is unchanged.
    expect(tabsAt(result.current.layout, 0)?.length).toBe(FOCUS_MAX_TABS);
  });

  it('still resolves true when the Focus has room', async () => {
    const { result } = renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, flushEditors: async () => true }), { wrapper });
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    await expect(result.current.place(CURRENT_FOCUS, tab('compilation-a'), 'p1')).resolves.toBe(true);
    await waitFor(() => expect(tabsAt(result.current.layout, 0)).toHaveLength(1));
  });
});

describe('useNoteFocus mutationError', () => {
  const fullLayout = (count: number): FocusLayout => ({ root: { kind: 'pane', id: 'p1', tabs: Array.from({ length: count }, (_, index) => tab(`compilation-${index}`)) } });

  it('records a failed change, and clears it on dismiss and when another Focus is shown', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ current: fullLayout(FOCUS_MAX_TABS), entries: {}, last: null }));
    const { result, rerender } = renderHook(({ focusKey }: { focusKey: string | null; }) => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey, writable: true, flushEditors: async () => true }), { wrapper, initialProps: { focusKey: CURRENT_FOCUS as string | null } });
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    const fail = () => result.current.place(CURRENT_FOCUS, tab(`compilation-${FOCUS_MAX_TABS}`), 'p1').catch(() => {});
    await act(fail);
    expect(result.current.mutationError).toMatchObject({ code: 'tab-limit' });
    act(() => result.current.dismissMutationError());
    expect(result.current.mutationError).toBeNull();

    await act(fail);
    expect(result.current.mutationError).not.toBeNull();
    rerender({ focusKey: null });
    await waitFor(() => expect(result.current.mutationError).toBeNull());
  });

  it('reports a note that no longer fits only as full, without a leftover error', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ current: fullLayout(FOCUS_MAX_TABS - 1), entries: {}, last: null }));
    let raced = false;
    const { result } = renderHook(() =>
      useNoteFocus({
        page: fakeController(),
        notebookId: NOTEBOOK,
        repository: REPOSITORY,
        scope: SCOPE,
        focusKey: CURRENT_FOCUS,
        writable: true,
        // While the editors flush, another tab takes the last free slot.
        flushEditors: async () => {
          if (!raced) {
            raced = true;
            await result.current.place(CURRENT_FOCUS, tab(`compilation-${FOCUS_MAX_TABS - 1}`), 'p1');
          }
          return true;
        },
      }), { wrapper });
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    let opened: string | undefined;
    await act(async () => {
      opened = await result.current.openNote('notes/a.md');
    });
    expect(opened).toBe('full');
    expect(result.current.mutationError).toBeNull();
  });
});

describe('useNoteFocus openNote', () => {
  // Stored as this device kept it before layouts were trees.
  const twoColumns = { division: 'columns-2', panes: [{ tabs: [tab('compilation-a')] }, { tabs: [tab('compilation-b')] }] };
  const render = () => {
    localStorage.setItem(storageKey, JSON.stringify({ current: twoColumns, entries: {}, last: null }));
    const { result } = renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, flushEditors: async () => true }), { wrapper });
    return result;
  };

  it('opens a note from inside a pane as a tab of that pane when placed here', async () => {
    const result = render();
    await waitFor(() => expect(result.current.layout && focusPanes(result.current.layout)).toHaveLength(2));

    await act(async () => {
      await result.current.openNote('notes/a.md', 'p2', 'here');
    });
    expect(tabsAt(result.current.layout, 1)).toContainEqual({ kind: 'note', path: 'notes/a.md' });
    expect(tabsAt(result.current.layout, 0)).toHaveLength(1);
    expect(result.current.entry?.shown.p2).toBe('note:notes/a.md');
  });

  it('still opens beside the source pane by default', async () => {
    const result = render();
    await waitFor(() => expect(result.current.layout && focusPanes(result.current.layout)).toHaveLength(2));

    await act(async () => {
      await result.current.openNote('notes/a.md', 'p2');
    });
    expect(tabsAt(result.current.layout, 0)).toContainEqual({ kind: 'note', path: 'notes/a.md' });
    expect(tabsAt(result.current.layout, 1)).toHaveLength(1);
  });
});

describe('useNoteFocus close', () => {
  it('returns the pane to the tab shown before the closed one, not to its neighbour', async () => {
    const { result } = renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, flushEditors: async () => true }), { wrapper });
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    for (const id of ['a', 'b', 'c']) await act(() => result.current.place(CURRENT_FOCUS, tab(id), 'p1'));
    await act(() => result.current.show('p1', 'note:notes/a.compilation.yml'));
    await act(() => result.current.close('note:notes/a.compilation.yml', 'p1'));
    await waitFor(() => expect(result.current.entry?.shown.p1).toBe('note:notes/c.compilation.yml'));
    await act(() => result.current.close('note:notes/c.compilation.yml', 'p1'));
    await waitFor(() => expect(result.current.entry?.shown.p1).toBe('note:notes/b.compilation.yml'));
  });
});
