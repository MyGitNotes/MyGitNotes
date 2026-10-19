import { createHash } from 'node:crypto';
import { type EditionSourceConfig, gitBlobId, type RemoteCache, type RemoteChange, type RemoteEntry, RemoteSource, RepositoryUnavailableError, type RepositoryId, type RepositoryScope, type RemoteSnapshot, sourceIdentity, type WorkspacePerson } from '@mygitnotes/core';
import type { EditionSources } from './edition-sources.js';

/** Files by repository-relative path; the repository's whole content. */
export type MemoryFiles = Map<string, string>;

/** A `RemoteSource` over a `Map`: the reference for an edition adapter that keeps repositories outside any provider. */
export class MemoryEditionSource extends RemoteSource {
  constructor(private readonly source: EditionSourceConfig, private readonly files: MemoryFiles, private readonly writable: boolean, private commits: { count: number; }, cache: RemoteCache | undefined, scope: RepositoryScope) {
    super(source.repository, source.branch, undefined, cache, scope);
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
    for (const folder of folders) entries.push({ path: folder, type: 'tree', mode: '040000', sha: createHash('sha1').update(`tree\0${folder}`).digest('hex') });
    const sha = this.head();
    return { sha, treeSha: sha, entries, info: { private: true, permissions: { push: this.writable }, default_branch: this.source.branch } };
  }
  protected async readBlob(sha: string): Promise<Buffer> {
    for (const content of this.files.values()) {
      const bytes = Buffer.from(content, 'utf8');
      if (gitBlobId(bytes, 40) === sha) return bytes;
    }
    throw new RepositoryUnavailableError('no-access', 'No such file.', 404);
  }
  protected async publishChanges(changes: RemoteChange[], _snapshot: RemoteSnapshot, _message: string): Promise<string> {
    for (const change of changes) {
      if (change.sha === null) this.files.delete(change.path);
      else if (change.content !== undefined) this.files.set(change.path, change.content);
      else if (change.base64 !== undefined) this.files.set(change.path, Buffer.from(change.base64, 'base64').toString('utf8'));
      else if (change.sha) this.files.set(change.path, (await this.readBlob(change.sha)).toString('utf8'));
    }
    this.commits.count += 1;
    return this.head();
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
  const commits = new Map<string, { count: number; }>();
  return {
    open(source, { person }, cache, scope) {
      const files = repositories.get(source.repository);
      if (!person || !files || !mayRead(person, source.repository)) throw new RepositoryUnavailableError('no-access', 'This repository is not available to you.', 403);
      if (!commits.has(source.repository)) commits.set(source.repository, { count: 0 });
      return new MemoryEditionSource(source, files, mayWrite(person, source.repository), commits.get(source.repository)!, cache, scope);
    },
  };
}
