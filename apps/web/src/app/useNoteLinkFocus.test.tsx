// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { type FocusLayout } from '@mygitnotes/core/focus-page';
import { useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { BrowserRouter, type Location, MemoryRouter, UNSAFE_NavigationContext, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFocusNoteState, noteReturnRoute, parseWorkspaceRoute } from '../lib/routes.js';
import type { OpenResult } from '../lib/use-note-focus.js';
import { useFocusNoteNavigation } from './useFocusNoteNavigation.js';
import { useNoteLinkLoad, useOpenNoteLinkInFocus } from './useNoteLinkFocus.js';
import { useNoteSort } from './useNoteSort.js';
import { useNoteActions } from './useNoteActions.js';
import { editorModeOf, shownEditorMode } from '../lib/editor-mode-url.js';
import { followMovedNote } from './follow-moved-note.js';

vi.mock(import('../lib/api.js'), async original => ({ ...await original(), fetchAssets: vi.fn(async () => []) }));

const ROOT = 'notes/life';
const LANE = `${ROOT}/reading.compilation.yml`;
const at = (name: string) => `${ROOT}/${name}`;
type Panes = Record<string, string[]>;
interface FocusState {
  panes: Panes;
  activePane: string;
  shown: Record<string, string | null>;
}

/** A Focus of the `life` notebook: panes of tabs, the note each shows and the active pane, as the page's Focus keeps them. */
function useFakeFocus(initial: FocusState, { loading = false, result, gate }: { loading?: boolean; result?: OpenResult; gate?: (path: string) => Promise<void>; }) {
  const [state, setState] = useState(initial);
  const layout: FocusLayout = Object.keys(state.panes).length === 1 ? { root: { kind: 'pane', id: Object.keys(state.panes)[0]!, tabs: state.panes[Object.keys(state.panes)[0]!]!.map(path => ({ kind: 'note', path })) } } : { root: { kind: 'split', id: 's1', orientation: 'horizontal', children: Object.entries(state.panes).map(([id, paths]) => ({ kind: 'pane', id, tabs: paths.map(path => ({ kind: 'note', path })) })) } };
  const entry = { activePane: state.activePane, shown: Object.fromEntries(Object.entries(state.shown).map(([pane, path]) => [pane, path ? `note:${path}` : null])), recent: [], history: {}, ratios: {}, hideToolbar: {} };
  const [openNote] = useState(() =>
    vi.fn(async (path: string): Promise<OpenResult> => {
      if (result) return result;
      if (gate) await gate(path);
      setState(current => ({ ...current, panes: { ...current.panes, [current.activePane]: current.panes[current.activePane]!.includes(path) ? current.panes[current.activePane]! : [...current.panes[current.activePane]!, path] }, shown: { ...current.shown, [current.activePane]: path } }));
      return 'opened';
    })
  );
  const show = async (pane: string, key: string) => setState(current => ({ ...current, activePane: pane, shown: { ...current.shown, [pane]: key.slice('note:'.length) } }));
  const close = (path: string) =>
    setState(current => {
      const tabs = current.panes[current.activePane]!.filter(tab => tab !== path);
      return { ...current, panes: { ...current.panes, [current.activePane]: tabs }, shown: { ...current.shown, [current.activePane]: tabs.at(-1) ?? null } };
    });
  const rename = (from: string, to: string) => setState(current => ({ ...current, panes: Object.fromEntries(Object.entries(current.panes).map(([pane, tabs]) => [pane, tabs.map(tab => tab === from ? to : tab)])), shown: Object.fromEntries(Object.entries(current.shown).map(([pane, path]) => [pane, path === from ? to : path])) }));
  const noteFocus = { loading, shown: 'current', layout, entry, notes: new Map(), openNote, show } as never;
  return { noteFocus, state, openNote, close, rename, activeNotePath: state.shown[state.activePane] ?? undefined };
}

interface Harness {
  url: string;
  /** The state of the history entry. */
  state: unknown;
  zoomed: boolean;
  /** Whether the note link the page was loaded on still waits for the Focus. */
  linkPending: boolean;
  focus: ReturnType<typeof useFakeFocus>;
  navigate: ReturnType<typeof useNavigate>;
  browse: (path: string) => Promise<void>;
  /** The person clicks a link to the note at `path` in a note `pane` shows. */
  link: (path: string, pane: string) => Promise<void>;
  setNarrow: (view: 'focus' | 'browse') => void;
  narrow: 'focus' | 'browse';
  handleOpenNote: ReturnType<typeof vi.fn>;
  /** The person picks the sort by title, as the page's sort menu does. */
  sortByTitle: () => void;
  /** The person picks split view in the mode control of the Focus pane showing `path`: the app's zoom opens it in that mode. */
  zoomInMode: (path: string, mode: 'live' | 'raw' | 'split') => Promise<boolean>;
}

/** A link in a note the Focus pane `pane` shows. */
function linkIn(pane: string) {
  const anchor = document.createElement('a');
  anchor.dataset.focusPane = pane;
  return anchor;
}

const existing = new Set([at('a.md'), at('b.md'), at('c.md'), at('renamed.md'), at('.templates/reading.md'), LANE]);

/**
 * `onCommit` runs as each render of the page is committed, before the effects of that render: what the person does in a
 * handler the browser runs between a render and its effects (React runs the effects of a non-urgent render in a later task).
 */
function Page({ report, focus: initial, options }: { report: (harness: Harness) => void; focus: FocusState; options: { loading?: boolean; result?: OpenResult; notebookId?: string; narrow?: 'focus' | 'browse'; onCommit?: (harness: Harness) => void; onMarked?: (harness: Harness) => void; gate?: (path: string) => Promise<void>; moved?: Record<string, string>; }; }) {
  const location = useLocation(), navigate = useNavigate();
  const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);
  const link = useNoteLinkLoad(location, editorRoute);
  const focus = useFakeFocus(initial, options);
  const [narrow, setNarrow] = useState<'focus' | 'browse'>(options.narrow ?? 'focus');
  const returnTo = noteReturnRoute(location.search, editorRoute.notebook ?? 'life', editorRoute.folder);
  const routedPath = editorRoute.note ? at(editorRoute.note) : null;
  const routedNote = routedPath && existing.has(routedPath) ? { notebookId: options.notebookId ?? 'life', path: routedPath, title: routedPath, content: '' } as never : null;
  // A note the server says lies elsewhere now (a live note's earlier target) is loading until the page follows it there, as the app's routed note does.
  const movedTo = routedPath ? options.moved?.[routedPath] : undefined;
  const routeError = routedPath && !existing.has(routedPath) && !movedTo ? 'route.noteNotFound' : '';
  useEffect(() => {
    if (movedTo && routedPath) followMovedNote({ note: { notebookId: 'life', path: routedPath }, to: movedTo, notebook: { id: 'life', root: ROOT }, routedPath, search: location.search, state: location.state, link, relocatePaths: () => {}, navigate, refresh: () => {} });
  });
  const [handleOpenNote] = useState(() => vi.fn(async () => true));
  const { handleSortChange } = useNoteSort('life', undefined, link.inFocus);
  const [setEditingNote] = useState(() => vi.fn()), [setAssets] = useState(() => vi.fn());
  const { handleOpenNote: openZoom } = useNoteActions({ activeTab: 'notes', editorRegistry: {} as never, setEditingNote, config: { notebooks: [{ id: 'life', root: ROOT }] } as never, location, editorRoute, focusNoteRoute: link.inFocus, returnTo, selectedFolder: null, selectedNotebookId: 'life', navigate, setAssets });
  const { trackOpen } = useOpenNoteLinkInFocus({ link, location, navigate, editorRoute, routedNote, routedPath, routeError, noteFocus: focus.noteFocus, activeNotePath: focus.activeNotePath, focusNarrowView: narrow, selectedNotebookId: 'life', notebookRoot: ROOT, returnTo, browsing: editorRoute.tab === 'notes', setFocusNarrowView: setNarrow, isTemplate: note => note.path.includes('/.templates/') });
  const { openFromBrowse, openLink } = useFocusNoteNavigation({ noteFocus: focus.noteFocus, selectedNotebookId: 'life', setFocusNarrowView: setNarrow, handleOpenNote: handleOpenNote as never, setAddingToFocus: vi.fn(), isTemplate: note => note.path.includes('/.templates/'), trackOpen });
  const harness: Harness = { url: location.pathname + location.search + location.hash, state: location.state, zoomed: Boolean(routedNote) && !routeError && !link.inFocus, linkPending: link.pending, focus, navigate, browse: path => openFromBrowse({ notebookId: 'life', path, title: path } as never), link: (path, pane) => openLink({ notebookId: 'life', path, title: path } as never, undefined, linkIn(pane)), setNarrow, narrow, handleOpenNote, sortByTitle: () => handleSortChange('title', 'asc'), zoomInMode: (path, mode) => openZoom({ notebookId: 'life', path, title: path } as never, '', { mode }) };
  useLayoutEffect(() => {
    report(harness);
    options.onCommit?.(harness);
  });
  // `onMarked` runs in the effects that marked the entry, before the marked entry renders (a transition render under load).
  const { navigator } = useContext(UNSAFE_NavigationContext);
  useEffect(() => {
    if (isFocusNoteState((navigator as unknown as { location: Location; }).location.state) && !isFocusNoteState(location.state)) options.onMarked?.(harness);
  });
  return null;
}

