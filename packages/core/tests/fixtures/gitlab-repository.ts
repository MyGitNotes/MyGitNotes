import { createHash, createHmac } from 'node:crypto';
import { gitListing } from '../../src/git-tree.js';
import { gitBlobId, MemoryRemoteCache, type RemoteCache } from '../../src/remote-cache.js';
import type { RemoteEntry } from '../../src/remote-source.js';

type Tree = Map<string, { blob: string; mode: string; }>;
/** A file as a test names it: its text, with a mode other than a plain file's when it matters. */
export type RepositoryFile = string | { content: string; mode: string; };
/** What a pushed commit does to each path: write it, or with null delete it. */
export type RepositoryChanges = Record<string, RepositoryFile | null>;
/** Lists the files of one commit; a test that checks ids against git passes git's own listing here. */
export type ListFiles = (files: Record<string, { content: string; mode: string; }>) => RemoteEntry[];

const SITE = 'https://gitlab.example.test';
const PROJECT = 'group/project';

/**
 * A GitLab project as the REST API serves it: commits that never change, object ids as git computes them, the tree
 * listing with keyset or page-number pagination, comparisons, file reads and commits. Every request is counted by kind.
 */
export function gitlabRepository(initial: Record<string, RepositoryFile>, options: { list?: ListFiles; } = {}) {
  const prefix = `${SITE}/api/v4/projects/${encodeURIComponent(PROJECT)}`;
  const blobs = new Map<string, Buffer>();
  const commits = new Map<string, { tree: Tree; parent: string | null; }>();
  const listings = new Map<string, RemoteEntry[]>();
  /** The commit that last changed each path. */
  const last = new Map<string, string>();
  /** Renames a comparison reports as such, new path to old path. */
  const renames = new Map<string, string>();
  const calls: { kind: string; url: string; }[] = [];
  /** Requests and cache reads in the order they happened. */
  const log: string[] = [];
  let head = '', counter = 0;
  const behaviour = { access: true, paging: 'keyset' as 'keyset' | 'keyset-by-id' | 'numbered' | 'bare', crlf: false, compare: 'ok' as 'ok' | 'fails' | 'timeout' | 'drops-one', beforeCommit: undefined as (() => void) | undefined, fail: undefined as ((kind: string) => number | undefined) | undefined };

  const write = (tree: Tree, file: string, value: RepositoryFile, sha: string, keepMode = false) => {
    const { content, mode } = typeof value === 'string' ? { content: value, mode: keepMode ? tree.get(file)?.mode ?? '100644' : '100644' } : value;
    const bytes = Buffer.from(content), blob = gitBlobId(bytes, 40);
    blobs.set(blob, bytes);
    tree.set(file, { blob, mode });
    last.set(file, sha);
  };
  const record = (parent: string | null, change: (tree: Tree, sha: string) => void) => {
    const sha = createHash('sha1').update(`commit ${++counter} on ${parent}`).digest('hex');
    const tree: Tree = new Map(parent ? commits.get(parent)!.tree : []);
    change(tree, sha);
    commits.set(sha, { tree, parent });
    return head = sha;
  };
  record(null, (tree, sha) => Object.entries(initial).forEach(([file, value]) => write(tree, file, value, sha)));

  /** The commit's recursive listing in git's order, which the API does not promise. */
  const listing = (sha: string) => {
    let entries = listings.get(sha);
    if (!entries) {
      const { tree } = commits.get(sha)!;
      entries = options.list ? options.list(Object.fromEntries([...tree].map(([file, { blob, mode }]) => [file, { content: blobs.get(blob)!.toString(), mode }]))) : gitListing([...tree].map(([path, { blob, mode }]) => ({ path, mode, type: 'blob', sha: blob })))!;
      listings.set(sha, entries);
    }
    return entries;
  };
  const ancestors = (sha: string | null) => {
    const seen: string[] = [];
    for (; sha; sha = commits.get(sha)!.parent) seen.push(sha);
    return seen;
  };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  const respond = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), method = init?.method || 'GET';
    if (!url.startsWith(prefix)) throw new Error(`Unexpected endpoint: ${url}`);
    const { pathname, searchParams: query } = new URL(url);
    const endpoint = pathname.slice(new URL(prefix).pathname.length);
    if (!(init?.headers as Record<string, string>)?.Authorization) return json({}, 404);
    const kind = !endpoint ? 'project' : endpoint.startsWith('/repository/branches/') ? 'branch' : endpoint === '/repository/tree' ? (query.get('recursive') === 'true' ? 'tree' : 'root') : endpoint === '/repository/compare' ? 'compare' : endpoint.startsWith('/repository/files/') ? (method === 'HEAD' ? 'head' : 'file') : endpoint.startsWith('/repository/blobs/') ? 'blob' : endpoint === '/repository/commits' && method === 'POST' ? 'commit' : 'unknown';
    calls.push({ kind, url });
    log.push(`gitlab:${kind}`);
    const failure = behaviour.fail?.(kind);
    if (failure) return json({}, failure);
    if (!endpoint) {
      return json({ visibility: 'private', default_branch: 'main' });
    }
    if (endpoint.startsWith('/repository/branches/')) {
      return behaviour.access ? json({ commit: { id: head }, can_push: true }) : json({}, 403);
    }
    if (endpoint === '/repository/tree') {
      const recursive = query.get('recursive') === 'true', ref = query.get('ref')!;
      if (!commits.has(ref)) return json({}, 404);
      // GitLab does not list in git's order; the reverse of it stands for whatever order it uses.
      const entries = listing(ref).filter(entry => recursive || !entry.path.includes('/')).reverse().map(({ path, mode, type, sha }) => ({ id: sha, name: path.slice(path.lastIndexOf('/') + 1), type, path, mode }));
      const size = Number(query.get('per_page') || 20);
      if (behaviour.paging.startsWith('keyset') && query.get('pagination') === 'keyset') {
        // The token is opaque to the reader. An earlier GitLab made it the last entry's object id and resumed after the first entry of that id.
        const token = query.get('page_token'), byId = behaviour.paging === 'keyset-by-id';
        const start = !token ? 0 : byId ? entries.findIndex(entry => entry.id === token) + 1 : Number(Buffer.from(token, 'hex').toString());
        const next = new URL(url);
        next.searchParams.set('page_token', byId ? entries[Math.min(start + size, entries.length) - 1].id : Buffer.from(String(start + size)).toString('hex'));
        return json(entries.slice(start, start + size), 200, start + size < entries.length ? { Link: `<${next}>; rel="next"` } : {});
      }
      // A site without keyset pagination of trees ignores the request for it and pages by number; behind some proxies the paging headers are lost.
      const page = Number(query.get('page') || 1), more = page * size < entries.length;
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      return json(entries.slice((page - 1) * size, page * size), 200, behaviour.paging === 'bare' ? {} : { 'x-next-page': more ? String(page + 1) : '', ...(more ? { Link: `<${url}>; rel="first", <${next}>; rel="next"` } : {}) });
    }
    if (endpoint === '/repository/compare') {
      const from = query.get('from')!, to = query.get('to')!;
      if (behaviour.compare === 'fails') return json({}, 500);
      if (!commits.has(from) || !commits.has(to)) return json({}, 404);
      // Without `straight` GitLab compares from the merge base, which misses what a rewritten branch dropped.
      const base = query.get('straight') === 'true' ? from : ancestors(from).find(sha => ancestors(to).includes(sha))!;
      const before = commits.get(base)!.tree, after = commits.get(to)!.tree;
      const diffs: Record<string, unknown>[] = [];
      for (const file of new Set([...before.keys(), ...after.keys()])) {
        const a = before.get(file), b = after.get(file);
        if (a && b && a.blob === b.blob && a.mode === b.mode) continue;
        const old = !a && renames.has(file) && before.has(renames.get(file)!) && !after.has(renames.get(file)!) ? renames.get(file)! : undefined;
        if (a && !b && [...renames].some(([renamed, source]) => source === file && after.has(renamed) && !before.has(renamed))) continue;
        diffs.push({ old_path: old ?? file, new_path: file, a_mode: (old ? before.get(old) : a)?.mode ?? '0', b_mode: b?.mode ?? '0', new_file: !a && !old, renamed_file: Boolean(old), deleted_file: !b, diff: '' });
      }
      if (behaviour.compare === 'timeout') return json({ commits: [], diffs: diffs.slice(0, 1), compare_timeout: true, compare_same_ref: false });
      return json({ commits: [], diffs: behaviour.compare === 'drops-one' ? diffs.slice(0, -1) : diffs, compare_timeout: false, compare_same_ref: from === to });
    }
    if (endpoint.startsWith('/repository/files/')) {
      const file = decodeURIComponent(endpoint.slice('/repository/files/'.length)), found = commits.get(query.get('ref')!)?.tree.get(file);
      if (!found) return json({}, 404);
      const facts = { blob_id: found.blob, last_commit_id: last.get(file)!, size: blobs.get(found.blob)!.length };
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'X-Gitlab-Blob-Id': facts.blob_id, 'X-Gitlab-Last-Commit-Id': facts.last_commit_id, 'X-Gitlab-Size': String(facts.size), 'X-Gitlab-Execute-Filemode': String(found.mode === '100755') } });
      return json({ ...facts, encoding: 'base64', content: blobs.get(found.blob)!.toString('base64') });
    }
    if (endpoint.startsWith('/repository/blobs/')) {
      const bytes = blobs.get(decodeURIComponent(endpoint.slice('/repository/blobs/'.length)));
      return bytes ? json({ encoding: 'base64', content: bytes.toString('base64'), size: bytes.length }) : json({}, 404);
    }
    if (endpoint === '/repository/commits' && method === 'POST') {
      behaviour.beforeCommit?.();
      const body = JSON.parse(String(init!.body)) as { force: boolean; actions: { action: string; file_path: string; content?: string; last_commit_id?: string; }[]; };
      const current = commits.get(head)!.tree;
      if (body.force !== false) return json({}, 400);
      for (const action of body.actions) {
        if (action.action === 'create' ? current.has(action.file_path) : action.last_commit_id !== last.get(action.file_path)) return json({ message: 'A file changed' }, 400);
      }
      const parent = head;
      record(parent, (tree, sha) => {
        for (const action of body.actions) {
          if (action.action === 'delete') tree.delete(action.file_path);
          else {
            const text = Buffer.from(action.content!, 'base64').toString();
            // Gitaly writes text with `core.autocrlf=input`: carriage returns before line feeds are dropped.
            write(tree, action.file_path, behaviour.crlf ? text.replaceAll('\r\n', '\n') : text, sha, true);
          }
        }
      });
      return json({ id: head, parent_ids: [parent] }, 201);
    }
    return json({}, 404);
  };

  return {
    site: SITE,
    project: PROJECT,
    behaviour,
    log,
    get head() {
      return head;
    },
    /** A `fetch` of its own identity, as each server process has. */
    process: () => ((input: string | URL | Request, init?: RequestInit) => respond(input, init)) as typeof fetch,
    /** The entries GitLab holds for a commit, as a correct reader presents them. */
    listing,
    /** The text of `file` at the head. */
    read: (file: string) => blobs.get(commits.get(head)!.tree.get(file)!.blob)!.toString(),
    /** A commit pushed by someone else on top of the head, or on `parent` to rewrite the branch. `moved` names renames, new path to old. */
    push(changes: RepositoryChanges, { parent = head, moved = {} as Record<string, string> } = {}) {
      for (const [to, from] of Object.entries(moved)) renames.set(to, from);
      return record(parent, (tree, sha) => {
        for (const [file, value] of Object.entries(changes)) {
          if (value === null) tree.delete(file);
          else write(tree, file, value, sha);
        }
      });
    },
    /** The requests made since the last call, counted by kind. */
    take() {
      const counts: Record<string, number> = {};
      for (const call of calls.splice(0)) counts[call.kind] = (counts[call.kind] || 0) + 1;
      return counts;
    },
    /** The URLs requested since the last `take`. */
    urls: (kind: string) => calls.filter(call => call.kind === kind).map(call => call.url),
  };
}

