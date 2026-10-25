// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { serializeNoteFile } from '@mygitnotes/core/note-file';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { registerDemoRepositories } from './demo-storage.js';
import { appendLocalCommit, blobId, committedDocuments, committedLayer, LocalCommitLimitError, localCommitsKey, localCommittedEntry, localCurrentRaw, localHistoryEntries, localTextAt, localTextOfBlob, localVersions, MAX_LOCAL_COMMIT_BYTES, MAX_LOCAL_COMMITS, type NoteChangeInput, readLocalCommits } from './local-commits.js';

const REPO = 'edition:demo:scenarios@main', SCOPE = `${REPO}:main`, NOTEBOOK = 'demo~trpg-en', HEAD = 'a'.repeat(40);
const raw = (content: string) => serializeNoteFile('notes/a.md', { title: 'A' }, content, false, new Date('2026-10-25T00:00:00Z'), '---\ntitle: A\n---\nold\n');
const change = (content: string): NoteChangeInput => ({ notebookId: NOTEBOOK, server: null, raw: raw(content) });
const input = (message: string, notes: Record<string, NoteChangeInput> = {}, documents: Record<string, unknown> = {}) => ({ message, author: 'You (demo)', notes, documents, now: new Date('2026-10-25T01:00:00Z') });

beforeEach(() => {
  localStorage.clear();
  registerDemoRepositories([{ id: REPO, branch: 'main', alias: 'demo', demo: true, revision: HEAD, notebooks: [NOTEBOOK] }]);
});

