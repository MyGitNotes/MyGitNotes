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

describe('useNoteFocus split and collapse', () => {
  const twoPanes: FocusLayout = { root: { kind: 'split', id: 'columns-2', orientation: 'horizontal', children: [{ kind: 'pane', id: 'p1', tabs: [tab('a'), tab('b')] }, { kind: 'pane', id: 'p2', tabs: [tab('c')] }] } };
  const render = (flushEditors: (paths?: readonly string[]) => Promise<boolean> = async () => true, layout: FocusLayout = twoPanes) => {
    localStorage.setItem(storageKey, JSON.stringify({ current: layout, entries: {}, last: null }));
    return renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, flushEditors }), { wrapper });
  };
  const keyOf = (id: string) => `note:notes/${id}.compilation.yml`;

  it('opens a dropped note in a new pane, shows it there and makes the pane active', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(() => result.current.split(CURRENT_FOCUS, 'p2', 'bottom', tab('d')));
    expect(focusPanes(result.current.layout!).map(pane => pane.id)).toEqual(['p1', 'p2', 'p3']);
    expect(tabsAt(result.current.layout, 2)).toEqual([tab('d')]);
    expect(result.current.entry?.activePane).toBe('p3');
    expect(result.current.entry?.shown.p3).toBe(keyOf('d'));
    expect(result.current.entry?.ratios.s1).toEqual({ p2: 50, p3: 50 });
  });

  it('moves a tab to a new pane and removes the source pane it empties, giving its space to the neighbour', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(() => result.current.split(CURRENT_FOCUS, 'p1', 'top', tab('c'), 'p2'));
    const panes = focusPanes(result.current.layout!);
    expect(panes.map(pane => pane.tabs)).toEqual([[tab('c')], [tab('a'), tab('b')]]);
    expect(result.current.layout?.root).toMatchObject({ kind: 'split', orientation: 'vertical' });
    expect(result.current.entry?.activePane).toBe(panes[0].id);
    expect(Object.keys(result.current.entry?.ratios ?? {})).not.toContain('columns-2');
  });

  it("does not hand a pane its predecessor's id state when a move empties the source and the new pane reuses its id", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    act(() => result.current.setHideToolbar('p2', true));
    await act(() => result.current.split(CURRENT_FOCUS, 'p1', 'right', tab('c'), 'p2'));
    const panes = focusPanes(result.current.layout!), entry = result.current.entry!;
    expect(panes.map(pane => pane.tabs)).toEqual([[tab('a'), tab('b')], [tab('c')]]);
    expect(Object.values(entry.hideToolbar).some(Boolean)).toBe(false);
    expect(entry.history[panes[1].id]).toEqual([keyOf('c')]);
    const [split] = Object.values(entry.ratios);
    expect(Object.keys(entry.ratios)).not.toContain('columns-2');
    expect(split).toEqual({ [panes[0].id]: 50, [panes[1].id]: 50 });
  });

  it('copies instead of moving when asked, leaving the source pane alone', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(() => result.current.split(CURRENT_FOCUS, 'p1', 'right', tab('c'), 'p2', true));
    expect(focusPanes(result.current.layout!)).toHaveLength(3);
    expect(tabsAt(result.current.layout, 2)).toEqual([tab('c')]);
  });

  it('saves every shown editor before it splits, and changes nothing when a save is refused', async () => {
    const flushed: (readonly string[] | undefined)[] = [];
    let accept = true;
    const { result } = render(async paths => {
      flushed.push(paths);
      return accept;
    });
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    accept = false;
    await act(async () => expect(await result.current.split(CURRENT_FOCUS, 'p1', 'right', tab('d'))).toBe(false));
    expect(flushed.at(-1)).toHaveLength(2);
    expect(focusPanes(result.current.layout!)).toHaveLength(2);
    accept = true;
    await act(() => result.current.split(CURRENT_FOCUS, 'p1', 'right', tab('d')));
    expect(focusPanes(result.current.layout!)).toHaveLength(3);
  });

  it('refuses a split over the pane limit with a FocusError', async () => {
    const wide: FocusLayout = { root: { kind: 'split', id: 'row', orientation: 'horizontal', children: Array.from({ length: 8 }, (_, index) => ({ kind: 'pane' as const, id: `p${index + 1}`, tabs: [tab(`n${index}`)] })) } };
    const { result } = render(undefined, wide);
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(async () => {
      await expect(result.current.split(CURRENT_FOCUS, 'p1', 'right', tab('x'))).rejects.toMatchObject({ code: 'pane-limit' });
    });
    expect(result.current.mutationError).toMatchObject({ code: 'pane-limit' });
  });

  it('removes a pane when its last tab closes and activates the most recent remaining pane', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    act(() => result.current.activate('p2'));
    await act(() => result.current.close(keyOf('c'), 'p2'));
    await waitFor(() => expect(focusPanes(result.current.layout!)).toHaveLength(1));
    expect(result.current.layout?.root).toMatchObject({ kind: 'pane', id: 'p1' });
    expect(result.current.entry?.activePane).toBe('p1');
  });

  it('removes the source pane when its last tab moves to another pane', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(() => result.current.moveTab(CURRENT_FOCUS, keyOf('c'), 'p2', 'p1'));
    expect(focusPanes(result.current.layout!).map(pane => pane.id)).toEqual(['p1']);
    expect(tabsAt(result.current.layout, 0)).toEqual([tab('a'), tab('b'), tab('c')]);
    expect(result.current.entry?.shown.p1).toBe(keyOf('c'));
  });
});

