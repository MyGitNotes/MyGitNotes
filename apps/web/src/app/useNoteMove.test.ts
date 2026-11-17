// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteItem } from '../lib/types.js';
import type { WorkingNote } from '../lib/working-notes.js';
import { useNoteMove } from './useNoteMove.js';

const files = vi.hoisted(() => ({ mutateFile: vi.fn() }));
vi.mock('../lib/files-api.js', () => files);
const lookup = vi.hoisted(() => ({ notes: [] as NoteItem[] }));
const api = vi.hoisted(() => ({ readNote: vi.fn() }));
vi.mock('../lib/api.js', () => api);
const live = vi.hoisted(() => ({ retargetLive: vi.fn() }));
vi.mock('../lib/live-api.js', () => live);
vi.mock('../lib/use-note-queries.js', () => ({ noteLookupOptions: () => ({ queryKey: ['lookup'], queryFn: async () => ({ notes: lookup.notes }) }) }));

const note: NoteItem = { id: 'idea', path: 'notes/idea.md', notebookId: 'nb', title: 'Idea', tags: [], metadata: {}, content: '# Idea' };
const config = { notebooks: [{ id: 'nb', root: 'notes' }] } as never;

function setup({ draft, focusTabs = [] as string[], remote = true, retargets }: { draft?: WorkingNote; focusTabs?: string[]; remote?: boolean; retargets?: boolean; }) {
  const order: string[] = [];
  const drafts = new Map<string, WorkingNote>(draft ? [[draft.note.path, draft]] : []);
  const focus = { page: { version: 2, focuses: [{ id: 'f', notebookId: 'nb', name: 'Focus', root: { kind: 'pane', id: 'p1', tabs: focusTabs.map(path => ({ kind: 'note', path })) } }] }, change: vi.fn() };
  const params = {
    config,
    remote,
    canWriteNotebook: () => true,
    readDraft: (_: string, path: string) => drafts.get(path),
    updateDraft: vi.fn((_: string, path: string, entry: WorkingNote | null) => {
      if (entry) drafts.set(path, entry);
      else drafts.delete(path);
    }),
    stageWorkingNote: vi.fn((staged: NoteItem, base: NoteItem | null) => {
      drafts.set(staged.path, { note: staged, base });
      return staged;
    }),
    saveNote: vi.fn(async (input: { path: string; }) => {
      order.push(`save ${input.path}`);
      return note;
    }),
    focus: focus as never,
    queryClient: new QueryClient(),
    queryScope: {} as never,
    flushEditors: vi.fn(async () => true),
    beforeFileChange: vi.fn(async (_scope?: unknown) => {}),
    setNotebookRevision: vi.fn((notebookId: string, revision: string) => {
      order.push(`revision ${notebookId} ${revision}`);
    }),
    forgetDrafts: vi.fn(),
    relocateCurrentFocus: vi.fn(),
    onFilesChanged: vi.fn(async (_result: unknown, _options?: unknown) => {
      order.push('files changed');
    }),
    setActionError: vi.fn(),
    t: ((key: string) => key) as never,
    ...(retargets === undefined ? {} : { retargets: () => retargets }),
  };
  const hook = renderHook(() => useNoteMove(params));
  const move = async (folder: string | null) => {
    act(() => hook.result.current.moveNote(note)?.());
    await act(() => hook.result.current.confirmMove(folder));
  };
  const rename = async (title: string, target: NoteItem = note, applyTitle?: (title: string) => void) => {
    act(() => hook.result.current.renameNote(target, applyTitle)?.());
    await act(() => hook.result.current.confirmRename(title));
  };
  const renameTo = (title: string, target: NoteItem = note) => act(() => hook.result.current.renameNoteTo(target, title));
  return { params, drafts, focus, move, rename, renameTo, order, hook };
}

beforeEach(() => {
  vi.clearAllMocks();
  lookup.notes = [];
});

