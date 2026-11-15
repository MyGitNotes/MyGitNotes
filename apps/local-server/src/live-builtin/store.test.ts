import { randomBytes } from 'node:crypto';
import { liveContentHash, LiveUnavailableError } from '@mygitnotes/core';
import { createClient, ErrorReply } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryLiveStore } from './memory-store.js';
import { liveStorePrefix, redisLiveStore, redisLiveStoreOver } from './redis-store.js';
import { liveStoreContract } from './store-contract.js';
import { LIVE_PRESENCE_MS, LIVE_TICKET_MS, type LiveStore } from './store.js';

/*
 * The live store of the built-in editor (docs/specs/2026-11-15-builtin-live-editor §3, slice N2). The contract runs over
 * the memory store always, and over a real Redis when MYGITNOTES_TEST_REDIS_URL names a throwaway one: every run takes
 * its own random prefix there and deletes its keys afterwards.
 */

const T0 = Date.parse('2026-11-15T00:00:00.000Z');
const LEASE_MS = 5 * 60_000;
const repository = 'edition:hosted:p1/notes@main';
const bytes = (text: string) => new TextEncoder().encode(text);
const hash = (letter: string) => letter.repeat(64);
const pat = { key: 'person:pat@example.test', name: 'Pat', email: 'pat@example.test', agent: false };
const checkout = (store: LiveStore, path: string, text: string, now = T0) => store.checkout(repository, { notebook: 'notes~life', base: { commit: 'a'.repeat(40), blob: 'b'.repeat(40), contentHash: liveContentHash(text) }, contentHash: liveContentHash(text), path }, bytes(text), now);
const pending = (store: LiveStore, text: string, now = T0) => store.createPending(repository, { notebook: 'notes~life', base: null, contentHash: liveContentHash(text), pathRule: '{{title}}.md', initialText: text }, bytes(text), now);
const receipt = (contentHash: string, path: string) => ({ commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash, path, conflict: null });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

liveStoreContract('memory', () => memoryLiveStore());

describe('the memory live store', () => {
  it('hands out copies: what a caller does to an answer, or to the bytes it gave, never reaches the store', async () => {
    const store = memoryLiveStore();
    const state = bytes('# A\n'), update = bytes('typed');
    const { link } = await checkout(store, 'notes/life/a.md', '# A\n');
    await store.append(link.id, 1, update, pat, T0 + 1);
    state.fill(0);
    update.fill(0);
    link.live = false;
    link.base!.commit = 'changed';
    const document = (await store.document(link.id, 1))!;
    expect(document).toEqual({ state: bytes('# A\n'), log: [bytes('typed')], gen: 0, seq: 1 });
    document.state.fill(0);
    document.log[0].fill(0);
    (await store.editors(link.id))[0].name = 'Changed';
    expect(await store.document(link.id, 1)).toEqual({ state: bytes('# A\n'), log: [bytes('typed')], gen: 0, seq: 1 });
    expect(await store.link(link.id)).toMatchObject({ live: true, base: { commit: 'a'.repeat(40) } });
    expect((await store.editors(link.id))[0].name).toBe('Pat');
  });

  it('is shared by everyone who holds it, as two adapter instances over one store are', async () => {
    const store = memoryLiveStore(), apart = memoryLiveStore();
    const { link } = await checkout(store, 'notes/life/a.md', '# A\n');
    expect(await store.link(link.id)).toEqual(link);
    expect(await apart.link(link.id)).toBeNull();
  });
});

