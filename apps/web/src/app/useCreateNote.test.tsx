// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCreateNote } from './useCreateNote.js';
import type { NoteItem } from '../lib/types.js';
const api = vi.hoisted(() => ({ saveNote: vi.fn(), fetchGitStatus: vi.fn(), renderNoteTemplate: vi.fn() }));
vi.mock('../lib/api.js', () => api);
type Params = Parameters<typeof useCreateNote>[0];
function params(overrides: Partial<Params> = {}): Params {
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, 'fetchQuery').mockResolvedValue({ notes: [] });
  return { config: { notebooks: [{ id: 'a', root: 'notes/shared', title: 'A', templates: [{ id: 'template', title: 'Template', file: 'template.md' }] }, { id: 'b', root: 'notes/b', title: 'B' }] }, selectedNotebookId: 'a', setSelectedNotebookId: vi.fn(), folders: [{ notebookId: 'a', path: 'sub', title: 'Sub', order: 0 }], browsedFolder: null, remote: false, canWrite: true, readDraft: () => undefined, queryClient, queryScope: { sourceId: 'local:a', revisions: {}, repositories: { a: 'local:a' }, drafts: {} }, stageWorkingNote: vi.fn(note => note), revisionFor: () => 'head', invalidateNotes: vi.fn(), setGitStatus: vi.fn(), newNoteStatuses: ['inbox'], sourceId: 'local:a', t: (key: string) => ({ 'createNote.untitled': 'Untitled', 'createNote.body': 'Write your note here.' } as Record<string, string>)[key] ?? key, onCreated: vi.fn(), onError: vi.fn(), ...overrides } as Params;
}
const lookupReturns = (input: Params, paths: string[]) => vi.mocked(input.queryClient.fetchQuery).mockResolvedValue({ notes: paths.map(path => ({ path })) });
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchGitStatus.mockResolvedValue({ status: {} });
  api.saveNote.mockImplementation(async input => ({ note: { ...input, id: 'new', title: 'Untitled', tags: [] } }));
  api.renderNoteTemplate.mockResolvedValue({ content: '# Untitled\n\nFrom template.\n', metadata: { title: 'Untitled', kind: 'reading' } });
});
afterEach(cleanup);

it('creates a note at once at the notebook root, titled by its heading', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote());
  expect(api.saveNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/shared/untitled.md', content: '# Untitled\n\nWrite your note here.\n', createOnly: true, noCommit: true }));
  // No title field: the heading names the note, so editing it renames the note.
  expect(api.saveNote.mock.calls[0][0].metadata).toEqual({ id: 'untitled', tags: [], status: 'inbox' });
  expect(input.onCreated).toHaveBeenCalledOnce();
});

it('numbers the untitled name past existing notes and remote drafts', async () => {
  const input = params({ remote: true, readDraft: (_: string, path: string) => path === 'notes/shared/untitled-2.md' ? { note: {} as NoteItem, base: null } : undefined });
  lookupReturns(input, ['notes/shared/untitled.md']);
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote());
  expect(input.stageWorkingNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/shared/untitled-3.md', id: 'untitled-3' }), null);
  expect(api.saveNote).not.toHaveBeenCalled();
});

it('creates native outlines with the compound suffix and no template', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ kind: 'outline', templateId: 'template' }));
  expect(api.saveNote.mock.calls[0][0]).toMatchObject({ path: 'notes/shared/untitled.outline.md', content: '- ', metadata: { title: 'Untitled', status: 'inbox' } });
  expect(api.renderNoteTemplate).not.toHaveBeenCalled();
});

it('creates a note from a template, and in the folder a compilation lane draws from', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ templateId: 'template', folder: 'sub', tag: 'reading' }));
  // The reader's own date and time fill {{date}} and {{time}}.
  expect(api.renderNoteTemplate).toHaveBeenCalledWith({ notebookId: 'a', templateId: 'template', title: 'Untitled', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), time: expect.stringMatching(/^\d{2}:\d{2}$/) });
  // The note records the template it came from, which dates the template's last use.
  expect(api.saveNote.mock.calls[0][0]).toMatchObject({ path: 'notes/shared/sub/untitled.md', content: '# Untitled\n\nFrom template.\n', metadata: { kind: 'reading', tags: ['reading'], template: 'template' } });
});

it('creates a note in the folder the Notes page is browsing, unless the caller names one', async () => {
  const input = params({ browsedFolder: 'sub' });
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote());
  expect(api.saveNote.mock.calls[0][0]).toMatchObject({ path: 'notes/shared/sub/untitled.md' });
  await act(() => hook.result.current.createNote({ folder: '' }));
  expect(api.saveNote.mock.calls[1][0]).toMatchObject({ path: 'notes/shared/untitled.md' });
});

it('stages a linked remote outline with native metadata and no save API', async () => {
  const input = params({ remote: true });
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ kind: 'outline', initialLink: { notebookId: 'a', path: 'notes/shared/source.compilation.yml', title: 'Source' } }));
  expect(input.stageWorkingNote).toHaveBeenCalledWith(expect.objectContaining({ kind: 'outline', path: 'notes/shared/untitled.outline.md', content: '- [Source](source.compilation.yml)' }), null);
  expect(api.saveNote).not.toHaveBeenCalled();
});

it('switches to another notebook first, then creates there', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ kind: 'outline', notebookId: 'b' }));
  expect(input.setSelectedNotebookId).toHaveBeenCalledWith('b');
  expect(api.saveNote).not.toHaveBeenCalled();
  await act(async () => {
    hook.rerender({ ...input, selectedNotebookId: 'b', queryScope: { ...input.queryScope, repositories: { b: 'local:a' } } });
  });
  await vi.waitFor(() => expect(api.saveNote).toHaveBeenCalledWith(expect.objectContaining({ notebookId: 'b', path: 'notes/b/untitled.outline.md' })));
});

