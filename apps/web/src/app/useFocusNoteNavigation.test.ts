// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFocusNoteNavigation } from './useFocusNoteNavigation.js';

const note = (notebookId: string) => ({ notebookId, path: 'notes/a.md', title: 'A' }) as never;
const setup = (shown: string | null, result: 'opened' | 'blocked' | 'readonly') => {
  const openNote = vi.fn(async () => result), setFocusNarrowView = vi.fn();
  const handleOpenNote = vi.fn(async () => true);
  const { result: hook } = renderHook(() => useFocusNoteNavigation({ noteFocus: { shown, openNote } as never, selectedNotebookId: 'life', setFocusNarrowView, handleOpenNote: handleOpenNote as never, setAddingToFocus: vi.fn(), isTemplate: note => note.path.includes('/.templates/') }));
  return { openInFocus: hook.current.openInFocus, openFromBrowse: hook.current.openFromBrowse, openLink: hook.current.openLink, addToFocus: hook.current.addToFocus, openNote, setFocusNarrowView, handleOpenNote };
};

describe('openInFocus for a card clicked in a pane', () => {
  it('opens a note of this notebook beside the source pane when a Focus is shown', async () => {
    const { openInFocus, openNote, setFocusNarrowView } = setup('current', 'opened');
    expect(await openInFocus(note('life'), 'p1', 'beside')).toBe(true);
    expect(openNote).toHaveBeenCalledWith('notes/a.md', 'p1', 'beside');
    expect(setFocusNarrowView).toHaveBeenCalledWith('focus');
  });
  it('falls back to zoom with no Focus shown, for another notebook, or when the Focus cannot open it', async () => {
    expect(await setup(null, 'opened').openInFocus(note('life'), 'p1', 'beside')).toBe(false);
    expect(await setup('current', 'opened').openInFocus(note('other'), 'p1', 'beside')).toBe(false);
    expect(await setup('current', 'readonly').openInFocus(note('life'), 'p1', 'beside')).toBe(false);
  });
});

describe('a template file', () => {
  const template = { notebookId: 'life', path: 'notes/.templates/reading.md', title: 'Reading' } as never;
  it('never opens in a Focus pane: from the list, a link in a pane, or Add to Focus, it opens in zoom', async () => {
    const shown = setup('current', 'opened');
    expect(await shown.openInFocus(template, 'p1', 'beside')).toBe(false);
    await shown.openFromBrowse(template);
    const pane = document.createElement('div');
    pane.dataset.focusPane = 'p1';
    const link = pane.appendChild(document.createElement('a'));
    await shown.openLink(template, undefined, link);
    expect(shown.openNote).not.toHaveBeenCalled();
    expect(shown.handleOpenNote).toHaveBeenCalledTimes(2);
    expect(shown.addToFocus(template)).toBeUndefined();
    expect(shown.addToFocus(note('life'))).toBeTypeOf('function');
  });
});
