import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkInLink, type EditionSourceConfig, gitBlobId, type LiveCheckInOptions, liveContentHash, type LiveContext, normalizeLiveText, parseWorkspaceConfig, sourceIdentity, sweepLive } from '@mygitnotes/core';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, type MemoryFiles } from '../src/memory-edition-source.js';
import { type MemoryLiveClock, memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const repository = sourceIdentity(edition);
const editor = { origin: 'https://live.example.test', messageType: 'live-status' };
const person = (n: number): LiveContext => ({ person: { realm: 'edition', userId: `p${n}` }, author: { name: `Person ${n}`, email: `p${n}@example.test` }, request: { headers: {} } });

let files: MemoryFiles, clock: MemoryLiveClock, liveNotes: MemoryLiveNotes;

const scope = async () => parseWorkspaceConfig(manifest);
const git = () => new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, scope);
/** A commit someone makes in Git directly: a new text, or a deletion with null. */
const gitCommit = async (file: string, content: string | null) => {
  const source = git();
  const snapshot = await source.getSnapshot(true);
  return (await source.commitChanges([content === null ? { path: file, sha: null } : { path: file, content }], snapshot.sha, 'write', 'notes', undefined, snapshot)).revision;
};
const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
const checkout = async (file: string) => {
  const snapshot = await git().getSnapshot(true);
  const content = files.get(file)!;
  const { checkout: row } = await liveNotes.person(person(1)).checkout(repository, { notebook: 'notes~life', path: file, base: { commit: snapshot.sha, blob: gitBlobId(Buffer.from(content), 40), content: normalizeLiveText(content) } });
  return row.id;
};
const liveText = async (id: string) => (await liveNotes.person(person(1)).read(repository, id)).content;
const run = (id: string, options: Partial<LiveCheckInOptions> = {}) => checkInLink(liveNotes, repository, id, { mode: 'manual', now: clock.now, timeZone: 'Asia/Taipei', sleep: async () => {}, ...options });

beforeEach(() => {
  files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '---\ntitle: A\n---\none\ntwo\nthree\nfour\nfive\n']]);
  // 20:00 UTC is 04:00 the next day in Taipei.
  clock = memoryLiveClock(Date.parse('2026-11-14T20:00:00.000Z'));
  liveNotes = memoryLiveNotes({ editor, repositories: [{ source: edition, files }], clock });
});

