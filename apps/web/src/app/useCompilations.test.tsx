// @vitest-environment jsdom
import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { CompilationViewProps } from '../components/CompilationView.js';
import { useCompilations } from './useCompilations.js';

const views = vi.fn<(props: CompilationViewProps) => void>();
vi.mock('../components/CompilationView.js', () => ({
  CompilationView: (props: CompilationViewProps) => {
    views(props);
    return null;
  },
}));
vi.mock('./useCompilationActionsValue.js', () => ({ useCompilationActionsValue: () => ({}) }));

const note = (notebookId: string, path: string) => ({ id: path, path, notebookId, title: path, tags: [], metadata: {} }) as NoteListItem;
const openInFocus = vi.fn<(note: NoteListItem, pane?: string, placement?: string) => Promise<boolean>>();
const handleOpenNote = vi.fn();
const boardPanel = { focusNotebook: 'thesis', openInFocus: vi.fn(), fullscreen: vi.fn() };
const compilations = () => renderHook(() => useCompilations({ config: { notebooks: [{ id: 'thesis', title: 'Thesis', root: 'notes/thesis' }] }, folders: [], selectedNotebookId: 'thesis', openInFocus, handleOpenNote, boardPanel, t: (key: string) => key } as never)).result.current;
const shown = (path: string, pane?: string) => {
  render(compilations().renderCompilation(path, pane));
  return views.mock.lastCall![0];
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens a card of a board in a Focus pane in another pane, beside it, and a card the Focus cannot take in zoom', async () => {
  const props = shown('notes/thesis/chapter.compilation.yml', 'pane-1');
  expect(props.frame).toBe('pane');
  // A Focus pane has no side panel: its cards open in the Focus.
  expect(props.sidePanel).toBeUndefined();
  openInFocus.mockResolvedValueOnce(true);
  const own = note('thesis', 'notes/thesis/a.md');
  props.onOpenNote(own);
  await waitFor(() => expect(openInFocus).toHaveBeenCalledWith(own, 'pane-1', 'beside'));
  expect(handleOpenNote).not.toHaveBeenCalled();
  // A note of another notebook has no place in this notebook's Focus, so it opens in zoom.
  openInFocus.mockResolvedValueOnce(false);
  const other = note('reading', 'notes/reading/b.md');
  props.onOpenNote(other);
  await waitFor(() => expect(handleOpenNote).toHaveBeenCalledWith(other, undefined));
});

it('gives a compilation in zoom the side panel its note cards open in', () => {
  const props = shown('notes/thesis/chapter.compilation.yml');
  expect(props.frame).toBe('zoom');
  expect(props.sidePanel).toBe(boardPanel);
});
