import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bucketR2Source, downloadNoteR2Objects, fetchR2ObjectToCache, hostedR2Source, localizeR2References, localR2Source, r2Cache, r2CacheRoot, type R2ObjectSource } from '../src/index.js';

const NOTE = { path: 'notes/ex/rules.md', content: '# Rules\n\n![Map](<r2:ex/maps/old west.png>)\n[Core](r2:ex/core.pdf)\n\n`r2:ex/in-code.png` and plain r2:ex/plain.png\n' };
const KEYS = ['ex/maps/old west.png', 'ex/core.pdf'];
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-r2-local-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A source that knows `objects` and counts what it is asked; `fetcher` answers its URLs and counts the reads. */
function fakeBucket(objects: Record<string, string>) {
  const asked: string[][] = [], fetched: string[] = [];
  const source: R2ObjectSource = {
    urls: async (_note, keys) => {
      asked.push(keys);
      return new Map(keys.filter(key => key in objects).map(key => [key, `https://bucket.test/${encodeURIComponent(key)}?sig=1`]));
    },
  };
  const fetcher = (async (input: string | URL | Request) => {
    const key = decodeURIComponent(new URL(String(input)).pathname.slice(1));
    fetched.push(key);
    return key in objects ? new Response(objects[key], { status: 200, headers: { etag: `"${key.length}"` } }) : new Response('', { status: 404 });
  }) as typeof fetch;
  return { source, fetcher, asked, fetched };
}
const listFiles = (root: string): string[] => fs.existsSync(root) ? fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath, entry.name))).sort() : [];

describe('the local R2 cache', () => {
  it('lives in the checkout unless MYGITNOTES_R2_CACHE_DIR names another folder', () => {
    expect(r2CacheRoot('/srv/notes', {})).toBe(path.join('/srv/notes', '.cache/r2-assets'));
    expect(r2CacheRoot('/srv/notes', { MYGITNOTES_R2_CACHE_DIR: '/var/cache/r2' })).toBe('/var/cache/r2');
    expect(r2CacheRoot('/srv/notes', { MYGITNOTES_R2_CACHE_DIR: 'state/r2' })).toBe(path.join('/srv/notes', 'state/r2'));
  });

  it('stores an object under a name that holds no key text, and finds it again by key', async () => {
    const cache = r2Cache(path.join(dir, 'cache'));
    expect(cache.find('ex/a.png')).toBeNull();
    const stored = await cache.store('ex/a.png', new TextEncoder().encode('image bytes'), { etag: '"abc"' });
    expect(stored).toMatchObject({ key: 'ex/a.png', size: 11, etag: '"abc"' });
    expect(fs.readFileSync(stored.file, 'utf8')).toBe('image bytes');
    expect(cache.find('ex/a.png')).toMatchObject({ key: 'ex/a.png', size: 11, etag: '"abc"', file: stored.file });
    // Every file lies directly in the cache root; no folder is made from the key.
    for (const file of listFiles(cache.root)) expect(file).toMatch(/^[a-f0-9]{64}(\.json)?$/);
  });

  it('refuses a key that is not a valid R2 key and never writes outside the cache root', async () => {
    const cache = r2Cache(path.join(dir, 'cache'));
    for (const key of ['../escape.png', '/etc/passwd', 'a/../../b.png', 'a//b.png', '']) {
      await expect(cache.store(key, new Uint8Array([1]))).rejects.toThrow(/key/i);
      expect(cache.find(key)).toBeNull();
    }
    expect(listFiles(dir)).toEqual([]);
  });

  it('never serves a partial or foreign file: the size and the key must match what was stored', async () => {
    const cache = r2Cache(path.join(dir, 'cache'));
    const stored = await cache.store('ex/a.png', new TextEncoder().encode('image bytes'));
    fs.writeFileSync(stored.file, 'cut');
    expect(cache.find('ex/a.png')).toBeNull();
    const other = await cache.store('ex/b.png', new TextEncoder().encode('b'));
    fs.writeFileSync(`${other.file}.json`, JSON.stringify({ key: 'ex/else.png', size: 1, fetchedAt: 'now' }));
    expect(cache.find('ex/b.png')).toBeNull();
  });

  it('stops at the byte limit and leaves nothing behind', async () => {
    const cache = r2Cache(path.join(dir, 'cache'));
    const body = new Response('0123456789').body!;
    await expect(cache.store('ex/big.bin', body, { maxBytes: 4 })).rejects.toMatchObject({ name: 'R2ObjectTooLargeError' });
    expect(cache.find('ex/big.bin')).toBeNull();
    expect(listFiles(cache.root)).toEqual([]);
  });

  it('says so when the cache folder cannot be written, apart from a failure of the body it reads', async () => {
    fs.writeFileSync(path.join(dir, 'file'), 'not a folder');
    await expect(r2Cache(path.join(dir, 'file/cache')).store('ex/a.png', new Uint8Array([1]))).rejects.toMatchObject({ name: 'R2CacheWriteError' });
    const broken = new ReadableStream<Uint8Array>({ pull: controller => controller.error(new TypeError('terminated')) });
    await expect(r2Cache(path.join(dir, 'cache')).store('ex/a.png', broken)).rejects.toMatchObject({ name: 'TypeError' });
  });

  it('forgets an object, so a later view reads the bucket again, and forgets one that is not there without failing', async () => {
    const cache = r2Cache(path.join(dir, 'cache'));
    await cache.store('ex/core.pdf', new TextEncoder().encode('core'));
    await cache.store('ex/other.png', new TextEncoder().encode('other'));
    cache.remove('ex/core.pdf');
    expect(cache.find('ex/core.pdf')).toBeNull();
    expect(cache.find('ex/other.png')).not.toBeNull();
    expect(() => cache.remove('ex/core.pdf')).not.toThrow();
    expect(() => cache.remove('../outside')).not.toThrow();
    expect(listFiles(cache.root)).toHaveLength(2);
  });

  it('refuses a cache entry that is a symlink out of the cache root', async () => {
    const cache = r2Cache(path.join(dir, 'cache'));
    const stored = await cache.store('ex/a.png', new TextEncoder().encode('image bytes'));
    const outside = path.join(dir, 'outside.txt');
    fs.writeFileSync(outside, 'image bytes');
    fs.rmSync(stored.file);
    fs.symlinkSync(outside, stored.file);
    expect(cache.find('ex/a.png')).toBeNull();
    await expect(cache.store('ex/a.png', new TextEncoder().encode('replaced!!!'))).resolves.toMatchObject({ size: 11 });
    expect(fs.readFileSync(outside, 'utf8')).toBe('image bytes');
  });
});

