import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { checkInLink, type CommitAuthor, type EditionSourceConfig, gitBlobId, liveAdapterError, type LiveCheckInOptions, type LiveContext, LiveCredentialError, normalizeLiveText, parseWorkspaceConfig, type RemoteSource, SourceError, sourceIdentity, sweepIdleLive, type WorkspaceConfigSource, type WorkspacePerson } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { bearerGrantRecord, type IdentityService } from '../src/identity.js';
import { type BuiltinFixture, builtinFixture, edition as hosted, manifest as hostedManifest, repository as hostedRepository, shutdownFixtures } from '../src/live-builtin/test-fixture.js';
import { memoryEditionSources } from '../src/memory-edition-source.js';
import { createRecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, type MemoryFiles } from '../src/memory-edition-source.js';
import { type MemoryLiveClock, memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';

/*
 * Check-ins with the editors' own credentials (docs/specs/2026-11-16-collab-first-self-host A6, slice S2): the engine
 * opens the repository as one editor after another until one may commit, and a refused credential never costs its
 * editor the credit.
 */

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const repository = sourceIdentity(edition);
const editor = { origin: 'https://live.example.test', messageType: 'live-status' };
const who = (n: number): WorkspacePerson => ({ realm: 'edition', userId: `p${n}` });
const author = (n: number): CommitAuthor => ({ name: `Person ${n}`, email: `p${n}@example.test` });
const person = (n: number): LiveContext => ({ person: who(n), author: author(n), request: { headers: {} } });
const file = 'notes/life/a.md';
const A = '---\ntitle: A\n---\none\ntwo\n';

let files: MemoryFiles, clock: MemoryLiveClock, liveNotes: MemoryLiveNotes;

const git = () => new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, async () => parseWorkspaceConfig(manifest));
const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
const checkout = async () => {
  const snapshot = await git().getSnapshot(true);
  const { checkout: row } = await liveNotes.person(person(1)).checkout(repository, { notebook: 'notes~life', path: file, base: { commit: snapshot.sha, blob: gitBlobId(Buffer.from(A), 40), content: normalizeLiveText(A) } });
  return row.id;
};
const run = (id: string, options: Partial<LiveCheckInOptions> = {}) => checkInLink(liveNotes, repository, id, { mode: 'manual', now: clock.now, timeZone: 'Asia/Taipei', sleep: async () => {}, ...options });
/** Two people typed, the first a second before the other. */
const typedByTwo = async () => {
  const id = await checkout();
  liveNotes.type(repository, id, `${A}three\n`, person(1));
  clock.advance(1000);
  liveNotes.type(repository, id, `${A}three\nfour\n`, person(2));
  return id;
};
/** Records every `service.open`, and lets `refuse` say what happens to one: throw at once, or hand out a source that fails later. */
const opening = (change: (person: WorkspacePerson | undefined, source: RemoteSource) => void = () => {}) => {
  const opens: { author: CommitAuthor | undefined; person: WorkspacePerson | undefined; arguments: number; }[] = [];
  const open = liveNotes.service.open.bind(liveNotes.service);
  vi.spyOn(liveNotes.service, 'open').mockImplementation(async (...args) => {
    const [, by, as] = args;
    opens.push({ author: by, person: as?.person, arguments: args.length });
    const source = await open(...args);
    change(as?.person, source);
    return source;
  });
  return opens;
};
const is = (n: number) => (candidate: WorkspacePerson | undefined) => candidate?.userId === `p${n}`;
/** The source's commits are refused by the provider with `status`. */
const refuseCommit = (source: RemoteSource, status: number) => void vi.spyOn(source, 'commitChanges').mockRejectedValue(new SourceError('The provider refused the commit.', status));

beforeEach(() => {
  files = new Map([['.mygitnotes.yaml', manifest], [file, A]]);
  clock = memoryLiveClock(Date.parse('2026-11-16T02:00:00.000Z'));
  liveNotes = memoryLiveNotes({ editor, repositories: [{ source: edition, files }], clock, persons: true, discard: true });
});

