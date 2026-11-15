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
import { moveAsset, responseError, restoreNote } from '../../lib/api.js';
import { mutateFile } from '../../lib/files-api.js';
import { LiveNewNoteDialog } from './LiveNewNoteDialog.js';
import { forgetCheckedIn } from '../../lib/live-api.js';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { LiveDraftsProvider } from './live-drafts.js';

// The built-in editor's socket: a provider that never connects, so a test sees the tab ask for its ticket and wait.
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    destroy() {}
  },
}));
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
  // A check-in a test left unread would say 「已簽回」 in the next test's editor of the same note.
  forgetCheckedIn(noteRefKey(note));
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
    render(createElement(BulkActionsToolbar, { count: 2, statuses: ['inbox'], availableTags: [], busy: false, readOnly: false, canMove: true, liveNotes: ['Alpha'], onSetStatus: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(), onMove: vi.fn(), onClear: vi.fn() }));
    expect(screen.getByText('Being edited live; check it in first: Alpha')).toBeInTheDocument();
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

describe('a live note on a phone', () => {
  it('keeps the live bar out from under the note header, so 立即簽回 and the save state stay reachable', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    fetchMock.mockResolvedValue(json({ checkout: view, outcome: 'created' }));
    const { container } = render(noteEditor({ live: { editor, onRefetch: vi.fn() } }));
    expect(container.querySelector('.note-editor')).toHaveAttribute('data-phone-bar', 'overlay');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    expect(document.querySelector('iframe')).not.toBeNull();
    expect(container.querySelector('.note-editor')).toHaveAttribute('data-phone-bar', 'flow');
    expect(screen.getByRole('button', { name: 'Check in now' })).toBeInTheDocument();
  });
});

describe('the phone sheet of a pending note being edited live', () => {
  it('says no word count or 唯讀 of the read view under it, and offers Rename', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    fetchMock.mockResolvedValue(json({ checkout: { ...view, path: 'notes/life/.live/abc.md', pending: true }, outcome: 'created' }));
    const pendingNote = { ...note, path: 'notes/life/.live/abc.md', live: { since: view.since, activeEditors: 1, pending: true as const, editorUrl: view.editorUrl } };
    const onRename = vi.fn();
    render(createElement(LiveDraftsProvider, { value: { discards: () => true, retargets: () => true } }, noteEditor({ note: pendingNote, live: { editor, onRefetch: vi.fn() }, onMove: vi.fn(), onRename })));
    await act(async () => {});
    expect(document.querySelector('iframe')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('status', { name: 'Save status' })).toBeNull();
    expect(screen.queryByText(/Read-only/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledWith(note.title);
  });
});

describe('a note checked in from its frame', () => {
  it('still says 已簽回 once the editor remounts for the new revision', async () => {
    const onCheckedIn = vi.fn();
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/checkout' ? json({ checkout: view, outcome: 'created' }) : json({ id: 'abc', path: note.path, committed: true, commit: 'c'.repeat(40), released: true, revision: 'c'.repeat(40) }));
    const live = { editor, onRefetch: vi.fn(), onCheckedIn };
    const first = render(noteEditor({ live }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'live-status', users: 1, saved: true, connected: true, released: false }, origin: editor.origin, source: document.querySelector('iframe')!.contentWindow }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check in now' }));
    });
    expect(onCheckedIn).toHaveBeenCalledWith(expect.objectContaining({ released: true }));
    // The workspace refresh replaces the editor (the routed note reloads at the new revision).
    first.unmount();
    render(noteEditor({ live }));
    expect(screen.getByText('Checked in')).toBeInTheDocument();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
  });
});

describe('a check-in that committed while others are still editing', () => {
  it('says so in the read view, past the remount the new revision brings, and leaves the lists to the workspace refresh', async () => {
    const onCheckedIn = vi.fn();
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/checkout' ? json({ checkout: view, outcome: 'created' }) : json({ id: 'abc', path: note.path, committed: true, commit: 'c'.repeat(40), released: false, reason: 'active', activeEditors: 1, revision: 'c'.repeat(40) }));
    const live = { editor, onRefetch: vi.fn(), onCheckedIn };
    const first = render(noteEditor({ live }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'live-status', users: 2, saved: true, connected: true, released: false }, origin: editor.origin, source: document.querySelector('iframe')!.contentWindow }));
    });
    live.onRefetch.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check in now' }));
    });
    expect(onCheckedIn).toHaveBeenCalledWith(expect.objectContaining({ committed: true, released: false }));
    // The head moved: the lists read at the old revision would be refused, so the app's workspace refresh reads them.
    expect(live.onRefetch).not.toHaveBeenCalled();
    first.unmount();
    render(noteEditor({ live }));
    expect(screen.getByText('Saved to Git; 1 person is still editing, so it will be checked in again tonight.')).toBeInTheDocument();
    expect(screen.queryByText('Checked in')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});