/** Answers PING and INFO as a Redis server would; an Error is thrown as the server's refusal. */
function infoServer(memory: string | Error, persistence: string | Error = 'aof_enabled:1\r\n') {
  return vi.fn(async (command: string[]): Promise<unknown> => {
    if (command[0] === 'PING') return 'PONG';
    const answer = command[0] === 'INFO' && command[1] === 'memory' ? memory : command[0] === 'INFO' && command[1] === 'persistence' ? persistence : new Error(`Unexpected command ${command[0]}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
}
const memoryInfo = (policy: string) => `# Memory\r\nused_memory:1048576\r\nmaxmemory:0\r\nmaxmemory_human:0B\r\nmaxmemory_policy:${policy}\r\nallocator_frag_ratio:1.00\r\n`;

describe('the Redis live store check', () => {
  it.each(['allkeys-lru', 'allkeys-lfu', 'allkeys-random'])('refuses to start under %s, which may evict live text', async policy => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(redisLiveStoreOver(infoServer(memoryInfo(policy)), 'test').check()).rejects.toThrow(`Redis may evict any key (maxmemory-policy ${policy}); the built-in live editor would lose typing. Use noeviction or a volatile-* policy.`);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['noeviction', 'volatile-lru', 'volatile-lfu', 'volatile-ttl', 'volatile-random'])('starts without a word under %s with an append-only file', async policy => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = infoServer(memoryInfo(policy));
    await expect(redisLiveStoreOver(send, 'test').check()).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([command]) => command.join(' '))).toEqual(['PING', 'INFO memory', 'INFO persistence']);
  });

  it.each([['INFO is refused', new ErrorReply("NOPERM this user has no permissions to run the 'info' command")], ['the policy is not listed', '# Memory\r\nused_memory:1048576\r\n'], ['the policy is one it does not know', memoryInfo('some-new-policy')]])('warns once and starts when %s', async (_why, memory) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(redisLiveStoreOver(infoServer(memory), 'test').check()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("[live-store] Cannot read Redis's maxmemory-policy. The built-in live editor needs noeviction or a volatile-* policy; under allkeys-* Redis may evict typing.");
  });

  it('warns when Redis keeps no append-only file and has not saved lately, and not when it has', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seconds = Math.floor(Date.now() / 1000);
    const persistence = (aof: number, saved: number) => `# Persistence\r\nloading:0\r\nrdb_changes_since_last_save:12\r\nrdb_last_save_time:${saved}\r\naof_enabled:${aof}\r\n`;
    await redisLiveStoreOver(infoServer(memoryInfo('noeviction'), persistence(0, seconds - 86_400)), 'test').check();
    expect(warn.mock.calls).toEqual([['[live-store] Redis keeps no append-only file; a Redis restart loses typing since the last check-in.']]);
    warn.mockClear();
    await redisLiveStoreOver(infoServer(memoryInfo('noeviction'), persistence(0, seconds - 60)), 'test').check();
    await redisLiveStoreOver(infoServer(memoryInfo('noeviction'), persistence(1, seconds - 86_400)), 'test').check();
    await redisLiveStoreOver(infoServer(memoryInfo('noeviction'), new ErrorReply('NOPERM')), 'test').check();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not start on a Redis it cannot reach, so the eviction policy is never left unread', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED redis://user:private-password@unreachable:6379');
    });
    await expect(redisLiveStoreOver(send, 'test').check()).rejects.toBeInstanceOf(LiveUnavailableError);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-password');
  });
});

describe('the Redis live store', () => {
  it('answers a failed command as an unavailable live editor, and logs what failed without the connection details', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: Error[] = [new Error('Socket closed: redis://user:private-password@unreachable:6379'), new ErrorReply("OOM command not allowed when used memory > 'maxmemory'.")];
    const store = redisLiveStoreOver(async () => {
      throw failures.shift()!;
    }, 'test');
    await expect(store.link('A'.repeat(22))).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(store.append('A'.repeat(22), 1, bytes('typed'), pat, T0)).rejects.toBeInstanceOf(LiveUnavailableError);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('private-password');
    expect(logged).not.toContain(Buffer.from('typed').toString('base64'));
    // A refusal by the server itself is named: a full Redis under noeviction must be visible to the operator.
    expect(logged).toContain('OOM command not allowed');
  });

  it("keeps its keys under the deployment's record prefix, namespaced as the sessions are", () => {
    expect(liveStorePrefix()).toBe('gh-notes:live-store:v1');
    vi.stubEnv('MYGITNOTES_SESSION_NAMESPACE', 'team');
    expect(liveStorePrefix()).toBe('gh-notes:team:live-store:v1');
  });

  it('takes only a native Redis URL', () => {
    expect(() => redisLiveStore({ url: 'https://rest.example.test' })).toThrow('The live store needs a redis:// or rediss:// URL.');
  });
});

const url = process.env.MYGITNOTES_TEST_REDIS_URL;