describe('the credential a check-in commits with', () => {
  it("is the first editor's while it works: they author the commit and everyone else is a co-author", async () => {
    const id = await typedByTwo();
    const opens = opening();
    expect(await run(id)).toMatchObject({ committed: true, released: true });
    expect(opens).toEqual([{ author: author(1), person: who(1), arguments: 3 }]);
    expect(commits()).toHaveLength(1);
    expect(commits()[0].author).toEqual(author(1));
    expect(commits()[0].message.split('\n').filter(line => line.startsWith('Co-authored-by:'))).toEqual(['Co-authored-by: Person 2 <p2@example.test>']);
  });

  it('is the next editor’s when opening the repository as the first is refused, and the first is still credited', async () => {
    const id = await typedByTwo();
    const opens = opening(candidate => {
      if (is(1)(candidate)) throw new LiveCredentialError();
    });
    expect(await run(id)).toMatchObject({ committed: true, released: true });
    expect(opens.map(open => open.person)).toEqual([who(1), who(2)]);
    expect(opens[1].author).toEqual(author(2));
    expect(commits()).toHaveLength(1);
    expect(commits()[0].author).toEqual(author(2));
    expect(commits()[0].message.split('\n').filter(line => line.startsWith('Co-authored-by:'))).toEqual(['Co-authored-by: Person 1 <p1@example.test>']);
    expect(liveNotes.notices).toEqual([]);
    expect(files.get(file)).toBe(`${A}three\nfour\n`);
  });

  it.each([401, 403, 404])("is the next editor's when the provider refuses the first editor's commit with %i", async status => {
    const id = await typedByTwo();
    const opens = opening((candidate, source) => {
      if (is(1)(candidate)) refuseCommit(source, status);
    });
    expect(await run(id)).toMatchObject({ committed: true, released: true });
    expect(opens.map(open => open.person)).toEqual([who(1), who(2)]);
    expect(commits().map(commit => commit.author)).toEqual([author(2)]);
    expect(commits()[0].message).toContain('Co-authored-by: Person 1 <p1@example.test>');
  });

  it("throws a failure that is not a credential's, and tries nobody else", async () => {
    const id = await typedByTwo();
    const opens = opening((_candidate, source) => refuseCommit(source, 500));
    await expect(run(id)).rejects.toMatchObject({ status: 500 });
    expect(opens.map(open => open.person)).toEqual([who(1)]);
    expect(commits()).toEqual([]);
    expect(liveNotes.notices).toEqual([]);
  });

  it('commits nothing when no editor may: the text stays live, uncommittable is notified, and a later check-in commits once someone may again', async () => {
    const id = await typedByTwo();
    let refused = true;
    const opens = opening(() => {
      if (refused) throw new LiveCredentialError();
    });
    expect(await run(id, { mode: 'scheduled' })).toEqual({ id, path: file, committed: false, released: false, reason: 'uncommittable' });
    expect(opens.map(open => open.person)).toEqual([who(1), who(2)]);
    expect(commits()).toEqual([]);
    expect(files.get(file)).toBe(A);
    expect((await liveNotes.person(person(1)).read(repository, id)).content).toBe(`${A}three\nfour\n`);
    expect(liveNotes.notices).toEqual([{ kind: 'uncommittable', repository, notebook: 'notes~life', path: file, id, editors: [{ name: 'Person 1' }, { name: 'Person 2' }], message: expect.stringMatching(/could not be committed/) }]);
    // The idle tick tries again, and commits once the first editor's credential works again.
    clock.advance(6 * 60_000);
    expect(await sweepIdleLive(liveNotes, { now: clock.now, sleep: async () => {} })).toMatchObject({ due: 1, results: [{ id, reason: 'uncommittable' }], failed: [] });
    refused = false;
    clock.advance(6 * 60_000);
    expect(await sweepIdleLive(liveNotes, { now: clock.now, sleep: async () => {} })).toMatchObject({ due: 1, results: [{ id, committed: true, released: true }] });
    expect(commits().map(commit => commit.author)).toEqual([author(1)]);
  });

  it('lets an editor without a verified email author through their own token, and names them nowhere when another commits', async () => {
    const id = await checkout();
    // As a GitLab or GitHub Enterprise person is shown: a name, and no email to credit them by.
    const nameless: LiveContext = { person: who(1), live: { name: 'gl-user' }, request: { headers: {} } };
    liveNotes.type(repository, id, `${A}three\n`, nameless);
    clock.advance(1000);
    liveNotes.type(repository, id, `${A}three\nfour\n`, person(2));
    const opens = opening();
    const result = await run(id, { mode: 'scheduled' });
    expect(result).toEqual({ id, path: file, committed: true, commit: expect.any(String), released: true });
    // No author is given: the provider records the account of the token the commit was made with.
    expect(opens).toEqual([{ author: undefined, person: who(1), arguments: 3 }]);
    expect(commits()[0].author).toBeUndefined();
    expect(commits()[0].message).toContain('Co-authored-by: Person 2 <p2@example.test>');
  });

  it('skips an editor without a verified email when another editor commits: they cannot be a co-author', async () => {
    const id = await checkout();
    liveNotes.type(repository, id, `${A}three\n`, { person: who(1), live: { name: 'gl-user' }, request: { headers: {} } });
    clock.advance(1000);
    liveNotes.type(repository, id, `${A}three\nfour\n`, person(2));
    opening(candidate => {
      if (is(1)(candidate)) throw new LiveCredentialError();
    });
    expect(await run(id)).toMatchObject({ committed: true, released: true, skippedEditors: ['gl-user'] });
    expect(commits()[0].author).toEqual(author(2));
    expect(commits()[0].message).not.toContain('Co-authored-by');
  });

  it('tries each person once: the agent of someone who typed adds no second try, and an agent alone commits as its person', async () => {
    const id = await typedByTwo();
    const read = await liveNotes.person(person(1)).read(repository, id);
    await liveNotes.person(person(1)).write(repository, id, { content: `${read.content}agent\n`, baseRevision: read.liveRevision, agent: true });
    const opens = opening(() => {
      throw new LiveCredentialError();
    });
    expect(await run(id, { mode: 'scheduled' })).toMatchObject({ reason: 'uncommittable' });
    expect(opens.map(open => open.person)).toEqual([who(1), who(2)]);
    vi.restoreAllMocks();
    clock.advance(6 * 60_000);
    const alone = opening();
    expect(await run(id)).toMatchObject({ committed: true, released: true });
    expect(alone).toEqual([{ author: author(1), person: who(1), arguments: 3 }]);
  });

  it('takes the person who asks for the check-in as the last candidate, credited as its author, with every editor a co-author', async () => {
    const id = await typedByTwo();
    const opens = opening(candidate => {
      if (!is(3)(candidate)) throw new LiveCredentialError();
    });
    expect(await run(id, { requester: { person: who(3), author: author(3) } })).toMatchObject({ committed: true, released: true });
    expect(opens.map(open => open.person)).toEqual([who(1), who(2), who(3)]);
    expect(commits()[0].author).toEqual(author(3));
    expect(commits()[0].message.split('\n').filter(line => line.startsWith('Co-authored-by:'))).toEqual(['Co-authored-by: Person 1 <p1@example.test>', 'Co-authored-by: Person 2 <p2@example.test>']);
    expect(liveNotes.notices).toEqual([]);
  });

  it('does not try the person who asks twice when they typed', async () => {
    const id = await typedByTwo();
    const opens = opening(() => {
      throw new LiveCredentialError();
    });
    expect(await run(id, { requester: { person: who(2), author: author(2) } })).toMatchObject({ reason: 'uncommittable' });
    expect(opens.map(open => open.person)).toEqual([who(1), who(2)]);
  });
});

