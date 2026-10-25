// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeVersions } from '@mygitnotes/core/note-versions';
import { registerDemoRepositories } from './demo-storage.js';
import { announceHistoryChange, fetchCommitFiles, fetchHistory, fetchHistoryContent, onHistoryChanged } from './history-api.js';
import { appendLocalCommit, blobId } from './local-commits.js';

const REPO = 'edition:demo:scenarios@main', SCOPE = `${REPO}:main`, NOTEBOOK = 'demo~trpg-en', HEAD = 'a'.repeat(40);
const target = { path: 'notes/a.md', notebookId: NOTEBOOK };
const serverEntry = (commit: string, subject: string) => ({ commit, parents: [], date: '2026-01-01T00:00:00.000Z', author: 'a', subject, body: '', path: 'notes/a.md', blob: 's'.repeat(40), agent: false });
const serverVersion = { blob: 's'.repeat(40), commit: 'r'.repeat(40), authored: '2026-01-01T00:00:00.000Z', sequence: 1, date: '2026.01.01', name: 'v1', created: '2026-01-02T00:00:00.000Z' };
const raw = (text: string) => `---\ntitle: A\n---\n${text}\n`;

let urls: string[];
beforeEach(() => {
  localStorage.clear();
  registerDemoRepositories([{ id: REPO, branch: 'main', alias: 'demo', demo: true, revision: HEAD, notebooks: [NOTEBOOK] }]);
  urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.startsWith('/api/history?')) {
        const page = new URL(url, 'http://x').searchParams.get('page');
        return new Response(JSON.stringify({ path: 'notes/a.md', repository: REPO, entries: [serverEntry(page === '1' ? 'r'.repeat(40) : 'q'.repeat(40), 'Real')], more: page === '1', versions: [serverVersion], writable: false }));
      }
      if (url.startsWith('/api/history/file')) return new Response(JSON.stringify({ blob: 's'.repeat(40), content: raw('server text') }));
      if (url.startsWith('/api/history/commit')) return new Response(JSON.stringify({ commit: 'x', date: '', files: ['server-file.md'] }));
      throw new Error(`Unexpected request ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const commitOne = (message: string, text: string, version?: Parameters<typeof appendLocalCommit>[2]['version']) => appendLocalCommit(SCOPE, HEAD, { message, author: 'You (demo)', notes: { 'notes/a.md': { notebookId: NOTEBOOK, server: null, raw: raw(text) } }, documents: {}, ...(version ? { version } : {}) });

describe('history in demo mode', () => {
  it('lists local commits above the repository commits on the first page only', async () => {
    await commitOne('Local one', 'one');
    const first = await fetchHistory(target, 1);
    expect(first.entries.map(entry => [entry.local ?? false, entry.subject])).toEqual([[true, 'Local one'], [false, 'Real']]);
    expect(first.localCommits).toBe(true);
    expect(first.writable).toBe(false);
    const second = await fetchHistory(target, 2);
    expect(second.entries.map(entry => entry.local ?? false)).toEqual([false]);
  });

  it('puts a local version, with its name, on the visitor’s commit', async () => {
    const blob = await blobId(raw('one'));
    await commitOne('Local one', 'one', { path: 'notes/a.md', numberVersion: ({ id, date }) => ({ blob, commit: id, authored: date, sequence: 2, date: '2026.10.25', name: 'v3', created: date }) });
    const page = await fetchHistory(target, 1);
    const placed = placeVersions(page.versions, page.entries);
    const local = page.entries.find(entry => entry.local)!;
    expect(placed.get(local.commit)?.map(version => version.name)).toEqual(['v3']);
    expect(placed.get('r'.repeat(40))?.map(version => version.name)).toEqual(['v1']);
  });

  it('reads a local commit and a local blob from this browser, and the rest from the server', async () => {
    const one = await commitOne('Local one', 'one');
    await commitOne('Local two', 'two');
    expect(await fetchHistoryContent(target, { commit: one.id })).toEqual({ blob: await blobId(raw('one')), content: raw('one') });
    expect(await fetchHistoryContent(target, { blob: await blobId(raw('two')) })).toMatchObject({ content: raw('two') });
    expect(urls.some(url => url.startsWith('/api/history/file'))).toBe(false);
    expect(await fetchHistoryContent(target, { commit: 'r'.repeat(40) })).toMatchObject({ content: raw('server text') });
    expect(urls.filter(url => url.startsWith('/api/history/file'))).toHaveLength(1);
  });

  it('shows the repository head text for a local commit that did not change the file', async () => {
    const other = await appendLocalCommit(SCOPE, HEAD, { message: 'Other', author: 'You (demo)', notes: { 'notes/b.md': { notebookId: NOTEBOOK, server: null, raw: raw('b') } }, documents: {} });
    await fetchHistoryContent(target, { commit: other.id });
    expect(urls.find(url => url.startsWith('/api/history/file'))).toContain(`commit=${HEAD}`);
  });

  it('names the other files of a local commit from the log, and of a server commit from the server', async () => {
    const commit = await appendLocalCommit(SCOPE, HEAD, { message: 'Two files', author: 'You (demo)', notes: { 'notes/a.md': { notebookId: NOTEBOOK, server: null, raw: raw('a') }, 'notes/b.md': { notebookId: NOTEBOOK, server: null, raw: raw('b') } }, documents: {} });
    expect(await fetchCommitFiles(target, commit.id)).toEqual(['notes/b.md']);
    expect(await fetchCommitFiles(target, 'r'.repeat(40))).toEqual(['server-file.md']);
  });

  it('tells open history panels about a local commit', () => {
    const listener = vi.fn();
    const stop = onHistoryChanged(listener);
    announceHistoryChange({ repositories: [REPO], paths: ['notes/a.md'] });
    expect(listener).toHaveBeenCalledWith({ repositories: [REPO], paths: ['notes/a.md'] });
    stop();
  });
});

describe('history outside the demo', () => {
  it('answers the server’s page untouched', async () => {
    registerDemoRepositories([]);
    const page = await fetchHistory(target, 1);
    expect(page.entries).toHaveLength(1);
    expect(page).not.toHaveProperty('localCommits');
    expect(page.versions).toEqual([serverVersion]);
  });
});
