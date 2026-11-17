import { createHash } from 'node:crypto';
import { type CommitAuthor, type EditionSourceConfig, gitBlobId, type RemoteCache, type RemoteChange, type RemoteCommit, type RemoteEntry, type RemoteSnapshot, RemoteSource, type RepositoryId, type RepositoryScope, RepositoryUnavailableError, sourceIdentity, StaleRevisionError, type WorkspacePerson } from '@mygitnotes/core';
import type { EditionSources } from './edition-sources.js';

/** Files by repository-relative path; the repository's whole content. */
export type MemoryFiles = Map<string, string>;

/** One commit a memory source published, or a state of the files a commit was published on. */
export interface MemoryCommit {
  sha: string;
  parents: string[];
  date: string;
  /** The author the source committed as; none for the credential's own account. */
  author?: CommitAuthor;
  message: string;
  /** The paths the commit changed; for a state no commit made, every path it held. */
  paths: string[];
  /** The whole content after the commit. */
  files: ReadonlyMap<string, string>;
}

/** The commit count and log of each repository, kept with its files so every source over the same files shares them. */
const histories = new WeakMap<MemoryFiles, { counter: { count: number; }; commits: MemoryCommit[]; }>();
const historyOf = (files: MemoryFiles) => {
  let history = histories.get(files);
  if (!history) histories.set(files, history = { counter: { count: 0 }, commits: [] });
  return history;
};

/** The commit counter of a repository's files: sources given the same counter agree on its head. */
export function memoryCommitCounter(files: MemoryFiles): { count: number; } {
  return historyOf(files).counter;
}

/** The commits memory sources published to these files, oldest first, with the states they were published on. */
export function memoryCommits(files: MemoryFiles): readonly MemoryCommit[] {
  return historyOf(files).commits;
}

const blobOf = (content: string) => gitBlobId(Buffer.from(content, 'utf8'), 40);

/**
 * Of the files a commit removed, the one an added file of text `added` was renamed from, as Git's rename detection takes
 * it: the same text, else the most similar one that keeps at least half its lines (counting each line once per
 * occurrence, against the longer of the two); null when none does.
 */
export function renamedSource(added: string, removed: readonly (readonly [string, string])[]): string | null {
  const exact = removed.find(([, text]) => text === added);
  if (exact) return exact[0];
  const lines = (text: string) => text.split('\n').filter((line, index, all) => line || index < all.length - 1);
  const mine = lines(added);
  let best: [string, number] | null = null;
  for (const [path, text] of removed) {
    const left = new Map<string, number>();
    for (const line of mine) left.set(line, (left.get(line) ?? 0) + 1);
    const theirs = lines(text);
    let shared = 0;
    for (const line of theirs) {
      const count = left.get(line) ?? 0;
      if (count > 0) {
        left.set(line, count - 1);
        shared++;
      }
    }
    const score = shared / Math.max(mine.length, theirs.length, 1);
    if (score >= 0.5 && (!best || score > best[1])) best = [path, score];
  }
  return best?.[0] ?? null;
}

/**
 * A `RemoteSource` over a `Map`: the reference for an edition adapter that keeps repositories outside any provider.
 * Every commit is logged with its author and message (`memoryCommits`), so a file's history and past blobs read back,
 * and a commit on a head that moved is refused as a provider refuses it.
 */