it.each(['repository', 'read-only'] as const)('does not create after a %s change during the name lookup', async reason => {
  const input = params();
  let finish!: (value: { notes: NoteItem[]; }) => void;
  vi.mocked(input.queryClient.fetchQuery).mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const hook = renderHook(useCreateNote, { initialProps: input });
  let operation!: Promise<void>;
  act(() => {
    operation = hook.result.current.createNote();
  });
  if (reason === 'repository') hook.rerender({ ...input, sourceId: 'local:b', selectedNotebookId: 'b' });
  if (reason === 'read-only') hook.rerender({ ...input, canWrite: false });
  await act(async () => {
    finish({ notes: [] });
    await operation;
  });
  expect(api.saveNote).not.toHaveBeenCalled();
  expect(input.stageWorkingNote).not.toHaveBeenCalled();
});

it('refuses a cross-notebook initial link without creating anything', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ kind: 'outline', initialLink: { notebookId: 'b', path: 'notes/b/same.md', title: 'Wrong owner' } }));
  expect(input.onError).toHaveBeenLastCalledWith('outline.changed');
  expect(api.saveNote).not.toHaveBeenCalled();
});

it('creates a slide note from the built-in Slides template, without asking the workspace', async () => {
  const input = params({ t: ((key: string, values?: Record<string, string>) => key === 'createNote.untitled' ? 'Untitled' : key === 'template.slides.body' ? `# ${values?.title}\n\n---\n` : key) as Params['t'] });
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ templateId: 'builtin:slides' }));
  expect(api.renderNoteTemplate).not.toHaveBeenCalled();
  expect(api.saveNote.mock.calls[0][0]).toMatchObject({ path: 'notes/shared/untitled.md', content: '# Untitled\n\n---\n' });
  // The heading names the note, as for a blank note; the blog needs both slideOptions to read it by its headings. A built-in
  // template is the app's own text, no template of the notebook, so the note carries no template id.
  expect(api.saveNote.mock.calls[0][0].metadata).toEqual({ id: 'untitled', type: 'slide', slideOptions: { engine: 'contour', structure: 'headings' }, tags: [], status: 'inbox' });
});

it('keeps the template’s own tags and status unless the caller chose them', async () => {
  api.renderNoteTemplate.mockResolvedValue({ content: '# Untitled\n\n> {{takeaway}}\n', metadata: { title: 'Untitled', tags: ['reading'], status: 'unread', author: '{{author}}' }, unfilled: ['takeaway', 'author'] });
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ templateId: 'reading' }));
  // Every placeholder but title, date and time stays as written, for the writer to replace.
  expect(api.saveNote.mock.calls[0][0]).toMatchObject({ path: 'notes/shared/untitled.md', content: '# Untitled\n\n> {{takeaway}}\n', metadata: { tags: ['reading'], status: 'unread', author: '{{author}}' } });
  await act(() => hook.result.current.createNote({ templateId: 'reading', tag: 'mine', status: 'done' }));
  expect(api.saveNote.mock.calls[1][0].metadata).toMatchObject({ tags: ['mine'], status: 'done' });
});

it('fills a template that is still a working change of this page here, without asking the workspace', async () => {
  const draft = { note: { id: 't', path: 'notes/shared/.templates/reading.md', notebookId: 'a', title: '{{title}}', tags: [], metadata: { template: { name: 'Reading', placeholders: { book: 'The book', author: { default: 'Unknown' } } }, kind: 'reading', author: '{{author}}', created: '2026-01-01T00:00:00.000Z' }, content: '# {{title}}\n\n{{date}} {{time}} {{book}}\n' } as NoteItem, base: null };
  const input = params({ remote: true, templates: [{ notebookId: 'a', id: 'reading', name: 'Reading', source: 'file', file: 'notes/shared/.templates/reading.md', placeholders: [] }], readDraft: (_: string, path: string) => path === 'notes/shared/.templates/reading.md' ? draft : undefined });
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ templateId: 'reading' }));
  expect(api.renderNoteTemplate).not.toHaveBeenCalled();
  const staged = vi.mocked(input.stageWorkingNote).mock.calls[0][0];
  expect(staged.path).toBe('notes/shared/untitled.md');
  expect(staged.content).toMatch(/^# Untitled\n\n\d{4}-\d{2}-\d{2} \d{2}:\d{2} \{\{book\}\}\n$/);
  // The template block and the template file's own timestamps stay behind; a declared default is not applied here. In the
  // note `template` is the id of the template it came from.
  expect(staged.metadata).toEqual({ id: 'untitled', kind: 'reading', author: '{{author}}', title: 'Untitled', template: 'reading', tags: [], status: 'inbox' });
});

/* Collab-first (docs/specs/2026-11-16-collab-first-self-host A3.2): offline, a note of a live repository is a browser draft, handed to the live editor once online. */
it('makes a new note of a live repository a browser draft while offline, instead of asking the live editor', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const fetchMock = vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const input = params({ remote: true, live: { askLivePathValues: vi.fn(), open: vi.fn() } });
    const hook = renderHook(useCreateNote, { initialProps: input });
    await act(() => hook.result.current.createNote());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input.stageWorkingNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/shared/untitled.md' }), null);
    expect(input.onCreated).toHaveBeenCalledOnce();
    expect(input.onError).not.toHaveBeenCalledWith(expect.stringMatching(/./));
  } finally {
    online.mockRestore();
    vi.unstubAllGlobals();
  }
});
