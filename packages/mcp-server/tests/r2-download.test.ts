import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { deriveAlias, r2SettingsFromEnv, repositoryRef, WORKSPACE_CONFIG_FILENAME, type WorkspaceConfigSource } from '@mygitnotes/core';
import { handleDownloadAssets, type ToolAssets } from '../src/tools/index.js';
import { createMCPServer } from '../src/server.js';
import { localTools } from '../src/local-tools.js';

const MANIFEST = 'schema_version: 1\nworkspace:\n  title: "Test Workspace"\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: "Example Notebook"\n    root: notes/example\n    assets: assets\n';
const NOTE = '---\ntitle: Welcome\n---\n\n![Photo](<r2:example/images/photo.png>)\n[Scan](r2:example/scan.pdf)\n\n`r2:example/in-code.png`\n';
const BUCKET_ENV = ['ACCOUNT_ID', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'BUCKET', 'ENDPOINT', 'REMOTE_URL', 'REMOTE_TOKEN', 'CACHE_DIR'];

/** An S3-compatible stand-in that only answers object reads, and counts them. */
async function startBucket(objects: Record<string, string>) {
  const gets: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://bucket'), [, bucket, ...parts] = url.pathname.split('/');
    const key = parts.map(decodeURIComponent).join('/');
    if (req.method !== 'GET' || bucket !== 'private-assets' || !url.searchParams.get('X-Amz-Signature') || !(key in objects)) return res.writeHead(404).end();
    gets.push(key);
    res.writeHead(200, { etag: '"e1"' }).end(objects[key]);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { gets, server, endpoint: `http://127.0.0.1:${(server.address() as { port: number; }).port}` };
}

let repo: string, product: string, bucket: Awaited<ReturnType<typeof startBucket>>;
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};

beforeEach(async () => {
  bucket = await startBucket({ 'example/images/photo.png': 'photo bytes', 'example/scan.pdf': 'scan bytes', 'example/in-code.png': 'never', 'example/unreferenced.png': 'never', 'r/42/example/mine.png': 'mine', 'r/43/example/theirs.png': 'theirs' });
  Object.assign(process.env, { MYGITNOTES_R2_ACCOUNT_ID: 'account', MYGITNOTES_R2_ACCESS_KEY_ID: 'key', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'secret', MYGITNOTES_R2_BUCKET: 'private-assets', MYGITNOTES_R2_ENDPOINT: bucket.endpoint });
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-mcp-download-'));
  product = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-mcp-product-'));
  write(WORKSPACE_CONFIG_FILENAME, MANIFEST);
  write('notes/example/welcome.md', NOTE);
});
afterEach(async () => {
  for (const name of BUCKET_ENV) delete process.env[`MYGITNOTES_R2_${name}`];
  await new Promise(resolve => bucket.server.close(resolve));
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(product, { recursive: true, force: true });
});

type Downloaded = { path: string; cache: string; assets: { key: string; reference: string; file: string; size: number; downloaded: boolean; }[]; missing: { key: string; reason: string; }[]; };
const download = (args: { path: string; refresh?: boolean; }, assets?: ToolAssets) => handleDownloadAssets({ repoRoot: repo, productRoot: product, ...(assets ? { assets } : {}) }, args) as Promise<Downloaded>;

