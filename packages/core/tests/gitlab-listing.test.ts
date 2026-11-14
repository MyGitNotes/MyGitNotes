import { afterAll, describe, expect, it } from 'vitest';
import { openRemoteRepository } from '../src/remote-factory.js';
import type { RemoteCache } from '../src/remote-cache.js';
import { gitWorktree } from './fixtures/git-worktree.js';
import { documentationTree, gitlabRepository, sealedCache } from './fixtures/gitlab-repository.js';

type Repository = ReturnType<typeof gitlabRepository>;
/** One request of a server process: a reader of its own, as the server opens one per request. */
const open = (repository: Repository, process: typeof fetch, cache?: RemoteCache) => openRemoteRepository({ type: 'gitlab', url: repository.site, repository: repository.project, branch: 'main' }, 'token', process, cache).reader;
/** A repository of about seven thousand entries, the pages its full listing takes, and one server process that has read it. */
async function large(cache?: RemoteCache) {
  const repository = gitlabRepository(documentationTree());
  const pages = Math.ceil(repository.listing(repository.head).length / 100);
  const process = repository.process();
  await open(repository, process, cache).getSnapshot();
  const cold = repository.take();
  return { repository, pages, process, cold };
}
const listed = async (repository: Repository, process: typeof fetch, cache?: RemoteCache) => (await open(repository, process, cache).getSnapshot()).entries;
const LISTING_KEY = 'mgn:gitlab-tree:';