describe('useNoteMove', () => {
  it('re-keys a never-committed remote draft, with its Focus tab, instead of moving a file', async () => {
    const { params, drafts, focus, move } = setup({ draft: { note, base: null }, focusTabs: ['notes/idea.md', 'notes/other.md'] });
    await move('work');
    expect(params.setActionError).toHaveBeenLastCalledWith('');
    expect([...drafts.keys()]).toEqual(['notes/work/idea.md']);
    expect(drafts.get('notes/work/idea.md')).toMatchObject({ base: null, note: { path: 'notes/work/idea.md', content: '# Idea' } });
    expect(focus.change).toHaveBeenCalledOnce();
    expect(focus.change.mock.calls[0][0].focuses[0].root.tabs.map((tab: { path: string; }) => tab.path)).toEqual(['notes/work/idea.md', 'notes/other.md']);
    expect(params.onFilesChanged).toHaveBeenCalledWith(expect.objectContaining({ pathMap: { 'notes/idea.md': 'notes/work/idea.md' } }), { background: true });
    expect(files.mutateFile).not.toHaveBeenCalled();
    expect(params.beforeFileChange).not.toHaveBeenCalled();
  });

  // lm-visual3 P3: the dialog's heading read the title typed in the editor, not the note's own.
  it('opens the Rename dialog on the note as it is named, with a title already typed kept apart', () => {
    const { hook } = setup({});
    act(() => hook.result.current.renameNote(note, undefined, 'Plan')?.());
    expect(hook.result.current.request).toMatchObject({ mode: 'rename', note: { title: note.title }, name: 'Plan' });
    act(() => hook.result.current.cancel());
    act(() => hook.result.current.renameNote(note)?.());
    expect(hook.result.current.request).not.toHaveProperty('name');
  });

  it('refuses to re-key a draft onto a note that already exists there', async () => {
    lookup.notes = [{ ...note, path: 'notes/work/idea.md' }];
    const { params, drafts, move } = setup({ draft: { note, base: null } });
    await move('work');
    expect(params.setActionError).toHaveBeenLastCalledWith('files.moveTaken');
    expect([...drafts.keys()]).toEqual(['notes/idea.md']);
    expect(params.onFilesChanged).not.toHaveBeenCalled();
  });

  it('moves a committed note as a file after saving the open editors', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/work/idea.md' }, deletedPaths: [] });
    const { params, move } = setup({});
    await move('work');
    expect(params.flushEditors).toHaveBeenCalled();
    expect(params.beforeFileChange).toHaveBeenCalled();
    expect(files.mutateFile).toHaveBeenCalledWith({ kind: 'move', notebookId: 'nb', path: 'notes/idea.md', destination: 'notes/work/idea.md' });
    expect(params.onFilesChanged).toHaveBeenCalledWith(expect.objectContaining({ revision: 'r2' }), { background: true });
  });

  it('carries the remote draft of a committed note to where the file moved, base included', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/work/idea.md' }, deletedPaths: [] });
    const { params, drafts, move } = setup({ draft: { note: { ...note, content: '# Idea\n\nEdited.' }, base: note } });
    await move('work');
    expect(params.beforeFileChange).toHaveBeenCalledWith({ notebookId: 'nb', paths: ['notes/idea.md', 'notes/work/idea.md'], carried: ['notes/idea.md'] });
    expect([...drafts.keys()]).toEqual(['notes/work/idea.md']);
    expect(drafts.get('notes/work/idea.md')).toMatchObject({ note: { path: 'notes/work/idea.md', content: '# Idea\n\nEdited.' }, base: { path: 'notes/work/idea.md', content: '# Idea' } });
    expect(params.setActionError).toHaveBeenLastCalledWith('');
  });

  it('moves the draft the editor staged while the move ran, not the one read before it', async () => {
    const { drafts, move } = setup({ draft: { note: { ...note, content: 'first' }, base: note } });
    files.mutateFile.mockImplementation(async () => {
      drafts.set('notes/idea.md', { note: { ...note, content: 'typed during the move' }, base: note });
      return { revision: 'r2', selectedPath: '', pathMap: {}, deletedPaths: [] };
    });
    await move('work');
    expect(drafts.get('notes/work/idea.md')?.note.content).toBe('typed during the move');
  });

  it('keeps the draft where it was when the move is refused', async () => {
    const { params, drafts, move } = setup({ draft: { note: { ...note, content: 'Edited.' }, base: note } });
    params.beforeFileChange.mockRejectedValueOnce(new Error('files.draftsBlock'));
    await move('work');
    expect(params.setActionError).toHaveBeenLastCalledWith('files.draftsBlock');
    expect([...drafts.keys()]).toEqual(['notes/idea.md']);
    expect(files.mutateFile).not.toHaveBeenCalled();
  });

  it('moves a note dropped on a folder without opening the dialog', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: {}, deletedPaths: [] });
    const { params, hook } = setup({});
    await act(() => hook.result.current.moveTo({ notebookId: 'nb', path: 'notes/work/idea.md', title: '' }, null));
    expect(files.mutateFile).toHaveBeenCalledWith({ kind: 'move', notebookId: 'nb', path: 'notes/work/idea.md', destination: 'notes/idea.md' });
    expect(params.onFilesChanged).toHaveBeenCalledWith(expect.objectContaining({ revision: 'r2' }), { background: true });
    expect(hook.result.current.request).toBeNull();
  });

  it('renames a never-committed draft: a new file name and the heading that titles it', async () => {
    const { params, drafts, rename } = setup({ draft: { note: { ...note, path: 'notes/untitled.md', content: '# Untitled\n\nBody.\n' }, base: null } });
    await rename('讀書 計畫', { ...note, path: 'notes/untitled.md' });
    expect([...drafts.keys()]).toEqual(['notes/讀書-計畫.md']);
    expect(drafts.get('notes/讀書-計畫.md')?.note).toMatchObject({ content: '# 讀書 計畫\n\nBody.\n', title: '讀書 計畫' });
    expect(params.onFilesChanged).toHaveBeenCalledWith(expect.objectContaining({ pathMap: { 'notes/untitled.md': 'notes/讀書-計畫.md' } }), { background: true });
    expect(params.saveNote).not.toHaveBeenCalled();
  });

  it.each([true, false])('renames a file with the new title in the move itself and saves nothing after it (remote: %s)', async remote => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/plans.md' }, deletedPaths: [] });
    const { params, rename } = setup({ remote });
    await rename('Plans');
    expect(files.mutateFile).toHaveBeenCalledOnce();
    expect(files.mutateFile).toHaveBeenCalledWith({ kind: 'move', notebookId: 'nb', path: 'notes/idea.md', destination: 'notes/plans.md', title: 'Plans' });
    expect(params.saveNote).not.toHaveBeenCalled();
    expect(api.readNote).not.toHaveBeenCalled();
    expect(params.onFilesChanged).toHaveBeenCalledWith(expect.objectContaining({ pathMap: { 'notes/idea.md': 'notes/plans.md' } }), { background: true });
  });

  it('asks the server only: no revision read and no destination lookup before a move', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: {}, deletedPaths: [] });
    const lookupSpy = vi.spyOn(QueryClient.prototype, 'fetchQuery');
    const { rename } = setup({});
    await rename('Plans');
    expect(lookupSpy).not.toHaveBeenCalled();
    lookupSpy.mockRestore();
  });

  it('shows the dialog message when the server refuses a taken destination, and leaves no trace of the move', async () => {
    files.mutateFile.mockRejectedValue(new Error('Destination already exists.'));
    const { params, rename } = setup({ remote: false });
    await rename('Plans');
    expect(params.setActionError).toHaveBeenLastCalledWith('files.moveTaken');
    expect(params.onFilesChanged).not.toHaveBeenCalled();
    expect(params.forgetDrafts).not.toHaveBeenCalled();
  });

  it('moves the staged draft of a renamed committed note with its new title, so the editor opens on it', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/plans.md' }, deletedPaths: [] });
    const { drafts, rename } = setup({ draft: { note: { ...note, content: '# Idea\n\nEdited.', metadata: { title: 'Idea' } }, base: { ...note, metadata: { title: 'Idea' } } } });
    await rename('Plans');
    expect([...drafts.keys()]).toEqual(['notes/plans.md']);
    expect(drafts.get('notes/plans.md')).toMatchObject({ note: { path: 'notes/plans.md', title: 'Plans', content: '# Plans\n\nEdited.', metadata: { title: 'Plans' } }, base: { path: 'notes/plans.md' } });
  });

  it('forgets the unsaved copies at the old path and lets the current Focus follow the note once, with the files changed (review4 F002)', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/plans.md' }, deletedPaths: [] });
    const { params, rename } = setup({});
    await rename('Plans');
    expect(params.forgetDrafts).toHaveBeenCalledWith('nb', 'notes/idea.md', 'notes/plans.md');
    // The answer's pathMap relocates the Focus tabs where the files changed; nothing relocates them a second time.
    expect(params.onFilesChanged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pathMap: { 'notes/idea.md': 'notes/plans.md' } }), { background: true });
    expect(params.relocateCurrentFocus).not.toHaveBeenCalled();
  });

  it('takes the revision the move committed before the workspace is read again, in a hosted workspace', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/plans.md' }, deletedPaths: [] });
    const { params, rename, order } = setup({ remote: true });
    await rename('Plans');
    expect(params.setNotebookRevision).toHaveBeenCalledExactlyOnceWith('nb', 'r2');
    expect(order).toEqual(['revision nb r2', 'files changed']);
  });

  it('does not take a revision for a local move, nor for a move that failed', async () => {
    files.mutateFile.mockResolvedValueOnce({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/plans.md' }, deletedPaths: [] });
    const local = setup({ remote: false });
    await local.rename('Plans');
    files.mutateFile.mockRejectedValueOnce(new Error('offline'));
    const failed = setup({ remote: true });
    await failed.rename('Plans');
    expect(local.params.setNotebookRevision).not.toHaveBeenCalled();
    expect(failed.params.setNotebookRevision).not.toHaveBeenCalled();
  });

  it('saves a title that keeps the file name where the note lies, before the workspace is read again', async () => {
    api.readNote.mockResolvedValue({ ...note, metadata: { status: 'inbox' } });
    const { params, rename, order } = setup({ remote: false });
    await rename('Idea!');
    expect(files.mutateFile).not.toHaveBeenCalled();
    expect(params.saveNote).toHaveBeenCalledWith({ path: 'notes/idea.md', notebookId: 'nb', content: '# Idea!', metadata: { status: 'inbox' } });
    expect(order).toEqual(['save notes/idea.md', 'files changed']);
  });

  it('retitles a note whose file name has capitals where it lies, when the new name differs only in case, and keeps it selected', async () => {
    const upper = { ...note, path: 'notes/Ideas.md', title: 'Ideas', content: '# Ideas' };
    api.readNote.mockResolvedValue(upper);
    const { params, rename, order } = setup({ remote: false });
    await rename('Ideas!', upper);
    expect(files.mutateFile).not.toHaveBeenCalled();
    expect(params.saveNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/Ideas.md', content: '# Ideas!' }));
    expect(params.onFilesChanged).toHaveBeenLastCalledWith(expect.objectContaining({ selectedPath: 'notes/Ideas.md', pathMap: {} }), { background: true });
    expect(order).toEqual(['save notes/Ideas.md', 'files changed']);
  });

  it('lets a compilation apply its own new name, and only moves its file', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: {}, deletedPaths: [] });
    const applyTitle = vi.fn();
    const compilation = { ...note, path: 'notes/untitled.compilation.yml', title: 'Untitled compilation' };
    const { params, rename } = setup({ remote: false });
    await rename('Reading list', compilation, applyTitle);
    expect(applyTitle).toHaveBeenCalledWith('Reading list');
    expect(files.mutateFile).toHaveBeenCalledWith(expect.objectContaining({ destination: 'notes/reading-list.compilation.yml' }));
    expect(files.mutateFile.mock.calls[0][0]).not.toHaveProperty('title');
    expect(params.saveNote).not.toHaveBeenCalled();
  });

  it('refuses a name with nothing to name a file after', async () => {
    const { params, rename } = setup({});
    await rename('!!!');
    expect(params.setActionError).toHaveBeenLastCalledWith('files.renameInvalid');
    expect(params.flushEditors).not.toHaveBeenCalled();
  });

  it('renames at once from a typed title, without the dialog: file name and title together', async () => {
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/plans.md' }, deletedPaths: [] });
    const { params, renameTo, hook } = setup({ remote: false });
    await renameTo(' Plans ');
    expect(hook.result.current.request).toBeNull();
    expect(files.mutateFile).toHaveBeenCalledWith({ kind: 'move', notebookId: 'nb', path: 'notes/idea.md', destination: 'notes/plans.md', title: 'Plans' });
    expect(params.saveNote).not.toHaveBeenCalled();
  });

  it('refuses a typed title with nothing to name a file after, and a notebook it cannot write', async () => {
    const { params, renameTo, hook } = setup({});
    await renameTo('!!!');
    expect(params.setActionError).toHaveBeenLastCalledWith('files.renameInvalid');
    expect(params.flushEditors).not.toHaveBeenCalled();
    params.canWriteNotebook = () => false;
    hook.rerender();
    await renameTo('Plans');
    expect(params.flushEditors).not.toHaveBeenCalled();
  });

  describe('a pending live note (未歸檔)', () => {
    const pending: NoteItem = { ...note, path: 'notes/.live/live-1.md', title: 'Draft', live: { since: '2026-11-15T00:00:00.000Z', activeEditors: 0, pending: true, editorUrl: 'http://localhost/x', pathRule: 'inbox/{{title}}.md' } };
    const checkedOut: NoteItem = { ...note, live: { since: '2026-11-15T00:00:00.000Z', activeEditors: 0, editorUrl: 'http://localhost/x' } };

    it('sets where its check-in files it on a move, without moving a file', async () => {
      live.retargetLive.mockResolvedValue({ checkout: {}, destination: { folder: 'work', name: '{{title}}.md' } });
      const { params, hook } = setup({ retargets: true });
      act(() => hook.result.current.moveNote(pending)?.());
      expect(hook.result.current.request).toMatchObject({ mode: 'move', note: pending });
      await act(() => hook.result.current.confirmMove('work'));
      expect(live.retargetLive).toHaveBeenCalledWith('nb', 'notes/.live/live-1.md', { folder: 'work' });
      await act(() => hook.result.current.moveTo(pending, null));
      expect(live.retargetLive).toHaveBeenLastCalledWith('nb', 'notes/.live/live-1.md', { folder: '' });
      expect(files.mutateFile).not.toHaveBeenCalled();
      expect(params.onFilesChanged).toHaveBeenCalled();
      expect(params.setActionError).toHaveBeenLastCalledWith('');
    });

    it('fixes the file name on a rename and leaves the title', async () => {
      live.retargetLive.mockResolvedValue({ checkout: {}, destination: { folder: 'inbox', name: 'Plans.md' } });
      const applyTitle = vi.fn();
      const { rename, renameTo } = setup({ retargets: true });
      await rename(' Plans ', pending, applyTitle);
      expect(live.retargetLive).toHaveBeenCalledWith('nb', 'notes/.live/live-1.md', { name: 'Plans' });
      expect(applyTitle).not.toHaveBeenCalled();
      await renameTo('Later', pending);
      expect(live.retargetLive).toHaveBeenLastCalledWith('nb', 'notes/.live/live-1.md', { name: 'Later' });
      expect(files.mutateFile).not.toHaveBeenCalled();
    });

    it('stays unmovable where the adapter cannot retarget, and a checked-out note always does', () => {
      const without = setup({ retargets: false });
      expect(without.hook.result.current.moveNote(pending)).toBeUndefined();
      expect(without.hook.result.current.renameNote(pending)).toBeUndefined();
      const able = setup({ retargets: true });
      expect(able.hook.result.current.moveNote(checkedOut)).toBeUndefined();
    });

    it('shows the refusal of a retarget', async () => {
      live.retargetLive.mockRejectedValue(new Error('The note is being checked in. Try again in a moment.'));
      const { params, hook } = setup({ retargets: true });
      act(() => hook.result.current.moveNote(pending)?.());
      await act(() => hook.result.current.confirmMove('work'));
      expect(params.setActionError).toHaveBeenLastCalledWith('The note is being checked in. Try again in a moment.');
    });
  });
});
