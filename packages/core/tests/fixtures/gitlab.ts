import { createHash } from 'node:crypto';
import { gitListing } from '../../src/git-tree.js';
import { gitBlobId } from '../../src/remote-cache.js';

/**
 * An in-memory GitLab project behind a `fetch` stand-in. Files and directories are named as git names them, so a
 * directory's id follows the files below it and a cache keyed by a tree's id sees an edit.
 */
export function gitlabFixture(site = 'https://gitlab.example.test/gitlab', extra: Record<string, string> = {}) {
  const manifest = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
  const files = new Map<string, string>([['notes/.github-notes.yaml', manifest], ['notes/ex/a.md', '---\ncustom: preserved\ntags: [work]\n---\n# Alpha\n'], ['notes/ex/folder/_dir.yml', 'title: Folder\n'], ['notes/ex/folder/b.md', '# Beta\n'], ['notes/ex/assets/picture.png', 'image bytes'], ['.github-notes-screen.yaml', 'version: 1\nrows: []\n'], ['AGENTS.md', '# Workspace\n']]);
  for (const [file, content] of Object.entries(extra)) files.set(file, content);
  const sha = (text: string) => createHash('sha1').update(text).digest('hex');
  // Objects are named as git names them, and a commit names one state of the files: changing a file moves the head.
  const blobId = (content: string) => gitBlobId(Buffer.from(content), 40);
  const mode = (path: string) => path.endsWith('symlink.md') ? '120000' : '100644';
  let moved: string | undefined, writes = 0;
  const current = () => moved ?? sha(JSON.stringify([writes, [...files].sort()]));
  let canPush = true, privateRepo = true, rejectCommit = false;
  const calls: { url: string; init?: RequestInit; }[] = [];
  const blobs = new Map<string, string>();
  const last = new Map([...files.keys()].map(file => [file, 'b'.repeat(40)]));
  const prefix = `${site}/api/v4/projects/group%2Fsubgroup%2Fproject`;
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (!url.startsWith(prefix)) throw new Error(`Unexpected fixture endpoint: ${url}`);
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    if (privateRepo && !auth) return json({}, 404);
    const endpoint = url.slice(prefix.length);
    if (!endpoint) return json({ visibility: privateRepo ? 'private' : 'public', default_branch: 'main' });
    if (endpoint.startsWith('/repository/branches/')) return json({ commit: { id: current() }, can_push: Boolean(auth && canPush) });
    if (endpoint.startsWith('/repository/tree?')) {
      for (const content of files.values()) blobs.set(blobId(content), content);
      const query = new URL(url).searchParams;
      const entries = gitListing([...files].map(([path, content]) => ({ path, mode: mode(path), type: 'blob', sha: blobId(content) })))!.filter(entry => query.get('recursive') === 'true' || !entry.path.includes('/')).map(entry => ({ path: entry.path, id: entry.sha, type: entry.type, mode: entry.mode }));
      // Pages by number, as a site older than keyset pagination of trees answers.
      const page = Number(query.get('page') || 1);
      return json(entries.slice((page - 1) * 100, page * 100), 200, { 'x-next-page': page * 100 < entries.length ? String(page + 1) : '' });
    }
    if (endpoint.startsWith('/repository/blobs/')) {
      const value = blobs.get(decodeURIComponent(endpoint.slice('/repository/blobs/'.length)));
      return value === undefined ? json({}, 404) : json({ encoding: 'base64', content: Buffer.from(value).toString('base64'), size: Buffer.byteLength(value) });
    }
    if (endpoint.startsWith('/repository/files/')) {
      const file = decodeURIComponent(endpoint.slice('/repository/files/'.length).split('?')[0]);
      return files.has(file) ? json({ blob_id: blobId(files.get(file)!), last_commit_id: last.get(file) }) : json({}, 404);
    }
    if (endpoint === '/repository/commits' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (rejectCommit || !canPush || body.force !== false) return json({ message: 'File changed' }, 400);
      for (const action of body.actions) {
        if (action.action === 'create' && files.has(action.file_path)) return json({ message: 'File already exists' }, 400);
        if (action.action !== 'create' && action.last_commit_id !== last.get(action.file_path)) return json({}, 400);
      }
      const parent = current();
      moved = undefined;
      writes++;
      for (const action of body.actions) {
        if (action.action === 'delete') files.delete(action.file_path);
        else files.set(action.file_path, Buffer.from(action.content, 'base64').toString('utf8'));
      }
      for (const action of body.actions) last.set(action.file_path, current());
      return json({ id: current(), parent_ids: [parent] }, 201);
    }
    return json({}, 404);
  };
  return {
    files,
    calls,
    request: request as typeof fetch,
    get head() {
      return current();
    },
    get writes() {
      return writes;
    },
    setHead(value: string) {
      moved = value;
    },
    public() {
      privateRepo = false;
    },
    readOnly() {
      canPush = false;
    },
    conflict() {
      rejectCommit = true;
    },
  };
}
