// @vitest-environment jsdom
import { noteRefKey } from '@mygitnotes/core/note-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchAgentResources, fetchNoteTemplates, readAgentResource } from '../lib/api.js';
import { useWebAgentTools } from './useWebAgentTools.js';
import { readWorkingNotes, updateWorkingNote, type WorkingNote, type WorkingNotes } from '../lib/working-notes.js';
import { draftScope, draftStore, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import { externalEditCount } from '../lib/external-note-edits.js';
import { saveLocalDraft } from '../lib/storage.js';
import type { NoteItem } from '../lib/types.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import type { ScopedNote, WriteScope } from '../lib/pi-agent/write-scope.js';

vi.mock('../lib/api.js', () => ({ fetchAgentResources: vi.fn(), readAgentResource: vi.fn(), fetchNoteTemplates: vi.fn(async () => []) }));

const repository: WorkspaceRepository = { id: 'github:me/notes@main', alias: 'notes', type: 'github', repository: 'me/notes', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life'], title: 'notes', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const scope = draftScope(repository);
const store = draftStore(repository);
const committed = (path: string, content: string, metadata: Record<string, unknown> = {}): NoteItem => ({ id: path, path, notebookId: 'notes~life', title: path, content, metadata, tags: [], revision: repository.revision });
const server = new Map<string, NoteItem>();
/** A cached lookup answers as it was before the note was checked out; only a fresh read sees the checkout. */
const cachedWithoutLive = (note: NoteItem | null, fresh?: boolean): NoteItem | null => note?.live && !fresh ? { ...note, live: undefined } : note;

const note = (path: string, notebookId = 'notes~life') => ({ notebookId, path });
/** The plan is open in the editor; the other notes the tests change are marked editable, so only the scope tests narrow it. */
const WIDE: WriteScope = { open: note('notes/plan.md'), allowed: ['notes/new.md', 'notes/other.md', 'notes/reading/Dune.md', 'notes/live.md', 'notes/own.md', 'notes/sync.md', 'notes/x.md', 'notes/.hidden/x.md'].map(path => note(path)) };

/** What a test changes in the page's state between the checks of one call, as another tab or the person's own typing could. */
interface Hooks {
  /** Answers the lookup of a committed note in place of the `server` notes (undefined: the server's); `count` is how many lookups were made. */
  lookup?: (path: string, count: number) => NoteItem | null | undefined;
}

/** `blog` adds a second notebook of the repository, `notes~blog`, for the tests that cross notebooks. */
function tools({ writable = true, scope = WIDE, hooks = {}, blog = false }: { writable?: boolean; scope?: WriteScope; hooks?: Hooks; blog?: boolean; } = {}) {
  const readDraft = (_notebookId: string, path: string) => readWorkingNotes(store)[path];
  const updateDraft = (_notebookId: string, path: string, entry: WorkingNote | null) => {
    updateWorkingNote(store, path, entry);
  };
  const stageWorkingNote = vi.fn((note: NoteItem, base: NoteItem | null, blocked?: string, deleted?: boolean) => {
    updateWorkingNote(store, note.path, { note, base, ...(blocked ? { blocked } : {}), ...(deleted && base ? { deleted: true as const } : {}) });
    return note;
  });
  const active = (): WorkingNotes => Object.fromEntries(Object.values(readWorkingNotes(store)).map(entry => [noteRefKey(entry.note), entry]));
  let lookups = 0;
  const findCommittedNote = async (ref: { path: string; }, options?: { fresh?: boolean; }) => {
    const answered = hooks.lookup?.(ref.path, ++lookups);
    return cachedWithoutLive(answered !== undefined ? answered : server.get(ref.path) ?? null, options?.fresh);
  };
  const { result } = renderHook(() => useWebAgentTools({ config: { workspace: { title: 'Notes' }, notebooks: [{ id: 'notes~life', title: 'Life', root: 'notes' }, ...blog ? [{ id: 'notes~blog', title: 'Blog', root: 'blog' }] : []] } as never, activeWorkingNotes: active(), repositoryFor: () => repository, canWriteNotebook: () => writable, revisionFor: () => repository.revision, readDraft, updateDraft, stageWorkingNote, findCommittedNote, resolveBareNotebook: localId => localId === 'life' ? 'notes~life' : null }));
  // The page keeps the notes a call creates, as the session does: they are in the scope of every call after it.
  const kept: ScopedNote[] = [];
  const keep = vi.fn((created: ScopedNote) => void kept.push(created));
  return { call: (tool: string, args: Record<string, unknown>) => result.current(tool, args, { open: scope.open, allowed: [...scope.allowed, ...kept] }, keep), stageWorkingNote, keep, kept };
}

beforeEach(() => {
  localStorage.clear();
  server.clear();
  server.set('notes/plan.md', committed('notes/plan.md', '# Plan\n\nship it\n', { status: 'working' }));
});

it('reads the committed note, then the working change once the agent wrote one, and never commits', async () => {
  const { call } = tools();
  expect(await call('read_note', { path: 'notes/plan.md' })).toMatchObject({ source: 'committed', content: '# Plan\n\nship it\n' });
  const before = externalEditCount(noteRefKey({ notebookId: 'notes~life', path: 'notes/plan.md' }));
  expect(await call('write_note', { path: 'notes/plan.md', content: '# Plan\n\nshipped\n', metadata: { status: 'done' } })).toMatchObject({ source: 'working', created: false });
  const entry = readWorkingNotes(store)['notes/plan.md'];
  expect(entry.base?.content).toBe('# Plan\n\nship it\n');
  expect(entry.note).toMatchObject({ content: '# Plan\n\nshipped\n', metadata: { status: 'done' } });
  expect(externalEditCount(noteRefKey({ notebookId: 'notes~life', path: 'notes/plan.md' }))).toBe(before + 1);
  expect(await call('read_note', { path: 'notes/plan.md' })).toMatchObject({ source: 'working', content: '# Plan\n\nshipped\n' });
});

it('accepts a bare notebook id as tool calls from before notebook keys name it, and returns the key', async () => {
  const { call } = tools();
  expect(await call('read_note', { path: 'notes/plan.md', notebookId: 'life' })).toMatchObject({ notebookId: 'notes~life', source: 'committed' });
  await expect(call('read_note', { path: 'notes/plan.md', notebookId: 'work' })).rejects.toThrow('not inside notebook work');
});

it('creates a note, edits one exact occurrence, and keeps frontmatter keys it was not given', async () => {
  const { call } = tools();
  expect(await call('write_note', { path: 'notes/new.md', content: 'hello world', metadata: { title: 'New' } })).toMatchObject({ created: true });
  expect(readWorkingNotes(store)['notes/new.md'].base).toBeNull();
  await call('edit_note', { path: 'notes/plan.md', oldText: 'ship it', newText: 'shipped' });
  expect(readWorkingNotes(store)['notes/plan.md'].note).toMatchObject({ content: '# Plan\n\nshipped\n', metadata: { status: 'working' } });
  await expect(call('edit_note', { path: 'notes/plan.md', oldText: 'absent', newText: 'x' })).rejects.toThrow('does not occur');
  await expect(call('edit_note', { path: 'notes/new.md', oldText: 'l', newText: 'L' })).rejects.toThrow('occurs 3 times');
});

it('moves a committed note to the trash as a deletion, and drops a note that exists only as a working change', async () => {
  const { call } = tools();
  expect(await call('delete_note', { path: 'notes/plan.md' })).toEqual({ path: 'notes/plan.md', notebookId: 'notes~life', deleted: true, trashed: true });
  expect(readWorkingNotes(store)['notes/plan.md']).toMatchObject({ deleted: true, base: { content: '# Plan\n\nship it\n' } });
  await expect(call('read_note', { path: 'notes/plan.md' })).rejects.toThrow('waits in their trash');
  await expect(call('delete_note', { path: 'notes/plan.md' })).rejects.toThrow('already deleted');
  await call('write_note', { path: 'notes/new.md', content: 'x' });
  expect(await call('delete_note', { path: 'notes/new.md' })).toMatchObject({ trashed: false });
  expect(readWorkingNotes(store)['notes/new.md']).toBeUndefined();
  // The page renders again after each change; a fresh render lists what is staged now.
  const { changes } = await tools().call('list_changes', {}) as { changes: { path: string; kind: string; diff: string; }[]; };
  expect(changes).toEqual([expect.objectContaining({ path: 'notes/plan.md', kind: 'deleted', diff: expect.stringContaining('-ship it') })]);
});

it('refuses a note with typing not yet saved, a read-only notebook, and a path outside every notebook', async () => {
  saveLocalDraft(scope, 'notes/plan.md', '# Plan\n\ntyping', {});
  await expect(tools().call('write_note', { path: 'notes/plan.md', content: 'x' })).rejects.toThrow('The person is editing notes/plan.md');
  await expect(tools().call('delete_note', { path: 'notes/plan.md' })).rejects.toThrow('editing');
  await expect(tools({ writable: false }).call('write_note', { path: 'notes/other.md', content: 'x' })).rejects.toThrow('read-only');
  await expect(tools().call('write_note', { path: 'elsewhere/a.md', content: 'x' })).rejects.toThrow('not inside any notebook');
  await expect(tools().call('read_note', { path: 'notes/../secret.md' })).rejects.toThrow('not a note path');
  await expect(tools().call('commit', {})).rejects.toThrow('Unknown note tool');
});

// The agent system of a repository: root and blog instructions, a root skill, and a blog skill that shadows a root one.
const other: WorkspaceRepository = { ...repository, id: 'github:me/docs@main', alias: 'docs', repository: 'me/docs', notebooks: ['docs~all'] };
const agentFiles = [{ path: '.agents/skills/post/SKILL.md', folder: '', kind: 'skill', skill: 'post' }, { path: '.agents/skills/review/SKILL.md', folder: '', kind: 'skill', skill: 'review' }, { path: 'AGENTS.md', folder: '', kind: 'instructions' }, { path: 'blog/.agents/skills/post/SKILL.md', folder: 'blog', kind: 'skill', skill: 'post' }, { path: 'blog/.agents/skills/post/references/style.md', folder: 'blog', kind: 'reference', skill: 'post' }, { path: 'blog/AGENTS.md', folder: 'blog', kind: 'instructions' }].map(file => ({ ...file, editable: true }));
const agentContents: Record<string, string> = { 'AGENTS.md': 'Root rules.\n', 'blog/AGENTS.md': 'Blog rules.\n', '.agents/skills/post/SKILL.md': '---\nname: post\ndescription: Root post\n---\n\nBody.\n', '.agents/skills/review/SKILL.md': '---\nname: review\ndescription: >-\n  Review a draft\n  before it ships.\n---\n', 'blog/.agents/skills/post/SKILL.md': '---\nname: post\ndescription: Blog post\n---\n', 'blog/.agents/skills/post/references/style.md': 'Short sentences.\n' };

function agentTools() {
  const config = { workspace: { title: 'Notes' }, notebooks: [{ id: 'notes~life', title: 'Life', root: 'notes' }, { id: 'blog~posts', title: 'Posts', root: 'blog/posts' }, { id: 'docs~all', title: 'Docs', root: 'notes' }] } as never;
  const repositoryFor = (notebookId: string) => notebookId === 'docs~all' ? other : notebookId === 'notes~life' || notebookId === 'blog~posts' ? repository : undefined;
  const { result } = renderHook(() => useWebAgentTools({ config, activeWorkingNotes: {}, repositoryFor, canWriteNotebook: () => true, revisionFor: () => repository.revision, readDraft: () => undefined, updateDraft: vi.fn(), stageWorkingNote: vi.fn(), findCommittedNote: async () => null, resolveBareNotebook: () => null }));
  // The agent-system tools only read, and reads need no note in scope.
  return (tool: string, args: Record<string, unknown>) => result.current(tool, args, { open: null, allowed: [] });
}

const session = { repository: repository.id, folder: 'blog' };
const paths = (files: { path: string; }[]) => files.map(file => file.path);

beforeEach(() => {
  vi.mocked(fetchAgentResources).mockReset().mockResolvedValue({ workspaces: [], files: agentFiles as never, revision: 'r1' });
  vi.mocked(readAgentResource).mockReset().mockImplementation(async file => file in agentContents ? { path: file, content: agentContents[file] } : Promise.reject(new Error('Failed to read agent resource')));
});

it("answers a note's agent system: the instructions from the root down, and the skills with the nearest folder winning a name", async () => {
  const result = await agentTools()('agent_system', { path: 'blog/posts/first.md', notebookId: 'blog~posts' }) as { workspace: unknown; notebookId: string; files: { path: string; content: string; }[]; skills: { name: string; description: string; path: string; directory: string; }[]; };
  expect(fetchAgentResources).toHaveBeenCalledWith(repository.id);
  expect(result.workspace).toEqual({ repository: repository.id, folder: 'blog/posts' });
  expect(result.notebookId).toBe('blog~posts');
  expect(result.files).toEqual([{ path: 'AGENTS.md', content: 'Root rules.\n' }, { path: 'blog/AGENTS.md', content: 'Blog rules.\n' }]);
  expect(result.skills).toEqual([{ name: 'post', description: 'Blog post', path: 'blog/.agents/skills/post/SKILL.md', directory: 'blog/.agents/skills/post' }, { name: 'review', description: 'Review a draft before it ships.', path: '.agents/skills/review/SKILL.md', directory: '.agents/skills/review' }]);
});

it('leaves out the folders a path is not inside, and takes a folder path with or without a slash for its notebook root', async () => {
  const call = agentTools();
  const shallow = await call('agent_system', { path: 'notes/plan.md', notebookId: 'notes~life' }) as { files: { path: string; }[]; skills: { name: string; description: string; }[]; };
  expect(paths(shallow.files)).toEqual(['AGENTS.md']);
  expect(shallow.skills.map(skill => [skill.name, skill.description])).toEqual([['post', 'Root post'], ['review', 'Review a draft before it ships.']]);
  const folder = await call('agent_system', { path: 'blog/posts/' });
  expect(paths((folder as { files: { path: string; }[]; }).files)).toEqual(['AGENTS.md', 'blog/AGENTS.md']);
  expect(await call('agent_system', { notebookId: 'blog~posts' })).toMatchObject({ workspace: { folder: 'blog/posts' }, files: [{ path: 'AGENTS.md' }, { path: 'blog/AGENTS.md' }] });
});

it("answers the session's own workspace when no path is given, and asks for a path when the session names none", async () => {
  const call = agentTools();
  expect(await call('agent_system', { workspace: session })).toMatchObject({ workspace: session, files: [{ path: 'AGENTS.md' }, { path: 'blog/AGENTS.md' }], skills: [{ name: 'post', description: 'Blog post' }, { name: 'review' }] });
  await expect(call('agent_system', {})).rejects.toThrow('did not report its agent workspace');
});

it('refuses a path no notebook holds, one in several notebooks, and a traversal', async () => {
  const call = agentTools();
  await expect(call('agent_system', { path: 'elsewhere/a.md' })).rejects.toThrow('not inside any notebook');
  await expect(call('agent_system', { path: 'notes/a.md' })).rejects.toThrow('several notebooks (notes~life, docs~all)');
  await expect(call('agent_system', { path: 'notes/../AGENTS.md' })).rejects.toThrow('no traversal');
  await expect(call('agent_system', { notebookId: 'nowhere~x' })).rejects.toThrow('Unknown notebook');
  expect(fetchAgentResources).not.toHaveBeenCalled();
});

it('reads an AGENTS.md or skill file of the session workspace, or of the notebook named', async () => {
  const call = agentTools();
  expect(await call('read_agent_file', { path: 'blog/.agents/skills/post/references/style.md', workspace: session })).toEqual({ path: 'blog/.agents/skills/post/references/style.md', workspace: { repository: repository.id }, content: 'Short sentences.\n' });
  expect(readAgentResource).toHaveBeenCalledWith('blog/.agents/skills/post/references/style.md', repository.id);
  await call('read_agent_file', { path: 'AGENTS.md', notebookId: 'docs~all', workspace: session });
  expect(readAgentResource).toHaveBeenLastCalledWith('AGENTS.md', other.id);
});

it('refuses a file that is not an agent file, before asking the server, and reports one the server refuses or lacks', async () => {
  const call = agentTools();
  await expect(call('read_agent_file', { path: 'notes/plan.md', workspace: session })).rejects.toThrow('not an AGENTS.md or skill file');
  await expect(call('read_agent_file', { path: '.agents/skills/../../secret.md', workspace: session })).rejects.toThrow('no traversal');
  await expect(call('read_agent_file', { path: 'AGENTS.md' })).rejects.toThrow('did not report its agent workspace');
  expect(readAgentResource).not.toHaveBeenCalled();
  await expect(call('read_agent_file', { path: '.agents/skills/gone/SKILL.md', workspace: session })).rejects.toThrow('or it does not exist');
});

const READING = { template: { name: 'Reading', path: 'reading/{{book}}.md', placeholders: { book: 'The book', author: { description: 'Who wrote it', default: 'Unknown' } } }, tags: ['reading'], author: '{{author}}' };
const withTemplates = () => {
  server.set('notes/.templates/reading.md', committed('notes/.templates/reading.md', '# {{title}}\n\n> {{takeaway}}\n', READING));
  vi.mocked(fetchNoteTemplates).mockResolvedValue([{ notebookId: 'notes~life', id: 'reading', name: 'Reading', source: 'file', file: 'notes/.templates/reading.md', path: 'reading/{{book}}.md', placeholders: [], lastUsed: null }]);
};

it('lists a notebook’s templates as the person sees them, a template they just drafted included', async () => {
  withTemplates();
  const { call } = tools();
  await call('write_note', { path: 'notes/plan.md', content: 'x' });
  updateWorkingNote(store, 'notes/.templates/meeting.md', { note: committed('notes/.templates/meeting.md', '# {{title}}\n\nWith {{who}}.\n'), base: null });
  const listed = await tools().call('list_templates', { notebookId: 'life' }) as { templates: { id: string; placeholders: { name: string; }[]; }[]; };
  expect(listed.templates.map(template => template.id)).toEqual(['meeting', 'reading']);
  expect(listed.templates[0].placeholders.map(placeholder => placeholder.name)).toEqual(['title', 'date', 'time', 'who']);
  expect((await tools().call('list_templates', {}) as { templates: unknown[]; }).templates).toHaveLength(2);
});

it('filters the templates by a query, orders them by the last use, cuts at the limit, and answers one template with its text', async () => {
  withTemplates();
  server.set('notes/.templates/meeting.md', committed('notes/.templates/meeting.md', '# {{title}}\n\nWith {{who}}.\n'));
  const listedBy = (id: string, fields: Record<string, unknown> = {}) => ({ notebookId: 'notes~life', id, name: id, source: 'file' as const, file: `notes/.templates/${id}.md`, placeholders: [], lastUsed: null, ...fields });
  vi.mocked(fetchNoteTemplates).mockResolvedValue([listedBy('meeting', { description: 'Minutes of a meeting' }), listedBy('reading', { name: 'Reading', description: 'Notes on a book', path: 'reading/{{book}}.md', lastUsed: '2026-11-01T08:00:00.000Z' }), listedBy('weekly', { name: 'Weekly review', lastUsed: '2026-11-05T08:00:00.000Z' })]);
  type Listed = { templates: { id: string; lastUsed: string | null; content?: string; }[]; total: number; truncated: boolean; };
  const { call } = tools();
  const list = async (args: Record<string, unknown>) => await tools().call('list_templates', args) as Listed;
  expect((await list({ notebookId: 'life' })).templates.map(template => [template.id, template.lastUsed])).toEqual([['weekly', '2026-11-05T08:00:00.000Z'], ['reading', '2026-11-01T08:00:00.000Z'], ['meeting', null]]);
  expect(await list({})).toMatchObject({ total: 3, truncated: false });
  expect(await list({ limit: 1 })).toMatchObject({ templates: [{ id: 'weekly' }], total: 3, truncated: true });
  expect((await list({ query: 'BOOK notes' })).templates.map(template => template.id)).toEqual(['reading']);
  expect((await list({ query: 'book meeting' })).templates).toEqual([]);

  // A note this page just made from a template, still a working change, is that template's last use.
  await call('write_note', { path: 'notes/sync.md', template: 'meeting', values: { who: 'Ann' } });
  const after = await list({});
  expect(after.templates.map(template => template.id)).toEqual(['meeting', 'weekly', 'reading']);
  expect(after.templates[0].lastUsed).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  const one = await list({ notebookId: 'life', templateId: 'reading' });
  expect(one).toMatchObject({ templates: [{ id: 'reading', lastUsed: '2026-11-01T08:00:00.000Z' }], total: 1, truncated: false });
  expect(one.templates[0].content).toMatch(/^---\ntemplate:\n {2}name: Reading\n[\s\S]*---\n# \{\{title\}\}\n\n> \{\{takeaway\}\}\n$/);
  expect(after.templates[0]).not.toHaveProperty('content');
  await expect(list({ templateId: 'reading' })).rejects.toThrow(/notebookId/);
  await expect(list({ notebookId: 'life', templateId: 'nope' })).rejects.toThrow(/no template 'nope'.*meeting, reading, weekly/);
  await expect(list({ limit: 'many' })).rejects.toThrow(/limit/);
});

it('stages a new note from a template: path from its pattern, values filled, unfilled reported, an existing note refused', async () => {
  withTemplates();
  const { call, stageWorkingNote } = tools();
  expect(await call('write_note', { notebookId: 'life', template: 'reading', values: { book: 'Dune' } })).toEqual({ path: 'notes/reading/Dune.md', notebookId: 'notes~life', source: 'working', created: true, template: 'reading', unfilled: ['takeaway'] });
  const staged = readWorkingNotes(store)['notes/reading/Dune.md'];
  expect(staged.base).toBeNull();
  // The template block stays behind; the note records the id of the template it came from.
  expect(staged.note).toMatchObject({ content: '# Dune\n\n> {{takeaway}}\n', metadata: { title: 'Dune', tags: ['reading'], author: 'Unknown', template: 'reading' } });

  await expect(call('write_note', { notebookId: 'life', template: 'reading', values: { book: 'Dune' } })).rejects.toThrow('A note already exists at notes/reading/Dune.md');
  await expect(call('write_note', { notebookId: 'life', template: 'reading', values: { boook: 'x' } })).rejects.toThrow(/no placeholder 'boook'/);
  await expect(call('write_note', { notebookId: 'life', template: 'reading', values: {} })).rejects.toThrow(/needs a value for book/);
  await expect(call('write_note', { notebookId: 'life', template: 'nope' })).rejects.toThrow(/no template 'nope'.*reading/);
  await expect(call('write_note', { template: 'reading', values: { book: 'x' } })).rejects.toThrow(/Name the notebook/);
  await expect(call('write_note', { path: 'notes/x.md', content: 'x', values: { book: 'x' } })).rejects.toThrow(/name one as template/);
  await expect(call('write_note', { path: 'notes/.hidden/x.md', template: 'reading' })).rejects.toThrow(/not a note path/);
  expect(stageWorkingNote).toHaveBeenCalledOnce();

  // The caller's own path, title and body win over the template's.
  expect(await call('write_note', { path: 'notes/own.md', template: 'reading', title: 'Mine', content: 'My body', metadata: { author: 'Me' } })).toMatchObject({ path: 'notes/own.md', created: true, unfilled: [] });
  expect(readWorkingNotes(store)['notes/own.md'].note).toMatchObject({ content: 'My body', metadata: { title: 'Mine', author: 'Me' } });
});

it('refuses a templated note in a read-only notebook', async () => {
  withTemplates();
  await expect(tools({ writable: false }).call('write_note', { notebookId: 'life', template: 'reading', values: { book: 'Dune' } })).rejects.toThrow('read-only');
});

it('refuses to write, edit or delete a note being edited live (編輯中)', async () => {
  server.set('notes/live.md', { ...committed('notes/live.md', '# Live\n'), live: { since: '2026-11-15T01:00:00.000Z', activeEditors: 1, editorUrl: 'https://live.example.test/abc' } });
  const { call, stageWorkingNote } = tools();
  for (const [tool, args] of [['write_note', { path: 'notes/live.md', content: 'x' }], ['edit_note', { path: 'notes/live.md', oldText: 'Live', newText: 'Gone' }], ['delete_note', { path: 'notes/live.md' }]] as const) await expect(call(tool, args), tool).rejects.toThrow('notes/live.md is being edited live (編輯中)');
  expect(stageWorkingNote).not.toHaveBeenCalled();
});

// The write scope: only the note open in the editor, and the notes the person kept editable, may change.
const REFUSED = /^Refused: .* is not a note the person has put in scope for you\..*propose the change as text in your reply/;
const OPEN_PLAN: WriteScope = { open: note('notes/plan.md'), allowed: [] };

it('lets the agent write, edit and delete the open note, and nothing else changes', async () => {
  const { call, stageWorkingNote } = tools({ scope: OPEN_PLAN });
  await call('write_note', { path: 'notes/plan.md', content: '# Plan\n\nwritten\n' });
  await call('edit_note', { path: 'notes/plan.md', oldText: 'written', newText: 'edited' });
  expect(await call('delete_note', { path: 'notes/plan.md' })).toMatchObject({ deleted: true });
  expect(stageWorkingNote).toHaveBeenCalledTimes(3);
  expect(Object.keys(readWorkingNotes(store))).toEqual(['notes/plan.md']);
});

it('refuses to write, edit or delete another note, tells the agent to propose the change as text, and changes nothing', async () => {
  server.set('notes/other.md', committed('notes/other.md', 'other body'));
  const { call, stageWorkingNote } = tools({ scope: OPEN_PLAN });
  await expect(call('write_note', { path: 'notes/other.md', content: 'x' })).rejects.toThrow(REFUSED);
  await expect(call('edit_note', { path: 'notes/other.md', oldText: 'other', newText: 'x' })).rejects.toThrow(REFUSED);
  // A delete outside the scope never reaches the trash.
  await expect(call('delete_note', { path: 'notes/other.md' })).rejects.toThrow(REFUSED);
  await expect(call('delete_note', { path: 'notes/other.md' })).rejects.toThrow('You may change only notes/plan.md.');
  // Neither edit nor delete creates anything: a note that does not exist yet is outside the scope for them.
  await expect(call('delete_note', { path: 'notes/brand-new.md' })).rejects.toThrow(REFUSED);
  expect(stageWorkingNote).not.toHaveBeenCalled();
  expect(readWorkingNotes(store)).toEqual({});
  // The refusal is the guard's, not the missing note's: it comes before any lookup of the note.
  await expect(call('edit_note', { path: 'notes/missing.md', oldText: 'a', newText: 'b' })).rejects.toThrow(REFUSED);
});

it('leaves reads unrestricted, whatever the scope', async () => {
  server.set('notes/other.md', committed('notes/other.md', 'other body'));
  const { call } = tools({ scope: { open: null, allowed: [] } });
  expect(await call('read_note', { path: 'notes/other.md' })).toMatchObject({ content: 'other body' });
  expect(await call('list_changes', {})).toEqual({ changes: [] });
});

it('refuses every change when no note is open and none is kept editable', async () => {
  const { call, stageWorkingNote } = tools({ scope: { open: null, allowed: [] } });
  await expect(call('write_note', { path: 'notes/plan.md', content: 'x' })).rejects.toThrow('You may change no note now: none is open');
  await expect(call('delete_note', { path: 'notes/plan.md' })).rejects.toThrow(REFUSED);
  expect(stageWorkingNote).not.toHaveBeenCalled();
});

it('allows a note the person kept editable beside the open one, but only that note', async () => {
  server.set('notes/other.md', committed('notes/other.md', 'other body'));
  server.set('notes/third.md', committed('notes/third.md', 'third body'));
  const { call } = tools({ scope: { open: note('notes/plan.md'), allowed: [note('notes/other.md')] } });
  await call('edit_note', { path: 'notes/other.md', oldText: 'other', newText: 'kept' });
  await call('edit_note', { path: 'notes/plan.md', oldText: 'ship it', newText: 'shipped' });
  await expect(call('edit_note', { path: 'notes/third.md', oldText: 'third', newText: 'x' })).rejects.toThrow('You may change only notes/plan.md, notes/other.md.');
});

it('matches a path to the note exactly: another case, a leading slash, a traversal, a dot segment or a doubled slash never reaches another note', async () => {
  const { call, stageWorkingNote, keep } = tools({ scope: OPEN_PLAN });
  // Another case is another note in a repository, so it is outside the scope: it cannot be deleted, and writing it creates a new note beside the open one.
  await expect(call('delete_note', { path: 'notes/PLAN.md' })).rejects.toThrow(REFUSED);
  expect(readWorkingNotes(store)['notes/plan.md']).toBeUndefined();
  expect(await call('write_note', { path: 'notes/Plan.md', content: 'x' })).toMatchObject({ path: 'notes/Plan.md', created: true });
  expect(keep).toHaveBeenCalledOnce();
  stageWorkingNote.mockClear();
  // The rest are not note paths at all, so no spelling of the open note's path reaches around the exact match, nor out of the notebook;
  // a creation takes no path with a backslash, a hidden folder or file, or an empty or dot segment either.
  for (const path of ['/notes/plan.md', 'notes/../notes/plan.md', 'notes/../plan.md', 'notes/./plan.md', 'notes//plan.md', '../notes/plan.md', 'notes\\plan.md', 'notes/a\\b.md', 'notes/.hidden/new.md', 'notes/.templates/new.md', 'notes/.new.md']) {
    await expect(call('write_note', { path, content: 'x' }), path).rejects.toThrow();
    await expect(call('delete_note', { path }), path).rejects.toThrow();
  }
  expect(stageWorkingNote).not.toHaveBeenCalled();
  expect(keep).toHaveBeenCalledOnce();
});

it('follows a note the person moved: the open note is the new path, and the old path or a kept old path no longer is', async () => {
  server.set('notes/archive/plan.md', committed('notes/archive/plan.md', '# Plan\n\nship it\n'));
  // The person renamed the open note: the editor now names the new path.
  const moved = tools({ scope: { open: note('notes/archive/plan.md'), allowed: [] } });
  await expect(moved.call('write_note', { path: 'notes/plan.md', content: 'x' })).rejects.toThrow(REFUSED);
  await expect(moved.call('delete_note', { path: 'notes/plan.md' })).rejects.toThrow(REFUSED);
  await moved.call('edit_note', { path: 'notes/archive/plan.md', oldText: 'ship it', newText: 'moved' });
  // A permission kept for the old path does not carry over to the new one.
  const kept = tools({ scope: { open: note('notes/other.md'), allowed: [note('notes/plan.md')] } });
  await expect(kept.call('edit_note', { path: 'notes/archive/plan.md', oldText: 'ship it', newText: 'x' })).rejects.toThrow(REFUSED);
  expect(readWorkingNotes(store)['notes/archive/plan.md'].note.content).toContain('moved');
});

it('refuses a change when the call arrives without a scope', async () => {
  const { result } = renderHook(() => useWebAgentTools({ config: { workspace: { title: 'Notes' }, notebooks: [{ id: 'notes~life', title: 'Life', root: 'notes' }] } as never, activeWorkingNotes: {}, repositoryFor: () => repository, canWriteNotebook: () => true, revisionFor: () => repository.revision, readDraft: () => undefined, updateDraft: vi.fn(), stageWorkingNote: vi.fn(), findCommittedNote: async () => null, resolveBareNotebook: () => null }));
  await expect((result.current as (tool: string, args: Record<string, unknown>) => Promise<unknown>)('write_note', { path: 'notes/plan.md', content: 'x' })).rejects.toThrow(REFUSED);
});

// Creating: a note that does not exist yet may be made in the notebook of a note in scope, and then stays in scope.
it('creates a note that does not exist yet in the notebook of the open note, and keeps it for the session', async () => {
  const { call, keep, kept, stageWorkingNote } = tools({ scope: OPEN_PLAN });
  expect(await call('write_note', { path: 'notes/ideas/new.md', content: '# New\n', metadata: { title: 'New' } })).toEqual({ path: 'notes/ideas/new.md', notebookId: 'notes~life', source: 'working', created: true });
  expect(readWorkingNotes(store)['notes/ideas/new.md']).toMatchObject({ base: null, note: { content: '# New\n', metadata: { title: 'New' } } });
  expect(stageWorkingNote).toHaveBeenCalledOnce();
  expect(keep).toHaveBeenCalledWith({ notebookId: 'notes~life', path: 'notes/ideas/new.md' });
  expect(kept).toEqual([{ notebookId: 'notes~life', path: 'notes/ideas/new.md' }]);
});

it('creates in the notebook of a kept note when the open note lies in another, and nowhere else', async () => {
  const { call, kept } = tools({ blog: true, scope: { open: note('blog/draft.md', 'notes~blog'), allowed: [note('notes/other.md')] } });
  expect(await call('write_note', { path: 'notes/brand-new.md', content: 'x' })).toMatchObject({ created: true, notebookId: 'notes~life' });
  expect(await call('write_note', { path: 'blog/brand-new.md', content: 'x' })).toMatchObject({ created: true, notebookId: 'notes~blog' });
  expect(kept.map(created => created.path)).toEqual(['notes/brand-new.md', 'blog/brand-new.md']);
});

it('refuses to create a note in a notebook that holds no note in scope, and names where the agent may create', async () => {
  const { call, keep, stageWorkingNote } = tools({ blog: true, scope: OPEN_PLAN });
  await expect(call('write_note', { path: 'blog/post.md', content: 'x' })).rejects.toThrow(REFUSED);
  await expect(call('write_note', { path: 'blog/post.md', content: 'x' })).rejects.toThrow('You may also create a note that does not exist yet in notebook notes~life.');
  // Naming the notebook changes nothing: the notebook of the note is what counts.
  await expect(call('write_note', { path: 'blog/post.md', content: 'x', notebookId: 'notes~blog' })).rejects.toThrow(REFUSED);
  expect(stageWorkingNote).not.toHaveBeenCalled();
  expect(keep).not.toHaveBeenCalled();
  expect(readWorkingNotes(store)).toEqual({});
});

it('refuses to write a note that exists already outside the scope, wherever it exists, and changes nothing', async () => {
  server.set('notes/other.md', committed('notes/other.md', 'other body'));
  server.set('notes/trashed.md', committed('notes/trashed.md', 'trashed body'));
  updateWorkingNote(store, 'notes/trashed.md', { note: committed('notes/trashed.md', 'trashed body'), base: committed('notes/trashed.md', 'trashed body'), deleted: true });
  updateWorkingNote(store, 'notes/added.md', { note: committed('notes/added.md', 'added by the person'), base: null });
  saveLocalDraft(scope, 'notes/typed.md', 'typing not yet saved', {});
  const { call, keep, stageWorkingNote } = tools({ scope: OPEN_PLAN });
  // In the repository, as the person's working change (added or deleted), and as typing in an editor.
  for (const path of ['notes/other.md', 'notes/trashed.md', 'notes/added.md', 'notes/typed.md']) await expect(call('write_note', { path, content: 'overwritten' }), path).rejects.toThrow(REFUSED);
  expect(stageWorkingNote).not.toHaveBeenCalled();
  expect(keep).not.toHaveBeenCalled();
  expect(readWorkingNotes(store)['notes/added.md'].note.content).toBe('added by the person');
  expect(readWorkingNotes(store)['notes/trashed.md']).toMatchObject({ deleted: true });
});

it('lets the agent edit, overwrite and delete the note it created, and no other note beside it', async () => {
  server.set('notes/other.md', committed('notes/other.md', 'other body'));
  const { call } = tools({ scope: OPEN_PLAN });
  await call('write_note', { path: 'notes/made.md', content: 'first draft' });
  await call('edit_note', { path: 'notes/made.md', oldText: 'first', newText: 'second' });
  expect(readWorkingNotes(store)['notes/made.md'].note.content).toBe('second draft');
  expect(await call('write_note', { path: 'notes/made.md', content: 'third draft' })).toMatchObject({ created: true });
  expect(readWorkingNotes(store)['notes/made.md'].note.content).toBe('third draft');
  expect(await call('delete_note', { path: 'notes/made.md' })).toEqual({ path: 'notes/made.md', notebookId: 'notes~life', deleted: true, trashed: false });
  expect(readWorkingNotes(store)['notes/made.md']).toBeUndefined();
  // Creating a note grants nothing over the others in its notebook.
  await expect(call('edit_note', { path: 'notes/other.md', oldText: 'other', newText: 'x' })).rejects.toThrow(REFUSED);
  await expect(call('delete_note', { path: 'notes/other.md' })).rejects.toThrow(REFUSED);
  await expect(call('write_note', { path: 'notes/other.md', content: 'x' })).rejects.toThrow(REFUSED);
});

it('refuses a creation that finds a note at its path by the time it stages, whether the note is committed or the person staged it meanwhile', async () => {
  // The first lookup sees nothing; the next ones (the live check and the base) see a note another tab committed.
  const committedMeanwhile = tools({ scope: OPEN_PLAN, hooks: { lookup: (path, count) => path === 'notes/race.md' && count > 1 ? committed('notes/race.md', 'someone else wrote this') : undefined } });
  await expect(committedMeanwhile.call('write_note', { path: 'notes/race.md', content: 'overwrite' })).rejects.toThrow(REFUSED);
  expect(committedMeanwhile.stageWorkingNote).not.toHaveBeenCalled();
  expect(committedMeanwhile.keep).not.toHaveBeenCalled();
  // The person's working change appears while the agent's call is awaiting.
  const stagedMeanwhile = tools({
    scope: OPEN_PLAN,
    hooks: {
      lookup: (path, count) => {
        if (path === 'notes/race2.md' && count === 2) updateWorkingNote(store, 'notes/race2.md', { note: committed('notes/race2.md', 'the person was faster'), base: null });
        return undefined;
      },
    },
  });
  await expect(stagedMeanwhile.call('write_note', { path: 'notes/race2.md', content: 'overwrite' })).rejects.toThrow(REFUSED);
  expect(stagedMeanwhile.stageWorkingNote).not.toHaveBeenCalled();
  expect(readWorkingNotes(store)['notes/race2.md'].note.content).toBe('the person was faster');
});

it('creates a note from a template in the notebook of a note in scope, keeps it, and refuses the other notebooks and the notes that exist', async () => {
  withTemplates();
  server.set('notes/reading/Emma.md', committed('notes/reading/Emma.md', 'Emma'));
  const { call, keep, kept } = tools({ blog: true, scope: OPEN_PLAN });
  expect(await call('write_note', { notebookId: 'life', template: 'reading', values: { book: 'Dune' } })).toMatchObject({ path: 'notes/reading/Dune.md', notebookId: 'notes~life', created: true, template: 'reading' });
  expect(kept).toEqual([{ notebookId: 'notes~life', path: 'notes/reading/Dune.md' }]);
  // A note made from a template is as editable afterwards as any the agent created.
  await call('edit_note', { path: 'notes/reading/Dune.md', oldText: '{{takeaway}}', newText: 'spice' });
  expect(readWorkingNotes(store)['notes/reading/Dune.md'].note.content).toBe('# Dune\n\n> spice\n');
  // An existing note is refused by the template's own rule, and a note the template makes in another notebook by the scope.
  await expect(call('write_note', { notebookId: 'life', template: 'reading', values: { book: 'Emma' } })).rejects.toThrow('A note already exists at notes/reading/Emma.md');
  await expect(call('write_note', { notebookId: 'notes~blog', template: 'reading', path: 'blog/Dune.md' })).rejects.toThrow(REFUSED);
  expect(keep).toHaveBeenCalledOnce();
  expect(readWorkingNotes(store)['blog/Dune.md']).toBeUndefined();
  // Without a note in scope, no template creates.
  await expect(tools({ scope: { open: null, allowed: [] } }).call('write_note', { notebookId: 'life', template: 'reading', values: { book: 'Ulysses' } })).rejects.toThrow('You may change no note now');
});

it('takes the notes in scope from the call, so a creation one page may make is refused on another that has no note in the notebook', async () => {
  const first = tools({ blog: true, scope: { open: note('notes/plan.md'), allowed: [] } });
  const second = tools({ blog: true, scope: { open: note('blog/draft.md', 'notes~blog'), allowed: [] } });
  expect(await first.call('write_note', { path: 'notes/page-one.md', content: 'x' })).toMatchObject({ created: true });
  await expect(second.call('write_note', { path: 'notes/page-two.md', content: 'x' })).rejects.toThrow(REFUSED);
  expect(second.keep).not.toHaveBeenCalled();
  expect(first.keep).toHaveBeenCalledOnce();
});

it('refuses a creation in a read-only notebook, and keeps nothing', async () => {
  const { call, keep, stageWorkingNote } = tools({ writable: false, scope: OPEN_PLAN });
  await expect(call('write_note', { path: 'notes/new.md', content: 'x' })).rejects.toThrow('read-only');
  expect(stageWorkingNote).not.toHaveBeenCalled();
  expect(keep).not.toHaveBeenCalled();
});