describe('downloading the objects a note references', () => {
  it('asks only for the keys the note references, fetches each once and caches it', async () => {
    const bucket = fakeBucket({ 'ex/maps/old west.png': 'map', 'ex/core.pdf': 'core', 'ex/in-code.png': 'no', 'ex/plain.png': 'no', 'ex/unreferenced.png': 'no' });
    const cache = r2Cache(path.join(dir, 'cache'));
    const report = await downloadNoteR2Objects({ note: NOTE, source: bucket.source, cache, fetcher: bucket.fetcher });
    expect(report).toMatchObject({ keys: KEYS, downloaded: KEYS, cached: [], missing: [] });
    expect(bucket.asked).toEqual([KEYS]);
    expect(bucket.fetched).toEqual(KEYS);
    expect(fs.readFileSync(cache.find('ex/core.pdf')!.file, 'utf8')).toBe('core');
    expect(cache.find('ex/core.pdf')!.etag).toBe('"11"');

    // A second run finds both in the cache and asks the bucket for nothing.
    const again = await downloadNoteR2Objects({ note: NOTE, source: bucket.source, cache, fetcher: bucket.fetcher });
    expect(again).toMatchObject({ downloaded: [], cached: KEYS, missing: [] });
    expect(bucket.asked).toHaveLength(1);
    expect(bucket.fetched).toEqual(KEYS);

    // --refresh reads them again.
    const refreshed = await downloadNoteR2Objects({ note: NOTE, source: bucket.source, cache, fetcher: bucket.fetcher, refresh: true });
    expect(refreshed.downloaded).toEqual(KEYS);
    expect(bucket.fetched).toHaveLength(4);
  });

  it('leaves out an object larger than the per-object limit, says so, and keeps the rest', async () => {
    const bucket = fakeBucket({ 'ex/maps/old west.png': 'map', 'ex/core.pdf': 'core bytes' });
    const cache = r2Cache(path.join(dir, 'cache'));
    const report = await downloadNoteR2Objects({ note: NOTE, source: bucket.source, cache, fetcher: bucket.fetcher, maxObjectBytes: 5 });
    expect(report.downloaded).toEqual(['ex/maps/old west.png']);
    expect(report.missing).toEqual([{ key: 'ex/core.pdf', reason: expect.stringContaining('larger than 5 bytes') }]);
    expect(cache.find('ex/core.pdf')).toBeNull();
    expect(listFiles(cache.root)).toHaveLength(2);
  });

  it('reports what it could not get and keeps the rest', async () => {
    const bucket = fakeBucket({ 'ex/core.pdf': 'core' });
    const cache = r2Cache(path.join(dir, 'cache'));
    const report = await downloadNoteR2Objects({ note: NOTE, source: bucket.source, cache, fetcher: bucket.fetcher });
    expect(report.downloaded).toEqual(['ex/core.pdf']);
    expect(report.missing).toEqual([{ key: 'ex/maps/old west.png', reason: 'not available to this note' }]);
    // Without a source, a cached object still counts and the rest is named.
    const offline = await downloadNoteR2Objects({ note: NOTE, source: null, cache });
    expect(offline).toMatchObject({ cached: ['ex/core.pdf'], downloaded: [], missing: [{ key: 'ex/maps/old west.png', reason: 'no bucket or hosted deployment is configured' }] });
  });

  it('copies the objects into the target folder by key and writes nowhere else', async () => {
    const note = { path: 'notes/ex/rules.md', content: `${NOTE.content}\n![x](<r2:ex/a\\..\\..\\evil.png>)\n` };
    const bucket = fakeBucket({ 'ex/maps/old west.png': 'map', 'ex/core.pdf': 'core', 'ex/a\\..\\..\\evil.png': 'evil' });
    const out = path.join(dir, 'out/target');
    const report = await downloadNoteR2Objects({ note, source: bucket.source, cache: r2Cache(path.join(dir, 'cache')), fetcher: bucket.fetcher, outDir: out });
    expect(listFiles(out)).toEqual(['ex/core.pdf', 'ex/maps/old west.png']);
    expect(report.written).toEqual([path.join(out, 'ex/maps/old west.png'), path.join(out, 'ex/core.pdf')]);
    expect(fs.readFileSync(path.join(out, 'ex/maps/old west.png'), 'utf8')).toBe('map');
    expect(report.missing).toEqual([{ key: 'ex/a\\..\\..\\evil.png', reason: expect.stringMatching(/escapes|traversal/i) }]);
    // Only the cache and the target folder hold files.
    expect(listFiles(dir).filter(file => !file.startsWith('cache/') && !file.startsWith('out/target/'))).toEqual([]);
  });
});