describe('blobId', () => {
  it('is the Git object id of a text', async () => {
    expect(await blobId('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('appending local commits', () => {
  it('stores a 40-hex id, the parent chain from the server head, and the text the server would write', async () => {
    const first = await appendLocalCommit(SCOPE, HEAD, input('One', { 'notes/a.md': change('# one\n') }));
    const second = await appendLocalCommit(SCOPE, HEAD, input('Two', { 'notes/a.md': change('# two\n') }));
    expect(first.id).toMatch(/^[0-9a-f]{40}$/);
    expect([first.parent, second.parent]).toEqual([HEAD, first.id]);
    expect(first.notes['notes/a.md']).toMatchObject({ raw: raw('# one\n') });
    expect(readLocalCommits(SCOPE)).toMatchObject({ version: 1, base: HEAD });
    expect(localCurrentRaw(SCOPE, 'notes/a.md')).toBe(raw('# two\n'));
  });

  it('gives different commits different ids', async () => {
    const a = await appendLocalCommit(SCOPE, HEAD, input('Same', { 'notes/a.md': change('# one\n') }));
    localStorage.clear();
    const b = await appendLocalCommit(SCOPE, HEAD, input('Same', { 'notes/a.md': change('# other\n') }));
    expect(a.id).not.toBe(b.id);
  });

  it('starts the 24-hour clock', async () => {
    await appendLocalCommit(SCOPE, HEAD, input('One'));
    expect(localStorage.getItem(`gh_notes_demo:${SCOPE}`)).toContain('firstWrite');
  });

  it('refuses the 201st commit before writing anything', async () => {
    const filler = (count: number) => Array.from({ length: count }, (_, n) => ({ id: String(n), parent: HEAD, date: '', author: '', message: '', notes: {}, documents: {} }));
    localStorage.setItem(localCommitsKey(SCOPE), JSON.stringify({ version: 1, base: HEAD, commits: filler(MAX_LOCAL_COMMITS - 1) }));
    await appendLocalCommit(SCOPE, HEAD, input('x'));
    expect(readLocalCommits(SCOPE)!.commits).toHaveLength(MAX_LOCAL_COMMITS);
    const stored = localStorage.getItem(localCommitsKey(SCOPE));
    await expect(appendLocalCommit(SCOPE, HEAD, input('x'))).rejects.toThrow(LocalCommitLimitError);
    expect(localStorage.getItem(localCommitsKey(SCOPE))).toBe(stored);
  });

  it('refuses a commit that would pass 1 MB before writing anything', async () => {
    await appendLocalCommit(SCOPE, HEAD, input('One', { 'notes/a.md': change('# one\n') }));
    const stored = localStorage.getItem(localCommitsKey(SCOPE));
    await expect(appendLocalCommit(SCOPE, HEAD, input('Big', { 'notes/b.md': change('x'.repeat(MAX_LOCAL_COMMIT_BYTES)) }))).rejects.toThrow(/1 MB/);
    expect(localStorage.getItem(localCommitsKey(SCOPE))).toBe(stored);
  });
});

describe('folding the log', () => {
  it('keeps the newest text of a path, the server note it replaced, and a deletion', async () => {
    const server = { id: 'a', path: 'notes/a.md', notebookId: NOTEBOOK, title: 'A', tags: ['red'], metadata: {}, status: 'open' };
    await appendLocalCommit(SCOPE, HEAD, input('One', { 'notes/a.md': { ...change('# one\n'), server } }));
    await appendLocalCommit(SCOPE, HEAD, input('Two', { 'notes/a.md': change('# two\n'), 'notes/b.md': change('# b\n') }));
    const layer = committedLayer(readLocalCommits(SCOPE));
    const key = noteRefKey({ notebookId: NOTEBOOK, path: 'notes/a.md' });
    expect(layer[key].note.content).toContain('# two');
    expect(layer[key].server).toMatchObject({ tags: ['red'], status: 'open' });
    expect(layer[noteRefKey({ notebookId: NOTEBOOK, path: 'notes/b.md' })].server).toBeNull();
    await appendLocalCommit(SCOPE, HEAD, input('Delete', { 'notes/a.md': { notebookId: NOTEBOOK, server: null, deleted: true } }));
    expect(committedLayer(readLocalCommits(SCOPE))[key]).toMatchObject({ deleted: true, server: expect.objectContaining({ tags: ['red'] }) });
    expect(localCommittedEntry('notes/a.md', NOTEBOOK)?.deleted).toBe(true);
    expect(localCommittedEntry('notes/zzz.md', NOTEBOOK)).toBeUndefined();
  });

  it('folds document pages by path, the newest winning', async () => {
    await appendLocalCommit(SCOPE, HEAD, input('One', {}, { 'focus.yaml': 1, 'other.yaml': 1 }));
    await appendLocalCommit(SCOPE, HEAD, input('Two', {}, { 'focus.yaml': 2 }));
    expect(committedDocuments(readLocalCommits(SCOPE))).toEqual({ 'focus.yaml': 2, 'other.yaml': 1 });
  });

  it('answers the text at a commit, null after a deletion and undefined where no local commit changed the path', async () => {
    const one = await appendLocalCommit(SCOPE, HEAD, input('One', { 'notes/a.md': change('# one\n') }));
    const two = await appendLocalCommit(SCOPE, HEAD, input('Two', { 'notes/b.md': change('# b\n') }));
    const three = await appendLocalCommit(SCOPE, HEAD, input('Three', { 'notes/a.md': { notebookId: NOTEBOOK, server: null, deleted: true } }));
    expect(localTextAt(SCOPE, one.id, 'notes/a.md')).toBe(raw('# one\n'));
    expect(localTextAt(SCOPE, two.id, 'notes/a.md')).toBe(raw('# one\n'));
    expect(localTextAt(SCOPE, three.id, 'notes/a.md')).toBeNull();
    expect(localTextAt(SCOPE, one.id, 'notes/b.md')).toBeUndefined();
    expect(localTextOfBlob(SCOPE, await blobId(raw('# one\n')))).toBe(raw('# one\n'));
  });
});

describe('history rows', () => {
  it('lists the commits that changed a path newest first, splitting subject and body', async () => {
    await appendLocalCommit(SCOPE, HEAD, input('One\n\nBody text', { 'notes/a.md': change('# one\n') }));
    await appendLocalCommit(SCOPE, HEAD, input('Other', { 'notes/b.md': change('# b\n') }));
    await appendLocalCommit(SCOPE, HEAD, input('Two', { 'notes/a.md': change('# two\n') }));
    const rows = localHistoryEntries(SCOPE, 'notes/a.md');
    expect(rows.map(row => [row.subject, row.local, row.agent])).toEqual([['Two', true, false], ['One', true, false]]);
    expect(rows[1].body).toBe('Body text');
    expect(rows[1].parents).toEqual([HEAD]);
    expect(rows[0].blob).toBe(await blobId(raw('# two\n')));
  });

  it('lists the versions the commits recorded for a path', async () => {
    const version = { blob: await blobId(raw('# one\n')), commit: 'c'.repeat(40), authored: '2026-10-25T01:00:00.000Z', sequence: 1, date: '2026.10.25', name: 'v3', created: '2026-10-25T01:00:00.000Z' };
    await appendLocalCommit(SCOPE, HEAD, { ...input('One', { 'notes/a.md': change('# one\n') }), version: { path: 'notes/a.md', numberVersion: () => version } });
    expect(localVersions(SCOPE, 'notes/a.md')).toEqual([version]);
    expect(localVersions(SCOPE, 'notes/b.md')).toEqual([]);
  });
});
