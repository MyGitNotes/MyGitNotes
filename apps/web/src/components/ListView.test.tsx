// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ListView } from './ListView.js';
import { NOTE_DRAG_TYPE, NOTE_MOVE_DRAG_TYPE } from '../lib/note-drag.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';

afterEach(cleanup);

const noteOf = (path: string): NoteListItem => ({ id: path, path, notebookId: 'life', title: `Title: ${path}`, tags: [], metadata: {} });

const baseProps = { statuses: ['inbox'], onOpenNote: vi.fn(), onDeleteNote: vi.fn(), onUpdateNoteStatus: vi.fn(), onNewNote: vi.fn() };

function makeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      data[type] = value;
    },
    getData: (type: string) => data[type] || '',
    effectAllowed: '',
    _data: data,
  };
}

it('renders no zoom button and non-draggable rows without focusMode', () => {
  render(createElement(ListView, { ...baseProps, notes: [noteOf('notes/a.md')] }));
  expect(screen.queryByTitle('Open in zoom')).not.toBeInTheDocument();
  const row = screen.getByText('Title: notes/a.md').closest('tr')!;
  expect(row).toHaveAttribute('draggable', 'false');
});

it('shows a zoom button that calls onZoomNote without opening the note', () => {
  const onOpenNote = vi.fn();
  const onZoomNote = vi.fn();
  render(createElement(ListView, { ...baseProps, onOpenNote, notes: [noteOf('notes/a.md')], focusMode: { onZoomNote, canDrag: () => true } }));
  fireEvent.click(screen.getByTitle('Open in zoom'));
  expect(onZoomNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/a.md' }));
  expect(onOpenNote).not.toHaveBeenCalled();
});

it('makes a row draggable with the note-drag payload when canDrag is true', () => {
  render(createElement(ListView, { ...baseProps, notes: [noteOf('notes/a.md')], focusMode: { onZoomNote: vi.fn(), canDrag: () => true } }));
  const row = screen.getByText('Title: notes/a.md').closest('tr')!;
  expect(row).toHaveAttribute('draggable', 'true');
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(row, { dataTransfer });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('notes/a.md');
  expect(dataTransfer.getData('text/plain')).toBe('notes/a.md');
});

it('leaves a row non-draggable when canDrag returns false', () => {
  render(createElement(ListView, { ...baseProps, notes: [noteOf('notes/a.md')], focusMode: { onZoomNote: vi.fn(), canDrag: () => false } }));
  const row = screen.getByText('Title: notes/a.md').closest('tr')!;
  expect(row).toHaveAttribute('draggable', 'false');
});

it('drags a movable row onto a folder without offering it to a Focus pane', () => {
  render(createElement(ListView, { ...baseProps, onMoveNote: vi.fn(), notes: [noteOf('notes/a.md')] }));
  const row = screen.getByText('Title: notes/a.md').closest('tr')!;
  expect(row).toHaveAttribute('draggable', 'true');
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(row, { dataTransfer });
  expect(JSON.parse(dataTransfer.getData(NOTE_MOVE_DRAG_TYPE))).toEqual({ notebookId: 'life', path: 'notes/a.md' });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('');
  expect(dataTransfer.getData('text/plain')).toBe('');
});

it('carries both payloads while a Focus is shown, and none when the list is read-only', () => {
  render(createElement(ListView, { ...baseProps, onMoveNote: vi.fn(), notes: [noteOf('notes/a.md')], focusMode: { onZoomNote: vi.fn(), canDrag: () => true } }));
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(screen.getByText('Title: notes/a.md').closest('tr')!, { dataTransfer });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('notes/a.md');
  expect(dataTransfer.getData(NOTE_MOVE_DRAG_TYPE)).not.toBe('');
  cleanup();
  render(createElement(ListView, { ...baseProps, readOnly: true, onMoveNote: vi.fn(), notes: [noteOf('notes/a.md')] }));
  expect(screen.getByText('Title: notes/a.md').closest('tr')).toHaveAttribute('draggable', 'false');
});

it('leaves rows to the Move button on a touch screen, where a long press selects', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query !== '(pointer: fine)' }));
  try {
    render(createElement(ListView, { ...baseProps, onMoveNote: vi.fn(), notes: [noteOf('notes/a.md')] }));
    expect(screen.getByText('Title: notes/a.md').closest('tr')).toHaveAttribute('draggable', 'false');
  } finally {
    vi.unstubAllGlobals();
  }
});