describe('a read-only note deleted elsewhere, without a live editor', () => {
  it('still says it was moved or deleted', async () => {
    const onReadRemote = vi.fn(async () => {
      throw await responseError(json({ error: 'Note not found.' }, 404), 'Failed');
    });
    await act(async () => {
      render(noteEditor({ frame: 'pane', onClose: undefined, readOnly: true, draftMode: true, onReadRemote, onMarkConflict: vi.fn() }));
    });
    expect(onReadRemote).toHaveBeenCalled();
    expect(screen.getByText(/moved or deleted remotely/)).toBeInTheDocument();
  });
});

describe('the live New dialog', () => {
  it('puts the first focus in its first field, not on ✕', () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) {
      this.setAttribute('open', '');
      this.querySelector('button')?.focus();
    });
    HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    try {
      render(createElement(LiveNewNoteDialog, { template: 'Meeting', prompts: [{ name: 'kind', default: 'Other', description: 'Meeting kind' }, { name: 'room', default: 'A' }], onConfirm: vi.fn(), onCancel: vi.fn() }));
      expect(screen.getByRole('textbox', { name: 'Meeting kind' })).toHaveFocus();
    } finally {
      cleanup();
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
  });
});

describe('file operations refused for a checked-out note', () => {
  const refusal = () => json({ error: 'Checked out to the live editor (編輯中): notes/life/a.md. Read the note again, or check it in with check_in_note first.', code: 'checked-out', paths: ['notes/life/a.md'] }, 409);
  it('read as 編輯中 in the file manager, asset moves and restore', async () => {
    document.documentElement.lang = 'zh-TW';
    fetchMock.mockImplementation(async () => refusal());
    await expect(mutateFile({ type: 'delete', path: 'notes/life/a.md' } as never)).rejects.toMatchObject({ status: 409, code: 'checked-out', message: '編輯中，請先簽回：notes/life/a.md' });
    await expect(moveAsset({ path: 'notes/life/a.png', directory: 'notes/life/img' })).rejects.toMatchObject({ status: 409, message: '編輯中，請先簽回：notes/life/a.md' });
    await expect(restoreNote({ path: 'notes/life/a.md', notebookId: 'notes~life' })).rejects.toMatchObject({ status: 409, message: '編輯中，請先簽回：notes/life/a.md' });
  });
});