describe('GitLab listing of a large repository', () => {
  it('lists a commit nobody holds page by page with keyset pagination, in git order', async () => {
    const repository = gitlabRepository(documentationTree()), process = repository.process();
    expect(repository.listing(repository.head).length).toBeGreaterThan(6800);
    const snapshot = await open(repository, process).getSnapshot();
    expect(snapshot.entries).toEqual(repository.listing(repository.head));
    const urls = repository.urls('tree');
    expect(urls.every(url => url.includes('pagination=keyset') && url.includes('per_page=100') && url.includes(`ref=${repository.head}`))).toBe(true);
    expect(urls.slice(1).every(url => url.includes('page_token='))).toBe(true);
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: 69 });
  });

  it('still lists a site that pages trees by number', async () => {
    const repository = gitlabRepository(documentationTree());
    repository.behaviour.paging = 'numbered';
    expect(await listed(repository, repository.process())).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: 69 });
  });

  it('lists all of a site whose paging headers are lost on the way, counting pages by their length', async () => {
    const repository = gitlabRepository(documentationTree());
    repository.behaviour.paging = 'bare';
    expect(await listed(repository, repository.process())).toEqual(repository.listing(repository.head));
    // The first page, asked with keyset pagination, named no next one; the pages by number start over.
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: 70 });
  });

  it('pages by number when page tokens repeat entries, as tokens naming an object id do for files of one content', async () => {
    const files = documentationTree();
    for (const file of Object.keys(files)) if (file.startsWith('docs/')) files[file] = '# The same page everywhere\n';
    const repository = gitlabRepository(files);
    repository.behaviour.paging = 'keyset-by-id';
    expect(await listed(repository, repository.process())).toEqual(repository.listing(repository.head));
    const urls = repository.urls('tree');
    expect(urls.filter(url => !url.includes('pagination=keyset'))).toHaveLength(69);
    expect(urls.length).toBeGreaterThan(69);
  });

  it('takes a tree of exactly one full page as complete after asking for a second', async () => {
    const repository = gitlabRepository(Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`note-${index}.md`, `# ${index}\n`])));
    expect(await listed(repository, repository.process())).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: 2 });
  });

  it('reads the project and the branch only while the head stays where this process read it', async () => {
    const { repository, process } = await large();
    for (let request = 0; request < 3; request++) expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 3, branch: 3 });
  });

  it('lists once for requests that arrive together', async () => {
    const repository = gitlabRepository(documentationTree()), process = repository.process();
    const [first, second, third] = await Promise.all([listed(repository, process), listed(repository, process), listed(repository, process)]);
    expect(first).toEqual(repository.listing(repository.head));
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(repository.take()).toEqual({ project: 3, branch: 3, tree: 69 });
  });

  it('lets a request read for itself when the one it waited on failed', async () => {
    const repository = gitlabRepository(documentationTree()), process = repository.process();
    let failed = false;
    repository.behaviour.fail = kind => kind === 'tree' && !failed ? (failed = true, 401) : undefined;
    const results = await Promise.allSettled([open(repository, process).getSnapshot(), open(repository, process).getSnapshot()]);
    expect(results.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ status: 401 }) })]);
    expect(results.flatMap(result => result.status === 'fulfilled' ? [result.value.entries] : [])).toEqual([repository.listing(repository.head)]);
    expect(repository.take()).toEqual({ project: 2, branch: 2, tree: 70 });
  });

  it('lists once more, not once per waiting request, after the listing they waited on failed', async () => {
    const repository = gitlabRepository(documentationTree()), process = repository.process();
    const pages = Math.ceil(repository.listing(repository.head).length / 100);
    let failed = false;
    repository.behaviour.fail = kind => kind === 'tree' && !failed ? (failed = true, 502) : undefined;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => open(repository, process).getSnapshot()));
    expect(results.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ status: 502 }) })]);
    // The failed request and one listing, which the four that waited share.
    expect(repository.take()).toEqual({ project: 5, branch: 5, tree: 1 + pages });
    const read = results.flatMap(result => result.status === 'fulfilled' ? [result.value.entries] : []);
    expect(read).toHaveLength(4);
    expect(read[0]).toEqual(repository.listing(repository.head));
    for (const entries of read) expect(entries).toBe(read[0]);
  });

  it('serves another process from the shared cache, after that reader read the branch itself', async () => {
    const cache = sealedCache();
    const { repository } = await large(cache);
    const log: string[] = [];
    const watched = { ...cache, get: (keys: string[]) => (log.push(...keys), repository.log.push('cache'), cache.get(keys)) };
    repository.log.length = 0;
    expect(await listed(repository, repository.process(), watched)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1 });
    expect(log.some(key => key.startsWith(LISTING_KEY))).toBe(true);
    expect(repository.log.slice(0, 3)).toEqual(['gitlab:project', 'gitlab:branch', 'cache']);
  });

  it('asks the shared cache nothing for a reader the branch refuses', async () => {
    const cache = sealedCache();
    const { repository } = await large(cache);
    const asked: string[] = [];
    repository.behaviour.access = false;
    await expect(open(repository, repository.process(), { ...cache, get: keys => (asked.push(...keys), cache.get(keys)) }).getSnapshot()).rejects.toMatchObject({ status: 403 });
    expect(asked).toEqual([]);
    expect(repository.take()).toEqual({ project: 1, branch: 1 });
  });

  it('keeps listings in the process alone when the cache cannot seal them', async () => {
    for (const sign of [undefined, () => undefined]) {
      const stored: string[] = [];
      const cache: RemoteCache = { get: async keys => keys.map(() => null), set: async entries => void stored.push(...entries.map(([key]) => key)), ...(sign ? { sign } : {}) };
      const { repository, process, pages } = await large(cache);
      expect(stored.filter(key => key.startsWith(LISTING_KEY))).toEqual([]);
      await listed(repository, process, cache);
      expect(repository.take()).toEqual({ project: 1, branch: 1 });
      await listed(repository, repository.process(), cache);
      expect(repository.take()).toEqual({ project: 1, branch: 1, tree: pages });
    }
  });

  it('rejects a cached listing that was changed, or sealed with another secret, and lists again', async () => {
    const cache = sealedCache();
    const { repository, pages } = await large(cache);
    const [key] = [...cache.values.keys()].filter(stored => stored.startsWith(LISTING_KEY));
    const sealed = cache.values.get(key)!;
    const slot = JSON.parse(sealed) as { sha: string; data: string; };
    // A writer of the store swaps the content, or presents the listing as another commit's.
    const forgeries = [JSON.stringify({ ...slot, data: slot.data.slice(0, -8) + (slot.data.slice(-8) === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA') }), JSON.stringify({ ...slot, sha: 'f'.repeat(40) }), '{not json', JSON.stringify({ ...slot, parts: 2 })];
    for (const forged of forgeries) {
      await cache.set([[key, forged]], 60);
      expect(await listed(repository, repository.process(), cache)).toEqual(repository.listing(repository.head));
      expect(repository.take(), forged.slice(0, 40)).toEqual({ project: 1, branch: 1, tree: pages });
      // What the reader listed replaced the forgery.
      expect(cache.values.get(key)).toBe(sealed);
    }
    await cache.set([[key, sealed]], 60);
    await listed(repository, repository.process(), { ...cache, sign: sealedCache('another secret').sign });
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: pages });
  });

  it('serves a listing too large for one cache value from its parts', async () => {
    const cache = sealedCache();
    const repository = gitlabRepository(documentationTree(130));
    await listed(repository, repository.process(), cache);
    const pages = Math.ceil(repository.listing(repository.head).length / 100);
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: pages });
    const keys = [...cache.values.keys()].filter(stored => stored.startsWith(LISTING_KEY));
    expect(keys.length).toBeGreaterThan(1);
    for (const key of keys) expect(Buffer.byteLength(cache.values.get(key)!)).toBeLessThanOrEqual(700 * 1024);
    expect(await listed(repository, repository.process(), cache)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1 });
    const part = keys.find(key => key.endsWith(':1'))!;
    await cache.set([[part, cache.values.get(part)!.slice(0, -4) + 'AAAA']], 60);
    await listed(repository, repository.process(), cache);
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: pages });
  });
});

