// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteEditorToolbar } from './NoteEditorToolbar.js';

afterEach(cleanup);

const note = { id: 'a', path: 'notes/untitled.md', notebookId: 'a', title: 'Untitled', tags: [], metadata: {}, content: '# Untitled' };
const session = { title: 'Untitled', locked: false, isSaving: false, hasUnsavedChanges: false, content: note.content, copyState: 'idle', copyNote: vi.fn(), close: vi.fn() };
const toolbar = (onRename?: () => void, extra: Record<string, unknown> = {}) => createElement(NoteEditorToolbar, { frame: 'zoom', note, session: session as never, docPanel: { notePanel: null, lastNotePanel: { current: 'find' } } as never, isMarkdown: false, autoSave: true, readOnly: false, editorMode: 'live', setEditorMode: vi.fn(), showLineNumbers: false, toggleLineNumbers: vi.fn(), showFormatToolbar: false, onClose: vi.fn(), onRename, ...extra });

it('renames from the title in zoom, with no Rename button among the controls', () => {
  const onRename = vi.fn();
  render(toolbar(onRename));
  fireEvent.click(screen.getByRole('button', { name: 'Untitled' }));
  expect(onRename).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
});

it('shows the title as plain text when the note cannot be renamed', () => {
  render(toolbar());
  expect(screen.getByText('Untitled').tagName).toBe('DIV');
});

it('shows the title in the sans face with the path muted below it', () => {
  render(toolbar());
  const title = screen.getByText('Untitled');
  expect(title).not.toHaveClass('font-serif');
  expect(screen.getByText('notes/untitled.md')).toHaveClass('text-muted');
  render(toolbar(vi.fn()));
  expect(screen.getAllByRole('button', { name: 'Untitled' }).at(-1)).not.toHaveClass('font-serif');
});

it('puts Refresh first in the controls as a ghost icon button with a tooltip, not a labelled button by the title', async () => {
  const onRefresh = vi.fn(async () => {});
  const { container } = render(toolbar(undefined, { onRefresh }));
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  expect(refresh).toHaveClass('ui-icon-button');
  expect(refresh).toHaveAttribute('title', expect.stringContaining('latest version'));
  expect(refresh.textContent).toBe('');
  expect(container.querySelector('.note-controls')!.firstElementChild).toBe(refresh);
  expect(container.querySelector('.note-heading')).not.toContainElement(refresh);
  fireEvent.click(refresh);
  expect(onRefresh).toHaveBeenCalledOnce();
});

it('groups the controls as view, adding, file and panels, the mode button beside line numbers for a Markdown note', () => {
  const groups = (isMarkdown: boolean, extra: Record<string, unknown> = {}) => {
    const { container } = render(toolbar(undefined, { isMarkdown, toggleFormatToolbar: vi.fn(), onMove: vi.fn(), ...extra }));
    const names = [...container.querySelectorAll('.note-controls-group')].map(group => group.getAttribute('aria-label'));
    const members = [...container.querySelectorAll('.note-controls-group')].map(group => [...group.querySelectorAll('button')].map(button => button.getAttribute('aria-label')));
    cleanup();
    return { names, members };
  };
  const adding = { onAddToFocus: vi.fn(), onAddToOutline: vi.fn() };
  expect(groups(true, adding).names).toEqual(['View', 'Add to', 'File', 'Panels']);
  const { members } = groups(true, adding);
  expect(members[0]).toEqual(['Switch to source', 'Line Numbers']);
  expect(members[1]).toEqual(['Add to outline', 'Add to Focus']);
  expect(members[2][0]).toBe('Move note');
  expect(members[3]).toEqual(['Formatting toolbar', 'Document tools']);
  // A note that is not Markdown has no modes; a note with nothing to add to has no adding group.
  expect(groups(false, adding).members[0]).toEqual(['Line Numbers']);
  expect(groups(true).names).toEqual(['View', 'File', 'Panels']);
});

it('switches the mode with one icon button that shows the mode in use and names the other, with the leader key for the same switch', () => {
  const setEditorMode = vi.fn();
  const { rerender } = render(toolbar(undefined, { isMarkdown: true, setEditorMode }));
  const toSource = screen.getByRole('button', { name: 'Switch to source' });
  expect(toSource).toHaveAttribute('data-mode-toggle', 'live');
  expect(toSource.textContent).toBe('');
  expect(toSource).toHaveAttribute('title', expect.stringMatching(/^Switch to source \(.+ M\)$/));
  expect(screen.queryByText('Live Preview')).toBeNull();
  fireEvent.click(toSource);
  expect(setEditorMode).toHaveBeenCalledWith('raw');
  rerender(toolbar(undefined, { isMarkdown: true, setEditorMode, editorMode: 'raw' }));
  fireEvent.click(screen.getByRole('button', { name: 'Switch to live preview' }));
  expect(setEditorMode).toHaveBeenLastCalledWith('live');
  // A Focus pane answers the leader too.
  rerender(toolbar(undefined, { isMarkdown: true, setEditorMode, frame: 'pane' }));
  expect(screen.getByRole('button', { name: 'Switch to source' })).toHaveAttribute('title', expect.stringMatching(/^Switch to source \(.+ M\)$/));
});
