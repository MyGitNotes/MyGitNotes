// @vitest-environment jsdom
import { createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { PanelProvider } from '../../lib/panel-context.js';
import type { NoteItem } from '../../lib/types.js';
import { NoteEditor, type NoteEditorProps } from '../NoteEditor.js';
import { ListView } from '../ListView.js';
import { CardView } from '../CardView.js';
import { BulkActionsToolbar } from '../BulkActionsToolbar.js';
import { responseError } from '../../lib/api.js';

vi.mock('../MarkdownEditor.js', () => ({ MarkdownEditor: forwardRef<unknown, { content: string; readOnly: boolean; }>(({ content, readOnly }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, onChange: () => {} })) }));

const editor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const note: NoteItem = { id: 'a', path: 'notes/life/a.md', notebookId: 'notes~life', title: 'Alpha', tags: [], metadata: { title: 'Alpha', status: 'inbox' }, content: '# Alpha\n' };
const view = { id: 'abc', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'https://live.example.test/abc', embedUrl: 'https://live.example.test/embed/abc', since: '2026-11-15T01:00:00.000Z', activeEditors: 0, conflict: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.lang = '';
});

const noteEditor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: true, statuses: ['inbox', 'done'], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, onCommitFile: async () => {}, branch: 'main', draftScope: 'src:main', onClose: () => {}, ...props } as NoteEditorProps));

