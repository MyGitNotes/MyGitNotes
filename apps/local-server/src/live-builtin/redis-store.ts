import { createHash, randomBytes } from 'node:crypto';
import { LiveUnavailableError, type RepositoryId } from '@mygitnotes/core';
import { createClient, ErrorReply } from 'redis';
import { recordKeyPrefix } from '../record-store/index.js';
import { LIVE_ENDED_MAX_BYTES, LIVE_MERGE_MS, LIVE_PRESENCE_MS, LIVE_TICKET_MS, type LiveStore, type StoredEditor, type StoredLink, type StoredTicket } from './store.js';

/*
 * The live store in Redis (docs/specs/2026-11-15-builtin-live-editor §3.2). Under the prefix P:
 *
 *   P:repos                  set     no TTL   repositories with live links
 *   P:r:<rk>:links           set     no TTL   live link ids of the repository
 *   P:r:<rk>:path:<pk>       string  no TTL   the link id of a path; kept after a release
 *   P:link:<id>              hash    no TTL   the link's fields and its `rk`; `base` and `conflict` as JSON, an absent field is null
 *   P:doc:<id>:<epoch>       string  no TTL   the epoch's compacted Yjs state, base64
 *   P:doc:<id>:<epoch>:log   list    no TTL   the Yjs updates since the last compaction, base64
 *   P:editors:<id>           hash    no TTL   editor key to JSON StoredEditor
 *   P:initial:<id>           string  no TTL   the text a pending link was created with
 *   P:lease:<id>             string  lease + 60 s   JSON { token, until, readSeq, readHash }
 *   P:presence:<id>          hash    90 s, refreshed   process id to JSON { at, people: { person key: last activity } }
 *   P:ticket:<sha256>        string  60 s     JSON StoredTicket with its `until`
 *   P:tickets:<id>           set     60 s, refreshed   the hashes of the link's tickets, so a release or discard deletes them
 *   P:merge:<sha256>         string  24 h     JSON { answer, until }: what a merge answered, for a repeat of it
 *   P:ended:<id>:<epoch>     hash    24 h     a released epoch's document: `state`, `log` (base64, comma-joined) and `until`
 *                                             (only for an epoch that stored typing, and only up to LIVE_ENDED_MAX_BYTES)
 *
 * `rk` and `pk` are the first 32 hex of the sha256 of the repository id and of the path. Live text carries no TTL, so a
 * volatile-* eviction policy never takes it (an ended document may go early, and a merge of typing kept of it then
 * conflicts rather than doubling text); `check` refuses a policy that would. Every compound call is one EVAL
 * script, atomic in Redis; the scripts use nothing newer than Redis 2.6 and build some key names themselves, so they
 * need a single Redis, not a cluster. Lifetimes are a backstop in real time: what a lease, a presence entry or a ticket
 * is worth is decided by the time the caller passes.
 */

/** How long a lease's key outlives the lease. */
const LEASE_GRACE_MS = 60_000;
/** A snapshot this recent counts as Redis saving to disk. */
const RDB_RECENT_MS = 60 * 60_000;
const LINK_ID = /^[A-Za-z0-9_-]{22}$/;
const TICKET_HASH = /^[0-9a-f]{64}$/;
const MERGE_KEY = /^[0-9a-f]{64}$/;

/*
 * A script that fails halfway keeps what it had written, so each reads and decodes everything it needs before its first
 * write: a call either answers or leaves the store as it was.
 */

/** KEYS[1] link, KEYS[2] lease: the lease, when `token` holds the live link at `now`. */
const HOLDER = `
local function holder(token, now)
  local lease = redis.call('GET', KEYS[2])
  if not lease or redis.call('HGET', KEYS[1], 'live') ~= '1' then return nil end
  lease = cjson.decode(lease)
  if lease.token ~= token or lease['until'] <= tonumber(now) then return nil end
  return lease
end`;