describe('checkInLink', () => {
  it('only acknowledges a note nobody changed', async () => {
    const id = await checkout('notes/life/a.md');
    expect(await run(id)).toEqual({ id, path: 'notes/life/a.md', committed: false, released: true });
    expect(commits()).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
  });

  it('takes the newer Git text into a note nobody changed, as in 0.20, when a credential opens the repository (cf14-F003)', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.setActive(repository, id, 1);
    const newer = '---\ntitle: A\n---\nONE\ntwo\nthree\nfour\nfive\n';
    await gitCommit('notes/life/a.md', newer);
    expect(await run(id, { mode: 'scheduled' })).toMatchObject({ committed: false, released: false, reason: 'active' });
    expect(await liveText(id)).toBe(newer);
    expect(commits()).toHaveLength(1);
  });

  it('writes back a note nobody changed that was deleted in Git, as in 0.20 (cf14-F003)', async () => {
    const id = await checkout('notes/life/a.md');
    const text = files.get('notes/life/a.md')!;
    await gitCommit('notes/life/a.md', null);
    expect(await run(id)).toMatchObject({ committed: true, conflict: { kind: 'deleted' } });
    expect(files.get('notes/life/a.md')).toBe(text);
  });

  it('commits the live text on an unmoved head, authored by the person who typed last with the others and the live trailers', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '---\ntitle: A\n---\none\nTWO\nthree\nfour\nfive\n', person(1));
    clock.advance(1000);
    liveNotes.type(repository, id, '---\ntitle: A\n---\none\nTWO\nTHREE\nfour\nfive\n', person(2));
    clock.advance(1000);
    const current = await liveNotes.person(person(3)).read(repository, id);
    await liveNotes.person(person(3)).write(repository, id, { content: `${current.content}agent line\n`, baseRevision: current.liveRevision, agent: true });
    const text = await liveText(id);
    const result = await run(id);
    expect(result).toMatchObject({ id, path: 'notes/life/a.md', committed: true, released: true, commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(files.get('notes/life/a.md')).toBe(text);
    const [commit] = commits();
    // The agent wrote last, but a person who typed comes before it.
    expect(commit.author).toEqual({ name: 'Person 2', email: 'p2@example.test' });
    expect(commit.message).toBe(`docs(notes): live edit a.md\n\nLive-Link: ${id}\nLive-Content: sha256:${liveContentHash(text)}\nAgent-Edit: 2026-11-14\nCo-authored-by: Person 1 <p1@example.test>\nCo-authored-by: Person 3 <p3@example.test>`);
  });

  it('merges Git changes into the live note before committing, so the next check-in keeps them', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.setActive(repository, id, 1);
    liveNotes.type(repository, id, '---\ntitle: A\n---\none\ntwo\nthree\nfour\nFIVE\n', person(1));
    await gitCommit('notes/life/a.md', '---\ntitle: A\n---\nONE\ntwo\nthree\nfour\nfive\n');
    const mergeIn = liveNotes.service.mergeIn.bind(liveNotes.service);
    const commitsAtMerge: number[] = [];
    vi.spyOn(liveNotes.service, 'mergeIn').mockImplementation(async (...args) => {
      commitsAtMerge.push(commits().length);
      return mergeIn(...args);
    });
    const merged = '---\ntitle: A\n---\nONE\ntwo\nthree\nfour\nFIVE\n';
    expect(await run(id, { mode: 'scheduled' })).toMatchObject({ committed: true, released: false, reason: 'active', activeEditors: 1 });
    expect(commitsAtMerge).toEqual([1]);
    expect(await liveText(id)).toBe(merged);
    expect(files.get('notes/life/a.md')).toBe(merged);
    // Typed on after the check-in: the next one starts from the merged text and keeps Git's change.
    liveNotes.type(repository, id, '---\ntitle: A\n---\nONE\ntwo\nTHREE\nfour\nFIVE\n', person(1));
    clock.advance(6 * 60_000);
    expect(await run(id, { mode: 'scheduled' })).toMatchObject({ committed: true });
    expect(files.get('notes/life/a.md')).toBe('---\ntitle: A\n---\nONE\ntwo\nTHREE\nfour\nFIVE\n');
  });

  it('names someone who typed between the merge-in and the text it commits, as its author since they typed last', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '---\ntitle: A\n---\none\ntwo\nthree\nfour\nFIVE\n', person(1));
    await gitCommit('notes/life/a.md', '---\ntitle: A\n---\nONE\ntwo\nthree\nfour\nfive\n');
    const mergeIn = liveNotes.service.mergeIn.bind(liveNotes.service);
    vi.spyOn(liveNotes.service, 'mergeIn').mockImplementation(async (...args) => {
      const answer = await mergeIn(...args);
      clock.advance(1000);
      liveNotes.type(repository, id, '---\ntitle: A\n---\nONE\ntwo\nthree\nfour\nFIVE\nsix\n', person(2));
      return answer;
    });
    expect(await run(id)).toMatchObject({ committed: true });
    expect(files.get('notes/life/a.md')).toBe('---\ntitle: A\n---\nONE\ntwo\nthree\nfour\nFIVE\nsix\n');
    const commit = commits().at(-1)!;
    expect(commit.author).toEqual({ name: 'Person 2', email: 'p2@example.test' });
    expect(commit.message).toContain('Co-authored-by: Person 1 <p1@example.test>');
  });

  it('authors a merged check-in by the person who typed last, even when they typed only after the merge-in', async () => {
    const id = await checkout('notes/life/a.md');
    await gitCommit('notes/life/a.md', '---\ntitle: A\n---\nONE\ntwo\nthree\nfour\nfive\n');
    // An agent wrote first, so the live text differs from Git and needs Git's change merged in.
    const current = await liveNotes.person(person(3)).read(repository, id);
    await liveNotes.person(person(3)).write(repository, id, { content: current.content.replace('five', 'FIVE'), baseRevision: current.liveRevision, agent: true });
    const mergeIn = liveNotes.service.mergeIn.bind(liveNotes.service);
    vi.spyOn(liveNotes.service, 'mergeIn').mockImplementation(async (...args) => {
      const answer = await mergeIn(...args);
      clock.advance(1000);
      liveNotes.type(repository, id, '---\ntitle: A\n---\nONE\ntwo\nthree\nfour\nFIVE\nsix\n', person(2));
      return answer;
    });
    expect(await run(id)).toMatchObject({ committed: true });
    const commit = commits().at(-1)!;
    expect(commit.author).toEqual({ name: 'Person 2', email: 'p2@example.test' });
    expect(commit.message).toContain('Co-authored-by: Person 3 <p3@example.test>');
  });

  it('merges a note over 1 MiB like any other', async () => {
    const body = Array.from({ length: 45_000 }, (_, i) => `line ${i} of a long note\n`).join('');
    expect(Buffer.byteLength(body)).toBeGreaterThan(1024 * 1024);
    files.set('notes/life/long.md', `# Long\n${body}end\n`);
    const id = await checkout('notes/life/long.md');
    liveNotes.type(repository, id, `# Long\n${body}END\n`, person(1));
    await gitCommit('notes/life/long.md', `# Longer\n${body}end\n`);
    const result = await run(id);
    expect(result).toMatchObject({ committed: true, released: true });
    expect(result.conflict).toBeUndefined();
    expect(files.get('notes/life/long.md')).toBe(`# Longer\n${body}END\n`);
    expect(liveNotes.notices).toEqual([]);
  });

  it('lets the live text win a conflict, names what it overwrote and notifies', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '---\ntitle: A\n---\none\nLIVE\nthree\nfour\nfive\n', person(1));
    const overwritten = await gitCommit('notes/life/a.md', '---\ntitle: A\n---\none\nGIT\nthree\nfour\nfive\n');
    const result = await run(id);
    expect(result).toMatchObject({ committed: true, released: true, conflict: { kind: 'overwrote', overwritten, commit: result.commit } });
    expect(files.get('notes/life/a.md')).toBe('---\ntitle: A\n---\none\nLIVE\nthree\nfour\nfive\n');
    expect(commits().at(-1)!.message).toContain(`\nLive-Overwrote: ${overwritten}`);
    expect(liveNotes.notices).toEqual([expect.objectContaining({ kind: 'conflict', repository, notebook: 'notes~life', path: 'notes/life/a.md', id, commit: result.commit, overwritten, editors: [{ name: 'Person 1' }] })]);
  });

  it('writes back a note deleted in Git and reports the deletion', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '# Kept live\n', person(1));
    const deletion = await gitCommit('notes/life/a.md', null);
    const result = await run(id);
    expect(result).toMatchObject({ committed: true, conflict: { kind: 'deleted', overwritten: deletion } });
    expect(files.get('notes/life/a.md')).toBe('# Kept live\n');
    expect(liveNotes.notices).toEqual([expect.objectContaining({ kind: 'deleted', overwritten: deletion })]);
  });

  it('files a pending note by its rule: the frontmatter date, a -2 on a taken path, and the date of since in the time zone', async () => {
    files.set('notes/life/meetings/2026-11-10 Sync.md', '# Taken\n');
    const calls = liveNotes.person(person(1));
    const dated = await calls.createPending(repository, { notebook: 'notes~life', pathRule: 'meetings/{{date}} {{title}}.md', content: '---\ntitle: Sync\ndate: 2026-11-10\n---\nAgenda\n' });
    const undated = await calls.createPending(repository, { notebook: 'notes~life', pathRule: 'inbox/{{date}} {{title}}', content: '# Plain\n' });
    const first = await run(dated.id);
    expect(first).toMatchObject({ path: 'notes/life/meetings/2026-11-10 Sync-2.md', committed: true, released: true, filed: true });
    expect(files.get('notes/life/meetings/2026-11-10 Sync-2.md')).toBe('---\ntitle: Sync\ndate: 2026-11-10\n---\nAgenda\n');
    expect(commits().at(-1)!.message.split('\n')[0]).toBe('docs(notes): file live note 2026-11-10 Sync-2.md');
    expect(await calls.filed(repository, dated.id)).toBe('notes/life/meetings/2026-11-10 Sync-2.md');
    // since is 2026-11-14T20:00Z, which is the 15th in Taipei.
    expect(await run(undated.id)).toMatchObject({ path: 'notes/life/inbox/2026-11-15 Plain.md', committed: true });
  });

  it('leaves a pending note open, and notifies, when its rule needs a value the note lacks', async () => {
    const pending = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: '{{kind}}/{{title}}.md', content: '# Untyped\n' });
    expect(await run(pending.id)).toEqual({ id: pending.id, path: null, committed: false, released: false, reason: 'unfiled' });
    expect(commits()).toEqual([]);
    expect(liveNotes.notices).toEqual([expect.objectContaining({ kind: 'unfiled', id: pending.id, path: null })]);
    expect((await liveNotes.service.checkouts(repository)).map(row => [row.id, row.path])).toEqual([[pending.id, null]]);
  });

  it('leaves a pending note whose title makes the path too long unfiled, and the sweep reports no failure', async () => {
    const pending = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: 'inbox/{{title}}.md', content: `# ${'會議'.repeat(40)}\n` });
    const report = await sweepLive(liveNotes, { instant: new Date(clock.now() + 1000), now: clock.now });
    expect(report.failed).toEqual([]);
    expect(report.results).toEqual([{ id: pending.id, path: null, committed: false, released: false, reason: 'unfiled' }]);
    expect(liveNotes.notices).toEqual([expect.objectContaining({ kind: 'unfiled', id: pending.id, message: expect.stringContaining('too long') })]);
    expect(commits()).toEqual([]);
  });

  it('commits a CRLF note in LF', async () => {
    files.set('notes/life/crlf.md', 'one\r\ntwo\r\n');
    const id = await checkout('notes/life/crlf.md');
    liveNotes.type(repository, id, 'one\ntwo\nthree\n', person(1));
    expect(await run(id)).toMatchObject({ committed: true });
    expect(files.get('notes/life/crlf.md')).toBe('one\ntwo\nthree\n');
  });

  it('makes no second commit after a crash between the commit and its acknowledgement', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '# Typed\n', person(1));
    vi.spyOn(liveNotes.service, 'synced').mockRejectedValueOnce(new Error('connection reset'));
    await expect(run(id)).rejects.toThrow('Live editor unavailable.');
    expect(commits().length).toBe(1);
    // The lease of the lost run expires.
    clock.advance(5 * 60_000 + 1);
    expect(await run(id)).toMatchObject({ committed: false, released: true });
    expect(commits().length).toBe(1);
  });

  it('commits typing after a lost acknowledgement over its own check-in, with no conflict', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '---\ntitle: A\n---\none\nTWO\nthree\nfour\nfive\n', person(1));
    vi.spyOn(liveNotes.service, 'synced').mockRejectedValueOnce(new Error('connection reset'));
    await expect(run(id)).rejects.toThrow('Live editor unavailable.');
    // Typed at the same lines the lost check-in committed.
    liveNotes.type(repository, id, '---\ntitle: A\n---\none\nTWO!\nthree\nfour\nfive\n', person(1));
    clock.advance(5 * 60_000 + 1);
    const result = await run(id);
    expect(result).toMatchObject({ committed: true, released: true });
    expect(result.conflict).toBeUndefined();
    expect(files.get('notes/life/a.md')).toBe('---\ntitle: A\n---\none\nTWO!\nthree\nfour\nfive\n');
    expect(commits().at(-1)!.message).not.toContain('Live-Overwrote');
    expect(liveNotes.notices).toEqual([]);
  });

  it('files a pending note once when the acknowledgement of its filing is lost, however often', async () => {
    const pending = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: 'inbox/{{title}}.md', content: '# Meeting\n' });
    vi.spyOn(liveNotes.service, 'synced').mockRejectedValueOnce(new Error('connection reset')).mockRejectedValueOnce(new Error('connection reset'));
    for (let lost = 0; lost < 2; lost++) {
      await expect(run(pending.id)).rejects.toThrow('Live editor unavailable.');
      // The lease of the lost run expires.
      clock.advance(5 * 60_000 + 1);
    }
    expect(await run(pending.id)).toEqual({ id: pending.id, path: 'notes/life/inbox/Meeting.md', committed: false, released: true, filed: true });
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/inbox/Meeting.md']]);
    expect([...files.keys()].filter(file => file.includes('/inbox/'))).toEqual(['notes/life/inbox/Meeting.md']);
    expect(await liveNotes.person(person(1)).filed(repository, pending.id)).toBe('notes/life/inbox/Meeting.md');
  });

  it('files a pending note beside another note that holds the same text, never into it', async () => {
    await gitCommit('notes/life/inbox/Meeting.md', '# Meeting\n');
    const pending = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: 'inbox/{{title}}.md', content: '# Meeting\n' });
    expect(await run(pending.id)).toMatchObject({ path: 'notes/life/inbox/Meeting-2.md', committed: true, filed: true });
    expect(files.get('notes/life/inbox/Meeting-2.md')).toBe('# Meeting\n');
    expect(await liveNotes.person(person(1)).filed(repository, pending.id)).toBe('notes/life/inbox/Meeting-2.md');
  });

  it('commits typing after a lost filing acknowledgement at the path it filed, with no conflict', async () => {
    const pending = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: 'inbox/{{title}}.md', content: '# Meeting\n' });
    vi.spyOn(liveNotes.service, 'synced').mockRejectedValueOnce(new Error('connection reset'));
    await expect(run(pending.id)).rejects.toThrow('Live editor unavailable.');
    liveNotes.type(repository, pending.id, '# Meeting\n\nAgreed.\n', person(1));
    clock.advance(5 * 60_000 + 1);
    const result = await run(pending.id);
    expect(result).toMatchObject({ path: 'notes/life/inbox/Meeting.md', committed: true, released: true, filed: true });
    expect(result.conflict).toBeUndefined();
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/inbox/Meeting.md'], ['notes/life/inbox/Meeting.md']]);
    expect(files.get('notes/life/inbox/Meeting.md')).toBe('# Meeting\n\nAgreed.\n');
    expect(commits().at(-1)!.message).not.toContain('Live-Overwrote');
    expect(liveNotes.notices).toEqual([]);
  });

  it('makes one commit when two sweeps run at once', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '# Typed\n', person(1));
    const instant = new Date(clock.now() + 1000);
    const reports = await Promise.all([sweepLive(liveNotes, { instant, now: clock.now }), sweepLive(liveNotes, { instant, now: clock.now })]);
    expect(commits().length).toBe(1);
    expect(reports.flatMap(report => report.results).filter(result => result.committed)).toHaveLength(1);
    expect(reports.flatMap(report => report.failed)).toEqual([]);
  });

  it('retries a release refused as active three times by hand and leaves it to the next tick when scheduled', async () => {
    files.set('notes/life/b.md', '# B\n');
    const manual = await checkout('notes/life/a.md');
    const scheduled = await checkout('notes/life/b.md');
    for (const id of [manual, scheduled]) {
      liveNotes.type(repository, id, '# Typed\n', person(1));
      liveNotes.setActive(repository, id, 2);
    }
    const release = vi.spyOn(liveNotes.service, 'release');
    const sleep = vi.fn(async () => {});
    expect(await run(manual, { sleep })).toMatchObject({ committed: true, released: false, reason: 'active', activeEditors: 2 });
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledTimes(4);
    release.mockClear();
    sleep.mockClear();
    expect(await run(scheduled, { mode: 'scheduled', sleep })).toMatchObject({ committed: true, released: false, reason: 'active' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('reads and commits again once when the head moves during the check-in', async () => {
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '# Typed\n', person(1));
    const open = liveNotes.service.open.bind(liveNotes.service);
    const opened = vi.spyOn(liveNotes.service, 'open').mockImplementationOnce(async (...args) => {
      const source = await open(...args);
      const read = source.getSnapshot.bind(source);
      source.getSnapshot = async fresh => {
        const snapshot = await read(fresh);
        // Someone commits another note between this check-in's read and its commit.
        await gitCommit('notes/life/other.md', '# Other\n');
        source.getSnapshot = read;
        return snapshot;
      };
      return source;
    });
    expect(await run(id)).toMatchObject({ committed: true, released: true });
    expect(opened).toHaveBeenCalledTimes(2);
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/other.md'], ['notes/life/a.md']]);
    expect(files.get('notes/life/a.md')).toBe('# Typed\n');
  });
});
