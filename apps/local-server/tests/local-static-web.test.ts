import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';

// The product checkout (`appRoot`/`base`) and the content workspace it serves notes from
// (`MYGITNOTES_LOCAL_PATH`) are different directories in the field. A workspace checkout can
// carry its own stale, gitignored `apps/web/dist` (e.g. from an old build), which must never
// shadow the product's real web build.
let productRoot: string, workspaceRoot: string, server: Server, base: string;
const writeIndex = (dir: string, body: string) => {
  fs.mkdirSync(path.join(dir, 'apps/web/dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps/web/dist/index.html'), body);
};

beforeEach(async () => {
  productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-product-'));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-workspace-'));
  writeIndex(productRoot, 'PRODUCT_BUILD');
  writeIndex(workspaceRoot, 'STALE_WORKSPACE_BUILD');
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', workspaceRoot);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  server = createServer(createApp(productRoot));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
  if (productRoot) fs.rmSync(productRoot, { recursive: true, force: true });
  if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

it('serves the product checkout web build, not a stale build left in the content workspace', async () => {
  const response = await fetch(`${base}/`);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('PRODUCT_BUILD');
});

it('serves the service worker file uncached so a deployment reaches installed apps, while built assets keep the default caching', async () => {
  fs.mkdirSync(path.join(productRoot, 'apps/web/dist/assets'), { recursive: true });
  fs.writeFileSync(path.join(productRoot, 'apps/web/dist/sw.js'), '// worker');
  fs.writeFileSync(path.join(productRoot, 'apps/web/dist/assets/app-abc123.js'), '// app');
  const worker = await fetch(`${base}/sw.js`);
  expect(worker.status).toBe(200);
  expect(worker.headers.get('cache-control')).toBe('no-cache');
  expect((await fetch(`${base}/assets/app-abc123.js`)).headers.get('cache-control')).not.toBe('no-cache');
});

it('answers a missing worker file or built file with 404, never the app page, while app routes still open it', async () => {
  for (const missing of ['/sw.js', '/assets/index-gone.js']) {
    const response = await fetch(`${base}${missing}`);
    expect(response.status, missing).toBe(404);
    expect(await response.text(), missing).not.toBe('PRODUCT_BUILD');
  }
  for (const route of ['/assets', '/notebooks/work/notes/a.md']) expect(await fetch(`${base}${route}`).then(response => response.text()), route).toBe('PRODUCT_BUILD');
});
