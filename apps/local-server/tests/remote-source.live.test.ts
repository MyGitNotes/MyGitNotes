import { describe, expect, it } from 'vitest';
import { callNoteShell, CheckedOutError, type EditionSourceConfig, gitBlobId, liveContentHash, type LiveContext, liveRepository, MemoryRemoteCache, parseNoteQuery, parseWorkspaceConfig, queryNotes, type RemoteCache, sourceIdentity, workspaceCatalog } from '@mygitnotes/core';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, type MemoryFiles } from '../src/memory-edition-source.js';
import { memoryLiveNotes } from '../src/memory-live-notes.js';

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main' };
const repository = sourceIdentity(edition);
const editor = { origin: 'https://live.example.test', messageType: 'live-status' };
const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
const scope = async () => parseWorkspaceConfig(manifest);
const gitA = '---\ntitle: Git title\ntags: [git]\nstatus: draft\n---\nGit body about apples.\n';
const liveA = '---\ntitle: Live title\ntags: [live]\nstatus: review\n---\nLive body about zebras.\n';

/** A cache that remembers every value written to it, by key. */
function recordingCache(): RemoteCache & { written: Map<string, string>; } {
  const inner = new MemoryRemoteCache();
  const written = new Map<string, string>();
  return {
    written,
    get: keys => inner.get(keys),
    set: async (entries, ttl) => {
      for (const [key, value] of entries) written.set(key, value);
      await inner.set(entries, ttl);
    },
  };
}

function fixture() {
  const files: MemoryFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', gitA], ['notes/life/b.md', '# B\n\nSee [A](a.md).\n'], ['notes/life/c.md', '# C\n']]);
  const liveNotes = memoryLiveNotes({ editor, repositories: [{ source: edition, files }] });
  /** One request's reader: a fresh source with a fresh view, as `openWorkspace` gives each request. */
  const open = (cache?: RemoteCache, live = true) => {
    const source = new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), cache, scope);
    if (live) source.useLive(liveRepository({ liveNotes, context: pat, repository, alias: 'notes', notebooks: async () => (await scope()).notebooks })!);
    return source;
  };
  const checkout = async (file: string) => {
    const content = files.get(file)!;
    const { checkout: row } = await liveNotes.person(pat).checkout(repository, { notebook: 'notes~life', path: file, base: { commit: 'a'.repeat(40), blob: gitBlobId(Buffer.from(content), 40), content } });
    return row.id;
  };
  return { files, liveNotes, open, checkout };
}

const life = async () => (await scope()).notebooks[0];