/** KEYS[2] lease, KEYS[3] editors, KEYS[4] presence, KEYS[5] tickets, KEYS[6] repos: deletes what an epoch leaves besides its link record. */
const ERASE = `
local function erase(P, id, epoch, rk, repository)
  local doc, links = P .. ':doc:' .. id .. ':' .. epoch, P .. ':r:' .. rk .. ':links'
  for _, hash in ipairs(redis.call('SMEMBERS', KEYS[5])) do redis.call('DEL', P .. ':ticket:' .. hash) end
  redis.call('DEL', doc, doc .. ':log', KEYS[2], KEYS[3], KEYS[4], KEYS[5])
  redis.call('SREM', links, id)
  if redis.call('SCARD', links) == 0 then redis.call('SREM', KEYS[6], repository) end
end`;

/** KEYS path, repos, links. ARGV P, new id, repository, rk, notebook, path, base, contentHash, state, now. */
const CHECKOUT = `
local P = ARGV[1]
local id = redis.call('GET', KEYS[1])
local link = id and (P .. ':link:' .. id)
if id and redis.call('HGET', link, 'repository') ~= ARGV[3] then id = false end
local outcome = 'joined'
if not id then
  outcome = 'created'
  id = ARGV[2]
  link = P .. ':link:' .. id
  redis.call('HMSET', link, 'id', id, 'repository', ARGV[3], 'rk', ARGV[4], 'path', ARGV[6], 'epoch', '1', 'seq', '0', 'contentSeq', '0')
  redis.call('SET', KEYS[1], id)
elseif redis.call('HGET', link, 'live') ~= '1' then
  outcome = 'reopened'
  redis.call('HINCRBY', link, 'epoch', 1)
  redis.call('HSET', link, 'contentSeq', redis.call('HGET', link, 'seq'))
  redis.call('HDEL', link, 'syncedAt', 'syncedHash', 'lastEditAt', 'conflict')
end
if outcome ~= 'joined' then
  redis.call('HMSET', link, 'live', '1', 'notebook', ARGV[5], 'since', ARGV[10], 'gen', '0', 'contentHash', ARGV[8])
  if ARGV[7] == '' then redis.call('HDEL', link, 'base') else redis.call('HSET', link, 'base', ARGV[7]) end
  redis.call('SET', P .. ':doc:' .. id .. ':' .. redis.call('HGET', link, 'epoch'), ARGV[9])
  redis.call('SADD', KEYS[3], id)
  redis.call('SADD', KEYS[2], ARGV[3])
end
return {outcome, redis.call('HGETALL', link)}`;

/** KEYS repos, links, link, doc, initial. ARGV id, repository, rk, notebook, pathRule, base, contentHash, state, now, whether an initial text is given, the initial text. */
const CREATE_PENDING = `
redis.call('HMSET', KEYS[3], 'id', ARGV[1], 'repository', ARGV[2], 'rk', ARGV[3], 'notebook', ARGV[4], 'pathRule', ARGV[5], 'since', ARGV[9], 'epoch', '1', 'live', '1', 'seq', '0', 'gen', '0', 'contentHash', ARGV[7], 'contentSeq', '0')
if ARGV[6] ~= '' then redis.call('HSET', KEYS[3], 'base', ARGV[6]) end
redis.call('SET', KEYS[4], ARGV[8])
if ARGV[10] == '1' then redis.call('SET', KEYS[5], ARGV[11]) end
redis.call('SADD', KEYS[2], ARGV[1])
redis.call('SADD', KEYS[1], ARGV[2])
return redis.call('HGETALL', KEYS[3])`;

/** KEYS links. ARGV P. */
const LINKS = `
local found = {}
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  local link = redis.call('HGETALL', ARGV[1] .. ':link:' .. id)
  if #link > 0 then found[#found + 1] = link end
end
return found`;

/** KEYS link, doc, log. ARGV epoch. */
const DOCUMENT = `
local at = redis.call('HMGET', KEYS[1], 'live', 'epoch', 'gen', 'seq')
if at[1] ~= '1' or at[2] ~= ARGV[1] then return false end
local state = redis.call('GET', KEYS[2])
if not state then return false end
return {state, redis.call('LRANGE', KEYS[3], 0, -1), at[3], at[4]}`;

/**
 * KEYS link, log, editors, and with a merge record its key. ARGV epoch, update, now, editor key ('' for a merge of
 * Git's changes), editor JSON, the merge record ('' for none), its lifetime.
 */