const empty = (): FocusState => ({ panes: { p1: [] }, activePane: 'p1', shown: { p1: null } });
const showing = (panes: Panes, activePane = Object.keys(panes)[0]!, shown?: Record<string, string>): FocusState => ({ panes, activePane, shown: shown ?? Object.fromEntries(Object.entries(panes).map(([pane, tabs]) => [pane, tabs.at(-1) ?? null])) });

function open(entries: (string | { pathname: string; search?: string; hash?: string; state?: unknown; })[], focus: FocusState = empty(), options: Parameters<typeof Page>[0]['options'] = {}) {
  const api = { current: undefined as unknown as Harness };
  const view = render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Page report={harness => api.current = harness} focus={focus} options={options} />
    </MemoryRouter>,
  );
  return { api, view };
}
const back = (api: { current: Harness; }) => act(() => void api.current.navigate(-1));
const forward = (api: { current: Harness; }) => act(() => void api.current.navigate(1));
/** The address names the note `name` and the Focus shows its tab: the active pane's shown note is the one the URL names. */
const showsNote = async (api: { current: Harness; }, name: string) => {
  await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at(name)));
  expect(api.current.url).toBe(`/notebooks/life/notes/${name}`);
  expect(api.current.zoomed).toBe(false);
};
/** The person clicks the tab of `path` in `pane`. */
const show = (api: { current: Harness; }, pane: string, path: string) => (api.current.focus.noteFocus as { show: (pane: string, key: string) => Promise<void>; }).show(pane, `note:${path}`);

