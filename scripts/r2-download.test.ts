import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';

const product = process.cwd();
const MANIFEST = 'schema_version: 1\nworkspace:\n  title: Personal\n  default_notebook: personal\nnotebooks:\n  - id: personal\n    title: Personal\n    root: notes/personal\n  - id: work\n    title: Work\n    root: notes/work\n';
const TOKEN = 'agent-token-never-printed';
const servers: Server[] = [];
let root: string, gets: string[], objects: Record<string, string>, endpoint: string;

const write = (name: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), content);
};
const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const files = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.relative(dir, path.join(entry.parentPath, entry.name))).sort() : [];
const BUCKET = () => ({ MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_ACCESS_KEY_ID: 'AK', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'r2-secret', MYGITNOTES_R2_BUCKET: 'private-assets', MYGITNOTES_R2_ENDPOINT: endpoint });
/** Runs the CLI in the workspace; the stand-in servers live in this process, so the child must not block it. */
const run = (args: string[], env: Record<string, string>) =>
  new Promise<{ code: number; output: string; }>(resolve => {
    const cleared = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('MYGITNOTES_') && !name.startsWith('GITHUB_NOTES_')));
    execFile(process.execPath, [path.join(product, 'node_modules/tsx/dist/cli.mjs'), path.join(product, 'scripts/r2-download.ts'), ...args], { cwd: root, env: { ...cleared, ...env }, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, output: stdout + stderr }));
  });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-r2-download-'));
  write('.github-notes.yaml', MANIFEST);
  write('notes/personal/trip.md', '# Trip\n\n![Map](<r2:personal/maps/old west.png>)\n[Ticket](r2:personal/ticket.pdf)\n');
  write('notes/personal/plain.md', '# Plain\n\nNo objects, only `r2:personal/in-code.png`.\n');
  write('notes/work/report.md', '# Report\n\n![Chart](r2:work/chart.png)\n![Map again](<r2:personal/maps/old west.png>)\n');
  gets = [];
  objects = { 'personal/maps/old west.png': 'map', 'personal/ticket.pdf': 'ticket', 'work/chart.png': 'chart', 'personal/in-code.png': 'never', 'personal/unreferenced.png': 'never' };
  endpoint = await listen(createServer((req, res) => {
    const url = new URL(req.url!, 'http://bucket'), key = url.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    if (req.method !== 'GET' || !url.pathname.startsWith('/private-assets/') || req.headers.authorization || !(key in objects)) return res.writeHead(404).end();
    gets.push(key);
    res.end(objects[key]);
  }));
});
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

describe('pnpm r2-download', () => {
  it('downloads the objects every note references into the cache with the bucket keys of the environment, once', async () => {
    const first = await run([], BUCKET());
    expect(first.code).toBe(0);
    expect(gets.sort()).toEqual(['personal/maps/old west.png', 'personal/ticket.pdf', 'work/chart.png']);
    expect(files(path.join(root, '.cache/r2-assets'))).toHaveLength(6);
    expect(first.output).toContain('3 downloaded, 0 already cached, 0 missing');
    expect(first.output).toContain(path.join(fs.realpathSync(root), '.cache/r2-assets'));
    expect(first.output).not.toContain('r2-secret');
    // Only the cache was written: no object landed in the workspace.
    expect(files(root).filter(file => !file.startsWith('.cache/'))).toEqual(['.github-notes.yaml', 'notes/personal/plain.md', 'notes/personal/trip.md', 'notes/work/report.md']);

    const again = await run([], BUCKET());
    expect(again.output).toContain('0 downloaded, 3 already cached, 0 missing');
    expect(gets).toHaveLength(3);
    expect((await run(['--refresh', '--notebook', 'work'], BUCKET())).output).toContain('2 downloaded, 0 already cached, 0 missing');
  });

  it('downloads one note with --note and copies its objects into --out, by key and nowhere else', async () => {
    const out = path.join(root, 'export');
    const result = await run(['--note', 'notes/personal/trip.md', '--out', out], BUCKET());
    expect(result.code).toBe(0);
    expect(gets.sort()).toEqual(['personal/maps/old west.png', 'personal/ticket.pdf']);
    expect(files(out)).toEqual(['personal/maps/old west.png', 'personal/ticket.pdf']);
    expect(fs.readFileSync(path.join(out, 'personal/ticket.pdf'), 'utf8')).toBe('ticket');
    expect(result.output).toContain('2 file(s) copied');
  });

  it('refuses a --note that is not a note of the workspace and reads nothing', async () => {
    write('secrets.md', '![x](r2:personal/ticket.pdf)');
    for (const note of ['secrets.md', '../outside.md', '.github-notes.yaml', 'notes/personal/missing.md']) {
      const result = await run(['--note', note], BUCKET());
      expect(result.code).toBe(1);
      expect(result.output).toMatch(/not a note/);
    }
    expect(gets).toEqual([]);
    expect(files(path.join(root, '.cache/r2-assets'))).toEqual([]);
  });

  it('exits 1 and names each object it could not get', async () => {
    delete objects['personal/ticket.pdf'];
    const result = await run(['--notebook', 'personal'], BUCKET());
    expect(result.code).toBe(1);
    expect(result.output).toContain('1 downloaded, 0 already cached, 1 missing');
    expect(result.output).toMatch(/notes\/personal\/trip\.md: r2:personal\/ticket\.pdf .*404/);
  });

  it('downloads through a hosted deployment with an agent token when the checkout has no bucket keys, and never prints the token', async () => {
    const calls: { authorization?: string; path: unknown; }[] = [];
    const hosted = await listen(createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk)).on('end', () => {
        const call = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { params: { arguments: { path: string; }; }; };
        calls.push({ authorization: req.headers.authorization, path: call.params.arguments.path });
        // The hosted copy of the report does not reference the map, so the deployment does not answer it for that note.
        const keys = call.params.arguments.path === 'notes/personal/trip.md' ? ['personal/maps/old west.png', 'personal/ticket.pdf'] : ['work/chart.png'];
        const result = { path: call.params.arguments.path, assets: keys.map(key => ({ key, url: `${endpoint}/private-assets/${key.split('/').map(encodeURIComponent).join('/')}?X-Amz-Signature=s` })), total: keys.length, nextOffset: null };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] } }));
      });
    }));
    const result = await run([], { MYGITNOTES_R2_REMOTE_URL: hosted, MYGITNOTES_R2_REMOTE_TOKEN: TOKEN });
    expect(result.code).toBe(0);
    expect(result.output).toContain('3 downloaded, 0 already cached, 0 missing');
    expect(calls).toEqual([{ authorization: `Bearer ${TOKEN}`, path: 'notes/personal/trip.md' }, { authorization: `Bearer ${TOKEN}`, path: 'notes/work/report.md' }]);
    expect(gets.sort()).toEqual(['personal/maps/old west.png', 'personal/ticket.pdf', 'work/chart.png']);
    expect(result.output).not.toContain(TOKEN);
    expect(files(root).some(file => fs.readFileSync(path.join(root, file), 'utf8').includes(TOKEN))).toBe(false);
  });

  it('says how to configure a source when the checkout has none', async () => {
    const result = await run([], {});
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/MYGITNOTES_R2_REMOTE_URL/);
    expect(result.output).toMatch(/MYGITNOTES_R2_BUCKET|bucket/i);
    expect(gets).toEqual([]);
  });
});