describe('a check-in that commits nothing', () => {
  it("releases a note whose text is still the one Git gave it without opening the repository, even when Git moved on and nobody's credential works", async () => {
    const id = await checkout();
    const source = git();
    const snapshot = await source.getSnapshot(true);
    await source.commitChanges([{ path: file, content: `${A}pushed from elsewhere\n` }], snapshot.sha, 'write', 'notes', undefined, snapshot);
    const opens = opening(() => {
      throw new LiveCredentialError();
    });
    expect(await run(id, { mode: 'scheduled' })).toEqual({ id, path: file, committed: false, released: true });
    expect(opens).toEqual([]);
    expect(commits()).toHaveLength(1);
    expect(files.get(file)).toBe(`${A}pushed from elsewhere\n`);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
    expect(liveNotes.notices).toEqual([]);
  });

  it('releases a note typed in and typed back to the text of its base the same way', async () => {
    const id = await checkout();
    liveNotes.type(repository, id, `${A}three\n`, person(1));
    liveNotes.type(repository, id, A, person(1));
    const opens = opening();
    expect(await run(id)).toEqual({ id, path: file, committed: false, released: true });
    expect(opens).toEqual([]);
    expect(commits()).toEqual([]);
  });

  it('leaves a note someone still has open live, unchanged as it is', async () => {
    const id = await checkout();
    liveNotes.setActive(repository, id, 1);
    const opens = opening();
    expect(await run(id, { mode: 'scheduled' })).toEqual({ id, path: file, committed: false, released: false, reason: 'active', activeEditors: 1 });
    expect(opens).toEqual([]);
    expect((await liveNotes.service.checkouts(repository)).map(row => row.id)).toEqual([id]);
  });

  it('discards a draft nobody typed in without opening the repository', async () => {
    const draft = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: 'inbox/{{title}}.md', content: '---\ntitle: Kept\n---\n\nA body the template gave it.\n' });
    const opens = opening(() => {
      throw new LiveCredentialError();
    });
    expect(await run(draft.id, { mode: 'scheduled', discardUntyped: true })).toEqual({ id: draft.id, path: null, committed: false, released: true, discarded: true, reason: 'empty' });
    expect(opens).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
  });
});