describe('every way into a check-in ends on the read view', () => {
  const checkedInNote = { ...note, content: '# Alpha\n\nChecked-in text.\n' };
  const statusMessage = (released = false, users = 1) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'live-status', users, saved: true, connected: true, released }, origin: editor.origin, source: document.querySelector('iframe')!.contentWindow }));
  const answers = (answer: Record<string, unknown>) => fetchMock.mockImplementation(async (url: string) => url === '/api/live/checkout' ? json({ checkout: view, outcome: 'created' }) : json({ id: 'abc', path: note.path, committed: true, commit: 'd'.repeat(40), released: true, revision: 'd'.repeat(40), ...answer }));
  const checkIn = async () => {
    act(() => statusMessage());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check in now' }));
    });
  };
  /** No frame, the checked-in text read again, 編輯 offered, and 「已簽回」 as a success notice. */
  const expectReadView = () => {
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check in now' })).toBeNull();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Note content')).toHaveValue(checkedInNote.content);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    const notice = screen.getByText('Checked in').closest('.editor-notice');
    expect(notice).toHaveClass('editor-notice-success');
  };

  it('in zoom, without the editor remounting', async () => {
    answers({});
    const onRefetch = vi.fn();
    const onReadRemote = vi.fn(async () => checkedInNote);
    const onCheckedIn = vi.fn();
    render(noteEditor({ live: { editor, onRefetch, onCheckedIn }, onReadRemote }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    onRefetch.mockClear();
    await checkIn();
    expectReadView();
    // The head moved: the app hears of it at once and reads the lists after its workspace refresh, not at the next 60 s one.
    expect(onCheckedIn).toHaveBeenCalled();
    expect(onRefetch).not.toHaveBeenCalled();
  });

  it('from a pane whose 編輯 opened zoom', async () => {
    answers({});
    const onReadRemote = vi.fn(async () => checkedInNote);
    const live = { editor, onRefetch: vi.fn(), onCheckedIn: vi.fn(), openZoom: vi.fn() };
    const view = render(noteEditor({ frame: 'pane', onClose: undefined, live, onReadRemote }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(live.openZoom).toHaveBeenCalled();
    // The pane lends its editor to zoom: the same editor, now framed as zoom, checks the note out on arrival.
    await act(async () => {
      view.rerender(noteEditor({ frame: 'zoom', live, onReadRemote }));
    });
    expect(document.querySelector('iframe')).not.toBeNull();
    await checkIn();
    expectReadView();
  });

  it('on a phone, with the header badge gone once the note is checked in', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    answers({});
    const onReadRemote = vi.fn(async () => checkedInNote);
    const liveNote = { ...note, live: { since: view.since, activeEditors: 1, editorUrl: view.editorUrl } };
    render(noteEditor({ note: liveNote, live: { editor, onRefetch: vi.fn(), onCheckedIn: vi.fn() }, onReadRemote }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    await checkIn();
    expectReadView();
    expect(screen.queryByText('Editing · 1')).toBeNull();
  });

  it('after a check-in that changed nothing', async () => {
    answers({ committed: false, commit: undefined, revision: 'c'.repeat(40) });
    const onRefetch = vi.fn();
    const onReadRemote = vi.fn(async () => checkedInNote);
    render(noteEditor({ live: { editor, onRefetch, onCheckedIn: vi.fn() }, onReadRemote }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    onRefetch.mockClear();
    await checkIn();
    expectReadView();
    expect(onRefetch).toHaveBeenCalled();
  });

  it('when someone else checked the note in', async () => {
    fetchMock.mockResolvedValue(json({ checkout: view, outcome: 'created' }));
    const onRefetch = vi.fn();
    const onReadRemote = vi.fn(async () => checkedInNote);
    const onCheckedIn = vi.fn();
    render(noteEditor({ live: { editor, onRefetch, onCheckedIn }, onReadRemote }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    onRefetch.mockClear();
    await act(async () => {
      statusMessage(true);
    });
    expectReadView();
    expect(onCheckedIn).toHaveBeenCalled();
  });
});

describe('the phone header while the live editor is framed', () => {
  it('leaves the editor count to the live bar, so only one count shows', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    fetchMock.mockResolvedValue(json({ checkout: view, outcome: 'created' }));
    const liveNote = { ...note, live: { since: view.since, activeEditors: 1, editorUrl: view.editorUrl } };
    render(noteEditor({ note: liveNote, live: { editor, onRefetch: vi.fn() } }));
    expect(screen.getByText('Editing · 1')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'live-status', users: 2, saved: true, connected: true, released: false }, origin: editor.origin, source: document.querySelector('iframe')!.contentWindow }));
    });
    expect(screen.getByText('2 editing')).toBeInTheDocument();
    expect(screen.queryByText('Editing · 1')).toBeNull();
  });
});

describe('the live New dialog field with a default', () => {
  it('selects the default when it takes the focus, so typing replaces it', () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    try {
      render(createElement(LiveNewNoteDialog, { template: 'Meeting', prompts: [{ name: 'kind', default: 'Other', description: 'Meeting kind' }], onConfirm: vi.fn(), onCancel: vi.fn() }));
      const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Meeting kind' });
      expect(field).toHaveFocus();
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Other'.length]);
    } finally {
      cleanup();
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
  });
});

describe('the built-in live editor', () => {
  const builtin = { kind: 'builtin' as const };
  it('opens in the app, asking for a socket ticket instead of framing a page', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/checkout' ? json({ checkout: { ...view, editorUrl: 'http://localhost/notebooks/notes~life/a.md', embedUrl: undefined }, outcome: 'created' }) : json({ ticket: 't'.repeat(32), document: 'abc.1' }));
    render(noteEditor({ live: { editor: builtin, onRefetch: vi.fn() } }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/live/socket-ticket', expect.objectContaining({ method: 'POST', body: JSON.stringify({ notebookId: 'notes~life', path: 'notes/life/a.md' }) }));
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Live editor' })).toBeInTheDocument();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open in a new tab' })).toBeNull();
  });
});