describe('download_assets on a local workspace', () => {
  it("saves the objects the note references into the checkout's cache, outside the repository, and reads each once", async () => {
    const first = await download({ path: 'notes/example/welcome.md' });
    expect(first.cache).toBe(path.join(product, '.cache/r2-assets'));
    expect(first.assets.map(({ key, reference, size, downloaded }) => ({ key, reference, size, downloaded }))).toEqual([{ key: 'example/images/photo.png', reference: 'r2:example/images/photo.png', size: 11, downloaded: true }, { key: 'example/scan.pdf', reference: 'r2:example/scan.pdf', size: 10, downloaded: true }]);
    expect(first.missing).toEqual([]);
    for (const asset of first.assets) expect(path.dirname(asset.file)).toBe(first.cache);
    expect(fs.readFileSync(first.assets[0].file, 'utf8')).toBe('photo bytes');
    // A key named only in code, and an object no note names, are never read.
    expect(bucket.gets).toEqual(['example/images/photo.png', 'example/scan.pdf']);
    // Nothing was written into the repository.
    expect(fs.readdirSync(repo, { recursive: true }).map(String).filter(file => !file.startsWith('notes') && file !== WORKSPACE_CONFIG_FILENAME)).toEqual([]);

    const again = await download({ path: 'notes/example/welcome.md' });
    expect(again.assets.map(asset => asset.downloaded)).toEqual([false, false]);
    expect(bucket.gets).toHaveLength(2);
    await download({ path: 'notes/example/welcome.md', refresh: true });
    expect(bucket.gets).toHaveLength(4);
  });

  it('names what the bucket does not hold and keeps what it does', async () => {
    write('notes/example/welcome.md', `${NOTE}\n![Gone](r2:example/gone.png)\n`);
    const result = await download({ path: 'notes/example/welcome.md' });
    expect(result.assets.map(asset => asset.key)).toEqual(['example/images/photo.png', 'example/scan.pdf']);
    expect(result.missing).toEqual([{ key: 'example/gone.png', reason: 'the object store answered 404' }]);
  });

  it('refuses a path that is not a note of the workspace', async () => {
    write('.env', '![x](r2:example/scan.pdf)');
    write('notes/example/assets/readme.md', '![x](r2:example/scan.pdf)');
    // A link inside the notebook to a file outside the repository is not one of its notes either.
    fs.writeFileSync(path.join(product, 'outside.md'), '![x](r2:example/scan.pdf)');
    fs.symlinkSync(path.join(product, 'outside.md'), path.join(repo, 'notes/example/link.md'));
    for (const file of ['.env', '../outside.md', WORKSPACE_CONFIG_FILENAME, 'notes/example/assets/readme.md', 'notes/example/missing.md', 'notes/example/link.md']) await expect(download({ path: file })).rejects.toThrow();
    expect(bucket.gets).toEqual([]);
  });

  it("keeps to the key prefix of the call's storage scope", async () => {
    write('notes/example/welcome.md', '![mine](r2:r/42/example/mine.png)\n![theirs](r2:r/43/example/theirs.png)\n');
    const scoped: ToolAssets = { scope: async () => ({ settings: r2SettingsFromEnv()!, prefix: 'r/42/', limits: { maxObjectBytes: 1024 } }) };
    const result = await download({ path: 'notes/example/welcome.md' }, scoped);
    expect(result.assets.map(asset => asset.key)).toEqual(['r/42/example/mine.png']);
    expect(result.missing).toEqual([{ key: 'r/43/example/theirs.png', reason: 'not available to this note' }]);
    expect(bucket.gets).toEqual(['r/42/example/mine.png']);
  });

  it('reads nothing without a bucket or a hosted deployment, and a storage that has no bucket is not replaced by the environment', async () => {
    const none: ToolAssets = { scope: async () => null };
    const result = await download({ path: 'notes/example/welcome.md' }, none);
    expect(result.assets).toEqual([]);
    expect(result.missing.map(entry => entry.reason)).toEqual(['no bucket or hosted deployment is configured', 'no bucket or hosted deployment is configured']);
    expect(bucket.gets).toEqual([]);
  });

  it('is listed for local agents and answers through the stdio server, caching under the Core checkout', async () => {
    expect(localTools.find(tool => tool.name === 'download_assets')?.inputSchema.required).toEqual(['path']);
    const source: WorkspaceConfigSource = { mode: 'local', settings: async () => ({ site: { type: 'local' }, members: [{ ref: repositoryRef({ type: 'local', path: repo }), alias: deriveAlias(path.basename(repo), new Set()), default: true, hidden: false, localPath: repo }], manifest: (_member, inRepository) => inRepository() }) };
    const server = createMCPServer(product, source);
    const client = new Client({ name: 'fixture', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('download_assets');
      const result = await client.callTool({ name: 'download_assets', arguments: { path: 'notes/example/welcome.md' } });
      const data = JSON.parse((result.content as { text: string; }[])[0].text) as Downloaded;
      expect(result.isError).toBeFalsy();
      expect(data.assets.map(asset => asset.key)).toEqual(['example/images/photo.png', 'example/scan.pdf']);
      expect(data.cache).toBe(path.join(product, '.cache/r2-assets'));
    } finally {
      await client.close();
      await server.close();
    }
  });
});