const APPEND = `
local at = redis.call('HMGET', KEYS[1], 'live', 'epoch')
if at[1] ~= '1' or at[2] ~= ARGV[1] then return false end
if ARGV[6] ~= '' then
  local merged = redis.call('GET', KEYS[4])
  if merged then
    merged = cjson.decode(merged)
    if merged['until'] > tonumber(ARGV[3]) then return {'merged', merged.answer} end
  end
end
local editor = nil
if ARGV[4] ~= '' then
  local known = redis.call('HGET', KEYS[3], ARGV[4])
  editor = cjson.decode(known or ARGV[5])
  if not known then editor.firstAt = tonumber(ARGV[3]) end
end
local length = redis.call('RPUSH', KEYS[2], ARGV[2])
local seq = redis.call('HINCRBY', KEYS[1], 'seq', 1)
if editor then
  editor.lastAt = tonumber(ARGV[3])
  editor.lastSeq = seq
  redis.call('HSET', KEYS[3], ARGV[4], cjson.encode(editor))
  redis.call('HSET', KEYS[1], 'lastEditAt', ARGV[3])
end
if ARGV[6] ~= '' then redis.call('SET', KEYS[4], ARGV[6], 'PX', ARGV[7]) end
return {seq, length}`;

/** KEYS link, doc, log. ARGV epoch, gen, count, state, contentHash, contentSeq. */
const COMPACT = `
local at = redis.call('HMGET', KEYS[1], 'live', 'epoch', 'gen')
if at[1] ~= '1' or at[2] ~= ARGV[1] or at[3] ~= ARGV[2] or tonumber(ARGV[3]) > redis.call('LLEN', KEYS[3]) then return 0 end
redis.call('SET', KEYS[2], ARGV[4])
if ARGV[3] ~= '0' then redis.call('LTRIM', KEYS[3], ARGV[3], -1) end
redis.call('HINCRBY', KEYS[1], 'gen', 1)
redis.call('HMSET', KEYS[1], 'contentHash', ARGV[5], 'contentSeq', ARGV[6])
return 1`;

/** KEYS link, lease. ARGV token, until, now, lifetime. */
const LEASE = `
if redis.call('HGET', KEYS[1], 'live') ~= '1' then return 'not-live' end
local held = redis.call('GET', KEYS[2])
if held and cjson.decode(held)['until'] > tonumber(ARGV[3]) then return 'held' end
redis.call('SET', KEYS[2], cjson.encode({ token = ARGV[1], ['until'] = tonumber(ARGV[2]) }), 'PX', ARGV[4])
return 'leased'`;

/** KEYS link, lease. ARGV token, now. */
const LEASE_HELD = `${HOLDER}
if holder(ARGV[1], ARGV[2]) then return 1 end
return 0`;

/** KEYS link, lease. ARGV token, now, seq, contentHash, grace. */
const LEASE_READ = `${HOLDER}
local lease = holder(ARGV[1], ARGV[2])
if not lease then return 0 end
lease.readSeq = tonumber(ARGV[3])
lease.readHash = ARGV[4]
redis.call('SET', KEYS[2], cjson.encode(lease), 'PX', string.format('%.0f', lease['until'] - tonumber(ARGV[2]) + tonumber(ARGV[5])))
return 1`;

/** KEYS link, lease, editors, initial. ARGV token, now, base, contentHash, path, conflict, P, pk. */
const SYNCED = `${HOLDER}
local lease = holder(ARGV[1], ARGV[2])
if not lease then return 'leased' end
local at = redis.call('HMGET', KEYS[1], 'path', 'seq', 'contentHash', 'contentSeq', 'id', 'rk')
if at[1] and at[1] ~= ARGV[5] then return 'path-fixed' end
local cut = nil
if lease.readHash == ARGV[4] then cut = lease.readSeq
elseif at[3] == ARGV[4] and at[4] == at[2] then cut = tonumber(at[2]) end
local covered = {}
if cut then
  local editors = redis.call('HGETALL', KEYS[3])
  for i = 1, #editors, 2 do
    if cjson.decode(editors[i + 1]).lastSeq <= cut then covered[#covered + 1] = editors[i] end
  end
end
if not at[1] then
  redis.call('HSET', KEYS[1], 'path', ARGV[5])
  redis.call('HDEL', KEYS[1], 'pathRule')
  redis.call('DEL', KEYS[4])
  redis.call('SET', ARGV[7] .. ':r:' .. at[6] .. ':path:' .. ARGV[8], at[5])
end
redis.call('HMSET', KEYS[1], 'base', ARGV[3], 'syncedAt', ARGV[2], 'syncedHash', ARGV[4])
if ARGV[6] == '' then redis.call('HDEL', KEYS[1], 'conflict') else redis.call('HSET', KEYS[1], 'conflict', ARGV[6]) end
for _, editor in ipairs(covered) do redis.call('HDEL', KEYS[3], editor) end
return 'ok'`;

