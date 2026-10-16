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

it('groups the controls as view, file and panels, with a mode group first for a Markdown note', () => {
  const groups = (isMarkdown: boolean) => {
    const { container } = render(toolbar(undefined, { isMarkdown, toggleFormatToolbar: vi.fn(), onMove: vi.fn(), onAddToFocus: vi.fn(), onAddToOutline: vi.fn() }));
    const names = [...container.querySelectorAll('.note-controls-group')].map(group => group.getAttribute('aria-label'));
    const members = [...container.querySelectorAll('.note-controls-group')].map(group => [...group.querySelectorAll('button')].map(button => button.getAttribute('aria-label')));
    cleanup();
    return { names, members };
  };
  expect(groups(true).names).toEqual(['Mode', 'View', 'File', 'Panels']);
  expect(groups(false).names).toEqual(['View', 'File', 'Panels']);
  const { members } = groups(false);
  expect(members[0]).toEqual(['Line Numbers', 'Add to outline', 'Add to Focus']);
  expect(members[1][0]).toBe('Move note');
  expect(members[2]).toEqual(['Formatting toolbar', 'Document tools']);
});
