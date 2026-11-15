// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { type FocusLayout } from '@mygitnotes/core/focus-page';
import React, { useMemo, useRef, useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteReturnRoute, parseWorkspaceRoute } from '../lib/routes.js';
import type { OpenResult } from '../lib/use-note-focus.js';
import { useFocusNoteNavigation } from './useFocusNoteNavigation.js';
import { useNoteLinkLoad, useOpenNoteLinkInFocus } from './useNoteLinkFocus.js';

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
function useFakeFocus(initial: FocusState, { loading = false, result }: { loading?: boolean; result?: OpenResult; }) {
  const [state, setState] = useState(initial);
  const layout: FocusLayout = Object.keys(state.panes).length === 1
    ? { root: { kind: 'pane', id: Object.keys(state.panes)[0]!, tabs: state.panes[Object.keys(state.panes)[0]!]!.map(path => ({ kind: 'note', path })) } }
    : { root: { kind: 'split', id: 's1', orientation: 'horizontal', children: Object.entries(state.panes).map(([id, paths]) => ({ kind: 'pane', id, tabs: paths.map(path => ({ kind: 'note', path })) })) } };
  const entry = { activePane: state.activePane, shown: Object.fromEntries(Object.entries(state.shown).map(([pane, path]) => [pane, path ? `note:${path}` : null])), recent: [], history: {}, ratios: {}, hideToolbar: {} };
  const openNote = vi.fn(async (path: string): Promise<OpenResult> => {
    if (result) return result;
    setState(current => ({ ...current, panes: { ...current.panes, [current.activePane]: current.panes[current.activePane]!.includes(path) ? current.panes[current.activePane]! : [...current.panes[current.activePane]!, path] }, shown: { ...current.shown, [current.activePane]: path } }));
    return 'opened';
  });
  const opened = useRef(openNote);
  const show = async (pane: string, key: string) => setState(current => ({ ...current, activePane: pane, shown: { ...current.shown, [pane]: key.slice('note:'.length) } }));
  const close = (path: string) =>
    setState(current => {
      const tabs = current.panes[current.activePane]!.filter(tab => tab !== path);
      return { ...current, panes: { ...current.panes, [current.activePane]: tabs }, shown: { ...current.shown, [current.activePane]: tabs.at(-1) ?? null } };
    });
  const rename = (from: string, to: string) => setState(current => ({ ...current, panes: Object.fromEntries(Object.entries(current.panes).map(([pane, tabs]) => [pane, tabs.map(tab => tab === from ? to : tab)])), shown: Object.fromEntries(Object.entries(current.shown).map(([pane, path]) => [pane, path === from ? to : path])) }));
  const noteFocus = { loading, shown: 'current', layout, entry, notes: new Map(), openNote: opened.current, show } as never;
  return { noteFocus, state, openNote: opened.current, close, rename, activeNotePath: state.shown[state.activePane] ?? undefined };
}

interface Harness {
  url: string;
  zoomed: boolean;
  focus: ReturnType<typeof useFakeFocus>;
  navigate: ReturnType<typeof useNavigate>;
  browse: (path: string) => Promise<void>;
  setNarrow: (view: 'focus' | 'browse') => void;
  narrow: 'focus' | 'browse';
  handleOpenNote: ReturnType<typeof vi.fn>;
}

const existing = new Set([at('a.md'), at('b.md'), at('c.md'), at('renamed.md'), at('.templates/reading.md'), LANE]);

function Page({ api, focus: initial, options }: { api: { current: Harness; }; focus: FocusState; options: { loading?: boolean; result?: OpenResult; notebookId?: string; narrow?: 'focus' | 'browse'; }; }) {
  const location = useLocation(), navigate = useNavigate();
  const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);
  const link = useNoteLinkLoad(location, editorRoute);
  const focus = useFakeFocus(initial, options);
  const [narrow, setNarrow] = useState<'focus' | 'browse'>(options.narrow ?? 'focus');
  const returnTo = noteReturnRoute(location.search, editorRoute.notebook ?? 'life', editorRoute.folder);
  const routedPath = editorRoute.note ? at(editorRoute.note) : null;
  const routedNote = routedPath && existing.has(routedPath) ? { notebookId: options.notebookId ?? 'life', path: routedPath, title: routedPath, content: '' } as never : null;
  const routeError = routedPath && !existing.has(routedPath) ? 'route.noteNotFound' : '';
  const handleOpenNote = useRef(vi.fn(async () => true)).current;
  const { trackOpen } = useOpenNoteLinkInFocus({ link, location, navigate, editorRoute, routedNote, routedPath, routeError, noteFocus: focus.noteFocus, activeNotePath: focus.activeNotePath, focusNarrowView: narrow, selectedNotebookId: 'life', notebookRoot: ROOT, returnTo, browsing: editorRoute.tab === 'notes', setFocusNarrowView: setNarrow, isTemplate: note => note.path.includes('/.templates/') });
  const { openFromBrowse } = useFocusNoteNavigation({ noteFocus: focus.noteFocus, selectedNotebookId: 'life', setFocusNarrowView: setNarrow, handleOpenNote: handleOpenNote as never, setAddingToFocus: vi.fn(), isTemplate: note => note.path.includes('/.templates/'), trackOpen });
  api.current = {
    url: location.pathname + location.search + location.hash,
    zoomed: Boolean(routedNote) && !routeError && !link.inFocus,
    focus,
    navigate,
    browse: path => openFromBrowse({ notebookId: 'life', path, title: path } as never),
    setNarrow,
    narrow,
    handleOpenNote,
  };
  return null;
}

const empty = (): FocusState => ({ panes: { p1: [] }, activePane: 'p1', shown: { p1: null } });
const showing = (panes: Panes, activePane = Object.keys(panes)[0]!, shown?: Record<string, string>): FocusState => ({ panes, activePane, shown: shown ?? Object.fromEntries(Object.entries(panes).map(([pane, tabs]) => [pane, tabs.at(-1) ?? null])) });

function open(entries: (string | { pathname: string; search?: string; hash?: string; state?: unknown; })[], focus: FocusState = empty(), options: Parameters<typeof Page>[0]['options'] = {}) {
  const api = { current: undefined as unknown as Harness };
  const view = render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Page api={api} focus={focus} options={options} />
    </MemoryRouter>,
  );
  return { api, view };
}
const back = (api: { current: Harness; }) => act(() => void api.current.navigate(-1));
/** The person clicks the tab of `path` in `pane`. */
const show = (api: { current: Harness; }, pane: string, path: string) => (api.current.focus.noteFocus as { show: (pane: string, key: string) => Promise<void>; }).show(pane, `note:${path}`);

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
  it('waits for the Focus to load before opening', async () => {
    const { api, view } = open(['/notebooks/life/notes/a.md'], empty(), { loading: true });
    expect(api.current.focus.openNote).not.toHaveBeenCalled();
    expect(api.current.zoomed).toBe(false);
    view.rerender(
      <MemoryRouter initialEntries={['/notebooks/life/notes/a.md']}>
        <Page api={api} focus={empty()} options={{}} />
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
  it('leaves a template file’s link in zoom: a template never opens in a Focus pane', async () => {
    const { api } = open(['/notebooks/life/notes/.templates/reading.md']);
    await waitFor(() => expect(api.current.zoomed).toBe(true));
    expect(api.current.focus.openNote).not.toHaveBeenCalled();
    expect(api.current.url).toBe('/notebooks/life/notes/.templates/reading.md');
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
