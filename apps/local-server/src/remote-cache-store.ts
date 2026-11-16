import { createHmac } from 'node:crypto';
import { MemoryRemoteCache, type RemoteCache, SourceError } from '@mygitnotes/core';
import { nativeRedisCommand } from './redis-store.js';

function restConnection() {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN ? { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN } : { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
}

/**
 * The native Redis the cache uses: its own (`MYGITNOTES_CACHE_REDIS_URL`), so cached reads never fill a Redis that
 * must not evict, such as the live store's; left out, the session Redis (`REDIS_URL`), as before.
 */
const nativeUrl = () => process.env.MYGITNOTES_CACHE_REDIS_URL || process.env.REDIS_URL;

/** Shared remote read cache in its own Redis, else the session Redis; errors end the request. */
export class RedisRemoteCache implements RemoteCache {
  private readonly prefix: string;
  constructor() {
    const namespace = process.env.MYGITNOTES_SESSION_NAMESPACE || '';
    this.prefix = namespace ? `gh-notes:${namespace}:cache:` : 'gh-notes:cache:';
  }
  private async rest(path: string, body: unknown): Promise<any> {
    const { url, token } = restConnection();
    if (!url || !token || !url.startsWith('https://')) throw new SourceError('Cache store is not configured.', 503);
    const response = await fetch(`${url}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new SourceError('Cache store unavailable.', 503);
    return response.json();
  }
  async get(keys: string[]): Promise<(string | null)[]> {
    if (!keys.length) return [];
    const command = ['MGET', ...keys.map(key => this.prefix + key)];
    try {
      const native = nativeUrl();
      if (native) return await nativeRedisCommand(native, command);
      const body = await this.rest('', command) as { result?: (string | null)[]; error?: string; };
      if (body.error || !Array.isArray(body.result)) throw new Error();
      return body.result;
    } catch (error) {
      throw error instanceof SourceError ? error : new SourceError('Cache store unavailable.', 503);
    }
  }
  async set(entries: [string, string][], ttlSeconds: number): Promise<void> {
    const commands = entries.map(([key, value]) => ['SET', this.prefix + key, value, 'EX', String(ttlSeconds)]);
    try {
      const native = nativeUrl();
      if (native) {
        for (const command of commands) await nativeRedisCommand(native, command);
        return;
      }
      for (let i = 0, bytes = 0, start = 0; i <= commands.length; i++) {
        const size = i < commands.length ? Buffer.byteLength(commands[i][2]) : 0;
        if (i === commands.length || (i > start && bytes + size > 800 * 1024)) {
          const results = await this.rest('/pipeline', commands.slice(start, i)) as { error?: string; }[];
          if (!Array.isArray(results) || results.some(result => result.error)) throw new Error();
          start = i;
          bytes = 0;
        }
        bytes += size;
      }
    } catch (error) {
      throw error instanceof SourceError ? error : new SourceError('Cache store unavailable.', 503);
    }
  }
  /** Seals with a key derived from SESSION_SECRET, which other writers of the store do not hold. Without the secret nothing is sealed. */
  sign(text: string): string | undefined {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) return undefined;
    return createHmac('sha256', createHmac('sha256', secret).update('mygitnotes remote cache seal v1').digest()).update(text).digest('hex');
  }
}

export function createRemoteCache(): RemoteCache {
  return nativeUrl() || restConnection().url ? new RedisRemoteCache() : new MemoryRemoteCache();
}
