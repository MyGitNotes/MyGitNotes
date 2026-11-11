// @vitest-environment jsdom
import { noteRefKey } from '@mygitnotes/core/note-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchAgentResources, readAgentResource } from '../lib/api.js';
import { useWebAgentTools } from './useWebAgentTools.js';
import { readWorkingNotes, updateWorkingNote, type WorkingNote, type WorkingNotes } from '../lib/working-notes.js';
import { draftScope, draftStore, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import { externalEditCount } from '../lib/external-note-edits.js';
import { saveLocalDraft } from '../lib/storage.js';
import type { NoteItem } from '../lib/types.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';

vi.mock('../lib/api.js', () => ({ fetchAgentResources: vi.fn(), readAgentResource: vi.fn() }));

const repository: WorkspaceRepository = { id: 'github:me/notes@main', alias: 'notes', type: 'github', repository: 'me/notes', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life'], title: 'notes', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const scope = draftScope(repository);
const store = draftStore(repository);
const committed = (path: string, content: string, metadata: Record<string, unknown> = {}): NoteItem => ({ id: path, path, notebookId: 'notes~life', title: path, content, metadata, tags: [], revision: repository.revision });
const server = new Map<string, NoteItem>();

function tools({ writable = true } = {}) {
  const readDraft = (_notebookId: string, path: string) => readWorkingNotes(store)[path];
  const updateDraft = (_notebookId: string, path: string, entry: WorkingNote | null) => {
    updateWorkingNote(store, path, entry);
  };
  const stageWorkingNote = vi.fn((note: NoteItem, base: NoteItem | null, blocked?: string, deleted?: boolean) => {
    updateWorkingNote(store, note.path, { note, base, ...(blocked ? { blocked } : {}), ...(deleted && base ? { deleted: true as const } : {}) });
    return note;
  });
  const active = (): WorkingNotes => Object.fromEntries(Object.values(readWorkingNotes(store)).map(entry => [noteRefKey(entry.note), entry]));
  const { result } = renderHook(() => useWebAgentTools({ config: { workspace: { title: 'Notes' }, notebooks: [{ id: 'notes~life', title: 'Life', root: 'notes' }] } as never, activeWorkingNotes: active(), repositoryFor: () => repository, canWriteNotebook: () => writable, revisionFor: () => repository.revision, readDraft, updateDraft, stageWorkingNote, findCommittedNote: async ref => server.get(ref.path) ?? null, resolveBareNotebook: localId => localId === 'life' ? 'notes~life' : null }));
  return { call: result.current, stageWorkingNote };
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
  return result.current;
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
