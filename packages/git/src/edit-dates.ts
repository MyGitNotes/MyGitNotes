import { spawn } from 'node:child_process';
import type { NoteEditFact } from '@mygitnotes/core';
import { runGit } from './git-service.js';

/** The last content change of every file tracked under some roots at one head: repository-relative path to ISO time. */
interface DatedTree {
  head: string;
  scope: string;
  dates: Map<string, string>;
}

/** The dated tree each repository was last asked for, by its top level and scope; replaced as the head moves. */
const trees = new Map<string, DatedTree>();
/** Datings in flight, by top level, head and scope, so requests that arrive together wait for one walk. */
const dating = new Map<string, Promise<DatedTree>>();

/** Where `repoRoot` lies in its repository: the top level and the prefix of `repoRoot` in it; undefined outside one. */
async function located(repoRoot: string): Promise<{ top: string; prefix: string; head: string; } | undefined> {
  try {
    // A repository without a commit fails on HEAD.
    const [top, prefix, head] = (await runGit(['rev-parse', '--show-toplevel', '--show-prefix', 'HEAD^{commit}'], repoRoot)).stdout.split('\n');
    return /^[0-9a-f]{40,64}$/.test(head ?? '') ? { top, prefix, head } : undefined;
  } catch {
    // Not a repository, or one without a commit: nothing is dated from Git.
    return undefined;
  }
}

/** The searched paths a walk still looks for, each with the head paths whose text it holds. */
type Searching = Map<string, string[]>;

/**
 * Walks `range` newest first, as `git log` orders it, and dates each searched path by the first commit that changed its
 * text. A rename that kept the text (the same blob on both sides) moves the search to the former path instead. Stops
 * reading once nothing is searched.
 */
function walk(top: string, range: string, pathspecs: string[], searching: Searching): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!searching.size) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotePath=false', '--literal-pathspecs', 'log', '-M', '--raw', '-z', '--no-abbrev', '--format=%x01%H%x00%aI', range, '--', ...pathspecs], { cwd: top, stdio: ['ignore', 'pipe', 'pipe'] });
    let rest = '', date = '', expectDate = false, stderr = '', done = false;
    /** The raw record being read: its fields, then the one or two paths it names. */
    let record: { oldBlob: string; newBlob: string; status: string; paths: string[]; } | undefined;
    const settle = (error?: Error) => {
      if (done) return;
      done = true;
      if (error) reject(error);
      else resolve(found);
    };
    const dateHeads = (heads: string[]) => {
      for (const file of heads) found.set(file, date);
    };
    const apply = ({ oldBlob, newBlob, status, paths }: NonNullable<typeof record>) => {
      const target = paths.at(-1)!;
      const heads = searching.get(target);
      if (!heads || status === 'D') return;
      searching.delete(target);
      // The same blob on both sides: a move or a mode change, the text untouched. The search goes on where it came from.
      if (oldBlob === newBlob && /^[RMT]/.test(status)) {
        const from = paths[0];
        searching.set(from, [...(searching.get(from) ?? []), ...heads]);
      } else {
        dateHeads(heads);
      }
    };
    const token = (raw: string) => {
      const text = raw.replace(/^\n/, '');
      if (record) {
        record.paths.push(text);
        if (record.paths.length === (/^[RC]/.test(record.status) ? 2 : 1)) {
          apply(record);
          record = undefined;
        }
      } else if (expectDate) {
        date = new Date(text).toISOString();
        expectDate = false;
      } else if (text.startsWith('\x01')) {
        expectDate = true;
      } else if (text.startsWith(':')) {
        const [, , oldBlob, newBlob, status] = text.slice(1).split(' ');
        record = { oldBlob, newBlob, status, paths: [] };
      }
      if (!searching.size && !record) {
        child.kill();
        settle();
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (done) return;
      const parts = (rest + chunk).split('\0');
      rest = parts.pop()!;
      for (const part of parts) {
        token(part);
        if (done) return;
      }
    });
    child.stderr.on('data', (chunk: Buffer) => stderr += chunk.toString());
    child.on('error', settle);
    child.on('close', code => {
      if (rest) token(rest);
      if (code && !done) settle(new Error(`git log failed: ${stderr.trim()}`));
      else settle();
    });
  });
}

