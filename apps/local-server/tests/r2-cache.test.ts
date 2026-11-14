import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { r2Cache, r2CacheRoot, r2SettingsFromEnv } from '@mygitnotes/core';
import { type AppServices, createApp } from '../src/app.js';
import type { RepositoryHandle } from '../src/request-workspace.js';

const MANIFEST = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
const NOTE = '# Rules\n\n![Map](<r2:ex/maps/old west.png>)\n[Core](r2:ex/core.pdf)\n[Big](r2:ex/big.mp4)\n[Gone](r2:ex/gone.png)\n';
const MAP_URL = '/r2-assets/ex/maps/old%20west.png?note=notes/ex/rules.md';
const R2 = { MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_ACCESS_KEY_ID: 'AK', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'r2-secret', MYGITNOTES_R2_BUCKET: 'private-assets' };
const servers: Server[] = [];
let root: string, base: string;

const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};

/** An S3-compatible stand-in that answers object reads and records each with its headers. */
async function startBucket(objects: Record<string, string>) {
  const gets: { key: string; authorization?: string; signed: boolean; }[] = [];
  const endpoint = await listen(createServer((req, res) => {
    const url = new URL(req.url!, 'http://bucket'), [, bucket, ...parts] = url.pathname.split('/');
    const key = parts.map(decodeURIComponent).join('/');
    if (req.method !== 'GET' || bucket !== 'private-assets') return res.writeHead(405).end();
    gets.push({ key, authorization: req.headers.authorization, signed: Boolean(url.searchParams.get('X-Amz-Signature')) });
    if (!(key in objects)) return res.writeHead(404).end();
    res.writeHead(200, { etag: '"e1"', 'content-length': Buffer.byteLength(objects[key]) }).end(objects[key]);
  }));
  return { gets, endpoint };
}