describe('捨棄草稿 in the framed editor', () => {
  const pendingNote = { ...note, path: 'notes/life/.live/abc.md', live: { since: view.since, activeEditors: 1, pending: true as const, editorUrl: view.editorUrl } };
  const pendingView = { ...view, path: 'notes/life/.live/abc.md', pending: true };
  it('is offered only where the adapter can discard, closes the frame first, and leaves for the notebook', async () => {
    const order: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      order.push(`${url} frame=${document.querySelector('iframe') ? 'shown' : 'gone'}`);
      return url === '/api/live/checkout' ? json({ checkout: pendingView, outcome: 'joined' }) : json({ discarded: true });
    });
    const first = render(noteEditor({ note: pendingNote, live: { editor, onRefetch: vi.fn() } }));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
    first.unmount();
    const onDiscarded = vi.fn();
    render(noteEditor({ note: pendingNote, live: { editor: { ...editor, discard: true }, onRefetch: vi.fn(), onDiscarded } }));
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
    expect(order.at(-1)).toBe('/api/live/discard frame=gone');
    expect(onDiscarded).toHaveBeenCalled();
  });

  it('says an empty draft was discarded when 立即簽回 found it empty', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/checkout' ? json({ checkout: pendingView, outcome: 'joined' }) : json({ id: 'abc', path: null, committed: false, released: true, discarded: true, reason: 'empty', revision: 'c'.repeat(40) }));
    const onDiscarded = vi.fn();
    render(noteEditor({ note: pendingNote, live: { editor, onRefetch: vi.fn(), onDiscarded } }));
    await act(async () => {});
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'live-status', users: 1, saved: true, connected: true, released: false }, origin: editor.origin, source: document.querySelector('iframe')!.contentWindow }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check in now' }));
    });
    expect(screen.getByText('The draft was empty and was discarded.')).toBeInTheDocument();
    expect(screen.queryByText('Checked in')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDiscarded).toHaveBeenCalled();
  });
});

describe('a pending note in the lists, where the adapter can discard and retarget', () => {
  const filing = { ...listed('notes/life/.live/xyz.md', { since: view.since, activeEditors: 0, pending: true, editorUrl: view.editorUrl, pathRule: 'projects/{{title}}.md' }), title: 'Untitled' };
  const drafts = { discards: () => true, retargets: () => true };
  const inDrafts = (element: ReturnType<typeof createElement>) => createElement(LiveDraftsProvider, { value: drafts }, element);

  it('says where it files, and lets it be deleted (discarded) and moved', () => {
    const onDeleteNote = vi.fn(), onMoveNote = vi.fn();
    render(inDrafts(createElement(ListView, { ...listProps, onDeleteNote, onMoveNote, notes: [filing, checkedOut] })));
    const row = (item: NoteListItem) => screen.getByText(item.title).closest('tr')!;
    expect(within(row(filing)).getByText('Not filed').closest('.live-badge')).toHaveAttribute('title', 'Files to: projects/Untitled.md (the name follows the title)');
    const remove = within(row(filing)).getByRole('button', { name: 'Delete note' });
    expect(remove).toBeEnabled();
    expect(remove).toHaveAttribute('title', 'Discard draft');
    fireEvent.click(remove);
    expect(onDeleteNote).toHaveBeenCalledWith(filing);
    fireEvent.click(within(row(filing)).getByRole('button', { name: 'Move note' }));
    expect(onMoveNote).toHaveBeenCalledWith(filing);
    // Its status is still the live editor's, and a checked-out note stays locked.
    expect(within(row(filing)).getByRole('combobox')).toBeDisabled();
    expect(within(row(checkedOut)).getByRole('button', { name: 'Delete note' })).toBeDisabled();
    expect(within(row(checkedOut)).getByRole('button', { name: 'Move note' })).toBeDisabled();
  });

  it('keeps delete and move locked where the adapter can do neither', () => {
    render(createElement(LiveDraftsProvider, { value: { discards: () => false, retargets: () => false } }, createElement(ListView, { ...listProps, notes: [filing] })));
    const row = screen.getByText(filing.title).closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Delete note' })).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Move note' })).toBeDisabled();
  });

  it('unlocks the same entries on cards', () => {
    const onDeleteNote = vi.fn();
    render(inDrafts(createElement(CardView, { ...listProps, onDeleteNote, notes: [filing] })));
    const card = screen.getByText(filing.title).closest('.note-card')! as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Delete note' })).toBeEnabled();
    expect(within(card).getByRole('button', { name: 'Move note' })).toBeEnabled();
  });
});