describe('GitLab listing after this process commits', () => {
  it('derives the new listing from the commit, checks it against the top of the tree, and lists nothing again', async () => {
    const cache = sealedCache();
    const { repository, process } = await large(cache);
    // The manifest and the note are read once and cached by content.
    await open(repository, process, cache).note('notes/ex/a.md');
    repository.take();
    const saved = await open(repository, process, cache).save('notes/ex/a.md', '# Alpha, changed\n', undefined, repository.head);
    expect(saved.revision).toBe(repository.head);
    expect(repository.read('notes/ex/a.md')).toBe('# Alpha, changed\n');
    expect(repository.take()).toEqual({ project: 1, branch: 2, file: 1, commit: 1, root: 1 });
    expect(await listed(repository, process, cache)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1 });
    // Another process finds the derived listing in the shared cache.
    expect(await listed(repository, repository.process(), cache)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1 });
  });

  it('derives creations in new directories and deletions that empty one', async () => {
    const { repository, process } = await large();
    await open(repository, process).save('notes/ex/new/deep/n.md', '# New\n', undefined, repository.head, true);
    expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
    await open(repository, process).commitNotes([{ path: 'notes/ex/folder/b.md', delete: true }, { path: 'notes/ex/new/deep/n.md', delete: true }], repository.head, 'docs: remove two notes');
    const entries = await listed(repository, process);
    expect(entries).toEqual(repository.listing(repository.head));
    expect(entries.some(entry => entry.path === 'notes/ex/folder' || entry.path === 'notes/ex/new')).toBe(false);
    const counts = repository.take();
    expect(counts).not.toHaveProperty('tree');
    expect(counts).not.toHaveProperty('compare');
    expect(counts).toMatchObject({ commit: 2, root: 2 });
  });

  it('keeps no derived listing when GitLab stored other bytes than were sent, and follows the comparison instead', async () => {
    const { repository, process } = await large();
    repository.behaviour.crlf = true;
    await open(repository, process).save('notes/ex/a.md', '# Alpha\r\nwith carriage returns\r\n', undefined, repository.head);
    expect(repository.read('notes/ex/a.md')).toBe('# Alpha\nwith carriage returns\n');
    expect(repository.take()).toMatchObject({ commit: 1, root: 1 });
    const reader = open(repository, process);
    expect((await reader.getSnapshot()).entries).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, compare: 1, head: 1, root: 1 });
    expect((await reader.readFile('notes/ex/a.md')).toString()).toBe('# Alpha\nwith carriage returns\n');
  });

  it('publishes the commit whatever happens to its listing', async () => {
    const { repository, process, pages } = await large();
    repository.behaviour.fail = kind => kind === 'root' ? 500 : undefined;
    const saved = await open(repository, process).save('notes/ex/a.md', '# Alpha, changed\n', undefined, repository.head);
    expect(saved.revision).toBe(repository.head);
    repository.take();
    expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, compare: 1, head: 1, root: 1, tree: pages });
  });

  it('keeps no derived listing when the commit landed on a head someone else moved', async () => {
    const { repository, process } = await large();
    repository.behaviour.beforeCommit = () => {
      repository.behaviour.beforeCommit = undefined;
      repository.push({ 'docs/area-3/section-3/page-3.md': '# Pushed in between\n' });
    };
    await open(repository, process).save('notes/ex/a.md', '# Alpha, changed\n', undefined, repository.head);
    expect(repository.take()).toEqual({ project: 1, branch: 2, blob: 2, file: 1, commit: 1 });
    expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, compare: 1, head: 2, root: 1 });
  });
});

