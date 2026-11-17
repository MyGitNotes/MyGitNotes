import { type EditionSourceConfig, gitBlobId, liveContentHash, type LiveContext, LiveStaleError, sourceIdentity, StaleRevisionError } from '@mygitnotes/core';
import { describe, expect, it } from 'vitest';
import { liveNotesContract } from './live-notes-contract.js';
import { memoryCommits, memoryEditionSources, type MemoryFiles } from './memory-edition-source.js';
import { memoryLiveClock, memoryLiveNotes } from './memory-live-notes.js';

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const source: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main' };
const repository = sourceIdentity(source);
const editor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const person = (n: number): LiveContext => ({ person: { realm: 'test', userId: `p${n}` }, author: { name: `Person ${n}`, email: `p${n}@example.test` }, request: { headers: {} } });

const setup = () => {
  const files: MemoryFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '# A\n']]);
  const clock = memoryLiveClock();
  const liveNotes = memoryLiveNotes({ editor, repositories: [{ source, files }], clock });
  return { files, clock, liveNotes };
};

liveNotesContract('memory', () => {
  const { clock, liveNotes } = setup();
  return { liveNotes, repository, notebook: 'notes~life', root: 'notes/life', person, type: (id, text, who) => liveNotes.type(repository, id, text, who), setActive: (id, n) => liveNotes.setActive(repository, id, n), advance: ms => clock.advance(ms) };
});

// The same adapter listing each editor's person, as one that commits with the editors' own credentials does, merging texts, and discarding and moving notes.
liveNotesContract('memory (own credentials)', () => {
  const files: MemoryFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '# A\n']]);
  const clock = memoryLiveClock();
  const liveNotes = memoryLiveNotes({ editor, repositories: [{ source, files }], clock, persons: true, merge: true, discard: true, retarget: true });
  return { ownCredentials: true, merges: true, liveNotes, repository, notebook: 'notes~life', root: 'notes/life', person, type: (id, text, who) => liveNotes.type(repository, id, text, who), setActive: (id, n) => liveNotes.setActive(repository, id, n), advance: ms => clock.advance(ms) };
});