describe('useNoteFocus Split right, Merge all panes and Close pane', () => {
  const layout: FocusLayout = { root: { kind: 'split', id: 'columns-3', orientation: 'horizontal', children: [{ kind: 'pane', id: 'p1', tabs: [tab('a'), tab('b')] }, { kind: 'pane', id: 'p2', tabs: [] }, { kind: 'pane', id: 'p3', tabs: [tab('b'), tab('c')] }] } };
  const render = () => {
    localStorage.setItem(storageKey, JSON.stringify({ current: layout, entries: {}, last: null }));
    return renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, flushEditors: async () => true }), { wrapper });
  };

  it('opens the note a pane shows again in a new pane beside it, and makes that pane active', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(async () => expect(await result.current.splitShown('p1', 'horizontal')).toBe(true));
    expect(focusPanes(result.current.layout!).map(pane => pane.tabs.map(candidate => candidate.path))).toEqual([['notes/a.compilation.yml', 'notes/b.compilation.yml'], ['notes/a.compilation.yml'], [], ['notes/b.compilation.yml', 'notes/c.compilation.yml']]);
    expect(result.current.entry?.activePane).toBe('p4');
    await act(async () => expect(await result.current.splitShown('p4', 'vertical')).toBe(true));
    expect(result.current.layout?.root).toMatchObject({ kind: 'split', orientation: 'horizontal' });
  });

  it('does nothing for a pane that shows nothing', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(async () => expect(await result.current.splitShown('p2', 'horizontal')).toBe(false));
    expect(focusPanes(result.current.layout!)).toHaveLength(3);
  });

  it('removes an empty pane and refuses one that still holds tabs', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(async () => expect(await result.current.closeEmptyPane('p1')).toBe(false));
    await act(async () => expect(await result.current.closeEmptyPane('p2')).toBe(true));
    expect(focusPanes(result.current.layout!).map(pane => pane.id)).toEqual(['p1', 'p3']);
  });

  it("merges every pane into the first and keeps the active pane's tab on screen", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(async () => result.current.activate('p3'));
    await act(async () => expect(await result.current.mergeAll()).toBe(true));
    expect(result.current.layout?.root).toMatchObject({ kind: 'pane', id: 'p1' });
    expect(tabsAt(result.current.layout, 0)).toEqual([tab('a'), tab('b'), tab('c')]);
    expect(result.current.entry?.activePane).toBe('p1');
    expect(result.current.entry?.shown.p1).toBe('note:notes/b.compilation.yml');
    await act(async () => expect(await result.current.mergeAll()).toBe(false));
  });
});

describe('useNoteFocus openNote beside the only pane', () => {
  const render = (splitBeside: boolean) => {
    localStorage.setItem(storageKey, JSON.stringify({ current: { root: { kind: 'pane', id: 'p1', tabs: [tab('compilation-a')] } }, entries: {}, last: null }));
    return renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, repository: REPOSITORY, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, splitBeside, flushEditors: async () => true }), { wrapper }).result;
  };

  it('splits the pane to the right on desktop and shows the note in the new pane', async () => {
    const result = render(true);
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    let opened: string | undefined;
    await act(async () => {
      opened = await result.current.openNote('notes/a.md', 'p1');
    });
    expect(opened).toBe('opened');
    expect(result.current.layout?.root).toMatchObject({ kind: 'split', orientation: 'horizontal' });
    expect(tabsAt(result.current.layout, 0)).toEqual([tab('compilation-a')]);
    expect(tabsAt(result.current.layout, 1)).toEqual([{ kind: 'note', path: 'notes/a.md' }]);
    expect(result.current.entry?.activePane).toBe('p2');
    expect(result.current.entry?.shown.p2).toBe('note:notes/a.md');
  });

  it('keeps adding a tab to the pane where the whole tree is not on screen, and for placement here', async () => {
    const narrow = render(false);
    await waitFor(() => expect(narrow.current.layout).not.toBeNull());
    await act(async () => {
      await narrow.current.openNote('notes/a.md', 'p1');
    });
    expect(focusPanes(narrow.current.layout!)).toHaveLength(1);
    expect(tabsAt(narrow.current.layout, 0)).toHaveLength(2);
    localStorage.clear();
    const wide = render(true);
    await waitFor(() => expect(wide.current.layout).not.toBeNull());
    await act(async () => {
      await wide.current.openNote('notes/b.md', 'p1', 'here');
    });
    expect(focusPanes(wide.current.layout!)).toHaveLength(1);
  });

  it('opens beside the most recent other pane once there are two', async () => {
    const result = render(true);
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(async () => {
      await result.current.openNote('notes/a.md', 'p1');
    });
    await act(async () => {
      await result.current.openNote('notes/b.md', 'p2');
    });
    expect(focusPanes(result.current.layout!)).toHaveLength(2);
    expect(tabsAt(result.current.layout, 0)).toContainEqual({ kind: 'note', path: 'notes/b.md' });
  });
});