describe('an adapter that commits with the deployment’s own credential', () => {
  beforeEach(() => {
    liveNotes = memoryLiveNotes({ editor, repositories: [{ source: edition, files }], clock });
  });

  it('is opened once, with the author alone as in 0.20, whoever asks for the check-in', async () => {
    const id = await typedByTwo();
    const opens = opening();
    expect(await run(id, { requester: { person: who(3), author: author(3) } })).toMatchObject({ committed: true, released: true });
    expect(opens).toEqual([{ author: author(1), person: undefined, arguments: 2 }]);
    expect(commits()[0].author).toEqual(author(1));
    expect(commits()[0].message).toContain('Co-authored-by: Person 2 <p2@example.test>');
  });

  it('lists no person on its editors', async () => {
    const id = await typedByTwo();
    const lease = await liveNotes.service.lease(repository, id);
    const detail = await liveNotes.service.detail(repository, id, lease);
    for (const listed of detail.editors) expect(listed).not.toHaveProperty('person');
  });

  it('falls back to the person who asks only when the deployment’s credential is refused', async () => {
    const id = await typedByTwo();
    const opens = opening(candidate => {
      if (!candidate) throw new LiveCredentialError();
    });
    expect(await run(id, { requester: { person: who(3), author: author(3) } })).toMatchObject({ committed: true, released: true });
    expect(opens.map(open => [open.person, open.arguments])).toEqual([[undefined, 2], [who(3), 3]]);
    expect(commits()[0].author).toEqual(author(3));
  });
});

describe('the credential error', () => {
  it('is a live error an adapter may throw: it is reported as it is, not as an unavailable editor', () => {
    const error = new LiveCredentialError();
    expect(liveAdapterError(error)).toBe(error);
    expect(error).toMatchObject({ status: 403 });
  });
});

describe('how live editing shows a person', () => {
  it('names an editor by `live` where the identity gives one, and by `author` otherwise', async () => {
    const id = await checkout();
    liveNotes.type(repository, id, `${A}three\n`, { person: who(1), author: { name: 'Commit Name', email: 'commit@example.test' }, live: { name: 'pat', email: '7+pat@users.noreply.github.com' }, request: { headers: {} } });
    const lease = await liveNotes.service.lease(repository, id);
    expect((await liveNotes.service.detail(repository, id, lease)).editors).toEqual([{ name: 'pat', email: '7+pat@users.noreply.github.com', agent: false, firstAt: expect.any(String), lastAt: expect.any(String), person: who(1) }]);
  });

  it('carries `live` on an outside bearer’s grant, and refuses one that is not a name with an optional email', () => {
    const grant = { person: who(1), owner: 'edition:p1', write: true, site: 'github:https://github.com' };
    expect(bearerGrantRecord({ ...grant, live: { name: 'pat', email: '7+pat@users.noreply.github.com' } })).toMatchObject({ live: { name: 'pat', email: '7+pat@users.noreply.github.com' } });
    expect(bearerGrantRecord({ ...grant, live: { name: 'pat' } })).toMatchObject({ live: { name: 'pat' } });
    expect(bearerGrantRecord(grant)).not.toHaveProperty('live');
    for (const live of [{ name: '' }, { email: 'a@example.test' }, { name: 'pat', email: 7 }, 'pat', null]) expect(bearerGrantRecord({ ...grant, live } as never), JSON.stringify(live)).toBeNull();
  });
});

