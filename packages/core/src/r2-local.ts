import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SourceError } from './github-api.js';
import { resolveSafePath } from './path-guard.js';
import { isValidR2Key, r2ReferenceKeys } from './r2-references.js';
import { type AssetScope, inAssetScope, presignR2Object, r2SettingsFromEnv } from './r2-storage.js';

/**
 * Where a local checkout keeps the private objects it has downloaded: `MYGITNOTES_R2_CACHE_DIR` (relative to the
 * checkout when not absolute), else `.cache/r2-assets` in the checkout, which its `.gitignore` leaves out of Git.
 */
export function r2CacheRoot(checkout: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MYGITNOTES_R2_CACHE_DIR?.trim();
  return configured ? path.resolve(checkout, configured) : path.join(checkout, '.cache/r2-assets');
}

/** One object in the local cache. */
export interface CachedR2Object {
  key: string;
  /** The absolute path of the object's bytes. */
  file: string;
  size: number;
  /** The entity tag the object store answered when the object was read, when it answered one. */
  etag?: string;
  fetchedAt: string;
}

/** An object larger than the caller lets into the cache. */
export class R2ObjectTooLargeError extends Error {
  override name = 'R2ObjectTooLargeError';
}

/**
 * The private objects one local checkout has downloaded, by key. A cache holds the objects of one bucket: clear it
 * (delete its folder) when the checkout is pointed at another one, or to free the space.
 */
export interface R2Cache {
  readonly root: string;
  /** The cached object of `key`, or null when it is absent, incomplete, or `key` is not a valid key. */
  find(key: string): CachedR2Object | null;
  /** Stores an object's bytes, replacing an earlier copy only once every byte is on disk; with `maxBytes`, a longer body is refused and nothing is kept. */
  store(key: string, body: ReadableStream<Uint8Array> | Uint8Array, options?: { etag?: string; maxBytes?: number; }): Promise<CachedR2Object>;
}

/**
 * The cache in `root`. An object lies directly in `root` under the SHA-256 of its key, with its key, size and entity
 * tag in a `.json` file beside it, so no part of a key ever names a path and two keys never share a file.
 */
export function r2Cache(root: string): R2Cache {
  const base = path.resolve(root);
  const objectFile = (key: string) => {
    if (!isValidR2Key(key)) throw new Error('Invalid R2 object key.');
    return path.join(base, crypto.createHash('sha256').update(key).digest('hex'));
  };
  /** Writes through a new file beside the target and renames it over, which replaces a link instead of following it. */
  const replace = async (target: string, write: (handle: fs.promises.FileHandle) => Promise<void>) => {
    const temp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const handle = await fs.promises.open(temp, 'wx', 0o600);
    try {
      await write(handle);
      await handle.close();
      fs.renameSync(temp, target);
    } catch (error) {
      await handle.close().catch(() => undefined);
      fs.rmSync(temp, { force: true });
      throw error;
    }
  };
  return {
    root: base,
    find(key) {
      if (!isValidR2Key(key)) return null;
      const file = objectFile(key);
      try {
        const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')) as { key?: unknown; size?: unknown; etag?: unknown; fetchedAt?: unknown; };
        // lstat: a link is never served, wherever it points.
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || meta.key !== key || meta.size !== stat.size) return null;
        return { key, file, size: stat.size, ...(typeof meta.etag === 'string' ? { etag: meta.etag } : {}), fetchedAt: String(meta.fetchedAt ?? '') };
      } catch {
        return null;
      }
    },
    async store(key, body, { etag, maxBytes } = {}) {
      const file = objectFile(key);
      fs.mkdirSync(base, { recursive: true });
      let size = 0;
      await replace(file, async handle => {
        const append = async (chunk: Uint8Array) => {
          size += chunk.byteLength;
          if (maxBytes !== undefined && size > maxBytes) throw new R2ObjectTooLargeError(`The object is larger than ${maxBytes} bytes.`);
          await handle.appendFile(chunk);
        };
        if (body instanceof Uint8Array) return append(body);
        const reader = body.getReader();
        try {
          for (let read = await reader.read(); !read.done; read = await reader.read()) await append(read.value);
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          throw error;
        }
      });
      const cached: CachedR2Object = { key, file, size, ...(etag ? { etag } : {}), fetchedAt: new Date().toISOString() };
      await replace(`${file}.json`, handle => handle.appendFile(JSON.stringify({ key, size, ...(etag ? { etag } : {}), fetchedAt: cached.fetchedAt })));
      return cached;
    },
  };
}