/**
 * KEYS link, lease, editors, presence, tickets, repos. ARGV token, now, seq, contentHash, P, how long the ended document
 * is kept, the most bytes it may take. Only an epoch that stored typing (a log entry, or a compaction) keeps it.
 */
const RELEASE = `${HOLDER}${ERASE}
if not holder(ARGV[1], ARGV[2]) then return 'leased' end
local at = redis.call('HMGET', KEYS[1], 'syncedAt', 'syncedHash', 'seq', 'epoch', 'id', 'rk', 'repository', 'gen')
if not at[1] or at[2] ~= ARGV[4] then return 'not-synced' end
if at[3] ~= ARGV[3] then return 'changed' end
local doc = ARGV[5] .. ':doc:' .. at[5] .. ':' .. at[4]
local state, log = redis.call('GET', doc), redis.call('LRANGE', doc .. ':log', 0, -1)
local size = 0
if state then
  size = #state
  for _, entry in ipairs(log) do size = size + #entry end
end
if state and (tonumber(at[8] or '0') > 0 or #log > 0) and math.floor(size * 3 / 4) <= tonumber(ARGV[7]) then
  local ended = ARGV[5] .. ':ended:' .. at[5] .. ':' .. at[4]
  redis.call('DEL', ended)
  redis.call('HMSET', ended, 'state', state, 'log', table.concat(log, ','), 'until', string.format('%.0f', tonumber(ARGV[2]) + tonumber(ARGV[6])))
  redis.call('PEXPIRE', ended, ARGV[6])
end
erase(ARGV[5], at[5], at[4], at[6], at[7])
redis.call('HSET', KEYS[1], 'live', '0')
return 'released'`;

/** KEYS link, lease, editors, presence, tickets, repos, initial. ARGV token, now, seq, P. */
const DISCARD = `${HOLDER}${ERASE}
if not holder(ARGV[1], ARGV[2]) then return 'leased' end
local at = redis.call('HMGET', KEYS[1], 'path', 'seq', 'epoch', 'id', 'rk', 'repository')
if at[1] then return 'not-pending' end
if at[2] ~= ARGV[3] then return 'changed' end
erase(ARGV[4], at[4], at[3], at[5], at[6])
redis.call('DEL', KEYS[1], KEYS[7])
return 'discarded'`;

/** KEYS link, lease. ARGV token, now, pathRule. */
const RETARGET = `${HOLDER}
if not holder(ARGV[1], ARGV[2]) then return 'leased' end
local path = redis.call('HGET', KEYS[1], 'path')
redis.call('DEL', KEYS[2])
if path then return 'not-pending' end
redis.call('HSET', KEYS[1], 'pathRule', ARGV[3])
return 'retargeted'`;

/** KEYS link, lease. ARGV token, now. */
const UNLEASE = `${HOLDER}
if holder(ARGV[1], ARGV[2]) then redis.call('DEL', KEYS[2]) end
return 'ok'`;

/** KEYS link, presence. ARGV process, its entry ('' for none), lifetime. */
const PRESENCE = `
if redis.call('HGET', KEYS[1], 'live') ~= '1' then return 0 end
if ARGV[2] == '' then redis.call('HDEL', KEYS[2], ARGV[1]) else redis.call('HSET', KEYS[2], ARGV[1], ARGV[2]) end
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return 1`;