describe.skipIf(!url)('over a real Redis (MYGITNOTES_TEST_REDIS_URL)', () => {
  /** This run's own keyspace. */
  const run = `mgn-test:${randomBytes(8).toString('hex')}`;
  let prefixes = 0;
  const prefix = () => `${run}:${++prefixes}`;
  const raw = createClient({ url, socket: { connectTimeout: 10_000, reconnectStrategy: false } });
  const command = (...args: string[]) => raw.sendCommand(args) as Promise<any>;
  const keysOf = async (pattern: string) => {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await command('SCAN', cursor, 'MATCH', pattern, 'COUNT', '1000') as [string, string[]];
      keys.push(...found);
      cursor = next;
    } while (cursor !== '0');
    return keys.sort();
  };
  /** What a key of the store holds, by its name under the prefix. */
  const kindOf = (name: string) => {
    const kinds: [string, RegExp][] = [['repos', /^repos$/], ['links', /^r:[0-9a-f]{32}:links$/], ['path', /^r:[0-9a-f]{32}:path:[0-9a-f]{32}$/], ['link', /^link:[A-Za-z0-9_-]{22}$/], ['doc', /^doc:[A-Za-z0-9_-]{22}:[1-9][0-9]*$/], ['log', /^doc:[A-Za-z0-9_-]{22}:[1-9][0-9]*:log$/], ['editors', /^editors:[A-Za-z0-9_-]{22}$/], ['initial', /^initial:[A-Za-z0-9_-]{22}$/], ['lease', /^lease:[A-Za-z0-9_-]{22}$/], ['presence', /^presence:[A-Za-z0-9_-]{22}$/], ['ticket', /^ticket:[0-9a-f]{64}$/], ['tickets', /^tickets:[A-Za-z0-9_-]{22}$/]];
    return kinds.find(([, pattern]) => pattern.test(name))?.[0] ?? `unknown key ${name}`;
  };
  /** The lifetimes of the store's keys in milliseconds, by kind; -1 is none. */
  const lifetimes = async (under: string) => {
    const found = new Map<string, number[]>();
    for (const key of await keysOf(`${under}:*`)) {
      const kind = kindOf(key.slice(under.length + 1));
      found.set(kind, [...(found.get(kind) ?? []), await command('PTTL', key) as number]);
    }
    return found;
  };

  beforeAll(async () => {
    raw.on('error', () => {});
    await raw.connect();
  });
  afterAll(async () => {
    const keys = await keysOf(`${run}:*`);
    for (let i = 0; i < keys.length; i += 500) await command('DEL', ...keys.slice(i, i + 500));
    expect(await keysOf(`${run}:*`)).toEqual([]);
    raw.destroy();
  });

  liveStoreContract('redis', () => redisLiveStore({ url: url!, prefix: prefix() }));

  it('gives no key a lifetime but a lease, presence and tickets', async () => {
    const under = prefix();
    const store = redisLiveStore({ url: url!, prefix: under });
    const { link } = await checkout(store, 'notes/life/a.md', '# A\n');
    const draft = await pending(store, '# Draft\n', T0 + 1);
    const { link: released } = await checkout(store, 'notes/life/b.md', '# B\n', T0 + 2);
    await store.append(link.id, 1, bytes('typed'), pat, T0 + 3);
    await store.append(draft.id, 1, bytes('typed'), pat, T0 + 3);
    await store.presence(link.id, 'process-1', { [pat.key]: T0 + 3 }, T0 + 3);
    await store.putTicket(hash('1'), { repository, id: link.id, epoch: 1, document: `${link.id}.1`, editor: pat, display: 'Pat' }, T0 + 3 + LIVE_TICKET_MS);
    expect(await store.lease(link.id, 'lease-1', T0 + 4 + LEASE_MS, T0 + 4)).toBe('leased');
    expect(await store.leaseRead(link.id, 'lease-1', 1, hash('a'), T0 + 4)).toBe(true);
    expect(await store.synced(link.id, 'lease-1', receipt(hash('a'), 'notes/life/a.md'), T0 + 5)).toBe('ok');
    expect(await store.compact(link.id, 1, 0, 0, bytes('state'), hash('a'), 1)).toBe(true);
    expect(await store.lease(released.id, 'lease-2', T0 + 4 + LEASE_MS, T0 + 4)).toBe('leased');
    expect(await store.synced(released.id, 'lease-2', receipt(hash('b'), 'notes/life/b.md'), T0 + 5)).toBe('ok');
    expect(await store.release(released.id, 'lease-2', { seq: 0, contentHash: hash('b') }, T0 + 6)).toBe('released');
    const found = await lifetimes(under);
    expect([...found.keys()].sort()).toEqual(['doc', 'editors', 'initial', 'lease', 'link', 'links', 'log', 'path', 'presence', 'repos', 'ticket', 'tickets']);
    for (const kind of ['repos', 'links', 'path', 'link', 'doc', 'log', 'editors', 'initial']) expect([kind, new Set(found.get(kind))]).toEqual([kind, new Set([-1])]);
    expect(found.get('link')).toHaveLength(3);
    expect(found.get('path')).toHaveLength(2);
    const within = (kind: string, most: number) => {
      for (const ttl of found.get(kind)!) {
        expect(ttl, kind).toBeGreaterThan(most - 30_000);
        expect(ttl, kind).toBeLessThanOrEqual(most);
      }
    };
    within('lease', LEASE_MS + 60_000);
    within('presence', LIVE_PRESENCE_MS);
    within('ticket', LIVE_TICKET_MS);
    within('tickets', LIVE_TICKET_MS);
  });

  it('leaves only the link and its path behind a release, and nothing behind a discard', async () => {
    const under = prefix();
    const store = redisLiveStore({ url: url!, prefix: under });
    const { link } = await checkout(store, 'notes/life/a.md', '# A\n');
    const draft = await pending(store, '# Draft\n', T0 + 1);
    for (const { id } of [link, draft]) {
      await store.append(id, 1, bytes('typed'), pat, T0 + 2);
      await store.presence(id, 'process-1', { [pat.key]: T0 + 2 }, T0 + 2);
      await store.putTicket(hash(id === link.id ? '1' : '2'), { repository, id, epoch: 1, document: `${id}.1`, editor: pat, display: 'Pat' }, T0 + 2 + LIVE_TICKET_MS);
      expect(await store.lease(id, 'lease', T0 + 3 + LEASE_MS, T0 + 3)).toBe('leased');
    }
    expect(await store.synced(link.id, 'lease', receipt(hash('a'), 'notes/life/a.md'), T0 + 4)).toBe('ok');
    expect(await store.release(link.id, 'lease', { seq: 1, contentHash: hash('a') }, T0 + 5)).toBe('released');
    expect(await store.discard(draft.id, 'lease', { seq: 1 }, T0 + 5)).toBe('discarded');
    expect(new Map([...await lifetimes(under)].sort())).toEqual(new Map([['link', [-1]], ['path', [-1]]]));
  });

  it('serves two handles on one prefix the same links, as two processes on one Redis', async () => {
    const under = prefix();
    const one = redisLiveStore({ url: url!, prefix: under }), two = redisLiveStore({ url: url!, prefix: under });
    const results = await Promise.all(Array.from({ length: 12 }, (_, n) => checkout(n % 2 ? one : two, 'notes/life/a.md', `# ${n}\n`, T0 + n)));
    expect(results.filter(result => result.outcome === 'created')).toHaveLength(1);
    expect(new Set(results.map(result => result.link.id)).size).toBe(1);
    const { id } = results[0].link;
    expect(await one.append(id, 1, bytes('from one'), pat, T0 + 20)).toEqual({ seq: 1, length: 1 });
    const read = (await two.document(id, 1))!;
    expect(read.log).toEqual([bytes('from one')]);
    expect(await one.append(id, 1, bytes('after the read'), pat, T0 + 21)).toEqual({ seq: 2, length: 2 });
    expect(await two.compact(id, 1, read.gen, read.log.length, bytes('state'), hash('a'), read.seq)).toBe(true);
    expect(await one.compact(id, 1, read.gen, 1, bytes('stale'), hash('b'), read.seq)).toBe(false);
    expect(await one.document(id, 1)).toEqual({ state: bytes('state'), log: [bytes('after the read')], gen: 1, seq: 2 });
    // Another prefix on the same Redis sees none of it.
    expect(await redisLiveStore({ url: url!, prefix: prefix() }).link(id)).toBeNull();
  });

  it('carries a megabyte of any bytes through the state and the log', async () => {
    const store = redisLiveStore({ url: url!, prefix: prefix() });
    const state = new Uint8Array(randomBytes(1024 * 1024)), update = new Uint8Array(randomBytes(1024 * 1024));
    const { link } = await store.checkout(repository, { notebook: 'notes~life', base: null, contentHash: hash('a'), path: 'notes/life/big.md' }, state, T0);
    expect(await store.append(link.id, 1, update, null, T0 + 1)).toEqual({ seq: 1, length: 1 });
    const document = (await store.document(link.id, 1))!;
    expect(Buffer.from(document.state).equals(Buffer.from(state))).toBe(true);
    expect(Buffer.from(document.log[0]).equals(Buffer.from(update))).toBe(true);
  });

  it('refuses to start while the server may evict any key, and starts under volatile-lru and noeviction', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = redisLiveStore({ url: url!, prefix: prefix() });
    const [, was] = await command('CONFIG', 'GET', 'maxmemory-policy') as string[];
    try {
      await command('CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru');
      await expect(store.check()).rejects.toThrow('Redis may evict any key (maxmemory-policy allkeys-lru); the built-in live editor would lose typing. Use noeviction or a volatile-* policy.');
      await command('CONFIG', 'SET', 'maxmemory-policy', 'volatile-lru');
      await expect(store.check()).resolves.toBeUndefined();
      await command('CONFIG', 'SET', 'maxmemory-policy', 'noeviction');
      await expect(store.check()).resolves.toBeUndefined();
    } finally {
      await command('CONFIG', 'SET', 'maxmemory-policy', was);
    }
  });
});