/** Where local mode reads private objects from. */
export interface R2ObjectSource {
  /**
   * A short-lived URL, readable without a credential, for each of `keys` the note at `notePath` may read. A key left
   * out is not available to that note.
   */
  urls(notePath: string, keys: string[]): Promise<Map<string, string>>;
}

/** Reads with the bucket keys of `scope`: presigned URLs for the keys inside its prefix. The caller has checked the note references them. */
export function bucketR2Source(scope: Pick<AssetScope, 'settings' | 'prefix'>): R2ObjectSource {
  return {
    async urls(_notePath, keys) {
      const allowed = keys.filter(key => isValidR2Key(key) && inAssetScope(scope, key));
      return new Map(await Promise.all(allowed.map(async key => [key, await presignR2Object(scope.settings, key)] as [string, string])));
    },
  };
}

const HOSTED_PAGE = 50;
/** How many pages one note is asked for at most; a note with more references than this is read as far as it goes. */
const HOSTED_PAGES = 40;

/**
 * Reads through a hosted deployment the person holds an agent token for: its `/mcp` tool `download_assets` answers
 * presigned URLs for the keys the hosted copy of the note references, so no bucket key is needed here. The token goes
 * only to that deployment, in the `Authorization` header, over https (http to this machine); never to an object URL.
 */
export function hostedR2Source(remoteUrl: string, token: string, fetcher: typeof fetch = fetch): R2ObjectSource {
  let remote: URL;
  try {
    remote = new URL(remoteUrl);
  } catch {
    throw new Error('MYGITNOTES_R2_REMOTE_URL must be the https URL of a hosted MyGitNotes deployment.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(remote.hostname);
  if (remote.protocol !== 'https:' && !(remote.protocol === 'http:' && loopback)) throw new Error('MYGITNOTES_R2_REMOTE_URL must be an https URL, so the agent token is never sent in the clear.');
  const endpoint = `${remote.origin}${remote.pathname.replace(/\/+$/, '').replace(/\/mcp$/, '')}/mcp`;
  return {
    async urls(notePath, keys) {
      const wanted = new Set(keys), found = new Map<string, string>();
      let offset: number | null = 0;
      for (let page = 0; offset !== null && page < HOSTED_PAGES; page++) {
        // A redirect is refused, so the token cannot follow one to another origin.
        const response: Response = await fetcher(endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'download_assets', arguments: { path: notePath, offset, limit: HOSTED_PAGE } } }) });
        // The body of a refusal is not repeated: it is the deployment's text, and nothing here should echo a credential.
        if (!response.ok) throw new Error(`The hosted deployment answered ${response.status}${response.status === 401 ? ': create an agent token in its Settings and set MYGITNOTES_R2_REMOTE_TOKEN' : ''}.`);
        const { result } = await response.json() as { result?: { isError?: boolean; structuredContent?: unknown; content?: { text?: unknown; }[]; }; };
        const text = result?.content?.[0]?.text;
        const answer = (result?.structuredContent ?? (typeof text === 'string' ? JSON.parse(text) : undefined)) as { error?: unknown; assets?: unknown; nextOffset?: unknown; } | undefined;
        if (result?.isError || !answer || !Array.isArray(answer.assets)) throw new Error(typeof answer?.error === 'string' ? answer.error : 'The hosted deployment did not answer download_assets; it may run an older MyGitNotes.');
        for (const asset of answer.assets as { key?: unknown; url?: unknown; }[]) {
          if (typeof asset.key === 'string' && typeof asset.url === 'string' && wanted.has(asset.key) && /^https?:\/\//i.test(asset.url)) found.set(asset.key, asset.url);
        }
        offset = typeof answer.nextOffset === 'number' && answer.nextOffset > offset ? answer.nextOffset : null;
      }
      return found;
    },
  };
}

