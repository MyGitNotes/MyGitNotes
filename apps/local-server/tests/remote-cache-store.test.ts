import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRemoteCache, SourceError } from '@mygitnotes/core';
import { createRemoteCache, RedisRemoteCache } from '../src/remote-cache-store.js';

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

  it('uses the process cache when no store is configured', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('KV_REST_API_URL', '');
    expect(createRemoteCache()).toBeInstanceOf(MemoryRemoteCache);
    vi.stubEnv('UPSTASH_REDIS_REST_URL', restUrl);
    expect(createRemoteCache()).toBeInstanceOf(RedisRemoteCache);
  });
});
