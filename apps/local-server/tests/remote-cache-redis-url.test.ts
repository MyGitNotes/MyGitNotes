import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRemoteCache } from '@mygitnotes/core';

/*
 * MYGITNOTES_CACHE_REDIS_URL (docs/specs/2026-11-16-collab-first-self-host A8): the remote cache's own native Redis,
 * so a Redis that never evicts (the live store's) is not filled by cached reads. Left out, the cache follows REDIS_URL.
 */

const commands: { url: string; command: string[]; }[] = [];
vi.mock('../src/redis-store.js', () => ({
  nativeRedisCommand: async (url: string, command: string[]) => {
    commands.push({ url, command });
    return command[0] === 'MGET' ? command.slice(1).map(() => null) : 'OK';
  },
}));
const { createRemoteCache, RedisRemoteCache } = await import('../src/remote-cache-store.js');

const UNSET = { REDIS_URL: '', MYGITNOTES_CACHE_REDIS_URL: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', MYGITNOTES_SESSION_NAMESPACE: '' };

beforeEach(() => {
  commands.length = 0;
  for (const [key, value] of Object.entries(UNSET)) vi.stubEnv(key, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the Redis of the remote cache', () => {
  it('is MYGITNOTES_CACHE_REDIS_URL when set, whatever REDIS_URL names', async () => {
    vi.stubEnv('REDIS_URL', 'redis://records:6379');
    vi.stubEnv('MYGITNOTES_CACHE_REDIS_URL', 'redis://cache:6379');
    const cache = createRemoteCache();
    expect(cache).toBeInstanceOf(RedisRemoteCache);
    await cache.get(['mgn:blob:v1:owner/repo:abc']);
    await cache.set([['mgn:blob:v1:owner/repo:abc', 'value']], 60);
    expect(commands).toEqual([{ url: 'redis://cache:6379', command: ['MGET', 'gh-notes:cache:mgn:blob:v1:owner/repo:abc'] }, { url: 'redis://cache:6379', command: ['SET', 'gh-notes:cache:mgn:blob:v1:owner/repo:abc', 'value', 'EX', '60'] }]);
  });

  it('is enough on its own to share the cache, without REDIS_URL', async () => {
    vi.stubEnv('MYGITNOTES_CACHE_REDIS_URL', 'redis://cache:6379');
    const cache = createRemoteCache();
    expect(cache).toBeInstanceOf(RedisRemoteCache);
    await cache.get(['key']);
    expect(commands.map(sent => sent.url)).toEqual(['redis://cache:6379']);
  });

  it('follows REDIS_URL when unset, as before, and is process memory without any Redis', async () => {
    vi.stubEnv('REDIS_URL', 'redis://records:6379');
    await createRemoteCache().get(['key']);
    expect(commands).toEqual([{ url: 'redis://records:6379', command: ['MGET', 'gh-notes:cache:key'] }]);
    vi.stubEnv('REDIS_URL', '');
    expect(createRemoteCache()).toBeInstanceOf(MemoryRemoteCache);
  });
});
