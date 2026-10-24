// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFocusNoteNavigation } from './useFocusNoteNavigation.js';

const note = (notebookId: string) => ({ notebookId, path: 'notes/a.md', title: 'A' }) as never;
const setup = (shown: string | null, result: 'opened' | 'blocked' | 'readonly') => {
  const openNote = vi.fn(async () => result), setFocusNarrowView = vi.fn();
  const { result: hook } = renderHook(() => useFocusNoteNavigation({ noteFocus: { shown, openNote } as never, selectedNotebookId: 'life', setFocusNarrowView, handleOpenNote: vi.fn() as never, setAddingToFocus: vi.fn() }));
  return { openInFocus: hook.current.openInFocus, openNote, setFocusNarrowView };
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