export class MemoryEditionSource extends RemoteSource {
  constructor(private readonly source: EditionSourceConfig, private readonly files: MemoryFiles, private readonly writable: boolean, private commits: { count: number; }, cache: RemoteCache | undefined, scope: RepositoryScope, commitsAs?: CommitAuthor) {
    super(source.repository, source.branch, undefined, cache, scope, commitsAs);
  }
  get id(): RepositoryId {
    return sourceIdentity(this.source);
  }
  /** Writes follow the person's right to this repository, not a token. */
  protected override mayWrite() {
    return this.writable;
  }
  private head(): string {
    return createHash('sha1').update(`${this.commits.count}\0${[...this.files].map(([file, content]) => `${file}\0${content}`).join('\0')}`).digest('hex');
  }
  protected async loadSnapshot(): Promise<RemoteSnapshot> {
    const entries: RemoteEntry[] = [];
    const folders = new Set<string>();
    for (const [file, content] of [...this.files].sort(([a], [b]) => a.localeCompare(b))) {
      const bytes = Buffer.from(content, 'utf8');
      entries.push({ path: file, type: 'blob', mode: '100644', sha: gitBlobId(bytes, 40), size: bytes.length });
      const parts = file.split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    }
    // A folder's sha covers its children's names, kinds and shas, so it changes whenever anything beneath it does.
    const children = (folder: string) => entries.filter(entry => entry.path.slice(0, entry.path.lastIndexOf('/') + 1) === (folder ? `${folder}/` : '') && entry.path !== folder);
    for (const folder of [...folders].sort((a, b) => b.split('/').length - a.split('/').length)) {
      const sha = createHash('sha1').update(`tree\0${children(folder).map(entry => `${entry.type}\0${entry.path}\0${entry.sha}`).sort().join('\0')}`).digest('hex');
      entries.push({ path: folder, type: 'tree', mode: '040000', sha });
    }
    const sha = this.head();
    return { sha, treeSha: sha, entries, info: { private: true, permissions: { push: this.writable }, default_branch: this.source.branch } };
  }
  protected async readBlob(sha: string): Promise<Buffer> {
    for (const content of this.files.values()) if (blobOf(content) === sha) return Buffer.from(content, 'utf8');
    for (const commit of memoryCommits(this.files)) for (const content of commit.files.values()) if (blobOf(content) === sha) return Buffer.from(content, 'utf8');
    throw new RepositoryUnavailableError('no-access', 'No such file.', 404);
  }
  /** The files of a commit: a logged one, or the current state when `commit` is the head nothing has logged yet. */
  private filesAt(commit: string): ReadonlyMap<string, string> | undefined {
    return memoryCommits(this.files).find(entry => entry.sha === commit)?.files ?? (commit === this.head() ? this.files : undefined);
  }
  protected override async historyPage(file: string, head: string, page: number, perPage: number): Promise<{ commits: RemoteCommit[]; more: boolean; }> {
    const log = memoryCommits(this.files);
    const touching: RemoteCommit[] = [];
    for (let entry = log.find(commit => commit.sha === head); entry; entry = log.find(commit => commit.sha === entry!.parents[0])) {
      if (entry.paths.includes(file)) touching.push({ sha: entry.sha, parents: entry.parents, date: entry.date, author: entry.author?.name ?? 'memory', message: entry.message });
    }
    const start = (page - 1) * perPage;
    return { commits: touching.slice(start, start + perPage), more: touching.length > start + perPage };
  }
  protected override async objectAt(commit: string, file: string): Promise<{ sha: string; size: number; } | null> {
    const content = this.filesAt(commit)?.get(file);
    return content === undefined ? null : { sha: blobOf(content), size: Buffer.byteLength(content, 'utf8') };
  }
  protected override async commitInfo(commit: string): Promise<{ date: string; paths: string[]; } | null> {
    const entry = memoryCommits(this.files).find(logged => logged.sha === commit);
    return entry ? { date: entry.date, paths: entry.paths } : null;
  }
  /** A path the commit removed whose text the added `file` keeps, as Git detects a rename; see {@link renamedSource}. */
  protected override async renamedFrom(commit: string, file: string): Promise<string | null> {
    const log = memoryCommits(this.files);
    const entry = log.find(logged => logged.sha === commit);
    const before = entry?.parents[0] ? log.find(logged => logged.sha === entry.parents[0])?.files : undefined;
    const added = entry?.files.get(file);
    if (!entry || !before || added === undefined || before.has(file)) return null;
    return renamedSource(added, entry.paths.flatMap(path => before.has(path) && !entry.files.has(path) ? [[path, before.get(path)!] as const] : []));
  }
  protected async publishChanges(changes: RemoteChange[], snapshot: RemoteSnapshot, message: string, author?: CommitAuthor): Promise<string> {
    const parent = this.head();
    // A provider refuses a commit on a head another writer has moved since the snapshot was read.
    if (snapshot.sha !== parent) throw new StaleRevisionError([this.id]);
    const log = historyOf(this.files).commits;
    const date = new Date().toISOString();
    if (!log.some(entry => entry.sha === parent)) log.push({ sha: parent, parents: [], date, message: 'Memory state', paths: [...this.files.keys()], files: new Map(this.files) });
    for (const change of changes) {
      if (change.sha === null) this.files.delete(change.path);
      else if (change.content !== undefined) this.files.set(change.path, change.content);
      else if (change.base64 !== undefined) this.files.set(change.path, Buffer.from(change.base64, 'base64').toString('utf8'));
      else if (change.sha) this.files.set(change.path, (await this.readBlob(change.sha)).toString('utf8'));
    }
    this.commits.count += 1;
    const sha = this.head();
    log.push({ sha, parents: [parent], date, ...(author ? { author } : {}), message, paths: changes.map(change => change.path).sort(), files: new Map(this.files) });
    return sha;
  }
}

/** What the in-memory edition sources hold and who may reach it. */
export interface MemoryEditionOptions {
  /** Repository name to its files, as the edition's store would hold them. */
  repositories: Map<string, MemoryFiles>;
  /** Whether the request's person may read a repository; nobody is refused by default. A signed-out request reaches nothing. */
  mayRead?(person: WorkspacePerson, repository: string): boolean;
  /** Whether the person may write; everyone who may read may by default. */
  mayWrite?(person: WorkspacePerson, repository: string): boolean;
}

/** The in-memory reference `EditionSources`. */
export function memoryEditionSources({ repositories, mayRead = () => true, mayWrite = () => true }: MemoryEditionOptions): EditionSources {
  return {
    open(source, { person }, cache, scope) {
      const files = repositories.get(source.repository);
      if (!person || !files || !mayRead(person, source.repository)) throw new RepositoryUnavailableError('no-access', 'This repository is not available to you.', 403);
      return new MemoryEditionSource(source, files, mayWrite(person, source.repository), memoryCommitCounter(files), cache, scope);
    },
  };
}