describe('where local mode reads objects from', () => {
  const R2 = { MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_ACCESS_KEY_ID: 'AK', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'r2-secret', MYGITNOTES_R2_BUCKET: 'private-assets' };

  it('presigns short-lived URLs with the bucket keys of the environment, inside the key prefix only', async () => {
    const source = localR2Source(R2)!;
    const urls = await source.urls('notes/ex/rules.md', ['ex/core.pdf']);
    const url = new URL(urls.get('ex/core.pdf')!);
    expect(url.origin + url.pathname).toBe('https://acc.r2.cloudflarestorage.com/private-assets/ex/core.pdf');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(String(url)).not.toContain('r2-secret');
    const scoped = bucketR2Source({ settings: { accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'b' }, prefix: 'r/42/' });
    expect([...(await scoped.urls('n.md', ['r/42/ex/a.png', 'r/43/ex/b.png', 'ex/c.png'])).keys()]).toEqual(['r/42/ex/a.png']);
  });

  it('has no source when neither bucket keys nor a hosted deployment are configured', () => {
    expect(localR2Source({})).toBeNull();
    expect(localR2Source({ MYGITNOTES_R2_REMOTE_URL: 'https://notes.example' })).toBeNull();
  });

  it('asks a hosted deployment through /mcp with the agent token, page by page, and keeps only the keys it asked for', async () => {
    const calls: { url: string; init: RequestInit; }[] = [];
    const pages = [{ assets: [{ key: 'ex/core.pdf', url: 'https://bucket.test/core?sig=1' }, { key: 'ex/other.png', url: 'https://bucket.test/other?sig=1' }], total: 3, nextOffset: 2 }, { assets: [{ key: 'ex/maps/old west.png', url: 'javascript:alert(1)' }], total: 3, nextOffset: null }];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init! });
      const result = pages[calls.length - 1];
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const source = localR2Source({ MYGITNOTES_R2_REMOTE_URL: 'https://notes.example/', MYGITNOTES_R2_REMOTE_TOKEN: 't'.repeat(43) }, fetcher)!;
    const urls = await source.urls('notes/ex/rules.md', KEYS);
    // A key the caller did not ask for and a URL that is not http(s) are dropped.
    expect([...urls]).toEqual([['ex/core.pdf', 'https://bucket.test/core?sig=1']]);
    expect(calls.map(call => call.url)).toEqual(['https://notes.example/mcp', 'https://notes.example/mcp']);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${'t'.repeat(43)}`);
    expect(calls[0].init.redirect).toBe('error');
    expect(JSON.parse(String(calls[0].init.body)).params).toEqual({ name: 'download_assets', arguments: { path: 'notes/ex/rules.md', offset: 0, limit: 50 } });
    expect(JSON.parse(String(calls[1].init.body)).params.arguments.offset).toBe(2);
  });

  it('takes object URLs only over https or on this machine, and stops paging once every asked key is found', async () => {
    const pages = [{ assets: [{ key: 'ex/core.pdf', url: 'http://bucket.test/core?sig=1' }, { key: 'ex/maps/old west.png', url: 'http://127.0.0.1:9000/map?sig=1' }], total: 90, nextOffset: 50 }, { assets: [{ key: 'ex/core.pdf', url: 'https://bucket.test/core?sig=2' }], total: 90, nextOffset: 100 }, { assets: [], total: 90, nextOffset: null }];
    let calls = 0;
    const fetcher = (async () => {
      const result = pages[calls++];
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: result, content: [] } }), { status: 200 });
    }) as typeof fetch;
    const urls = await hostedR2Source('http://127.0.0.1:8080', 't', fetcher).urls('notes/ex/rules.md', KEYS);
    // The plain-http bucket URL of a remote host is refused; a loopback deployment's loopback one and the https one are kept.
    expect([...urls].sort()).toEqual([['ex/core.pdf', 'https://bucket.test/core?sig=2'], ['ex/maps/old west.png', 'http://127.0.0.1:9000/map?sig=1']]);
    // Both keys were found on the second page, so the third is never asked for.
    expect(calls).toBe(2);
  });

  it('keeps no object URL a remote deployment aims at this machine or a private address, but lets a loopback deployment answer loopback URLs', async () => {
    const aimed = ['http://127.0.0.1:8787/api/x', 'http://localhost:3000/', 'http://[::1]:22/', 'http://2130706433/', 'https://127.0.0.1/', 'https://localhost./x', 'https://192.168.1.1/admin', 'https://10.0.0.5/', 'https://172.16.0.1/', 'https://169.254.169.254/latest', 'https://100.64.0.1/', 'https://0.0.0.0/', 'https://[fd00::1]/', 'https://[fe80::1]/', 'https://[::ffff:10.0.0.1]/', 'https://0x7f000001/', 'https://a.localhost/'];
    const answer = (urls: string[]) => (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: { assets: urls.map((url, index) => ({ key: `ex/${index}.png`, url })), nextOffset: null }, content: [] } }), { status: 200 })) as typeof fetch;
    const keys = aimed.map((_url, index) => `ex/${index}.png`);
    expect([...(await hostedR2Source('https://notes.example', 't', answer(aimed)).urls('n.md', keys))]).toEqual([]);
    const fine = ['https://bucket.example/a?sig=1', 'https://172.32.0.1/b', 'https://[2001:db8::1]/c'];
    expect([...(await hostedR2Source('https://notes.example', 't', answer(fine)).urls('n.md', keys)).values()]).toEqual(fine);
    const local = ['http://127.0.0.1:9000/a', 'http://localhost:9000/b'];
    expect([...(await hostedR2Source('http://127.0.0.1:8080', 't', answer(local)).urls('n.md', keys)).values()]).toEqual(local);
  });

  it('reads an object without following a redirect', async () => {
    const seen: (RequestInit | undefined)[] = [];
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => (seen.push(init), new Response('x', { status: 200 }))) as typeof fetch;
    await fetchR2ObjectToCache(r2Cache(path.join(dir, 'cache')), 'ex/core.pdf', 'https://bucket.test/core?sig=1', { fetcher });
    expect(seen[0]?.redirect).toBe('error');
  });

  it('drops a connector path (/mcp/<token>) pasted into the deployment URL instead of asking /mcp/<token>/mcp', async () => {
    const urls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => (urls.push(String(input)), new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: { assets: [], nextOffset: null }, content: [] } }), { status: 200 }))) as typeof fetch;
    for (const remote of ['https://notes.example/mcp/abc123_-TOKEN', 'https://notes.example/mcp/abc123_-TOKEN/', 'https://notes.example/mcp', 'https://notes.example']) await hostedR2Source(remote, 't', fetcher).urls('n.md', KEYS);
    await hostedR2Source('https://notes.example/app/mcp/abc123', 't', fetcher).urls('n.md', KEYS);
    expect(urls).toEqual([...Array(4).fill('https://notes.example/mcp'), 'https://notes.example/app/mcp']);
  });

  it('sends the agent token only over https or to this machine, and never repeats it in an error', async () => {
    const token = 'secret-token-value';
    expect(() => hostedR2Source('http://notes.example', token)).toThrow(/https/);
    expect(() => hostedR2Source('ftp://notes.example', token)).toThrow(/https/);
    expect(() => hostedR2Source('http://127.0.0.1:4321', token)).not.toThrow();
    const refused = hostedR2Source('https://notes.example', token, (async () => new Response(JSON.stringify({ error: `bad ${token}` }), { status: 401 })) as typeof fetch);
    const error = await refused.urls('notes/ex/rules.md', KEYS).catch(error => error as Error);
    expect(error.message).toMatch(/401/);
    expect(error.message).not.toContain(token);
    const failing = hostedR2Source('https://notes.example', token, (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'Path is not a configured note.' }) }] } }), { status: 200 })) as typeof fetch);
    await expect(failing.urls('notes/ex/rules.md', KEYS)).rejects.toThrow('Path is not a configured note.');
    // An older deployment answers an unknown tool in plain words, not JSON.
    const older = hostedR2Source('https://notes.example', token, (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] } }), { status: 200 })) as typeof fetch);
    await expect(older.urls('notes/ex/rules.md', KEYS)).rejects.toThrow(/older MyGitNotes/);
  });
});

describe('localizing references for a downloaded copy', () => {
  it('points the references of the given keys at local paths and leaves the others as they are', () => {
    const markdown = '![Map](<r2:ex/maps/old west.png>)\n[Core](r2:ex/core%20%281%29.pdf)\n<img src="r2:ex/a.png">\n[gone](r2:ex/gone.pdf)\n\n[ref]: r2:ex/maps/region.webp\n';
    const local = localizeR2References(markdown, { 'ex/maps/old west.png': 'assets/ex/maps/old west.png', 'ex/core (1).pdf': 'assets/ex/core (1).pdf', 'ex/a.png': 'assets/ex/a.png', 'ex/maps/region.webp': 'assets/ex/maps/region.webp' });
    expect(local).toBe('![Map](<assets/ex/maps/old west.png>)\n[Core](assets/ex/core%20%281%29.pdf)\n<img src="assets/ex/a.png">\n[gone](r2:ex/gone.pdf)\n\n[ref]: assets/ex/maps/region.webp\n');
  });
});