/**
 * A shared cache as a deployment with a session secret provides it: a store any writer can change, whose values a test
 * reads in `values`, and a keyed digest only the server can compute.
 */
export function sealedCache(secret = 'a secret the cache store never sees') {
  const store = new MemoryRemoteCache();
  const values = new Map<string, string>();
  const cache: RemoteCache & { values: Map<string, string>; } = {
    values,
    get: keys => store.get(keys),
    async set(entries, ttl) {
      for (const [key, value] of entries) values.set(key, value);
      return store.set(entries, ttl);
    },
    sign: text => createHmac('sha256', secret).update(text).digest('hex'),
  };
  return cache;
}

const MANIFEST = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';

/** A workspace of about `areas` × 240 entries; thirty areas make the seven thousand of a large documentation repository. */
export function documentationTree(areas = 30): Record<string, RepositoryFile> {
  const files: Record<string, RepositoryFile> = { 'notes/.github-notes.yaml': MANIFEST, 'notes/ex/a.md': '---\ntags: [work]\n---\n# Alpha\n', 'notes/ex/folder/b.md': '# Beta\n', 'README.md': '# Documentation\n', 'scripts/build.sh': { content: '#!/bin/sh\n', mode: '100755' } };
  for (let area = 0; area < areas; area++) {
    for (let section = 0; section < 19; section++) {
      for (let page = 0; page < 11; page++) files[`docs/area-${area}/section-${section}/page-${page}.md`] = `# Page ${area}.${section}.${page}\n`;
    }
  }
  return files;
}
