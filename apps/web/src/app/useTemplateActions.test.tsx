// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { useTemplateActions } from './useTemplateActions.js';
import type { NoteTemplateInfo } from '../lib/note-templates.js';
import type { NoteItem } from '../lib/types.js';
import type { WorkingNote } from '../lib/working-notes.js';

const api = vi.hoisted(() => ({ saveNote: vi.fn(), fetchGitStatus: vi.fn() }));
vi.mock('../lib/api.js', () => api);
type Params = Parameters<typeof useTemplateActions>[0];

function setup(overrides: Partial<Params> = {}, existing: string[] = []) {
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, 'fetchQuery').mockImplementation(async options => ({ notes: existing.filter(path => JSON.stringify((options as { queryKey: unknown; }).queryKey).includes(path)).map(path => ({ path })) }) as never);
  const drafts = new Map<string, WorkingNote>();
  const params = {
    config: { notebooks: [{ id: 'qa~ex', root: 'notes/ex', title: 'Example' }] },
    remote: false,
    canWriteNotebook: () => true,
    readDraft: (_: string, path: string) => drafts.get(path),
    updateDraft: vi.fn((_: string, path: string, entry: WorkingNote | null) => void (entry ? drafts.set(path, entry) : drafts.delete(path))),
    stageWorkingNote: vi.fn((note: NoteItem, base: NoteItem | null) => {
      drafts.set(note.path, { note, base });
      return note;
    }),
    revisionFor: () => 'head',
    queryClient,
    queryScope: { sourceId: 's', revisions: {}, repositories: { 'qa~ex': 's' }, drafts: {} },
    invalidateNotes: vi.fn(),
    setGitStatus: vi.fn(),
    openInZoom: vi.fn(async () => true),
    deleteNote: vi.fn(async () => {}),
    relocateFile: vi.fn(async () => {}),
    t: (key: string, values?: Record<string, string>) => values ? `${key}:${Object.values(values).join(',')}` : key,
    ...overrides,
  } as unknown as Params;
  return { params, drafts, actions: renderHook(() => useTemplateActions(params)).result.current };
}
const reading: NoteTemplateInfo = { notebookId: 'qa~ex', id: 'reading', name: 'Reading', source: 'file', file: 'notes/ex/.templates/reading.md', placeholders: [] };
const registered: NoteTemplateInfo = { notebookId: 'qa~ex', id: 'registered', name: 'Registered', source: 'manifest', file: 'notes/ex/kept/registered.md', placeholders: [] };

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchGitStatus.mockResolvedValue({ status: {} });
  api.saveNote.mockImplementation(async input => ({ note: { ...input, id: input.path, title: 'x', tags: [] } }));
});

it('creates a template file with a starter template block in the worktree and opens it in zoom', async () => {
  const { params, actions } = setup();
  await actions.createTemplate('qa~ex', ' Book review ');
  expect(api.saveNote).toHaveBeenCalledExactlyOnceWith({ path: 'notes/ex/.templates/Book review.md', notebookId: 'qa~ex', createOnly: true, noCommit: true, content: '# {{title}}\n', metadata: { template: { name: 'Book review', description: '' } } });
  expect(params.invalidateNotes).toHaveBeenCalled();
  expect(params.openInZoom).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: 'notes/ex/.templates/Book review.md' }));
});

it('creates a template as a working change of the page in a remote workspace', async () => {
  const { params, actions } = setup({ remote: true });
  await actions.createTemplate('qa~ex', 'Meeting');
  expect(api.saveNote).not.toHaveBeenCalled();
  expect(params.stageWorkingNote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: 'notes/ex/.templates/Meeting.md', notebookId: 'qa~ex', content: '# {{title}}\n', metadata: { template: { name: 'Meeting', description: '' } }, revision: 'head' }), null);
  expect(params.openInZoom).toHaveBeenCalledOnce();
});

it('saves a note as a template named after it, without the note file’s own keys, and refuses an existing file or working change', async () => {
  const note = { notebookId: 'qa~ex', title: 'Weekly review', metadata: { id: 'weekly', created: 'c', updated: 'u', tags: ['review'] }, content: '# Weekly review\n\n- wins\n' };
  const { params, actions } = setup();
  await actions.saveAsTemplate(note);
  expect(api.saveNote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: 'notes/ex/.templates/Weekly review.md', createOnly: true, content: '# Weekly review\n\n- wins\n', metadata: { template: { name: 'Weekly review' }, tags: ['review'] } }));
  expect(params.openInZoom).toHaveBeenCalledOnce();

  const taken = setup({}, ['notes/ex/.templates/Weekly review.md']);
  await expect(taken.actions.saveAsTemplate(note)).rejects.toThrow('templates.exists:Weekly review');
  expect(api.saveNote).toHaveBeenCalledOnce();
  expect(taken.params.openInZoom).not.toHaveBeenCalled();

  const drafted = setup({ remote: true });
  drafted.drafts.set('notes/ex/.templates/Weekly review.md', { note: {} as NoteItem, base: null });
  await expect(drafted.actions.saveAsTemplate(note)).rejects.toThrow('templates.exists:Weekly review');
  expect(drafted.params.stageWorkingNote).not.toHaveBeenCalled();
});

it('opens a template’s file in zoom to edit it', async () => {
  const { params, actions } = setup();
  await actions.editTemplate(registered);
  expect(params.openInZoom).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ notebookId: 'qa~ex', path: 'notes/ex/kept/registered.md' }));
});

it('renames a .templates file as it is, refusing a taken name and a manifest template', async () => {
  const { params, actions } = setup({}, ['notes/ex/.templates/meeting.md']);
  await actions.renameTemplate(reading, 'books');
  expect(params.relocateFile).toHaveBeenCalledExactlyOnceWith({ notebookId: 'qa~ex', path: 'notes/ex/.templates/reading.md', title: 'Reading' }, 'notes/ex/.templates/books.md');
  await actions.renameTemplate(reading, 'reading');
  await expect(actions.renameTemplate(reading, 'meeting')).rejects.toThrow('templates.exists:meeting');
  await expect(actions.renameTemplate(registered, 'other')).rejects.toThrow('templates.manifestHint');
  expect(params.relocateFile).toHaveBeenCalledOnce();
});

it('deletes a template as a note is deleted, drops one that is only a working change, and never a manifest template', async () => {
  const local = setup();
  await local.actions.deleteTemplate(reading);
  expect(local.params.deleteNote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ notebookId: 'qa~ex', path: 'notes/ex/.templates/reading.md' }));
  await expect(local.actions.deleteTemplate(registered)).rejects.toThrow('templates.manifestHint');

  const remote = setup({ remote: true });
  remote.drafts.set(reading.file, { note: {} as NoteItem, base: null });
  await remote.actions.deleteTemplate(reading);
  expect(remote.params.updateDraft).toHaveBeenCalledExactlyOnceWith('qa~ex', reading.file, null);
  expect(remote.params.deleteNote).not.toHaveBeenCalled();
});

it('refuses every change in a read-only notebook', async () => {
  const { params, actions } = setup({ canWriteNotebook: () => false });
  await expect(actions.createTemplate('qa~ex', 'x')).rejects.toThrow('outline.readOnly');
  await expect(actions.renameTemplate(reading, 'x')).rejects.toThrow('outline.readOnly');
  await expect(actions.deleteTemplate(reading)).rejects.toThrow('outline.readOnly');
  expect(api.saveNote).not.toHaveBeenCalled();
  expect(params.relocateFile).not.toHaveBeenCalled();
  expect(params.deleteNote).not.toHaveBeenCalled();
});
