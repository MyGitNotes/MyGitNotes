import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { parseBibliography } from '../src/typst-preview/bibtex.js';

let root: string, outside: string, server: Server, base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const toolkit = (version: string) => {
  write('node_modules/thesis-toolkit/package.json', JSON.stringify({ name: 'thesis-toolkit', version, bin: { 'thesis-toolkit': 'dist/cli.js' } }));
  write('node_modules/thesis-toolkit/dist/cli.js', '');
};
const config = (value: Record<string, unknown>) => write('thesis-toolkit.json', JSON.stringify(value));

const BIB = ['@comment{ignored}', '@string{oup = "Oxford University Press"}', '@book{sosa2007,\n  author = {Sosa, Ernest},\n  title = {A {Virtue} Epistemology},\n  year = {2007},\n  publisher = oup\n}', '@article{two2010, author = "Smith, John and Doe, Jane", title = "Two", date = {2010-05-01}}', '@article{godel1931,\n  author = {Kurt G{\\"o}del},\n  title = {{\\"U}ber formal unentscheidbare S{\\"a}tze},\n  year = 1931\n}', '@book{王2015,\n  author = {王小明},\n  title = {知識論},\n  year = {2015}\n}', '@book{many2011, author = {Smith, John and Ludwig van Beethoven and {World Health Organization}}, title = {Many}, year = {2011}}', '@book{edited2012, editor = {Roe, Richard}, title = {Edited}, year = {2012}}'].join('\n\n');

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-typst-project-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-typst-outside-')));
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes\n  - id: p\n    title: Projects\n    root: projects\n');
  write('.gitignore', 'node_modules\n');
  write('notes/x.md', '# X\n');
  config({ root: '.', projectsDir: 'projects', bibliography: 'refs/library.bib' });
  write('refs/library.bib', BIB);
  write('projects/demo/body.md', '# Body\n');
  write('projects/demo/arguments/deep/note.md', '# Deep\n');
  write('projects/demo/src/main/main.typ', '');
  write('projects/demo/src/anon/main.typ', '');
  write('projects/demo/src/drafts/notes.typ', '');
  write('projects/loose.md', '# Not in a project\n');
  write('projects/-w/body.md', '# Flag\n');
  write('projects/-w/src/main/main.typ', '');
  toolkit('0.1.6');
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
  for (const dir of [root, outside]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const get = (route: string, file: string, headers: Record<string, string> = {}) => fetch(`${base}/api/typst-preview/${route}?path=${encodeURIComponent(file)}`, { headers });
const project = async (file: string) => (await get('project', file)).json();

it('answers the project of a note inside it, with its targets and the toolkit', async () => {
  const res = await get('project', 'projects/demo/body.md');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ project: { name: 'demo', directory: 'projects/demo', targets: ['anon', 'main'], defaultTarget: 'main', bibliographyRevision: expect.stringMatching(/^[a-f0-9]{16}$/) }, toolkit: { ok: true, version: '0.1.6' } });
  expect(await project('projects/demo/arguments/deep/note.md')).toMatchObject({ project: { name: 'demo' } });
});

it('takes the first target in order when there is no main', async () => {
  fs.rmSync(path.join(root, 'projects/demo/src/main'), { recursive: true });
  write('projects/demo/src/zeta/main.typ', '');
  expect(await project('projects/demo/body.md')).toMatchObject({ project: { targets: ['anon', 'zeta'], defaultTarget: 'anon' } });
});

it('answers no project for a note outside one', async () => {
  expect(await project('notes/x.md')).toEqual({ project: null });
  expect(await project('projects/loose.md')).toEqual({ project: null });
});

it('answers no project when the configuration points outside the worktree or is not the toolkit schema', async () => {
  config({ root: '../..', projectsDir: 'projects', bibliography: 'refs/library.bib' });
  expect(await project('projects/demo/body.md')).toEqual({ project: null });
  config({ root: '.', projectsDir: 'projects', bibliography: 'refs/library.bib', command: 'rm -rf /' });
  expect(await project('projects/demo/body.md')).toEqual({ project: null });
  config({ root: '.', projectsDir: 'projects' });
  expect(await project('projects/demo/body.md')).toEqual({ project: null });
});

it('answers no project when the bibliography or the Typst root is a symlink out of the worktree', async () => {
  fs.writeFileSync(path.join(outside, 'secret.bib'), '@book{secret, title = {Secret}}');
  fs.rmSync(path.join(root, 'refs/library.bib'));
  fs.symlinkSync(path.join(outside, 'secret.bib'), path.join(root, 'refs/library.bib'));
  expect(await project('projects/demo/body.md')).toEqual({ project: null });
  expect((await get('bibliography', 'projects/demo/body.md')).status).toBe(404);

  fs.rmSync(path.join(root, 'refs/library.bib'));
  write('refs/library.bib', BIB);
  fs.symlinkSync(outside, path.join(root, 'elsewhere'));
  config({ root: 'elsewhere', projectsDir: 'projects', bibliography: 'refs/library.bib' });
  expect(await project('projects/demo/body.md')).toEqual({ project: null });
});

