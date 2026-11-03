// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseWorkspaceRoute } from '../lib/routes.js';
import { useNoteLinkLoad, useOpenNoteLinkInFocus } from './useNoteLinkFocus.js';

const at = (url: string) => {
  const parsed = new URL(url, 'https://workspace.invalid');
  return { location: { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash, key: 'default', state: null } as never, route: parseWorkspaceRoute(parsed.pathname, parsed.search) };
};
const note = { notebookId: 'life', path: 'notes/life/a.md', title: 'A', content: '' } as never;

function setup(url: string, { result = 'opened', notebookId = 'life', focusLoading = false, routeError = '' } = {}) {
  const openNote = vi.fn(async () => result), navigate = vi.fn(), setFocusNarrowView = vi.fn();
  const initial = at(url);
  const view = renderHook(({ current, loading, error }) => {
    const link = useNoteLinkLoad(current.location, current.route);
    useOpenNoteLinkInFocus({ link, location: current.location, navigate, routedNote: error ? null : note, routeError: error, noteFocus: { loading, shown: 'current', layout: {}, openNote } as never, selectedNotebookId: notebookId, returnTo: '/notebooks/life', setFocusNarrowView });
    return link.pending;
  }, { initialProps: { current: initial, loading: focusLoading, error: routeError } });
  return { view, openNote, navigate, setFocusNarrowView };
}

describe('a note link loaded as the page', () => {
  it('opens the note as a tab of the active Focus and shows that Focus', async () => {
    const { view, openNote, navigate, setFocusNarrowView } = setup('/notebooks/life/notes/a.md#Part');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/life#Part', { replace: true }));
    expect(openNote).toHaveBeenCalledWith('notes/life/a.md');
    expect(setFocusNarrowView).toHaveBeenCalledWith('focus');
    expect(view.result.current).toBe(false);
  });
  it('waits for the Focus to load before opening', async () => {
    const { view, openNote, navigate } = setup('/notebooks/life/notes/a.md', { focusLoading: true });
    expect(view.result.current).toBe(true);
    expect(openNote).not.toHaveBeenCalled();
    view.rerender({ current: at('/notebooks/life/notes/a.md'), loading: false, error: '' });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });
  it('survives the redirect of a bare notebook id to its key, which is not found until then', async () => {
    const { view, navigate } = setup('/notebooks/a/notes/a.md', { routeError: 'route.notebookNotFound' });
    expect(view.result.current).toBe(true);
    view.rerender({ current: at('/notebooks/life/notes/a.md'), loading: false, error: '' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/life', { replace: true }));
  });
  it('is dropped when the reader leaves the note before it opened', () => {
    const { view, openNote } = setup('/notebooks/life/notes/a.md', { focusLoading: true });
    view.rerender({ current: at('/notebooks/life'), loading: true, error: '' });
    view.rerender({ current: at('/notebooks/life/notes/a.md'), loading: false, error: '' });
    expect(view.result.current).toBe(false);
    expect(openNote).not.toHaveBeenCalled();
  });
  it('stays in zoom when the Focus cannot take the note or it belongs to another notebook', async () => {
    const full = setup('/notebooks/life/notes/a.md', { result: 'full' });
    await waitFor(() => expect(full.openNote).toHaveBeenCalled());
    expect(full.navigate).not.toHaveBeenCalled();
    expect(full.view.result.current).toBe(false);
    const other = setup('/notebooks/life/notes/a.md', { notebookId: 'work' });
    expect(other.openNote).not.toHaveBeenCalled();
    expect(other.view.result.current).toBe(false);
  });
  it('keeps the not-found page of a missing note', () => {
    const { view, openNote } = setup('/notebooks/life/notes/a.md', { routeError: 'route.noteNotFound' });
    expect(openNote).not.toHaveBeenCalled();
    expect(view.result.current).toBe(false);
  });
});

describe('a zoom URL', () => {
  it('stays zoom, since the app navigated there itself and gave it a returnTo', () => {
    const { view, openNote } = setup('/notebooks/life/notes/a.md?returnTo=%2Fnotebooks%2Flife');
    expect(view.result.current).toBe(false);
    expect(openNote).not.toHaveBeenCalled();
  });
});