async function start(env: Record<string, string>, services: Partial<AppServices> = {}) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-r2-cache-'));
  fs.mkdirSync(path.join(root, 'notes/ex'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes/.github-notes.yaml'), MANIFEST);
  fs.writeFileSync(path.join(root, 'notes/ex/rules.md'), NOTE);
  fs.writeFileSync(path.join(root, 'notes/ex/other.md'), '# Other\n');
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '', MYGITNOTES_R2_CACHE_DIR: '', MYGITNOTES_R2_REMOTE_URL: '', MYGITNOTES_R2_REMOTE_TOKEN: '', GITHUB_NOTES_SOURCE: 'local', GITHUB_NOTES_LOCAL_PATH: root, ...env })) vi.stubEnv(key, value);
  base = await listen(createServer(createApp(root, services)));
}
const get = (url: string) => fetch(`${base}${url}`, { redirect: 'manual' });
const cacheFiles = () => fs.existsSync(path.join(root, '.cache/r2-assets')) ? fs.readdirSync(path.join(root, '.cache/r2-assets')) : [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a local workspace serves private R2 objects through its cache', () => {
  it('reads a referenced object from the bucket on its first view, then answers from the cache without a bucket call', async () => {
    const bucket = await startBucket({ 'ex/maps/old west.png': 'map bytes', 'ex/core.pdf': 'core bytes' });
    await start({ ...R2, MYGITNOTES_R2_ENDPOINT: bucket.endpoint });

    const first = await get(MAP_URL);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('map bytes');
    expect(first.headers.get('content-type')).toBe('image/png');
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect(first.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox; frame-ancestors 'self'");
    expect(first.headers.get('x-frame-options')).toBeNull();
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    expect(first.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''old%20west.png");
    expect(bucket.gets).toEqual([{ key: 'ex/maps/old west.png', authorization: undefined, signed: true }]);
    // The object lies in the checkout's ignored cache folder, under a name that holds no key text.
    expect(cacheFiles().sort().map(name => name.replace(/^[a-f0-9]{64}/, '<sha256>'))).toEqual(['<sha256>', '<sha256>.json']);

    const second = await get(MAP_URL);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe('map bytes');
    expect(bucket.gets).toHaveLength(1);
  });

  it('answers a PDF so the inline preview frame can show it: no frame denial and no sandbox, framed by this origin only', async () => {
    const bucket = await startBucket({ 'ex/core.pdf': 'core bytes' });
    await start({ ...R2, MYGITNOTES_R2_ENDPOINT: bucket.endpoint });
    const pdf = await get('/r2-assets/ex/core.pdf?note=notes/ex/rules.md');
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('x-frame-options')).toBeNull();
    expect(pdf.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(pdf.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('reads the bucket once when several first views arrive together', async () => {
    const bucket = await startBucket({ 'ex/maps/old west.png': 'map bytes' });
    await start({ ...R2, MYGITNOTES_R2_ENDPOINT: bucket.endpoint });
    const answers = await Promise.all([get(MAP_URL), get(MAP_URL), get(MAP_URL)]);
    expect(await Promise.all(answers.map(answer => answer.text()))).toEqual(['map bytes', 'map bytes', 'map bytes']);
    expect(bucket.gets).toHaveLength(1);
  });

  it('shows a cached object offline, with no bucket configured, and still only to a note that references it', async () => {
    await start({});
    const cache = r2Cache(r2CacheRoot(root));
    await cache.store('ex/maps/old west.png', new TextEncoder().encode('map bytes'));
    await cache.store('ex/unreferenced.png', new TextEncoder().encode('secret'));

    const offline = await get(MAP_URL);
    expect(offline.status).toBe(200);
    expect(await offline.text()).toBe('map bytes');
    // A cached object is not served to a note that does not reference it, nor without a note.
    expect((await get('/r2-assets/ex/maps/old%20west.png?note=notes/ex/other.md')).status).toBe(404);
    expect((await get('/r2-assets/ex/unreferenced.png?note=notes/ex/rules.md')).status).toBe(404);
    expect((await get('/r2-assets/ex/maps/old%20west.png')).status).toBe(404);
    expect((await get('/r2-assets/ex/maps/old%20west.png?note=../outside.md')).status).toBe(404);
    // A referenced object that was never downloaded is not found.
    expect((await get('/r2-assets/ex/core.pdf?note=notes/ex/rules.md')).status).toBe(404);
  });

  it("does not serve a cached object outside the requester's asset scope", async () => {
    const bucket = await startBucket({});
    await start({ ...R2, MYGITNOTES_R2_ENDPOINT: bucket.endpoint }, { assetStorage: { resolve: async () => ({ settings: r2SettingsFromEnv()!, prefix: 'r/42/', limits: { maxObjectBytes: 1 } }) } });
    await r2Cache(r2CacheRoot(root)).store('ex/maps/old west.png', new TextEncoder().encode('map bytes'));
    expect((await get(MAP_URL)).status).toBe(404);
    expect(bucket.gets).toEqual([]);
  });

  it('answers 404 for an object the bucket does not hold and 502 when the bucket cannot be reached, caching nothing', async () => {
    const bucket = await startBucket({});
    await start({ ...R2, MYGITNOTES_R2_ENDPOINT: bucket.endpoint });
    expect((await get('/r2-assets/ex/gone.png?note=notes/ex/rules.md')).status).toBe(404);
    vi.stubEnv('MYGITNOTES_R2_ENDPOINT', 'http://127.0.0.1:9');
    expect((await get(MAP_URL)).status).toBe(502);
    expect(cacheFiles()).toEqual([]);
  });

  it('redirects to the bucket, as before the cache, when the cache folder cannot be written', async () => {
    const bucket = await startBucket({ 'ex/maps/old west.png': 'map bytes' });
    await start({ ...R2, MYGITNOTES_R2_ENDPOINT: bucket.endpoint });
    // The cache folder is named under a file, so nothing can be created there.
    vi.stubEnv('MYGITNOTES_R2_CACHE_DIR', path.join(root, 'notes/ex/rules.md/cache'));
    await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    base = await listen(createServer(createApp(root)));
    const answer = await get(MAP_URL);
    expect(answer.status).toBe(302);
    expect(new URL(answer.headers.get('location')!).pathname).toBe('/private-assets/ex/maps/old%20west.png');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[r2-assets]'));
  });

  it('reads through a hosted deployment with an agent token when no bucket keys are set, and sends the token to no one else', async () => {
    const bucket = await startBucket({ 'ex/maps/old west.png': 'map bytes' });
    const calls: { authorization?: string; arguments: Record<string, unknown>; }[] = [];
    const body = (req: IncomingMessage) =>
      new Promise<string>(resolve => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(chunk)).on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
    const hosted = await listen(createServer(async (req, res) => {
      const call = JSON.parse(await body(req)) as { params: { name: string; arguments: Record<string, unknown>; }; };
      calls.push({ authorization: req.headers.authorization, arguments: call.params.arguments });
      if (req.url !== '/mcp' || call.params.name !== 'download_assets') return res.writeHead(404).end();
      const result = { path: call.params.arguments.path, assets: [{ key: 'ex/maps/old west.png', url: `${bucket.endpoint}/private-assets/ex/maps/old%20west.png?X-Amz-Signature=hosted` }], total: 1, nextOffset: null };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] } }));
    }));
    await start({ MYGITNOTES_R2_REMOTE_URL: hosted, MYGITNOTES_R2_REMOTE_TOKEN: 'agent-token' });

    const first = await get(MAP_URL);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('map bytes');
    expect(calls).toEqual([{ authorization: 'Bearer agent-token', arguments: { path: 'notes/ex/rules.md', offset: 0, limit: 50 } }]);
    expect(bucket.gets).toEqual([{ key: 'ex/maps/old west.png', authorization: undefined, signed: true }]);
    // The second view needs neither the deployment nor the bucket.
    expect((await get(MAP_URL)).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(bucket.gets).toHaveLength(1);
    // A key the hosted note does not answer is not found.
    expect((await get('/r2-assets/ex/core.pdf?note=notes/ex/rules.md')).status).toBe(404);
    expect(fs.readdirSync(root, { recursive: true }).map(String).some(file => fs.statSync(path.join(root, file)).isFile() && fs.readFileSync(path.join(root, file), 'utf8').includes('agent-token'))).toBe(false);
  });

  it('redirects to the bucket, as before, for an object larger than a first view caches', async () => {
    const { createLocalR2AssetHandler } = await import('../src/r2-assets.js');
    const bucket = await startBucket({ 'ex/big.mp4': 'a long video', 'ex/core.pdf': 'core' });
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-r2-cache-'));
    for (const [key, value] of Object.entries({ ...R2, MYGITNOTES_R2_ENDPOINT: bucket.endpoint })) vi.stubEnv(key, value);
    const cache = r2Cache(path.join(root, 'cache'));
    const app = express();
    app.get('/r2-assets/*', createLocalR2AssetHandler({ resolve: async () => ({ settings: r2SettingsFromEnv()!, prefix: '', limits: { maxObjectBytes: 1 } }) }, async () => ({ content: NOTE, repository: {} as RepositoryHandle }), cache, { maxObjectBytes: 8 }));
    base = await listen(createServer(app));

    const big = await get('/r2-assets/ex/big.mp4?note=notes/ex/rules.md');
    expect(big.status).toBe(302);
    expect(new URL(big.headers.get('location')!).pathname).toBe('/private-assets/ex/big.mp4');
    expect(big.headers.get('location')).not.toContain('r2-secret');
    expect(cache.find('ex/big.mp4')).toBeNull();
    // The next view redirects at once, without reading the bucket again to learn the size.
    expect((await get('/r2-assets/ex/big.mp4?note=notes/ex/rules.md')).status).toBe(302);
    expect(bucket.gets.filter(read => read.key === 'ex/big.mp4')).toHaveLength(1);
    // A small object is cached as usual.
    expect((await get('/r2-assets/ex/core.pdf?note=notes/ex/rules.md')).status).toBe(200);
    expect(cache.find('ex/core.pdf')?.size).toBe(4);
  });
});
