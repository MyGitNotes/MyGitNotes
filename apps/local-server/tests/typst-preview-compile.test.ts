import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { PreviewCompiler } from '../src/typst-preview/compiler.js';

let root: string, server: Server, base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};

// A stand-in for the toolkit's CLI: it records how it was run, then writes a "PDF" holding body.md as it read it at start.
const FAKE_CLI = `
const fs = require('node:fs'), path = require('node:path');
const here = path.join(__dirname, '..');
const control = JSON.parse(fs.readFileSync(path.join(here, 'control.json'), 'utf8'));
const body = fs.readFileSync(path.join(process.cwd(), 'projects', process.argv[3], 'body.md'), 'utf8');
fs.appendFileSync(path.join(here, 'runs.jsonl'), JSON.stringify({ argv: process.argv.slice(1), env: Object.keys(process.env), cwd: process.cwd(), pid: process.pid }) + '\\n');
if (control.ignoreTerm) process.on('SIGTERM', () => {});
if (control.grandchildMs) require('node:child_process').spawn('sleep', [String(control.grandchildMs / 1000)], { stdio: 'inherit' });
console.log('compiling ' + process.argv[3] + ' ' + process.argv[4]);
setTimeout(() => {
  if (body.includes('[@missing]')) {
    console.error('error: label <missing> does not exist in the document');
    process.exit(1);
  }
  fs.writeFileSync(process.argv[process.argv.indexOf('--output') + 1], '%PDF-1.4\\n' + body);
}, control.sleepMs);
`;
const control = (value: { sleepMs: number; ignoreTerm?: boolean; grandchildMs?: number; }) => write('node_modules/thesis-toolkit/control.json', JSON.stringify(value));
const runs = (): { argv: string[]; env: string[]; cwd: string; pid: number; }[] => {
  const file = path.join(root, 'node_modules/thesis-toolkit/runs.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
};
const until = async (done: () => boolean) => {
  for (let i = 0; i < 400 && !done(); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  expect(done()).toBe(true);
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const cli = () => fs.realpathSync(path.join(root, 'node_modules/thesis-toolkit/dist/cli.js'));

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-typst-compile-')));
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('SESSION_SECRET', 'a-secret-the-compiler-must-not-pass-on');
  vi.stubEnv('MYGITNOTES_BRIDGE_TOKEN', 'another');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: p\nnotebooks:\n  - id: p\n    title: Projects\n    root: projects\n  - id: a\n    title: A\n    root: notes\n');
  write('.gitignore', 'node_modules\n');
  write('thesis-toolkit.json', JSON.stringify({ root: '.', projectsDir: 'projects', bibliography: 'library.bib' }));
  write('library.bib', '');
  write('notes/x.md', '# X\n');
  write('projects/demo/body.md', 'first\n');
  write('projects/demo/src/main/main.typ', '');
  write('projects/demo/src/anon/main.typ', '');
  write('node_modules/thesis-toolkit/package.json', JSON.stringify({ name: 'thesis-toolkit', version: '0.1.6', bin: { 'thesis-toolkit': 'dist/cli.js' } }));
  write('node_modules/thesis-toolkit/dist/cli.js', FAKE_CLI);
  control({ sleepMs: 0 });
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

interface Compiled {
  ok: boolean;
  revision?: string;
  durationMs: number;
  log: string;
}
const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) => fetch(`${base}/api/typst-preview/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const compile = async (target = 'main', file = 'projects/demo/body.md') => (await post({ path: file, target })).json() as Promise<Compiled>;
const pdf = (revision?: string, target = 'main') => fetch(`${base}/api/typst-preview/pdf?path=${encodeURIComponent('projects/demo/body.md')}&target=${target}${revision ? `&revision=${revision}` : ''}`);

it('runs the installed toolkit with a fixed command line and none of the server secrets', async () => {
  const result = await compile();
  expect(result).toMatchObject({ ok: true, revision: expect.stringMatching(/^[a-f0-9]{16}$/), log: expect.stringContaining('compiling demo main') });
  const [run] = runs();
  expect(run!.argv.slice(0, 5)).toEqual([cli(), 'compile', 'demo', 'main', '--output']);
  expect(run!.argv).toHaveLength(6);
  // The PDF is written outside the worktree, in the server's own temporary directory.
  expect(path.isAbsolute(run!.argv[5]!)).toBe(true);
  expect(path.relative(root, run!.argv[5]!).startsWith('..')).toBe(true);
  expect(path.basename(path.dirname(run!.argv[5]!))).toMatch(/^mygitnotes-typst-preview-/);
  expect(run!.cwd).toBe(root);
  expect(run!.env).toContain('PATH');
  expect(run!.env.filter(name => /SECRET|MYGITNOTES|TOKEN/.test(name))).toEqual([]);
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe('');

  const served = await pdf(result.revision);
  expect(served.status).toBe(200);
  expect(served.headers.get('content-type')).toBe('application/pdf');
  expect(await served.text()).toBe('%PDF-1.4\nfirst\n');
});

it('runs once more, and only once more, for every compile asked for during a run, and that run reads the last save', async () => {
  control({ sleepMs: 400 });
  const first = compile();
  await until(() => runs().length === 1);
  write('projects/demo/body.md', 'second\n');
  const second = compile();
  write('projects/demo/body.md', 'third\n');
  const third = compile();
  const results = await Promise.all([first, second, third]);
  expect(runs()).toHaveLength(2);
  expect(results.map(result => result.ok)).toEqual([true, true, true]);
  expect(results[1]!.revision).toBe(results[2]!.revision);
  expect(results[0]!.revision).not.toBe(results[1]!.revision);
  expect(await (await pdf(results[2]!.revision)).text()).toBe('%PDF-1.4\nthird\n');
});

it('keeps targets apart', async () => {
  const main = await compile('main'), anon = await compile('anon');
  expect(runs().map(run => run.argv[3])).toEqual(['main', 'anon']);
  expect((await pdf(main.revision, 'main')).status).toBe(200);
  expect((await pdf(anon.revision, 'anon')).status).toBe(200);
});

it('answers a failed run with its log and keeps serving the last good PDF', async () => {
  const good = await compile();
  write('projects/demo/body.md', 'see [@missing]\n');
  const bad = await compile();
  expect(bad.ok).toBe(false);
  expect(bad.revision).toBeUndefined();
  expect(bad.log).toContain('error: label <missing> does not exist');
  const served = await pdf(good.revision);
  expect(served.status).toBe(200);
  expect(await served.text()).toBe('%PDF-1.4\nfirst\n');
});

it('answers 404 before any PDF exists and 409 for a revision that is no longer current', async () => {
  expect((await pdf()).status).toBe(404);
  const first = await compile();
  write('projects/demo/body.md', 'changed\n');
  const second = await compile();
  expect((await pdf(first.revision)).status).toBe(409);
  expect((await pdf(second.revision)).status).toBe(200);
  expect((await pdf()).status).toBe(200);
});

it('refuses a target the project does not have, a note outside a project, and a toolkit that cannot compile', async () => {
  for (const target of ['--watch', '../main', 'nope', '', 7]) expect((await post({ path: 'projects/demo/body.md', target })).status).toBe(400);
  expect((await post({ path: 'notes/x.md', target: 'main' })).status).toBe(404);
  write('node_modules/thesis-toolkit/package.json', JSON.stringify({ name: 'thesis-toolkit', version: '0.1.5', bin: { 'thesis-toolkit': 'dist/cli.js' } }));
  const old = await post({ path: 'projects/demo/body.md', target: 'main' });
  expect(old.status).toBe(409);
  expect(await old.json()).toMatchObject({ code: 'too-old' });
  expect(runs()).toEqual([]);
});

it('refuses another origin, a tailnet guest, and a workspace off the main branch', async () => {
  expect((await post({ path: 'projects/demo/body.md', target: 'main' }, { Origin: 'http://evil.test' })).status).toBe(403);
  vi.stubEnv('MYGITNOTES_REMOTE_ORIGIN', 'https://desk.tail.ts.net');
  vi.stubEnv('MYGITNOTES_REMOTE_OWNER', 'me@example.com');
  expect((await post({ path: 'projects/demo/body.md', target: 'main' }, { Origin: 'https://desk.tail.ts.net', 'Tailscale-User-Login': 'guest@example.com' })).status).toBe(403);
  expect((await fetch(`${base}/api/typst-preview/pdf?path=projects%2Fdemo%2Fbody.md&target=main`, { headers: { Origin: 'https://desk.tail.ts.net', 'Tailscale-User-Login': 'guest@example.com' } })).status).toBe(403);
  git('checkout', '-b', 'other');
  expect((await post({ path: 'projects/demo/body.md', target: 'main' })).status).toBe(403);
  expect(runs()).toEqual([]);
});

const job = () => ({ key: 'k', cli: cli(), cwd: root, project: 'demo', target: 'main' });

it('kills a run that outlasts the timeout, with SIGKILL when it ignores SIGTERM', async () => {
  const compiler = new PreviewCompiler({ timeoutMs: 300, killGraceMs: 200 });
  try {
    control({ sleepMs: 60_000 });
    const polite = await compiler.compile(job());
    expect(polite).toMatchObject({ ok: false, log: expect.stringContaining('timed out') });
    expect(alive(runs()[0]!.pid)).toBe(false);

    control({ sleepMs: 60_000, ignoreTerm: true });
    const stubborn = await compiler.compile(job());
    expect(stubborn.ok).toBe(false);
    expect(alive(runs()[1]!.pid)).toBe(false);
    expect(compiler.pdf('k')).toBeUndefined();
  } finally {
    compiler.dispose();
  }
});

it('frees its slot within the timeout when the toolkit leaves a child holding its output', async () => {
  const compiler = new PreviewCompiler({ timeoutMs: 300, killGraceMs: 200 });
  try {
    control({ sleepMs: 60_000, ignoreTerm: true, grandchildMs: 8000 });
    const started = performance.now();
    const result = await compiler.compile(job());
    expect(result.ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(3000);
  } finally {
    compiler.dispose();
  }
});

it('never runs two compiles of one queue at once, whatever their keys', async () => {
  const compiler = new PreviewCompiler();
  try {
    control({ sleepMs: 300 });
    const first = compiler.compile({ ...job(), key: 'a', queue: 'demo' });
    await until(() => runs().length === 1);
    const second = compiler.compile({ ...job(), key: 'b', queue: 'demo' });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(runs()).toHaveLength(1);
    expect((await Promise.all([first, second])).map(result => result.ok)).toEqual([true, true]);
    expect(runs()).toHaveLength(2);
    expect(compiler.pdf('a')).toBeDefined();
    expect(compiler.pdf('b')).toBeDefined();
  } finally {
    compiler.dispose();
  }
});

it('runs at most two compiles at once', async () => {
  const compiler = new PreviewCompiler();
  try {
    control({ sleepMs: 300 });
    const all = ['a', 'b', 'c'].map(key => compiler.compile({ ...job(), key }));
    await until(() => runs().length === 2);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(runs()).toHaveLength(2);
    expect((await Promise.all(all)).map(result => result.ok)).toEqual([true, true, true]);
    expect(runs()).toHaveLength(3);
  } finally {
    compiler.dispose();
  }
});

it('keeps only the end of a long log', async () => {
  write('node_modules/thesis-toolkit/dist/cli.js', "process.stdout.write('x'.repeat(200000) + 'the end');");
  const compiler = new PreviewCompiler();
  try {
    const result = await compiler.compile(job());
    expect(result.ok).toBe(false);
    expect(result.log.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.log.startsWith('x')).toBe(true);
    // The run printed more than the limit and wrote no PDF: the end of its output stays, then the reason.
    expect(result.log.endsWith('xthe end\nThe compile ended without writing a PDF.')).toBe(true);
  } finally {
    compiler.dispose();
  }
});

it('removes its directory and kills its runs when disposed', async () => {
  const compiler = new PreviewCompiler();
  await compiler.compile(job());
  const directory = path.dirname(compiler.pdf('k')!.file);
  expect(fs.readdirSync(directory)).toEqual([path.basename(compiler.pdf('k')!.file)]);
  control({ sleepMs: 60_000 });
  const running = compiler.compile(job());
  await until(() => runs().length === 2);
  compiler.dispose();
  expect(fs.existsSync(directory)).toBe(false);
  expect((await running).ok).toBe(false);
  await until(() => !alive(runs()[1]!.pid));
  expect(compiler.pdf('k')).toBeUndefined();
});
