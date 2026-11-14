import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRemoteCache, openRemoteRepository, SourceError } from '@mygitnotes/core';
import { createRemoteCache, RedisRemoteCache } from '../src/remote-cache-store.js';
import { documentationTree, gitlabRepository } from '../../../packages/core/tests/fixtures/gitlab-repository.js';

const restUrl = 'https://cache.example.test';
beforeEach(() => {
  vi.stubEnv('REDIS_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', restUrl);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
  vi.stubEnv('MYGITNOTES_SESSION_NAMESPACE', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('shared cache store', () => {
  it('reads and writes through the Redis REST API under its own key space', async () => {
    const requests: { url: string; body: unknown; }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init!.body)) });
      return new Response(JSON.stringify(String(input).endsWith('/pipeline') ? [{ result: 'OK' }] : { result: ['value', null] }), { status: 200 });
    });
    const cache = new RedisRemoteCache();
    expect(await cache.get(['mgn:blob:v1:owner/repo:abc', 'mgn:blob:v1:owner/repo:def'])).toEqual(['value', null]);
    await cache.set([['mgn:blob:v1:owner/repo:abc', 'value']], 60);
    expect(requests[0]).toMatchObject({ url: restUrl, body: ['MGET', 'gh-notes:cache:mgn:blob:v1:owner/repo:abc', 'gh-notes:cache:mgn:blob:v1:owner/repo:def'] });
    expect(requests[1]).toMatchObject({ url: `${restUrl}/pipeline`, body: [['SET', 'gh-notes:cache:mgn:blob:v1:owner/repo:abc', 'value', 'EX', '60']] });
  });

  it('fails the request when the store is unavailable rather than continuing without it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const cache = new RedisRemoteCache();
    await expect(cache.get(['mgn:blob:v1:owner/repo:abc'])).rejects.toBeInstanceOf(SourceError);
    await expect(cache.set([['mgn:blob:v1:owner/repo:abc', 'value']], 60)).rejects.toMatchObject({ status: 503 });
  });

  it('seals with the session secret, and seals nothing without one', () => {
    const cache = new RedisRemoteCache();
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    const seal = cache.sign('listing');
    expect(seal).toMatch(/^[a-f0-9]{64}$/);
    expect(cache.sign('listing')).toBe(seal);
    expect(cache.sign('another listing')).not.toBe(seal);
    vi.stubEnv('SESSION_SECRET', 't'.repeat(64));
    expect(cache.sign('listing')).not.toBe(seal);
    for (const secret of ['', 'short']) {
      vi.stubEnv('SESSION_SECRET', secret);
      expect(cache.sign('listing')).toBeUndefined();
    }
  });

  it('serves a GitLab listing to another process from Redis, and only as this server sealed it', async () => {
    const redis = new Map<string, string>();
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    // Redis over REST: MGET in one command, SET in a pipeline.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init!.body)) as string[] | string[][];
      if (!String(input).endsWith('/pipeline')) return new Response(JSON.stringify({ result: (body as string[]).slice(1).map(key => redis.get(key) ?? null) }), { status: 200 });
      for (const [, key, value] of body as string[][]) redis.set(key, value);
      return new Response(JSON.stringify((body as string[][]).map(() => ({ result: 'OK' }))), { status: 200 });
    });
    const repository = gitlabRepository(documentationTree(3));
    const listed = async () => (await openRemoteRepository({ type: 'gitlab', url: repository.site, repository: repository.project, branch: 'main' }, 'token', repository.process(), new RedisRemoteCache()).reader.getSnapshot()).entries;
    expect(await listed()).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: 7 });
    const [key] = [...redis.keys()].filter(stored => stored.startsWith('gh-notes:cache:mgn:gitlab-tree:'));
    expect(key).toContain(`${repository.site}/${repository.project}@main`);
    expect(await listed()).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1 });
    // Another writer of the store cannot pass off a listing of its own, and a server with another secret trusts none.
    const sealed = redis.get(key)!;
    redis.set(key, sealed.replace(repository.head, 'f'.repeat(40)));
    expect(await listed()).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: 7 });
    expect(redis.get(key)).toBe(sealed);
    vi.stubEnv('SESSION_SECRET', 't'.repeat(64));
    expect(await listed()).toEqual(repository.listing(repository.head));
    expect(repository.take()).toEqual({ project: 1, branch: 1, tree: 7 });
  });

  it('uses the process cache when no store is configured', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('KV_REST_API_URL', '');
    expect(createRemoteCache()).toBeInstanceOf(MemoryRemoteCache);
    vi.stubEnv('UPSTASH_REDIS_REST_URL', restUrl);
    expect(createRemoteCache()).toBeInstanceOf(RedisRemoteCache);
  });
});
