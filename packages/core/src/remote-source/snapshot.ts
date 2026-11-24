import type { RepositoryId, RepositoryScope } from '../repository.js';
import { WorkspaceConfig } from '../types.js';
import { SourceError } from '../github-api.js';
import { gitBlobId, REMOTE_CACHE_BATCH_BYTES, REMOTE_CACHE_MAX_VALUE, REMOTE_CACHE_TTL, type RemoteCache } from '../remote-cache.js';
import type { CommitAuthor } from '../commit-author.js';
import type { RemoteChange, RemoteEntry, RemoteSnapshot } from './types.js';

const CACHEABLE_FILE = /\.(md|markdown|mdx|txt|ya?ml)$/i;
/** Blobs kept in memory for one request. */
const LOADED_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The base of every remote reader: its branch snapshot, the blobs this request loaded or the shared cache holds, the
 * workspace manifest it serves, and the provider's contract. The layers above add live notes, history, the note read
 * model and commits (`RemoteSource`).
 */
export abstract class SnapshotSource {
  protected snapshot?: Promise<RemoteSnapshot>;
  protected fresh = false;
  /** Blobs loaded from the shared cache or verified platform reads, by sha. */
  protected loaded = new Map<string, Buffer>();
  private loadedBytes = 0;
  private cacheChecked = new Set<string>();
  /**
   * `scope` supplies the notebooks this repository serves; the workspace manifest is never read from here. `commitsAs` is
   * who the commits this source publishes are authored by, for a deployment whose `token` is not the person's own;
   * without one a commit's author is the token's account, as the provider has it.
   */
  constructor(public repository: string, public branch: string, protected token: string | undefined, protected cache: RemoteCache | undefined, private readonly scope: RepositoryScope, protected readonly commitsAs?: CommitAuthor) {}
  /** The repository's identity within a workspace, as `sourceIdentity` spells it. */
  abstract get id(): RepositoryId;
  protected abstract loadSnapshot(): Promise<RemoteSnapshot>;
  protected abstract readBlob(sha: string): Promise<Buffer>;
  /** Publishes one commit and returns its id. `author` is the source's, already checked; a provider that cannot set a commit's author leaves it out. */
  protected abstract publishChanges(changes: RemoteChange[], snapshot: RemoteSnapshot, message: string, author?: CommitAuthor): Promise<string>;
  protected invalidate() {}

  /** Loads cached blobs for the given files; providers extend this with batched platform reads. */
  async prefetchFiles(files: string[]): Promise<void> {
    const { entries } = await this.getSnapshot();
    const wanted = new Set(files);
    await this.loadCached(entries.filter(entry => wanted.has(entry.path) && entry.type === 'blob' && entry.mode !== '120000'));
  }

  /** What shared-cache keys call this repository; a source on a named site adds the site, so one name on two sites never shares an entry, and an edition source is keyed `edition:<platform>:<repository>`. */
  protected cacheRepository(): string {
    // An edition source is namespaced by its platform here, in the base, so no edition adapter can collide with a provider repository of the same name.
    const id: string = this.id;
    if (id.startsWith('edition:') && id.endsWith(`@${this.branch}`)) return id.slice(0, -(this.branch.length + 1)).toLowerCase();
    return this.repository.toLowerCase();
  }
  private blobKey(sha: string) {
    return `mgn:blob:v1:${this.cacheRepository()}:${sha}`;
  }
  protected cacheable(entry: RemoteEntry) {
    return Boolean(this.cache) && CACHEABLE_FILE.test(entry.path) && (entry.size === undefined || entry.size * 4 / 3 <= REMOTE_CACHE_MAX_VALUE);
  }

  /** Keeps this request's blobs available while bounding its memory. */
  private remember(sha: string, bytes: Buffer) {
    this.loaded.set(sha, bytes);
    this.loadedBytes += bytes.length;
    while (this.loadedBytes > LOADED_MAX_BYTES && this.loaded.size > 1) {
      const oldest = this.loaded.keys().next().value!;
      if (oldest === sha) break;
      this.loadedBytes -= this.loaded.get(oldest)!.length;
      this.loaded.delete(oldest);
    }
  }