/** The hosted deployment `MYGITNOTES_R2_REMOTE_URL` names, read with the agent token `MYGITNOTES_R2_REMOTE_TOKEN`; null unless both are set. */
export function hostedR2SourceFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): R2ObjectSource | null {
  const remote = env.MYGITNOTES_R2_REMOTE_URL?.trim(), token = env.MYGITNOTES_R2_REMOTE_TOKEN?.trim();
  return remote && token ? hostedR2Source(remote, token, fetcher) : null;
}

/**
 * The source a local checkout reads private objects from: the bucket named by `MYGITNOTES_R2_*` when its keys are
 * set, else the hosted deployment of `hostedR2SourceFromEnv`, else none.
 */
export function localR2Source(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): R2ObjectSource | null {
  const settings = r2SettingsFromEnv(env);
  return settings ? bucketR2Source({ settings, prefix: '' }) : hostedR2SourceFromEnv(env, fetcher);
}

/** Reads the object behind a presigned URL into the cache, sending no credential; with `maxBytes`, a larger object is refused before or while it is read. */
export async function fetchR2ObjectToCache(cache: R2Cache, key: string, url: string, { fetcher = fetch, maxBytes }: { fetcher?: typeof fetch; maxBytes?: number; } = {}): Promise<CachedR2Object> {
  const response = await fetcher(url);
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    // A missing object stays a 404 for the caller; any other refusal is the store's failure.
    throw new SourceError(`the object store answered ${response.status}`, response.status === 404 ? 404 : 502);
  }
  if (maxBytes !== undefined && Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new R2ObjectTooLargeError(`The object is larger than ${maxBytes} bytes.`);
  }
  return cache.store(key, response.body, { etag: response.headers.get('etag') ?? undefined, maxBytes });
}

export interface R2DownloadOptions {
  /** The note as the local checkout holds it; only the keys its text references are downloaded. */
  note: { path: string; content: string; };
  /** Where missing objects are read from; null reads nothing and reports what the cache lacks. */
  source: R2ObjectSource | null;
  cache: R2Cache;
  /** Also copies each object to `<outDir>/<key>`. */
  outDir?: string;
  /** Reads every referenced object again, cached or not. */
  refresh?: boolean;
  fetcher?: typeof fetch;
}

export interface R2DownloadReport {
  /** The keys the note references. */
  keys: string[];
  /** Keys read from the source in this run. */
  downloaded: string[];
  /** Keys the cache already held. */
  cached: string[];
  /** Keys this run could not read into the cache or could not copy into `outDir`, and why. */
  missing: { key: string; reason: string; }[];
  /** The files written under `outDir`. */
  written: string[];
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Downloads the private objects one note references into the cache, and into `outDir` when given. Only keys the
 * note's own text references are asked for, an object the cache holds is not read again, and a copy is written
 * inside `outDir` or not at all.
 */
export async function downloadNoteR2Objects({ note, source, cache, outDir, refresh = false, fetcher = fetch }: R2DownloadOptions): Promise<R2DownloadReport> {
  const keys = r2ReferenceKeys(note.content);
  const report: R2DownloadReport = { keys, downloaded: [], cached: [], missing: [], written: [] };
  const needed = refresh ? keys : keys.filter(key => !cache.find(key));
  report.cached = keys.filter(key => !needed.includes(key));
  let urls = new Map<string, string>(), unavailable = source ? 'not available to this note' : 'no bucket or hosted deployment is configured';
  if (needed.length && source) {
    try {
      urls = await source.urls(note.path, needed);
    } catch (error) {
      unavailable = message(error);
    }
  }
  for (const key of needed) {
    const url = urls.get(key);
    if (!url) {
      report.missing.push({ key, reason: unavailable });
      continue;
    }
    try {
      await fetchR2ObjectToCache(cache, key, url, { fetcher });
      report.downloaded.push(key);
    } catch (error) {
      report.missing.push({ key, reason: message(error) });
    }
  }
  if (outDir === undefined) return report;
  fs.mkdirSync(outDir, { recursive: true });
  for (const key of keys) {
    const cached = cache.find(key);
    if (!cached) continue;
    try {
      // The key names the path, so it is held to the target folder as a repository path is held to its repository.
      const target = resolveSafePath(outDir, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(cached.file, target);
      report.written.push(target);
    } catch (error) {
      report.missing.push({ key, reason: message(error) });
    }
  }
  return report;
}
