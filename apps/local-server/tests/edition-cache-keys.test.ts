import { describe, expect, it } from 'vitest';
import { GitHubSource, type NotebookConfig, type RemoteCache, type RepositoryScope } from '@mygitnotes/core';
import { MemoryEditionSource, type MemoryFiles } from '../src/memory-edition-source.js';

const nb = { id: 'life', title: 'Life', root: 'notes/life' } as NotebookConfig;
const scope = (async () => ({ notebooks: [nb] })) as unknown as RepositoryScope;
const recordingCache = () => {
  const keys: string[] = [];
  const store = new Map<string, string>();
  const cache: RemoteCache = {
    get: async wanted => { keys.push(...wanted); return wanted.map(key => store.get(key) ?? null); },
    set: async entries => { for (const [key, value] of entries) store.set(key, value); },
  };
  return { cache, keys };
};
const edition = (repository: string, files: MemoryFiles, cache: RemoteCache) =>
  new MemoryEditionSource({ type: 'edition', platform: 'hosted', repository, branch: 'main', label: 'n' }, files, true, { count: 0 }, cache, scope);
const indexKey = async (source: { catalog(): { index(nb: NotebookConfig): Promise<unknown> } }, keys: string[]) => {
  keys.length = 0;
  await source.catalog().index(nb);
  return keys.find(key => key.startsWith('mgn:index:'))!;
};

describe('edition cache keys', () => {
  it('changes the notebook index key when a file in the notebook changes', async () => {
    const { cache, keys } = recordingCache();
    const files: MemoryFiles = new Map([['notes/life/a.md', '# A\n']]);
    const before = await indexKey(edition('p1/notes', files, cache), keys);
    files.set('notes/life/a.md', '# A changed\n');
    expect(await indexKey(edition('p1/notes', files, cache), keys)).not.toBe(before);
  });

  it('never shares a key with a provider repository of the same name', async () => {
    const { cache, keys } = recordingCache();
    const files: MemoryFiles = new Map([['notes/life/a.md', '# A\n']]);
    const mine = await indexKey(edition('owner/repo', files, cache), keys);
    const github = new GitHubSource('owner/repo', 'main', 'token', (async () => new Response('{}', { status: 500 })) as typeof fetch, cache, scope);
    const theirs = (github as unknown as { cacheRepository(): string }).cacheRepository();
    expect(mine).toContain('edition:hosted:owner/repo');
    expect(mine.startsWith(`mgn:index:v3:${theirs}:`)).toBe(false);
  });

  it('keeps provider keys as they were', () => {
    const request = (async () => new Response('{}')) as typeof fetch;
    const key = (source: object) => (source as { cacheRepository(): string }).cacheRepository();
    expect(key(new GitHubSource('Owner/Repo', 'main', 't', request, undefined, scope))).toBe('owner/repo');
    expect(key(new GitHubSource('Owner/Repo', 'main', 't', request, undefined, scope, 'https://ghe.example.com'))).toBe('https://ghe.example.com/owner/repo');
  });
});