  /** Fills loaded blobs from the shared cache. Only entries of this reader's authorized tree are looked up. Returns entries still missing. */
  protected async loadCached(entries: RemoteEntry[]): Promise<RemoteEntry[]> {
    const pending = [...new Map(entries.filter(entry => !this.loaded.has(entry.sha) && this.cacheable(entry) && !this.cacheChecked.has(entry.sha)).map(entry => [entry.sha, entry])).values()];
    let batch: RemoteEntry[] = [], bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const hits = await this.cache!.get(batch.map(entry => this.blobKey(entry.sha)));
      batch.forEach((entry, i) => {
        this.cacheChecked.add(entry.sha);
        if (hits[i] === null) return;
        // Content addressing is the authorization rule for this cache, so a value is only trusted when it hashes to its key.
        const bytes = Buffer.from(hits[i]!, 'base64');
        if (gitBlobId(bytes, entry.sha.length) === entry.sha) this.remember(entry.sha, bytes);
      });
      batch = [];
      bytes = 0;
    };
    for (const entry of pending) {
      const size = (entry.size ?? 64 * 1024) * 4 / 3;
      if (batch.length && bytes + size > REMOTE_CACHE_BATCH_BYTES) await flush();
      batch.push(entry);
      bytes += size;
    }
    await flush();
    return entries.filter(entry => !this.loaded.has(entry.sha));
  }

  /** Stores verified platform reads in the shared cache. */
  protected async storeCached(blobs: [RemoteEntry, Buffer][]) {
    const verified = blobs.filter(([entry, bytes]) => gitBlobId(bytes, entry.sha.length) === entry.sha);
    for (const [entry, bytes] of verified) this.remember(entry.sha, bytes);
    const values = verified.filter(([entry]) => this.cacheable(entry)).map(([entry, bytes]) => [this.blobKey(entry.sha), bytes.toString('base64')] as [string, string]).filter(([, value]) => Buffer.byteLength(value) <= REMOTE_CACHE_MAX_VALUE);
    if (values.length) await this.cache!.set(values, REMOTE_CACHE_TTL);
  }
  async getSnapshot(fresh = false): Promise<RemoteSnapshot> {
    if (fresh) {
      this.snapshot = undefined;
      this.fresh = true;
    }
    this.snapshot ??= this.loadSnapshot();
    return this.snapshot;
  }
  /** Whether this reader holds the credential a write needs; an edition adapter overrides it for a signed-in person without a token. */
  protected mayWrite(): boolean {
    return Boolean(this.token);
  }
  /** Whether this reader's credential may commit to the main workspace branch as of `snapshot`. */
  canWrite(snapshot: RemoteSnapshot) {
    return Boolean(this.mayWrite() && snapshot.info.permissions?.push && this.branch === 'main');
  }
  /** Read immutable blobs from the exact snapshot used for planning or resolution. */
  async readSnapshotFile(snapshot: RemoteSnapshot, file: string): Promise<Buffer> {
    if (file.startsWith('/') || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.' || !p) || file.includes('\0')) throw new SourceError('Invalid repository path.');
    const entry = snapshot.entries.find(e => e.path === file && e.type === 'blob' && e.mode !== '120000');
    if (!entry) throw new SourceError('File unavailable.', 404);
    if ((entry.size || 0) > 5 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
    if (!this.loaded.has(entry.sha)) await this.loadCached([entry]);
    const loaded = this.loaded.get(entry.sha);
    if (loaded) return loaded;
    const buffer = await this.readBlob(entry.sha);
    if (buffer.length > 5 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
    if (this.cacheable(entry)) await this.storeCached([[entry, buffer]]);
    return buffer;
  }

  /** The workspace manifest restricted to the notebooks this repository serves. */
  async config(): Promise<WorkspaceConfig> {
    return this.scope();
  }
}