describe('a note of a repository with a live editor', () => {
  it('opens read-only with Edit, its status locked', () => {
    render(noteEditor({ live: { editor, onRefetch: vi.fn() } }));
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeDisabled();
  });

  it('checks the note out on Edit and frames the editor', async () => {
    const onRefetch = vi.fn();
    fetchMock.mockResolvedValue(json({ checkout: view, outcome: 'created' }));
    render(noteEditor({ live: { editor, onRefetch } }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/live/checkout', expect.objectContaining({ method: 'POST', body: JSON.stringify({ notebookId: 'notes~life', path: 'notes/life/a.md' }) }));
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('https://live.example.test/embed/abc?theme=light');
    expect(screen.queryByLabelText('Note content')).toBeNull();
    expect(onRefetch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
  });

  it('keeps the direct editor for a note the live editor refuses as too large', async () => {
    fetchMock.mockResolvedValue(json({ error: 'Too large.', code: 'too-large' }, 413));
    render(noteEditor({ live: { editor, onRefetch: vi.fn() } }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByLabelText('Note content')).not.toHaveAttribute('readonly');
    expect(screen.getByRole('status')).toHaveTextContent('too large for the live editor');
  });

  it('opens zoom from a Focus pane instead of framing the editor there', () => {
    const openZoom = vi.fn();
    render(noteEditor({ frame: 'pane', onClose: undefined, live: { editor, onRefetch: vi.fn(), openZoom } }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(openZoom).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens a pending note straight in its frame', async () => {
    fetchMock.mockResolvedValue(json({ checkout: { ...view, path: 'notes/life/.live/abc.md', pending: true }, outcome: 'joined' }));
    await act(async () => {
      render(noteEditor({ note: { ...note, path: 'notes/life/.live/abc.md', live: { since: view.since, activeEditors: 1, pending: true, editorUrl: view.editorUrl } }, live: { editor, onRefetch: vi.fn() } }));
    });
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('shows a conflict banner while the live note overwrote a Git change', () => {
    render(noteEditor({ note: { ...note, live: { since: view.since, activeEditors: 0, editorUrl: view.editorUrl, conflict: { kind: 'overwrote', overwritten: 'f'.repeat(40), commit: 'e'.repeat(40), at: view.since } } }, live: { editor, onRefetch: vi.fn() } }));
    expect(screen.getAllByRole('status').some(element => element.textContent?.includes(`The last check-in overwrote ${'f'.repeat(7)}`))).toBe(true);
  });
});

const listed = (path: string, live?: NoteListItem['live']): NoteListItem => ({ id: path, path, notebookId: 'notes~life', title: `Title ${path}`, tags: [], metadata: {}, status: 'inbox', ...(live ? { live } : {}) });
const checkedOut = listed('notes/life/a.md', { since: view.since, activeEditors: 2, editorUrl: view.editorUrl });
const quiet = listed('notes/life/b.md', { since: view.since, activeEditors: 0, editorUrl: view.editorUrl });
const pending = listed('notes/life/.live/xyz.md', { since: view.since, activeEditors: 1, pending: true, editorUrl: view.editorUrl });
const plain = listed('notes/life/c.md');
const listProps = { statuses: ['inbox', 'done'], onOpenNote: vi.fn(), onDeleteNote: vi.fn(), onMoveNote: vi.fn(), onUpdateNoteStatus: vi.fn(), onNewNote: vi.fn() };

describe('lists', () => {
  it('badge checked-out and pending notes, and lock their quick actions with the reason', () => {
    render(createElement(ListView, { ...listProps, notes: [checkedOut, quiet, pending, plain] }));
    const row = (note: NoteListItem) => screen.getByText(note.title).closest('tr')!;
    expect(within(row(checkedOut)).getByText('Editing · 2')).toBeInTheDocument();
    expect(within(row(quiet)).getByText('Editing')).toBeInTheDocument();
    expect(within(row(pending)).getByText('Not filed')).toBeInTheDocument();
    expect(within(row(plain)).queryByText(/Editing|Not filed/)).toBeNull();
    for (const note of [checkedOut, pending]) {
      expect(within(row(note)).getByRole('combobox')).toBeDisabled();
      expect(within(row(note)).getByRole('button', { name: 'Move note' })).toBeDisabled();
      expect(within(row(note)).getByRole('button', { name: 'Move note' })).toHaveAttribute('title', 'Being edited live; check it in first');
      expect(within(row(note)).getByRole('button', { name: 'Delete note' })).toBeDisabled();
    }
    expect(within(row(plain)).getByRole('combobox')).toBeEnabled();
    expect(row(checkedOut)).toHaveAttribute('draggable', 'false');
  });

  it('badge cards the same way', () => {
    render(createElement(CardView, { ...listProps, notes: [checkedOut, pending, plain] }));
    const card = (note: NoteListItem) => screen.getByText(note.title).closest('.note-card')! as HTMLElement;
    expect(within(card(checkedOut)).getByText('Editing · 2')).toBeInTheDocument();
    expect(within(card(pending)).getByText('Not filed')).toBeInTheDocument();
    expect(within(card(checkedOut)).getByRole('combobox')).toBeDisabled();
    expect(within(card(plain)).getByRole('combobox')).toBeEnabled();
  });

  it('lock the bulk actions while the selection holds a checked-out note', () => {
    render(createElement(BulkActionsToolbar, { count: 2, statuses: ['inbox'], availableTags: [], busy: false, readOnly: false, canMove: true, liveLocked: true, onSetStatus: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(), onMove: vi.fn(), onClear: vi.fn() }));
    expect(screen.getByText('Being edited live; check it in first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Move/ })).toBeDisabled();
  });
});

describe('a refusal of a checked-out note', () => {
  it('reads as 編輯中 with the paths it names', async () => {
    document.documentElement.lang = 'zh-TW';
    const error = await responseError(json({ error: 'notes/life/a.md is being edited live (編輯中)…', code: 'checked-out', paths: ['notes/life/a.md'] }, 409), 'Failed');
    expect(error.status).toBe(409);
    expect(error.code).toBe('checked-out');
    expect(error.paths).toEqual(['notes/life/a.md']);
    expect(error.message).toBe('編輯中，請先簽回：notes/life/a.md');
  });
});

describe('a live note that was checked in and filed elsewhere', () => {
  it('keeps no conflict draft in its read-only editor, since nothing of the reader was typed', async () => {
    const onMarkConflict = vi.fn();
    const onReadRemote = vi.fn(async () => {
      throw await responseError(json({ error: 'This live note was checked in and filed.', movedTo: 'notes/life/Kickoff.md' }, 404), 'Failed');
    });
    await act(async () => {
      render(noteEditor({ frame: 'pane', onClose: undefined, draftMode: true, onReadRemote, onMarkConflict, note: { ...note, path: 'notes/life/.live/abc.md' }, live: { editor, onRefetch: vi.fn(), openZoom: vi.fn() } }));
    });
    expect(onReadRemote).toHaveBeenCalled();
    expect(onMarkConflict).not.toHaveBeenCalled();
    expect(screen.queryByText(/moved or deleted remotely/)).toBeNull();
  });
});