it('answers no project for a project whose name would be read as a flag', async () => {
  expect(await project('projects/-w/body.md')).toEqual({ project: null });
});

it('leaves out a target whose name would be read as a flag', async () => {
  write('projects/demo/src/-o/main.typ', '');
  expect(await project('projects/demo/body.md')).toMatchObject({ project: { targets: ['anon', 'main'] } });
});

it('reports a toolkit that is too old, and one that is not installed', async () => {
  toolkit('0.1.5');
  expect(await project('projects/demo/body.md')).toMatchObject({ project: { name: 'demo' }, toolkit: { ok: false, code: 'too-old', version: '0.1.5' } });
  toolkit('0.2.0');
  expect(await project('projects/demo/body.md')).toMatchObject({ toolkit: { ok: true, version: '0.2.0' } });
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
  expect(await project('projects/demo/body.md')).toMatchObject({ project: { name: 'demo' }, toolkit: { ok: false, code: 'missing' } });
});

it('refuses a page of another origin, and a tailnet login that does not own this machine', async () => {
  expect((await get('project', 'projects/demo/body.md', { Origin: 'http://evil.test' })).status).toBe(403);
  vi.stubEnv('MYGITNOTES_REMOTE_ORIGIN', 'https://desk.tail.ts.net');
  vi.stubEnv('MYGITNOTES_REMOTE_OWNER', 'me@example.com');
  const tailnet = (login: string, route = 'project') => get(route, 'projects/demo/body.md', { Origin: 'https://desk.tail.ts.net', 'Tailscale-User-Login': login });
  expect((await tailnet('guest@example.com')).status).toBe(403);
  expect((await tailnet('guest@example.com', 'bibliography')).status).toBe(403);
  expect((await tailnet('me@example.com')).status).toBe(200);
  // The general local guard lets the dev:remote origin through for anyone; these routes do not.
  expect((await fetch(`${base}/api/workspace`, { headers: { Origin: 'https://desk.tail.ts.net', 'Tailscale-User-Login': 'guest@example.com' } })).status).toBe(200);
});

it('lists the bibliography with family names, whole CJK names and plain titles', async () => {
  const res = await get('bibliography', 'projects/demo/body.md');
  expect(res.status).toBe(200);
  const body = await res.json() as { revision: string; entries: unknown[]; };
  expect(body.revision).toBe((await project('projects/demo/body.md')).project.bibliographyRevision);
  expect(body.entries).toEqual([{ key: 'sosa2007', authors: ['Sosa'], year: '2007', title: 'A Virtue Epistemology' }, { key: 'two2010', authors: ['Smith', 'Doe'], year: '2010', title: 'Two' }, { key: 'godel1931', authors: ['Gödel'], year: '1931', title: 'Über formal unentscheidbare Sätze' }, { key: '王2015', authors: ['王小明'], year: '2015', title: '知識論' }, { key: 'many2011', authors: ['Smith', 'van Beethoven', 'World Health Organization'], year: '2011', title: 'Many' }, { key: 'edited2012', authors: ['Roe'], year: '2012', title: 'Edited' }]);
});

it('answers 404 with the path the toolkit reads when the bibliography is missing, and for a note outside a project', async () => {
  fs.rmSync(path.join(root, 'refs/library.bib'));
  const res = await get('bibliography', 'projects/demo/body.md');
  expect(res.status).toBe(404);
  expect((await res.json() as { error: string; }).error).toContain('refs/library.bib');
  expect((await get('bibliography', 'notes/x.md')).status).toBe(404);
});

it('changes the bibliography revision when the file changes', async () => {
  const before = (await project('projects/demo/body.md')).project.bibliographyRevision;
  write('refs/library.bib', `${BIB}\n@book{new2020, title = {New}}`);
  expect((await project('projects/demo/body.md')).project.bibliographyRevision).not.toBe(before);
});

it('reads BibTeX accents, quoted and concatenated values, and "and others"', () => {
  expect(parseBibliography([`@Article{a, Author = {Fran\\c{c}ois P\\'erez and Jos{\\'e} Nu\\~nez}, Title = "Caf\\'e {\\&} {\\ss}", Year = "1999"}`, '@book{b, author = {Smith, John and others}, title = {One } # {Two}, date = {2001}}', '@misc(c, title = {No author})', '@book{d, author = {村上, 春樹}, title = {A -- B}}'].join('\n'))).toEqual([{ key: 'a', authors: ['Pérez', 'Nuñez'], year: '1999', title: 'Café & ß' }, { key: 'b', authors: ['Smith', '等', '等'], year: '2001', title: 'One Two' }, { key: 'c', authors: [], year: '', title: 'No author' }, { key: 'd', authors: ['村上春樹'], year: '', title: 'A – B' }]);
});