/** KEYS ticket, tickets. ARGV the ticket, lifetime, hash. */
const PUT_TICKET = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('SADD', KEYS[2], ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return 1`;

/** KEYS ticket. ARGV P, hash. */
const TAKE_TICKET = `
local ticket = redis.call('GET', KEYS[1])
if not ticket then return false end
local tickets = ARGV[1] .. ':tickets:' .. cjson.decode(ticket).id
redis.call('DEL', KEYS[1])
redis.call('SREM', tickets, ARGV[2])
return ticket`;

type Connection = { client: ReturnType<typeof createClient>; ready: Promise<unknown>; inFlight: number; };
const connections = new Map<string, Connection>();

/**
 * One command over the live store's own native connection, one per endpoint, with the session store's timeouts. It
 * throws the client's own error, so the store can tell a refusal by the server from a lost connection: a refusal leaves
 * the connection sound, anything else drops it and a later call reconnects.
 *
 * The connection holds the process only while a command is in flight, its connecting included: idle, it is unref'd, so
 * it never keeps a process that is done from exiting; a command refs it until Redis answers, so a process that awaits
 * one with nothing else to hold it (a composition awaiting `started` before it listens) is not ended under it.
 */
async function liveRedisCommand(url: string, command: string[]): Promise<unknown> {
  let connection = connections.get(url);
  try {
    if (!connection?.client.isOpen) {
      const client = createClient({ url, socket: { connectTimeout: 10000, reconnectStrategy: false }, commandOptions: { timeout: 10000 }, disableOfflineQueue: true });
      client.on('error', () => console.warn('[live-store] Redis connection unavailable.'));
      connection = { client, ready: client.connect(), inFlight: 0 };
      connections.set(url, connection);
    }
    const held = connection;
    if (held.inFlight++ === 0) held.client.ref();
    try {
      await held.ready;
      return await held.client.sendCommand(command);
    } finally {
      if (--held.inFlight === 0) held.client.unref();
    }
  } catch (error) {
    if (!(error instanceof ErrorReply)) {
      if (connections.get(url) === connection) connections.delete(url);
      if (connection?.client.isOpen) connection.client.destroy();
    }
    throw error;
  }
}

const digest32 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
const encode = (data: Uint8Array) => Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
const decode = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));
const json = (value: unknown) => value === null ? '' : JSON.stringify(value);
/** A hash as Redis answers it, field then value, as a map. */
function fieldsOf(reply: unknown): Map<string, string> {
  const flat = Array.isArray(reply) ? reply as string[] : [];
  const fields = new Map<string, string>();
  for (let i = 0; i + 1 < flat.length; i += 2) fields.set(flat[i], flat[i + 1]);
  return fields;
}
/** A link record as its hash holds it; null for an empty answer. */
function linkOf(reply: unknown): StoredLink | null {
  const fields = fieldsOf(reply);
  const id = fields.get('id');
  if (!id) return null;
  const number = (name: string) => Number(fields.get(name) ?? 0);
  const time = (name: string) => fields.has(name) ? Number(fields.get(name)) : null;
  const parsed = (name: string) => fields.has(name) ? JSON.parse(fields.get(name)!) : null;
  return { id, repository: fields.get('repository') ?? '', notebook: fields.get('notebook') ?? '', path: fields.get('path') ?? null, ...(fields.has('pathRule') ? { pathRule: fields.get('pathRule') } : {}), since: number('since'), epoch: number('epoch'), live: fields.get('live') === '1', base: parsed('base'), syncedAt: time('syncedAt'), syncedHash: fields.get('syncedHash') ?? null, lastEditAt: time('lastEditAt'), conflict: parsed('conflict'), seq: number('seq'), gen: number('gen'), contentHash: fields.get('contentHash') ?? '', contentSeq: number('contentSeq') };
}

/** The prefix of every live store key of this deployment, namespaced as its sessions are. */
export function liveStorePrefix(): string {
  return `${recordKeyPrefix()}:live-store:v1`;
}

/** The live store in native Redis (`redis://` or `rediss://`), under {@link liveStorePrefix} unless `prefix` is given. */
export function redisLiveStore({ url, prefix }: { url: string; prefix?: string; }): LiveStore {
  if (!/^rediss?:\/\//.test(url)) throw new Error('The live store needs a redis:// or rediss:// URL.');
  return redisLiveStoreOver(command => liveRedisCommand(url, command), prefix);
}

/** The Redis live store over any way to send one command and get its reply, which a test fakes. `send` throws on failure. */
export function redisLiveStoreOver(send: (command: string[]) => Promise<unknown>, prefix = liveStorePrefix()): LiveStore {
  const P = prefix;
  const key = { repos: `${P}:repos`, links: (repository: RepositoryId) => `${P}:r:${digest32(repository)}:links`, path: (repository: RepositoryId, path: string) => `${P}:r:${digest32(repository)}:path:${digest32(path)}`, link: (id: string) => `${P}:link:${id}`, doc: (id: string, epoch: number) => `${P}:doc:${id}:${epoch}`, log: (id: string, epoch: number) => `${P}:doc:${id}:${epoch}:log`, editors: (id: string) => `${P}:editors:${id}`, initial: (id: string) => `${P}:initial:${id}`, lease: (id: string) => `${P}:lease:${id}`, merge: (hash: string) => `${P}:merge:${hash}`, ended: (id: string, epoch: number) => `${P}:ended:${id}:${epoch}`, presence: (id: string) => `${P}:presence:${id}`, ticket: (hash: string) => `${P}:ticket:${hash}`, tickets: (id: string) => `${P}:tickets:${id}` };
  /**
   * One command. A failure is logged by the call and its link id and thrown as an unavailable live editor: a refusal by
   * the server with its first line (a full Redis must be visible), anything else without detail, since a client error
   * may quote the connection URL. No log holds text, a path or a ticket.
   */
  const call = async (what: string, command: string[]) => {
    try {
      return await send(command);
    } catch (error) {
      console.warn(error instanceof ErrorReply ? `[live-store] Redis refused ${what}: ${error.message.split('\n')[0].slice(0, 200)}` : `[live-store] Redis unavailable (${what}).`);
      throw new LiveUnavailableError();
    }
  };
  const script = (what: string, lua: string, keys: string[], args: (string | number)[]) => call(what, ['EVAL', lua, String(keys.length), ...keys, ...args.map(String)]);
  // Only an id and an epoch this store issues reach a key name.
  const isLink = (id: string) => LINK_ID.test(id);
  const isEpoch = (epoch: number) => Number.isSafeInteger(epoch) && epoch > 0;
  const lifecycleKeys = (id: string) => [key.link(id), key.lease(id), key.editors(id), key.presence(id), key.tickets(id), key.repos];

  return {
    async check() {
      await call('check', ['PING']);
      // INFO is allowed where a managed service refuses CONFIG. One that refuses INFO too leaves the policy unread.
      const info = async (section: string) => {
        try {
          return String(await send(['INFO', section]));
        } catch {
          return '';
        }
      };
      const policy = /^maxmemory_policy:([a-z-]+)/m.exec(await info('memory'))?.[1];
      if (policy?.startsWith('allkeys-')) throw new Error(`Redis may evict any key (maxmemory-policy ${policy}); the built-in live editor would lose typing. Use noeviction or a volatile-* policy.`);
      if (policy !== 'noeviction' && !policy?.startsWith('volatile-')) console.warn(`[live-store] Cannot tell whether Redis may evict live text (maxmemory-policy ${policy ?? 'unreadable'}). The built-in live editor needs noeviction or a volatile-* policy.`);
      const persistence = await info('persistence');
      const saved = Number(/^rdb_last_save_time:(\d+)/m.exec(persistence)?.[1] ?? 0) * 1000;
      if (/^aof_enabled:0\s*$/m.test(persistence) && Date.now() - saved > RDB_RECENT_MS) console.warn('[live-store] Redis keeps no append-only file; a Redis restart loses typing since the last check-in.');
    },
    async repositories() {
      return (await call('repositories', ['SMEMBERS', key.repos]) as string[]).sort();
    },
    async links(repository) {
      const found = (await script('links', LINKS, [key.links(repository)], [P]) as unknown[]).map(linkOf).filter((link): link is StoredLink => link !== null && link.live);
      return found.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
    },
    async link(id) {
      return isLink(id) ? linkOf(await call(`link ${id}`, ['HGETALL', key.link(id)])) : null;
    },
    async checkout(repository, { path, notebook, base, contentHash }, state, now) {
      const [outcome, link] = await script('checkout', CHECKOUT, [key.path(repository, path), key.repos, key.links(repository)], [P, randomBytes(16).toString('base64url'), repository, digest32(repository), notebook, path, json(base), contentHash, encode(state), now]) as ['created' | 'joined' | 'reopened', unknown];
      return { link: linkOf(link)!, outcome };
    },
    async createPending(repository, { notebook, base, contentHash, pathRule, initialText }, state, now) {
      const id = randomBytes(16).toString('base64url');
      return linkOf(await script(`createPending ${id}`, CREATE_PENDING, [key.repos, key.links(repository), key.link(id), key.doc(id, 1), key.initial(id)], [id, repository, digest32(repository), notebook, pathRule, json(base), contentHash, encode(state), now, initialText === undefined ? '0' : '1', initialText ?? '']))!;
    },
    async initialText(id) {
      return isLink(id) ? await call(`initialText ${id}`, ['GET', key.initial(id)]) as string | null : null;
    },
    async document(id, epoch) {
      if (!isLink(id) || !isEpoch(epoch)) return null;
      const found = await script(`document ${id}.${epoch}`, DOCUMENT, [key.link(id), key.doc(id, epoch), key.log(id, epoch)], [epoch]) as [string, string[], string, string] | null;
      return found ? { state: decode(found[0]), log: found[1].map(decode), gen: Number(found[2]), seq: Number(found[3]) } : null;
    },
    async append(id, epoch, update, editor, now, merge) {
      if (!isLink(id) || !isEpoch(epoch)) return 'not-live';
      if (merge && !MERGE_KEY.test(merge.key)) throw new Error('A merge answer is kept under a sha256 hex.');
      const identity = editor ? JSON.stringify({ key: editor.key, name: editor.name, ...(editor.email !== undefined ? { email: editor.email } : {}), agent: editor.agent, ...(editor.person !== undefined ? { person: { realm: editor.person.realm, userId: editor.person.userId } } : {}) }) : '';
      // The key lives a day in real time at most; whether its answer still counts is decided by the times the caller passes.
      const record = merge ? [JSON.stringify({ answer: merge.answer, until: merge.until }), Math.max(1, Math.min(LIVE_MERGE_MS, Math.ceil(merge.until - now)))] : ['', 0];
      const appended = await script(`append ${id}.${epoch}`, APPEND, [key.link(id), key.log(id, epoch), key.editors(id), ...(merge ? [key.merge(merge.key)] : [])], [epoch, encode(update), now, editor?.key ?? '', identity, ...record]) as [number, number] | ['merged', string] | null;
      if (!appended) return 'not-live';
      return appended[0] === 'merged' ? { merged: appended[1] } : { seq: appended[0], length: appended[1] as number };
    },
    async ended(id, epoch, now) {
      if (!isLink(id) || !isEpoch(epoch)) return null;
      const [state, log, until] = await call(`ended ${id}.${epoch}`, ['HMGET', key.ended(id, epoch), 'state', 'log', 'until']) as [string | null, string | null, string | null];
      if (state === null || Number(until) <= now) return null;
      return { state: decode(state), log: log ? log.split(',').map(decode) : [] };
    },
    async mergeAnswer(hash, now) {
      if (!MERGE_KEY.test(hash)) return null;
      const found = await call('mergeAnswer', ['GET', key.merge(hash)]) as string | null;
      if (!found) return null;
      const { answer, until } = JSON.parse(found) as { answer: string; until: number; };
      return until > now ? answer : null;
    },
    async compact(id, epoch, gen, count, state, contentHash, contentSeq) {
      if (!isLink(id) || !isEpoch(epoch) || !Number.isSafeInteger(count) || count < 0) return false;
      return await script(`compact ${id}.${epoch}`, COMPACT, [key.link(id), key.doc(id, epoch), key.log(id, epoch)], [epoch, gen, count, encode(state), contentHash, contentSeq]) === 1;
    },
    async editors(id) {
      if (!isLink(id)) return [];
      const listed = [...fieldsOf(await call(`editors ${id}`, ['HGETALL', key.editors(id)])).values()].map(value => JSON.parse(value) as StoredEditor);
      return listed.sort((a, b) => a.firstAt - b.firstAt || (a.key < b.key ? -1 : 1));
    },
    async lease(id, token, until, now) {
      if (!isLink(id)) return 'not-live';
      return await script(`lease ${id}`, LEASE, [key.link(id), key.lease(id)], [token, until, now, Math.max(1, Math.ceil(until - now)) + LEASE_GRACE_MS]) as 'leased' | 'held' | 'not-live';
    },
    async leaseHeld(id, token, now) {
      return isLink(id) && await script(`leaseHeld ${id}`, LEASE_HELD, [key.link(id), key.lease(id)], [token, now]) === 1;
    },
    async leaseRead(id, token, seq, contentHash, now) {
      return isLink(id) && await script(`leaseRead ${id}`, LEASE_READ, [key.link(id), key.lease(id)], [token, now, seq, contentHash, LEASE_GRACE_MS]) === 1;
    },
    async synced(id, token, receipt, now) {
      if (!isLink(id)) return 'leased';
      const base = { commit: receipt.commit, blob: receipt.blob, contentHash: receipt.contentHash };
      return await script(`synced ${id}`, SYNCED, [key.link(id), key.lease(id), key.editors(id), key.initial(id)], [token, now, json(base), receipt.contentHash, receipt.path, json(receipt.conflict), P, digest32(receipt.path)]) as 'ok' | 'leased' | 'path-fixed';
    },
    async release(id, token, expect, now) {
      if (!isLink(id)) return 'leased';
      return await script(`release ${id}`, RELEASE, lifecycleKeys(id), [token, now, expect.seq, expect.contentHash, P, LIVE_MERGE_MS, LIVE_ENDED_MAX_BYTES]) as 'released' | 'leased' | 'not-synced' | 'changed';
    },
    async discard(id, token, expect, now) {
      if (!isLink(id)) return 'leased';
      return await script(`discard ${id}`, DISCARD, [...lifecycleKeys(id), key.initial(id)], [token, now, expect.seq, P]) as 'discarded' | 'leased' | 'not-pending' | 'changed';
    },
    async retarget(id, token, pathRule, now) {
      if (!isLink(id)) return 'leased';
      return await script(`retarget ${id}`, RETARGET, [key.link(id), key.lease(id)], [token, now, pathRule]) as 'retargeted' | 'leased' | 'not-pending';
    },
    async unlease(id, token, now) {
      if (!isLink(id)) return;
      await script(`unlease ${id}`, UNLEASE, [key.link(id), key.lease(id)], [token, now]);
    },
    async presence(id, process, people, now) {
      if (!isLink(id)) return;
      await script(`presence ${id}`, PRESENCE, [key.link(id), key.presence(id)], [process, Object.keys(people).length ? JSON.stringify({ at: now, people }) : '', LIVE_PRESENCE_MS]);
    },
    async activePeople(id, since, now) {
      if (!isLink(id)) return 0;
      const active = new Set<string>();
      for (const value of fieldsOf(await call(`activePeople ${id}`, ['HGETALL', key.presence(id)])).values()) {
        const entry = JSON.parse(value) as { at: number; people: Record<string, number>; };
        if (entry.at + LIVE_PRESENCE_MS <= now) continue;
        for (const [person, last] of Object.entries(entry.people)) if (last >= since) active.add(person);
      }
      return active.size;
    },
    async putTicket(hash, ticket, until) {
      if (!TICKET_HASH.test(hash) || !isLink(ticket.id)) throw new Error('A ticket is kept under the sha256 hex of the ticket, for a link of this store.');
      await script(`putTicket ${ticket.id}`, PUT_TICKET, [key.ticket(hash), key.tickets(ticket.id)], [JSON.stringify({ ...ticket, until }), LIVE_TICKET_MS, hash]);
    },
    async takeTicket(hash, now) {
      if (!TICKET_HASH.test(hash)) return null;
      const found = await script('takeTicket', TAKE_TICKET, [key.ticket(hash)], [P, hash]) as string | null;
      if (!found) return null;
      const { until, ...ticket } = JSON.parse(found) as StoredTicket & { until: number; };
      return until > now ? ticket : null;
    },
  };
}
