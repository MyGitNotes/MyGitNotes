import { createHash } from 'node:crypto';
import type { RemoteEntry } from './remote-source.js';

const name = (entry: RemoteEntry) => entry.path.slice(entry.path.lastIndexOf('/') + 1);
/** Where git places an entry: by the bytes of its name among its siblings, or of its path in a recursive listing, a directory as if it ended with a slash. */
const sortKey = (entry: RemoteEntry, text: string) => Buffer.from(entry.type === 'tree' ? `${text}/` : text);

/** The git object id of the tree whose direct entries are `rows`; 64-character ids hash with SHA-256. */
export function gitTreeId(rows: RemoteEntry[], idLength = 40): string {
  const sorted = rows.map(entry => ({ entry, key: sortKey(entry, name(entry)) })).sort((a, b) => Buffer.compare(a.key, b.key));
  const body = Buffer.concat(sorted.map(({ entry }) => Buffer.concat([Buffer.from(`${entry.type === 'tree' ? '40000' : entry.mode} ${name(entry)}\0`), Buffer.from(entry.sha, 'hex')])));
  return createHash(idLength === 64 ? 'sha256' : 'sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
}

/** `entries` in the order `git ls-tree -r -t` lists them. */
export function inGitOrder(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.map(entry => ({ entry, key: sortKey(entry, entry.path) })).sort((a, b) => Buffer.compare(a.key, b.key)).map(({ entry }) => entry);
}

/**
 * The recursive listing git gives a set of files: the files and every directory above them, each directory's object id
 * hashed from the entries under it, as `git ls-tree -r -t` lists them. Undefined when the files cannot form one tree.
 */
export function gitListing(files: RemoteEntry[], idLength = 40): RemoteEntry[] | undefined {
  const paths = new Set<string>();
  for (const file of files) {
    if (file.type === 'tree' || file.sha.length !== idLength || !/^[0-9a-f]+$/.test(file.sha) || !/^[0-7]{6}$/.test(file.mode) || !file.path || file.path.split('/').some(part => !part) || paths.has(file.path)) return undefined;
    paths.add(file.path);
  }
  const children = new Map<string, RemoteEntry[]>([['', []]]);
  const parent = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  for (const file of files) {
    // Every directory above the file exists, up to the root.
    for (let directory = parent(file.path); !children.has(directory); directory = parent(directory)) children.set(directory, []);
    children.get(parent(file.path))!.push(file);
  }
  const trees: RemoteEntry[] = [];
  // A directory's path is longer than its parent's, so the longest first hashes each directory after everything under it.
  for (const directory of [...children.keys()].filter(Boolean).sort((a, b) => b.length - a.length)) {
    // A file cannot stand where a directory is.
    if (paths.has(directory)) return undefined;
    const tree = { path: directory, mode: '040000', type: 'tree', sha: gitTreeId(children.get(directory)!, idLength) };
    children.get(parent(directory))!.push(tree);
    trees.push(tree);
  }
  return inGitOrder([...files, ...trees]);
}