const titled = (path: string, title: string, extra: Partial<NoteListItem> = {}): NoteListItem => ({ ...noteOf(path), title, ...extra });

it('keeps one line per note: the path is the title tooltip, not a second line', () => {
  render(createElement(ListView, { ...baseProps, notes: [titled('notes/deep/alpha.md', 'Alpha')] }));
  expect(screen.queryByText('notes/deep/alpha.md')).not.toBeInTheDocument();
  const title = screen.getByText('Alpha').closest('[title]')!;
  expect(title).toHaveAttribute('title', 'notes/deep/alpha.md');
});

it('shows the path with the match marked while a search matches it, so a row found by its path says why', () => {
  const notes = [titled('notes/deep/alpha.md', 'Alpha'), titled('notes/other.md', 'Other')];
  const { container } = render(createElement(ListView, { ...baseProps, notes, highlightQuery: 'deep' }));
  const path = container.querySelector('.note-row-path')!;
  expect(path).toHaveTextContent('notes/deep/alpha.md');
  expect(path.querySelector('mark')).toHaveTextContent('deep');
  expect(container.querySelectorAll('.note-row-path')).toHaveLength(1);
});

it('highlights a title match without adding the path when the path does not match', () => {
  const { container } = render(createElement(ListView, { ...baseProps, notes: [titled('notes/a.md', 'Alpha')], highlightQuery: 'alp' }));
  expect(container.querySelector('mark')).toHaveTextContent('Alp');
  expect(container.querySelector('.note-row-path')).toBeNull();
});

it('keeps each status a select named for its note, with a dot and the status name', () => {
  render(createElement(ListView, { ...baseProps, notes: [titled('notes/a.md', 'Alpha', { status: 'inbox' })] }));
  const status = screen.getByRole('combobox', { name: 'Status for Alpha' });
  expect(status).toHaveTextContent('inbox');
  expect(status.querySelector('.status-dot')).toBeInTheDocument();
});

it('lays the tags of a row on one line, and shows a dash for a note without tags', () => {
  const { container } = render(createElement(ListView, { ...baseProps, notes: [titled('notes/a.md', 'Alpha', { tags: ['x', 'y'] }), titled('notes/b.md', 'Beta')] }));
  expect(container.querySelectorAll('.note-tags-one-line')).toHaveLength(1);
  expect(container.querySelector('.note-tags-one-line')).toHaveTextContent('x');
  expect(screen.getByText('Beta').closest('tr')!.querySelector('.note-tags')).toBeNull();
});

it('marks the row actions so they appear on hover and keyboard focus, and stay while a delete awaits confirmation', () => {
  const { container } = render(createElement(ListView, { ...baseProps, confirmDelete: true, notes: [titled('notes/a.md', 'Alpha')] }));
  const actions = container.querySelector('.note-row-actions')!;
  expect(actions).not.toHaveAttribute('data-confirming');
  fireEvent.click(screen.getByTitle('Delete note'));
  expect(container.querySelector('.note-row-actions')).toHaveAttribute('data-confirming');
});

it('labels the column headers in sentence case', () => {
  render(createElement(ListView, { ...baseProps, notes: [noteOf('notes/a.md')], onSortChange: vi.fn() }));
  for (const name of ['Title', 'Status', 'Tags', 'Modified']) expect(screen.getByText(name).closest('th')!).not.toHaveClass('uppercase');
  expect(screen.getByText('Title').closest('thead')!).not.toHaveClass('uppercase');
});

it('starts each folder with a header row when the notes come grouped', () => {
  const groupOf = (note: NoteListItem) => ({ key: note.path.split('/')[1], label: `Folder ${note.path.split('/')[1]}` });
  const { container } = render(createElement(ListView, { ...baseProps, notes: [noteOf('notes/a/1.md'), noteOf('notes/a/2.md'), noteOf('notes/b/3.md')], groupOf }));
  expect([...container.querySelectorAll('.note-group-heading')].map(heading => heading.textContent)).toEqual(['Folder a', 'Folder b']);
});