describe('GitLab listing after someone else moves the head', () => {
  const pushed = (repository: Repository) => repository.push({ 'docs/area-1/section-1/page-1.md': '# Changed elsewhere\n', 'docs/area-1/fresh/dir/page.md': '# Added elsewhere\n', 'docs/area-2/section-2/page-2.md': null, 'scripts/build.sh': { content: '#!/bin/sh\n', mode: '100644' } });

  it('follows a small comparison, reading each changed file at the head, in this process and from the shared cache', async () => {
    const cache = sealedCache();
    const { repository, process } = await large(cache);
    pushed(repository);
    expect(await listed(repository, process, cache)).toEqual(repository.listing(repository.head));
    expect(repository.urls('compare')).toEqual([expect.stringContaining('straight=true')]);
    // The deletion is taken from the comparison; the changed, added and re-moded files are read.
    expect(repository.take()).toEqual({ project: 1, branch: 1, compare: 1, head: 3, root: 1 });
    expect(await listed(repository, repository.process(), cache)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1 });
    // A process that never read the repository starts from the cached listing of the earlier head.
    pushed(repository);
    repository.push({ 'docs/area-5/section-5/page-5.md': '# Changed again\n' });
    expect(await listed(repository, repository.process(), cache)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, compare: 1, head: 1, root: 1 });
  });

  it('follows renames', async () => {
    const { repository, process } = await large();
    repository.push({ 'docs/area-4/section-4/page-4.md': null, 'docs/area-4/moved/page.md': '# Page 4.4.4\n' }, { moved: { 'docs/area-4/moved/page.md': 'docs/area-4/section-4/page-4.md' } });
    expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, compare: 1, head: 1, root: 1 });
  });

  it('compares a rewritten branch directly, not from the merge base', async () => {
    const { repository, process } = await large();
    const base = repository.head;
    repository.push({ 'docs/area-6/section-6/page-6.md': '# Soon dropped\n' });
    await listed(repository, process);
    repository.take();
    repository.push({ 'docs/area-7/section-7/page-7.md': '# Forced\n' }, { parent: base });
    expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, compare: 1, head: 2, root: 1 });
  });

  it('lists again when following would take more requests, with or without more than 200 changed paths', async () => {
    for (const changed of [80, 250]) {
      const { repository, process, pages } = await large();
      repository.push(Object.fromEntries(Array.from({ length: changed }, (_, index) => [`docs/area-${index % 30}/section-${Math.floor(index / 30)}/page-0.md`, `# Rewritten ${index}\n`])));
      expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
      expect(repository.take(), `${changed} paths`).toEqual({ project: 1, branch: 1, compare: 1, tree: pages });
    }
  });

  it('lists again when the comparison fails or overflows', async () => {
    for (const compare of ['fails', 'timeout'] as const) {
      const { repository, process, pages } = await large();
      pushed(repository);
      repository.behaviour.compare = compare;
      expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
      expect(repository.take(), compare).toEqual({ project: 1, branch: 1, compare: 1, tree: pages });
    }
  });

  it('does not list again through a rate limit or lost access', async () => {
    for (const status of [429, 401, 403]) {
      const { repository, process } = await large();
      pushed(repository);
      repository.behaviour.fail = kind => kind === 'compare' ? status : undefined;
      await expect(open(repository, process).getSnapshot()).rejects.toMatchObject({ status });
      expect(repository.take(), String(status)).toEqual({ project: 1, branch: 1, compare: 1 });
    }
  });

  it('lists again when the comparison left a change out', async () => {
    const { repository, process, pages } = await large();
    pushed(repository);
    repository.behaviour.compare = 'drops-one';
    expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, compare: 1, head: 2, root: 1, tree: pages });
  });
});

describe('GitLab listings derived without listing, against git itself', () => {
  const worktree = gitWorktree();
  afterAll(() => worktree.remove());

  it('equal the listing a real repository gives after own commits and pushed adds, deletes, renames and mode changes', async () => {
    const repository = gitlabRepository(documentationTree(3), { list: files => worktree.list(files).entries });
    const process = repository.process();
    const current = async () => expect(await listed(repository, process)).toEqual(repository.listing(repository.head));
    await current();
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: 7 });
    await open(repository, process).save('notes/ex/a.md', '# Alpha, changed\n', undefined, repository.head);
    await current();
    await open(repository, process).save('notes/ex/new/deep/筆記.md', '# 筆記\n', undefined, repository.head, true);
    await current();
    await open(repository, process).commitNotes([{ path: 'notes/ex/new/deep/筆記.md', delete: true }, { path: 'notes/ex/folder/b.md', delete: true }], repository.head, 'docs: remove two notes');
    await current();
    repository.push({ 'docs/area-0/a-b': 'sorts before section-0\n', 'docs/area-0/section-0.md': 'beside the directory of the same stem\n', 'docs/area-0/section-0/page-0.md': null });
    await current();
    repository.push({ 'docs/area-1/section-1/page-1.md': null, 'docs/renamed/page.md': '# Page 1.1.1\n' }, { moved: { 'docs/renamed/page.md': 'docs/area-1/section-1/page-1.md' } });
    await current();
    repository.push({ 'scripts/build.sh': { content: '#!/bin/sh\n', mode: '100644' }, 'README.md': { content: '# Documentation\n', mode: '100755' }, 'link.md': { content: 'README.md', mode: '120000' } });
    await current();
    repository.push({ 'docs/area-2/section-2/page-2.md': null, 'docs/area-2/section-2/page-2.md/inner.md': '# A directory where a file was\n' });
    await current();
    const counts = repository.take();
    expect(counts).not.toHaveProperty('tree');
    expect(counts).toMatchObject({ commit: 3, compare: 4 });
  });
});