/** Every file tracked under `pathspecs` at `head`, repository-relative. */
async function trackedFiles(top: string, head: string, pathspecs: string[]): Promise<string[]> {
  const { stdout } = await runGit(['--literal-pathspecs', 'ls-tree', '-r', '-z', '--full-tree', '--name-only', head, '--', ...pathspecs], top);
  return stdout.split('\0').filter(Boolean);
}

/** Dates the files under `pathspecs` at `head`, walking only the commits since an earlier dating of an ancestor head. */
async function dateTree(top: string, head: string, pathspecs: string[], scope: string): Promise<DatedTree> {
  const files = await trackedFiles(top, head, pathspecs);
  const searching: Searching = new Map(files.map(file => [file, [file]]));
  const previous = trees.get(JSON.stringify([top, scope]));
  let since: DatedTree | undefined;
  if (previous && previous.scope === scope && previous.head !== head) {
    try {
      await runGit(['merge-base', '--is-ancestor', previous.head, head], top);
      since = previous;
    } catch {
      // The head went back or elsewhere: every file is dated again.
    }
  }
  const dates = await walk(top, since ? `${since.head}..${head}` : head, pathspecs, searching);
  // What the commits since the earlier head left unchanged keeps its earlier date, under the path it had then.
  for (const [from, heads] of searching) {
    const known = since?.dates.get(from);
    if (known) { for (const file of heads) dates.set(file, known); }
  }
  return { head, scope, dates };
}

/**
 * Edit-date facts (`NoteEditFact`) of every file Git tracks under `roots` (repository-relative directories of the
 * worktree at `repoRoot`): the author date of the last commit that changed its text, following renames that kept it,
 * and whether the working tree or the index holds uncommitted changes to it. A file Git does not hold is left out, as
 * is everything in a folder that is not a repository or a repository without commits.
 *
 * The dates are computed in one `git log` pass over the roots and kept per repository and head; when the head moves on,
 * only the new commits are read. The uncommitted changes are read on every call. A Git failure is logged and dates
 * nothing, so a read falls back to frontmatter dates instead of failing.
 */
export async function noteEditFacts(repoRoot: string, roots: readonly string[]): Promise<Map<string, NoteEditFact>> {
  try {
    return await editFacts(repoRoot, roots);
  } catch (error) {
    console.warn(`[edit-dates] ${repoRoot}: ${(error as Error).message.split('\n')[0]}`);
    return new Map();
  }
}

async function editFacts(repoRoot: string, roots: readonly string[]): Promise<Map<string, NoteEditFact>> {
  const where = await located(repoRoot);
  const facts = new Map<string, NoteEditFact>();
  if (!where || !roots.length) return facts;
  const { top, prefix, head } = where;
  const pathspecs = [...new Set(roots.map(root => `${prefix}${root}`.replace(/\/+$/, '')))].sort();
  const scope = JSON.stringify(pathspecs);
  const at = JSON.stringify([top, scope]), key = JSON.stringify([top, head, scope]);
  let tree = trees.get(at);
  if (tree?.head !== head) {
    let pending = dating.get(key);
    if (!pending) {
      pending = dateTree(top, head, pathspecs, scope).then(dated => {
        trees.set(at, dated);
        return dated;
      }).finally(() => dating.delete(key));
      dating.set(key, pending);
    }
    tree = await pending;
  }
  const { stdout } = await runGit(['--no-optional-locks', '--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--untracked-files=no', '--', ...pathspecs], top);
  const changed = new Set<string>();
  const entries = stdout.split('\0');
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.length < 4) continue;
    changed.add(entry.slice(3));
    // A rename or copy names its original path next.
    if (/[RC]/.test(entry.slice(0, 2))) index++;
  }
  for (const [file, lastCommitAt] of tree.dates) {
    if (!file.startsWith(prefix)) continue;
    facts.set(file.slice(prefix.length), changed.has(file) ? { lastCommitAt, uncommitted: true } : { lastCommitAt });
  }
  return facts;
}