describe('reading checked-out notes', () => {
  it('shows the live title, tags, status and text in note() and the catalog, and searches live-only words', async () => {
    const { liveNotes, open, checkout } = fixture();
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, liveA, pat);
    const reader = open();
    const note = await reader.note('notes/life/a.md');
    expect(note).toMatchObject({ title: 'Live title', tags: ['live'], status: 'review', content: 'Live body about zebras.\n', live: { activeEditors: expect.any(Number), editorUrl: expect.stringMatching(/^https:\/\/live\.example\.test\//) } });
    expect(note.revision).toBe((await reader.getSnapshot()).sha);
    const index = await reader.catalog().index(await life());
    expect(index.find(item => item.path === 'notes/life/a.md')).toMatchObject({ title: 'Live title', tags: ['live'], status: 'review', live: expect.objectContaining({ since: expect.any(String) }) });
    expect(index.find(item => item.path === 'notes/life/c.md')?.live).toBeUndefined();
    const contents = await reader.catalog().contents(index.filter(item => item.path === 'notes/life/a.md'));
    expect(contents.get('notes/life/a.md')).toBe('Live body about zebras.\n');
    const nb = await life();
    const catalog = await workspaceCatalog({ ...await scope(), notebooks: [nb] }, [{ id: repository, alias: 'notes', notebooks: [nb], catalog: open().catalog() }]);
    const { query, options } = parseNoteQuery({ notebookId: 'notes~life', q: 'zebras' });
    expect((await queryNotes(catalog, query, options)).notes.map(item => item.path)).toEqual(['notes/life/a.md']);
    const apples = parseNoteQuery({ notebookId: 'notes~life', q: 'apples' });
    expect((await queryNotes(catalog, apples.query, apples.options)).notes).toEqual([]);
    // Bulk reads see the live text too, and the shell's read answers it by path.
    expect((await open().notes()).find(item => item.path === 'notes/life/a.md')?.title).toBe('Live title');
    expect((await callNoteShell(open(), 'read', { path: 'notes/life/a.md' }, false)).content).toBe(liveA);
  });

  it('lists pending live notes at their virtual paths', async () => {
    const { liveNotes, open } = fixture();
    const pending = await liveNotes.person(pat).createPending(repository, { notebook: 'notes~life', pathRule: '{{title}}.md', content: '# Meeting\n\nnotes\n' });
    const virtual = `notes/life/.live/${pending.id}.md`;
    const reader = open();
    expect(await reader.notePaths(await life())).toContain(virtual);
    expect((await reader.catalog().index(await life())).find(item => item.path === virtual)).toMatchObject({ title: 'Meeting', live: { pending: true } });
    expect((await reader.notes()).some(item => item.path === virtual)).toBe(true);
    expect(await open().note(virtual)).toMatchObject({ title: 'Meeting', live: { pending: true } });
  });

  it('keeps Git text in the index cache, and recomputes a memo when a live hash changes', async () => {
    const { liveNotes, open, checkout } = fixture();
    const cache = recordingCache();
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, liveA, pat);
    await open(cache).catalog().index(await life());
    const indexValues = [...cache.written].filter(([key]) => key.startsWith('mgn:index:')).map(([, value]) => value);
    expect(indexValues.length).toBe(1);
    expect(indexValues[0]).toContain('Git title');
    expect(indexValues[0]).not.toContain('Live title');
    // Every live text in the cache sits under its own hash.
    const liveEntries = [...cache.written].filter(([key]) => key.startsWith('mgn:live:'));
    expect(liveEntries.length).toBeGreaterThan(0);
    for (const [key, value] of liveEntries) expect(key.endsWith(`:${liveContentHash(value)}`)).toBe(true);
    let computed = 0;
    const compute = async () => ++computed;
    await open(cache).catalog().memo('probe', [await life()], compute);
    await open(cache).catalog().memo('probe', [await life()], compute);
    expect(computed).toBe(1);
    liveNotes.type(repository, id, `${liveA}more\n`, pat);
    await open(cache).catalog().memo('probe', [await life()], compute);
    expect(computed).toBe(2);
  });
});

describe('writing around checked-out notes', () => {
  it('refuses a commit that touches a checked-out path, naming it, and publishes nothing', async () => {
    const { files, open, checkout } = fixture();
    await checkout('notes/life/a.md');
    const reader = open();
    const head = (await reader.getSnapshot()).sha;
    const before = memoryCommits(files).length;
    const refused = await reader.commitChanges([{ path: 'notes/life/a.md', content: '# Overwritten\n' }, { path: 'notes/life/c.md', content: '# C2\n' }], head, 'update').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CheckedOutError);
    expect(refused).toMatchObject({ status: 409, code: 'checked-out', paths: ['notes/life/a.md'] });
    expect(memoryCommits(files).length).toBe(before);
    expect(files.get('notes/life/a.md')).toBe(gitA);
    expect(files.get('notes/life/c.md')).toBe('# C\n');
    // A note that is not checked out still commits as before.
    await expect(open().commitChanges([{ path: 'notes/life/c.md', content: '# C2\n' }], head, 'update')).resolves.toMatchObject({ committed: true });
  });

  it('refuses a move that would rewrite the links of a checked-out note', async () => {
    const { files, open, checkout } = fixture();
    await checkout('notes/life/b.md');
    const reader = open();
    const revision = (await reader.getSnapshot()).sha;
    const refused = await callNoteShell(reader, 'mv', { source: 'notes/life/a.md', destination: 'notes/life/moved.md', revision }, true).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CheckedOutError);
    expect((refused as CheckedOutError).paths).toEqual(['notes/life/b.md']);
    expect(files.has('notes/life/a.md')).toBe(true);
    expect(files.has('notes/life/moved.md')).toBe(false);
  });

  it('reads and writes Git alone without a live view', async () => {
    const { liveNotes, open, checkout } = fixture();
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, liveA, pat);
    const reader = open(undefined, false);
    expect((await reader.note('notes/life/a.md')).title).toBe('Git title');
    expect((await reader.note('notes/life/a.md')).live).toBeUndefined();
  });
});