/** Holds each note the Focus opens until the test lets it finish, as a note read over the network does. */
function heldOpens() {
  const waiting = new Map<string, () => void>();
  const held = { holding: true };
  const gate = (path: string) => held.holding ? new Promise<void>(release => waiting.set(path, release)) : Promise.resolve();
  /** Lets the opens of `paths` finish, those not waiting skipped, in one render. */
  const release = (...paths: string[]) =>
    act(async () => {
      for (const path of paths) {
        waiting.get(path)?.();
        waiting.delete(path);
      }
    });
  /** Opens finish at once from now on. */
  const stop = () => void (held.holding = false);
  return { gate, waiting, release, stop };
}

afterEach(() => vi.unstubAllGlobals());

describe('a note link loaded as the page', () => {
  it('opens the note as a tab of the active Focus and keeps naming it in the address bar', async () => {
    const { api } = open(['/notebooks/life/notes/a.md?q=draft#Part']);
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
    expect(api.current.focus.openNote).toHaveBeenCalledWith(at('a.md'));
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft#Part');
    expect(api.current.zoomed).toBe(false);
  });
  it('on a reload lands on the same note in the same Focus, reselecting its tab instead of opening a second one', async () => {
    const { api } = open(['/notebooks/life/notes/a.md'], showing({ p1: [at('a.md')], p2: [at('b.md')] }, 'p2'));
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
    expect(api.current.focus.state.activePane).toBe('p1');
    expect(api.current.focus.openNote).not.toHaveBeenCalled();
    expect(api.current.url).toBe('/notebooks/life/notes/a.md');
    expect(api.current.zoomed).toBe(false);
  });
  it('keeps the note in the Focus when the sort or the Focus shown changes the query of its address', async () => {
    const { api } = open(['/notebooks/life/notes/a.md?q=draft']);
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
    // The sort and the Focus switcher copy the mark from the entry the page shows, so the mark is shown before they run.
    await waitFor(() => expect(isFocusNoteState(api.current.state)).toBe(true));
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft');
    act(() => api.current.sortByTitle());
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft&sortField=title&sortOrder=asc'));
    expect(api.current.zoomed).toBe(false);
    expect(api.current.focus.activeNotePath).toBe(at('a.md'));
    await back(api);
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft'));
    expect(api.current.zoomed).toBe(false);
  });
  it('never undoes a change of the address the person makes as the Focus shows the note, before the page marked it', async () => {
    let changed = false;
    const { api } = open(['/notebooks/life/notes/a.md?q=draft'], empty(), {
      onCommit: harness => {
        if (changed || harness.linkPending || harness.focus.activeNotePath !== at('a.md')) return;
        changed = true;
        // The sort, clicked as the Focus shows the note, before the page's effects marked its entry.
        harness.sortByTitle();
      },
    });
    await waitFor(() => expect(changed).toBe(true));
    await act(async () => {});
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft&sortField=title&sortOrder=asc');
    expect(api.current.zoomed).toBe(false);
    expect(isFocusNoteState(api.current.state)).toBe(true);
    await back(api);
    await waitFor(() => expect(isFocusNoteState(api.current.state)).toBe(true));
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft');
    expect(api.current.zoomed).toBe(false);
    expect(api.current.focus.activeNotePath).toBe(at('a.md'));
  });
  it('keeps the note in the Focus when the sort is picked after its entry was marked, before the marked entry rendered', async () => {
    let changed = false;
    const { api } = open(['/notebooks/life/notes/a.md?q=draft'], empty(), {
      onMarked: harness => {
        if (changed) return;
        changed = true;
        harness.sortByTitle();
      },
    });
    await waitFor(() => expect(changed).toBe(true));
    await act(async () => {});
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft&sortField=title&sortOrder=asc');
    expect(api.current.zoomed).toBe(false);
    expect(isFocusNoteState(api.current.state)).toBe(true);
    expect(api.current.focus.activeNotePath).toBe(at('a.md'));
  });
  it("under the browser's own history, opens the loaded link in the Focus and marks its entry", async () => {
    window.history.replaceState(null, '', '/notebooks/life/notes/a.md?q=draft');
    const api = { current: undefined as unknown as Harness };
    render(
      <BrowserRouter>
        <Page report={harness => api.current = harness} focus={empty()} options={{}} />
      </BrowserRouter>,
    );
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
    await waitFor(() => expect(isFocusNoteState(api.current.state)).toBe(true));
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft');
    expect(api.current.zoomed).toBe(false);
    act(() => api.current.sortByTitle());
    await waitFor(() => expect(window.location.search).toBe('?q=draft&sortField=title&sortOrder=asc'));
    expect(api.current.zoomed).toBe(false);
  });
  it('waits for the Focus to load before opening', async () => {
    const { api, view } = open(['/notebooks/life/notes/a.md'], empty(), { loading: true });
    expect(api.current.focus.openNote).not.toHaveBeenCalled();
    expect(api.current.zoomed).toBe(false);
    view.rerender(
      <MemoryRouter initialEntries={['/notebooks/life/notes/a.md']}>
        <Page report={harness => api.current = harness} focus={empty()} options={{}} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
  });
  it('stays in zoom when the Focus cannot take the note or it belongs to another notebook', async () => {
    const full = open(['/notebooks/life/notes/a.md'], empty(), { result: 'full' });
    await waitFor(() => expect(full.api.current.zoomed).toBe(true));
    expect(full.api.current.url).toBe('/notebooks/life/notes/a.md');
    const other = open(['/notebooks/life/notes/a.md'], empty(), { notebookId: 'work' });
    await waitFor(() => expect(other.api.current.zoomed).toBe(true));
    expect(other.api.current.focus.openNote).not.toHaveBeenCalled();
  });
  it('keeps the not-found page of a missing note', async () => {
    const { api } = open(['/notebooks/life/notes/missing.md']);
    await waitFor(() => expect(api.current.focus.openNote).not.toHaveBeenCalled());
    expect(api.current.url).toBe('/notebooks/life/notes/missing.md');
  });
  for (const order of ['the click first', 'both in one render'] as const) {
    it(`wins over a list click made while it opens (${order}), which opens nothing and leaves the history as it was`, async () => {
      const held = heldOpens();
      const { api } = open(['/settings', '/notebooks/life/notes/a.md'], empty(), { gate: held.gate });
      await waitFor(() => expect(held.waiting.has(at('a.md'))).toBe(true));
      expect(api.current.linkPending).toBe(true);
      let clicked: Promise<void> | undefined;
      act(() => void (clicked = api.current.browse(at('b.md'))));
      if (order === 'the click first') {
        await held.release(at('b.md'));
        await held.release(at('a.md'));
      } else {
        await held.release(at('a.md'), at('b.md'));
      }
      // The ignored click settles: nothing waits for it.
      await act(async () => await clicked);
      await waitFor(() => expect(isFocusNoteState(api.current.state)).toBe(true));
      await showsNote(api, 'a.md');
      expect(api.current.focus.openNote).toHaveBeenCalledTimes(1);
      expect(api.current.focus.openNote).toHaveBeenCalledWith(at('a.md'));
      expect(api.current.focus.state.panes.p1).toEqual([at('a.md')]);
      expect(api.current.handleOpenNote).not.toHaveBeenCalled();
      // Once it settled, a click opens its note as before, in a new entry Back leaves for the loaded note.
      held.stop();
      await act(() => api.current.browse(at('b.md')));
      await showsNote(api, 'b.md');
      await back(api);
      await showsNote(api, 'a.md');
      expect(isFocusNoteState(api.current.state)).toBe(true);
      await back(api);
      expect(api.current.url).toBe('/settings');
    });
  }
  it('leaves a template file’s link in zoom: a template never opens in a Focus pane', async () => {
    const { api } = open(['/notebooks/life/notes/.templates/reading.md']);
    await waitFor(() => expect(api.current.zoomed).toBe(true));
    expect(api.current.focus.openNote).not.toHaveBeenCalled();
    expect(api.current.url).toBe('/notebooks/life/notes/.templates/reading.md');
  });
});

describe('a note link loaded at a path the note moved away from', () => {
  it('opens the note in the Focus where it lies now, the address naming it there, instead of the not-found page or zoom', async () => {
    const { api } = open(['/notebooks/life/notes/old.md'], empty(), { moved: { [at('old.md')]: at('renamed.md') } });
    await showsNote(api, 'renamed.md');
    expect(api.current.focus.openNote).toHaveBeenCalledWith(at('renamed.md'));
    expect(api.current.focus.openNote).toHaveBeenCalledOnce();
  });
});

describe('the address of the Focus', () => {
  it('names the note a list click opens, keeping the browse query, in a new history entry', async () => {
    const { api } = open(['/notebooks/life?q=draft&view=flat']);
    await act(() => api.current.browse(at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md?q=draft&view=flat'));
    expect(api.current.zoomed).toBe(false);
    await back(api);
    expect(api.current.url).toBe('/notebooks/life?q=draft&view=flat');
  });
  it('follows the Focus displayed on the notebook page: its active note replaces the notebook route', async () => {
    const { api } = open(['/notebooks/life?q=draft'], showing({ p1: [at('a.md')] }));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft'));
    expect(api.current.zoomed).toBe(false);
  });
  it('replaces the entry when the person switches tabs or panes', async () => {
    const { api } = open(['/settings', '/notebooks/life?q=draft'], showing({ p1: [at('a.md'), at('b.md')], p2: [at('c.md')] }, 'p1', { p1: at('a.md'), p2: at('c.md') }));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft'));
    await act(() => show(api, 'p1', at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md?q=draft'));
    await act(() => show(api, 'p2', at('c.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/c.md?q=draft'));
    await back(api);
    expect(api.current.url).toBe('/settings');
  });
  it('keeps a change of the address the person makes as the tab they switch to is shown, before the page followed it', async () => {
    let changed = false;
    const { api } = open(['/settings', '/notebooks/life?q=draft'], showing({ p1: [at('a.md'), at('b.md')] }, 'p1', { p1: at('a.md') }), {
      onCommit: harness => {
        if (changed || harness.focus.activeNotePath !== at('b.md')) return;
        changed = true;
        // The sort, clicked as the Focus shows the tab, before the page's effects gave the address its note.
        harness.sortByTitle();
      },
    });
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft'));
    await act(() => show(api, 'p1', at('b.md')));
    await waitFor(() => expect(changed).toBe(true));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md?q=draft&sortField=title&sortOrder=asc'));
    expect(api.current.zoomed).toBe(false);
    await back(api);
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft');
  });
  it('replaces the entry when the shown note is renamed or its tab closed, and names the notebook once the Focus is empty', async () => {
    const { api } = open(['/notebooks/life'], showing({ p1: [at('a.md'), at('b.md')] }));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md'));
    act(() => api.current.focus.rename(at('b.md'), at('renamed.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/renamed.md'));
    act(() => api.current.focus.close(at('renamed.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md'));
    act(() => api.current.focus.close(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life'));
    expect(api.current.zoomed).toBe(false);
  });
  it('names the notebook while a compilation tab is shown', async () => {
    const { api } = open(['/notebooks/life?q=draft']);
    await act(() => api.current.browse(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft'));
    await act(() => api.current.browse(LANE));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life?q=draft'));
    await back(api);
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft');
  });
  it('keeps a browsed folder of the notebook route through the note route and back', async () => {
    const { api } = open(['/notebooks/life/folders/projects?q=draft']);
    await act(() => api.current.browse(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft&folder=projects'));
    act(() => api.current.focus.close(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/folders/projects?q=draft'));
  });
  it('leaves a board address on the board while the Focus shows a note', async () => {
    const { api } = open(['/notebooks/life/notes/a.md', '/notebooks/life?view=kanban&q=draft'], showing({ p1: [at('a.md')] }));
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(api.current.url).toBe('/notebooks/life?view=kanban&q=draft');
  });
  it('opens a note picked on the board below the board, preserving its view in the note address and on Back', async () => {
    const { api } = open(['/notebooks/life?view=kanban&q=draft'], showing({ p1: [at('a.md')] }));
    await act(() => api.current.browse(at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md?view=kanban&q=draft'));
    await back(api);
    expect(api.current.url).toBe('/notebooks/life?view=kanban&q=draft');
  });
  it('returns to the board address after closing its last Focus note', async () => {
    const { api } = open(['/notebooks/life?view=kanban']);
    await act(() => api.current.browse(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?view=kanban'));
    act(() => api.current.focus.close(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life?view=kanban'));
  });
  it('drops the ?notebook= the way back from Settings leaves on the notebook route, since the note route names its notebook', async () => {
    const { api } = open(['/settings', '/notebooks/life?q=draft&notebook=life'], showing({ p1: [at('a.md')] }));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md?q=draft'));
  });
});

describe('Back', () => {
  it('returns to the previous note and reselects its tab without opening a second one or pushing again', async () => {
    const { api } = open(['/notebooks/life']);
    await act(() => api.current.browse(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md'));
    await act(() => api.current.browse(at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md'));
    await back(api);
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
    expect(api.current.url).toBe('/notebooks/life/notes/a.md');
    expect(api.current.focus.state.panes.p1).toEqual([at('a.md'), at('b.md')]);
    expect(api.current.focus.openNote).toHaveBeenCalledTimes(2);
    expect(api.current.zoomed).toBe(false);
    await back(api);
    expect(api.current.url).toBe('/notebooks/life');
  });
  it('returns to the note link the page was loaded on after the dock opened another note, every time', async () => {
    const { api } = open(['/notebooks/life/notes/a.md']);
    await showsNote(api, 'a.md');
    await act(() => api.current.browse(at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md'));
    await back(api);
    await showsNote(api, 'a.md');
    await forward(api);
    await showsNote(api, 'b.md');
    await back(api);
    await showsNote(api, 'a.md');
    await act(() => api.current.browse(at('c.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/c.md'));
    await back(api);
    await showsNote(api, 'a.md');
    expect(api.current.focus.state.panes.p1).toEqual([at('a.md'), at('b.md'), at('c.md')]);
    expect(api.current.focus.openNote).toHaveBeenCalledTimes(3);
  });
  it('answers a return to an entry it answered before, whether the note was opened from the list, the dock or a link', async () => {
    const { api } = open(['/notebooks/life']);
    await act(() => api.current.browse(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md'));
    await act(() => api.current.browse(at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md'));
    await back(api);
    await showsNote(api, 'a.md');
    await act(() => api.current.link(at('c.md'), 'p1'));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/c.md'));
    await back(api);
    await showsNote(api, 'a.md');
    await forward(api);
    await showsNote(api, 'c.md');
    await back(api);
    await showsNote(api, 'a.md');
    await act(() => api.current.browse(at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md'));
    await back(api);
    await showsNote(api, 'a.md');
    await back(api);
    expect(api.current.url).toBe('/notebooks/life');
    await forward(api);
    await showsNote(api, 'a.md');
    await forward(api);
    await showsNote(api, 'b.md');
    expect(api.current.focus.state.panes.p1).toEqual([at('a.md'), at('b.md'), at('c.md')]);
    expect(api.current.focus.openNote).toHaveBeenCalledTimes(4);
  });
  it('after Back, keeps the tab the person switches to and replaces the entry with its note', async () => {
    const { api } = open(['/notebooks/life']);
    await act(() => api.current.browse(at('a.md')));
    await act(() => api.current.browse(at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md'));
    await back(api);
    await showsNote(api, 'a.md');
    await act(() => show(api, 'p1', at('b.md')));
    await showsNote(api, 'b.md');
    await back(api);
    expect(api.current.url).toBe('/notebooks/life');
    await forward(api);
    await showsNote(api, 'b.md');
  });
  it('reselects the tab in the pane that holds it', async () => {
    const { api } = open(['/notebooks/life'], showing({ p1: [at('a.md')], p2: [at('b.md')] }, 'p1'));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md'));
    await act(() => api.current.browse(at('c.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/c.md'));
    await act(() => show(api, 'p2', at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md'));
    await back(api);
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
    expect(api.current.focus.state.activePane).toBe('p1');
    expect(api.current.focus.state.panes).toEqual({ p1: [at('a.md'), at('c.md')], p2: [at('b.md')] });
    expect(api.current.url).toBe('/notebooks/life/notes/a.md');
  });
  it('from zoom closes back to the Focus address', async () => {
    const { api } = open(['/notebooks/life', { pathname: '/notebooks/life/notes/c.md', search: '?returnTo=%2Fnotebooks%2Flife' }], showing({ p1: [at('a.md')] }));
    expect(api.current.zoomed).toBe(true);
    expect(api.current.url).toBe('/notebooks/life/notes/c.md?returnTo=%2Fnotebooks%2Flife');
    await back(api);
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md'));
    expect(api.current.zoomed).toBe(false);
  });
});

describe('on a phone', () => {
  const phone = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  it('names the note while the note screen is shown and the notebook on the list screen', async () => {
    phone();
    const { api } = open(['/notebooks/life?q=draft'], showing({ p1: [at('a.md')] }), { narrow: 'browse' });
    await waitFor(() => expect(api.current.narrow).toBe('browse'));
    expect(api.current.url).toBe('/notebooks/life?q=draft');
    await act(() => api.current.browse(at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md?q=draft'));
    expect(api.current.narrow).toBe('focus');
    act(() => api.current.setNarrow('browse'));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life?q=draft'));
  });
  it('keeps the board and note on separate screens and returns to the board with Back', async () => {
    phone();
    const { api } = open(['/notebooks/life?view=kanban'], empty(), { narrow: 'browse' });
    await act(() => api.current.browse(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md'));
    expect(api.current.narrow).toBe('focus');
    await back(api);
    await waitFor(() => expect(api.current.narrow).toBe('browse'));
    expect(api.current.url).toBe('/notebooks/life?view=kanban');
  });
  it('shows the list again when Back leaves the note', async () => {
    phone();
    const { api } = open(['/notebooks/life'], empty(), { narrow: 'browse' });
    await act(() => api.current.browse(at('a.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/a.md'));
    await back(api);
    await waitFor(() => expect(api.current.narrow).toBe('browse'));
    expect(api.current.url).toBe('/notebooks/life');
  });
});

describe('a zoom URL', () => {
  it('stays zoom, since the app navigated there itself and gave it a returnTo', async () => {
    const { api } = open([{ pathname: '/notebooks/life/notes/a.md', search: '?returnTo=%2Fnotebooks%2Flife' }], showing({ p1: [at('b.md')] }));
    await waitFor(() => expect(api.current.zoomed).toBe(true));
    expect(api.current.focus.openNote).not.toHaveBeenCalled();
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?returnTo=%2Fnotebooks%2Flife');
  });
  it('is a note link that asks for zoom with ?zoom, which opens it in zoom instead of the Focus', async () => {
    for (const url of ['/notebooks/life/notes/a.md?zoom', '/notebooks/life/notes/a.md?zoom=1#Part']) {
      const { api, view } = open([url], showing({ p1: [at('b.md')] }));
      await waitFor(() => expect(api.current.zoomed).toBe(true));
      expect(api.current.focus.openNote).not.toHaveBeenCalled();
      expect(api.current.url).toBe(url);
      view.unmount();
    }
  });
  it('is not a Focus address when the app opens a note route itself without one', async () => {
    const { api } = open(['/notebooks/life'], showing({ p1: [at('b.md')] }));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md'));
    act(() => void api.current.navigate('/notebooks/life/notes/c.md?folder=projects'));
    await waitFor(() => expect(api.current.zoomed).toBe(true));
    expect(api.current.focus.openNote).not.toHaveBeenCalled();
    expect(api.current.url).toBe('/notebooks/life/notes/c.md?folder=projects');
  });
});

describe('split view picked in a Focus pane', () => {
  it('opens the note in zoom with mode=split as a new entry, and Back returns to the Focus showing the same tab', async () => {
    const { api } = open(['/notebooks/life'], showing({ p1: [at('a.md'), at('b.md')] }, 'p1', { p1: at('b.md') }));
    await showsNote(api, 'b.md');
    await waitFor(() => expect(isFocusNoteState(api.current.state)).toBe(true));
    await act(() => api.current.zoomInMode(at('b.md'), 'split'));
    await waitFor(() => expect(api.current.zoomed).toBe(true));
    const zoom = new URL(api.current.url, 'https://workspace.invalid');
    expect(zoom.pathname).toBe('/notebooks/life/notes/b.md');
    expect(zoom.searchParams.get('mode')).toBe('split');
    expect(zoom.searchParams.get('returnTo')).toBe('/notebooks/life');
    expect(shownEditorMode(editorModeOf(zoom.search), { frame: 'zoom', phone: false })).toBe('split');
    // The Focus underneath did not move.
    expect(api.current.focus.activeNotePath).toBe(at('b.md'));
    await back(api);
    await showsNote(api, 'b.md');
    expect(api.current.focus.state.panes.p1).toEqual([at('a.md'), at('b.md')]);
    // The pane shows the note live: its address names no mode.
    expect(shownEditorMode(editorModeOf(new URL(api.current.url, 'https://workspace.invalid').search), { frame: 'pane', phone: false })).toBe('live');
  });

  it('keeps a split link that lands in the Focus as it is, the pane showing live', async () => {
    const { api } = open(['/notebooks/life/notes/a.md?mode=split']);
    await waitFor(() => expect(api.current.focus.activeNotePath).toBe(at('a.md')));
    await waitFor(() => expect(isFocusNoteState(api.current.state)).toBe(true));
    expect(api.current.url).toBe('/notebooks/life/notes/a.md?mode=split');
    expect(api.current.zoomed).toBe(false);
    expect(shownEditorMode(editorModeOf('?mode=split'), { frame: 'pane', phone: false })).toBe('live');
  });

  it('keeps the mode in the address when the Focus moves to another tab', async () => {
    const { api } = open(['/notebooks/life/notes/a.md?mode=source'], showing({ p1: [at('a.md'), at('b.md')] }, 'p1', { p1: at('a.md') }));
    await waitFor(() => expect(isFocusNoteState(api.current.state)).toBe(true));
    await act(() => show(api, 'p1', at('b.md')));
    await waitFor(() => expect(api.current.url).toBe('/notebooks/life/notes/b.md?mode=source'));
  });
});