describe('the app with an identity that says how live editing shows a person', () => {
  const pat = { name: 'pat', email: '7+pat@users.noreply.github.com' };
  /** `x-person` names who is signed in. The identity gives `live` and no `author`, as the community's does. */
  const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: 'pat', owner: `edition:${req.headers['x-person']}`, live: pat } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
  const configSource: WorkspaceConfigSource = {
    mode: 'remote',
    settings: async () => {
      // The site is the first source's; the workspace opens only the edition repository.
      const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, hosted]);
      return { ...settings, members: [{ ...settings.members[1], default: true }] };
    },
  };
  const note = { notebookId: 'notes~life', path: 'notes/life/a.md' };
  let root: string, server: Server, base: string, live: BuiltinFixture, hostedFiles: MemoryFiles;
  const call = async (url: string, body: unknown, as = 'p1') => {
    const response = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-person': as }, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: (response.headers.get('content-type') ?? '').includes('application/json') ? JSON.parse(text) : text };
  };
  const made = () => memoryCommits(hostedFiles).filter(commit => commit.message !== 'Memory state');

  beforeEach(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-credentials-')));
    for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_LIVE_IDLE_CHECKIN: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
    hostedFiles = new Map([['.mygitnotes.yaml', hostedManifest], ['notes/life/a.md', A]]);
    live = builtinFixture({ files: hostedFiles });
    server = createServer(createApp(root, { configSource, recordStore: createRecordStore(root), remoteCache: undefined, workspaceChoices: null, identity, editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', hostedFiles]]) }), liveNotes: live.liveNotes }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await shutdownFixtures();
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('issues a socket ticket for the `live` name and email with the person who signed in, while an ordinary commit keeps the author the identity gives, here none', async () => {
    const { id } = (await call('/api/live/checkout', note)).body.checkout;
    const { ticket } = (await call('/api/live/socket-ticket', note)).body;
    expect(await live.store.takeTicket(createHash('sha256').update(ticket, 'utf8').digest('hex'), live.time.now())).toEqual({ repository: hostedRepository, id, epoch: 1, document: `${id}.1`, editor: { key: 'person:7+pat@users.noreply.github.com', name: 'pat', email: pat.email, agent: false, person: { realm: 'edition', userId: 'p1' } }, display: 'pat' });
    const head = (await new MemoryEditionSource(hosted, hostedFiles, true, memoryCommitCounter(hostedFiles), undefined, async () => parseWorkspaceConfig(hostedManifest)).getSnapshot(true)).sha;
    expect((await call('/api/notes', { notebookId: 'notes~life', path: 'notes/life/new.md', content: 'x', metadata: { title: 'New' }, revision: head })).status).toBe(200);
    expect(made()).toHaveLength(1);
    expect(made()[0].author).toBeUndefined();
  });

  it('asks for a check-in as the signed-in person: when no editor may commit, 「立即簽回」 commits with the credential of whoever pressed it', async () => {
    const { id } = (await call('/api/live/checkout', note)).body.checkout;
    await live.liveNotes.type(hostedRepository, id, `${A}three\n`, { person: who(9), author: author(9), request: { headers: {} } });
    const opens: (WorkspacePerson | undefined)[] = [];
    const open = live.liveNotes.service.open.bind(live.liveNotes.service);
    vi.spyOn(live.liveNotes.service, 'open').mockImplementation(async (...args) => {
      opens.push(args[2]?.person);
      if (args[2]?.person?.userId === 'p9') throw new LiveCredentialError();
      return open(...args);
    });
    expect(await call('/api/live/checkin', note)).toMatchObject({ status: 200, body: { id, path: 'notes/life/a.md', committed: true, released: true } });
    expect(opens).toEqual([who(9), who(1)]);
    expect(made()).toHaveLength(1);
    expect(made()[0].author).toEqual(pat);
    expect(made()[0].message).toContain('Co-authored-by: Person 9 <p9@example.test>');
  });
});