describe('the memory live notes', () => {
  const base = { commit: 'a'.repeat(40), blob: 'b'.repeat(40), content: '# A\n' };

  it('covers only its repositories, with its editor', () => {
    const { liveNotes } = setup();
    expect(liveNotes.editors).toEqual([editor]);
    expect(liveNotes.editor(repository)).toEqual(editor);
    expect(liveNotes.editor('edition:hosted:someone/else@main')).toBeNull();
  });

  it('names revisions by session while one is open and by hash otherwise', async () => {
    const { liveNotes } = setup();
    const { checkout } = await liveNotes.person(person(1)).checkout(repository, { notebook: 'notes~life', path: 'notes/life/a.md', base });
    const calls = liveNotes.person(person(1));
    expect((await calls.read(repository, checkout.id)).liveRevision).toBe(`h:${liveContentHash('# A\n')}`);
    liveNotes.setActive(repository, checkout.id, 1);
    liveNotes.type(repository, checkout.id, '# A\nmore\n', person(2));
    const open = await calls.read(repository, checkout.id);
    expect(open.liveRevision).toMatch(/^e\d+:1$/);
    liveNotes.setActive(repository, checkout.id, 0);
    const closed = await calls.read(repository, checkout.id);
    expect(closed.liveRevision).toBe(`h:${liveContentHash('# A\nmore\n')}`);
    // A new session starts from the text the hash names, so a write on that hash still rebases.
    liveNotes.type(repository, checkout.id, '# A\nmore\nagain\n', person(2));
    await calls.write(repository, checkout.id, { content: '# B\nmore\n', baseRevision: closed.liveRevision, agent: true });
    expect((await calls.read(repository, checkout.id)).content).toBe('# B\nmore\nagain\n');
    // A revision of the session that ended cannot be reconstructed.
    await expect(calls.write(repository, checkout.id, { content: 'x', baseRevision: open.liveRevision, agent: true })).rejects.toBeInstanceOf(LiveStaleError);
  });

  it('opens the repository for the service with the given author, records each commit, and shares heads with the person side', async () => {
    const { files, liveNotes } = setup();
    const service = await liveNotes.service.open(repository, { name: 'Person 1', email: 'p1@example.test' });
    const personSide = memoryEditionSources({ repositories: new Map([['p1/notes', files]]) }).open(source, { person: { realm: 'test', userId: 'p1' }, request: { headers: {} } }, undefined, service.config.bind(service));
    const before = await service.getSnapshot(true);
    expect((await personSide.getSnapshot(true)).sha).toBe(before.sha);
    const receipt = await service.commitChanges([{ path: 'notes/life/a.md', content: '# A2\n' }], before.sha, 'update', 'notes', 'docs(notes): live edit a.md');
    expect((await personSide.getSnapshot(true)).sha).toBe(receipt.revision);
    const [commit] = memoryCommits(files).slice(-1);
    expect(commit).toMatchObject({ sha: receipt.revision, parents: [before.sha], author: { name: 'Person 1', email: 'p1@example.test' }, message: 'docs(notes): live edit a.md', paths: ['notes/life/a.md'] });
    // The text the commit replaced stays readable by its blob and through the file's history.
    expect(await service.readHistoryBlob(gitBlobId(Buffer.from('# A\n'), 40))).toEqual({ blob: gitBlobId(Buffer.from('# A\n'), 40), content: '# A\n' });
    expect(await service.readFileAt(before.sha, 'notes/life/a.md')).toMatchObject({ content: '# A\n' });
    const history = await (await liveNotes.service.open(repository)).fileHistory('notes/life/a.md', 1);
    expect(history.entries.map(entry => entry.commit)).toEqual([receipt.revision, before.sha]);
  });

  it('follows a file’s history back through a commit that moved it, edits and all', async () => {
    const { liveNotes } = setup();
    const service = await liveNotes.service.open(repository);
    const first = await service.getSnapshot(true);
    const edited = await service.commitChanges([{ path: 'notes/life/a.md', content: '# A\none\ntwo\nthree\n' }], first.sha, 'edit');
    const moved = await service.commitChanges([{ path: 'notes/life/a.md', sha: null }, { path: 'notes/life/done/b.md', content: '# B\none\ntwo\nthree\n' }], edited.revision, 'move');
    const history = await (await liveNotes.service.open(repository)).fileHistory('notes/life/done/b.md', 1);
    expect(history.entries.map(entry => [entry.commit, entry.path])).toEqual([[moved.revision, 'notes/life/done/b.md'], [edited.revision, 'notes/life/a.md'], [first.sha, 'notes/life/a.md']]);
    expect(await service.readFileAt(edited.revision, history.entries[1].path)).toMatchObject({ content: '# A\none\ntwo\nthree\n' });
  });

  it('refuses a commit on a head that moved, as a provider does', async () => {
    const { liveNotes } = setup();
    const first = await liveNotes.service.open(repository);
    const second = await liveNotes.service.open(repository);
    const snapshot = await first.getSnapshot(true);
    const stale = await second.getSnapshot(true);
    await first.commitChanges([{ path: 'notes/life/a.md', content: '# one\n' }], snapshot.sha, 'update');
    await expect(second.commitChanges([{ path: 'notes/life/a.md', content: '# two\n' }], stale.sha, 'update', 'notes', undefined, stale)).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('keeps the notices it is given', async () => {
    const { liveNotes } = setup();
    await liveNotes.notify!({ kind: 'unfiled', repository, notebook: 'notes~life', path: null, id: 'x', editors: [], message: 'Missing {{kind}}.' });
    expect(liveNotes.notices).toHaveLength(1);
  });
});
