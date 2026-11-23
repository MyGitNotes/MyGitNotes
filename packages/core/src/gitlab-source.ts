import { timingSafeEqual } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { type RemoteChange, type RemoteCommit, type RemoteEntry, type RemoteSnapshot, RemoteSource } from './remote-source.js';
import type { CommitAuthor } from './commit-author.js';
import { SourceError } from './github-api.js';
import { gitListing, inGitOrder } from './git-tree.js';
import { normalizeGitLabUrl, sourceIdentity } from './source-config.js';
import { gitBlobId, REMOTE_CACHE_MAX_VALUE, REMOTE_CACHE_TTL, type RemoteCache } from './remote-cache.js';
import { reaching, type RepositoryScope } from './repository.js';
import type { CommitRenames, LastCommit } from './remote-edit-dates.js';

/** The entries of one commit's tree. */
interface Listing {
  sha: string;
  entries: RemoteEntry[];
}
/** A listing as the shared cache keeps it: path, mode, type and object id. */
type ListingRow = [string, string, string, string];
const LISTING_KEY_VERSION = 2;
const OBJECT_ID = /^[a-f0-9]{40}([a-f0-9]{24})?$/;
/** Listings this process holds and those it is reading, by branch and commit. Keyed like the GitHub runtime by its `fetch`, so test doubles never share one. */
const processListings = new WeakMap<typeof fetch, { held: Map<string, RemoteEntry[]>; reading: Map<string, Promise<RemoteEntry[]>>; }>();
/** The most entries the held listings count together. A listing derived from another shares its unchanged entries, so the count overstates their memory. */
const PROCESS_LISTING_ENTRIES = 200_000;
/** A comparison that changed more files than this is not followed. */
const FOLLOWED_FILES = 200;
/** What one cache value holds of a sealed listing, leaving room for its commit and seal. */
const LISTING_PART = REMOTE_CACHE_MAX_VALUE - 1024;
/** Room to inflate a cached listing; the 100,000 entries the source accepts take less. */
const LISTING_MAX_BYTES = 64 * 1024 * 1024;
/** How long a save waits for the listing of its own commit before it answers without it. */
const ADOPT_WAIT = 4000;
/** Paths per GraphQL request for their last commits; GitLab's default query complexity takes about twenty. */
const LAST_COMMIT_BATCH = 20;
/** GraphQL requests in flight at once for one dating step. */
const LAST_COMMIT_REQUESTS = 4;

/** Whether two entries name one object at one path, as one kind and mode. */
const sameEntry = (a: RemoteEntry, b: RemoteEntry | undefined) => a.path === b?.path && a.sha === b.sha && a.type === b.type && a.mode === b.mode;
/** Freezing keeps one request from changing a listing another one reads. */
function frozen(entries: RemoteEntry[]): RemoteEntry[] {
  for (const entry of entries) Object.freeze(entry);
  return Object.freeze(entries) as RemoteEntry[];
}

/** Settles when `work` does or `ms` have passed, whichever comes first, and never rejects. `work` goes on either way. */
function within(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    void work.catch(() => undefined).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** The token of the page a keyset-paginated response names next in its `Link` header; null on the last page. */
function nextPageToken(link: string | null, site: string): string | null {
  const next = /<([^>]*)>\s*;\s*rel="?next"?/i.exec(link || '');
  try {
    // Only the token is taken, so requests keep going to the configured site, whatever host the header names.
    return next && new URL(next[1], site).searchParams.get('page_token');
  } catch {
    return null;
  }
}

/** GitLab API v4 adapter. Reads remain pinned to immutable Git objects. */
export class GitLabSource extends RemoteSource {
  readonly url: string;
  private blobs = new Map<string, Promise<Buffer>>();
  constructor(url: string, repository: string, branch: string, token: string | undefined, private request: typeof fetch, cache: RemoteCache | undefined, scope: RepositoryScope, author?: CommitAuthor) {
    super(repository, branch, token, cache, scope, author);
    this.url = normalizeGitLabUrl(url);
  }
  get id() {
    return sourceIdentity({ type: 'gitlab', url: this.url, repository: this.repository, branch: this.branch });
  }
  private async response(endpoint: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(`${this.url}/api/v4/projects/${encodeURIComponent(this.repository)}${endpoint}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'User-Agent': 'MyGitNotes', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    } catch {
      throw new SourceError('GitLab could not be reached. Check the configured site and connection.', 502);
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Math.max(1, Number(retry)) : 60;
      if (response.status === 429) throw new SourceError('GitLab rate limit reached. Retry later.', 429, seconds);
      if (response.status === 401) throw new SourceError('Sign in again to authorize GitLab access.', 401);
      if (response.status === 403) throw new SourceError('GitLab permission denied.', 403);
      if (response.status === 404) throw new SourceError('GitLab repository, branch or file is unavailable. Sign in for private access.', 404);
      if ([400, 409, 422].includes(response.status) && init.method === 'POST') throw new SourceError('GitLab could not commit this change. Reload and review the latest files before retrying.', 409);
      throw new SourceError('GitLab request failed.', 502);
    }
    return response;
  }
  private async json(endpoint: string, init?: RequestInit): Promise<any> {
    return (await this.response(endpoint, init)).json();
  }
  protected async loadSnapshot(): Promise<RemoteSnapshot> {
    const project = await reaching('no-access', async () => {
      const found = await this.json('');
      if (found.visibility !== 'public' && !this.token) throw new SourceError('Sign in to read this private repository.', 401);
      return found;
    });
    const branch = await reaching('missing-branch', () => this.json(`/repository/branches/${encodeURIComponent(this.branch)}`));
    const sha = branch.commit?.id;
    if (typeof sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(sha)) throw new SourceError('GitLab returned an invalid branch revision.', 502);
    return { sha, treeSha: sha, entries: await this.listing(sha), info: { private: project.visibility !== 'public', default_branch: project.default_branch, permissions: { push: Boolean(this.token && branch.can_push) } } };
  }
  private memory() {
    let memory = processListings.get(this.request);
    if (!memory) processListings.set(this.request, memory = { held: new Map(), reading: new Map() });
    return memory;
  }
  /**
   * What caches call this branch's listing. It names the site with the project, since a commit's listing hashes to no
   * key of its own, and as a JSON array, so no site, project and branch spell the key of three others.
   */
  private listingKey() {
    return `mgn:gitlab-tree:v${LISTING_KEY_VERSION}:${JSON.stringify([this.url, this.cacheRepository(), this.branch])}`;
  }
  /** The cache's seal over this branch's key, a commit and the listing stored as its own; undefined when the cache seals nothing. */
  private seal(sha: string, data: string): string | undefined {
    return this.cache?.sign?.(JSON.stringify([this.listingKey(), sha, data]));
  }
  /**
   * Every entry of commit `sha`, which this reader's own branch read just named. A commit never changes, so the listing
   * comes from this process when it holds it, and requests that arrive together for one nobody holds wait for one read.
   */
  private async listing(sha: string): Promise<RemoteEntry[]> {
    const { held, reading } = this.memory(), key = `${this.listingKey()}:${sha}`;
    for (;;) {
      const entries = held.get(key);
      if (entries) {
        // Refresh its place, so the least recently used listing goes first.
        held.delete(key);
        held.set(key, entries);
        return entries;
      }
      const shared = reading.get(key);
      if (!shared) break;
      try {
        return await shared;
      } catch { /* The request that was reading failed on its own credential or connection. Of those that waited on it, the first to look again reads, and the rest wait on that one. */ }
    }
    const own = this.readListing(sha).finally(() => {
      if (reading.get(key) === own) reading.delete(key);
    });
    reading.set(key, own);
    return own;
  }
  /**
   * A listing this process does not hold: the shared cache's when it is of this commit, else an earlier listing moved
   * to this commit by GitLab's comparison, else GitLab's own, page by page.
   */
  private async readListing(sha: string): Promise<RemoteEntry[]> {
    const stored = await this.storedListing();
    if (stored?.sha === sha) return this.hold(sha, stored.entries);
    // The shared cache holds what any process read last, which is at least as recent as what this one did.
    const base = stored ?? this.lastHeld();
    let entries = base && await this.follow(base, sha);
    if (!entries) {
      entries = inGitOrder(await this.list(sha, true));
      // GitLab names no root tree to hash a listing back to, but each directory it lists has to hash to the entries
      // listed under it. A listing that does not, as when a page named no next one while entries remained, answers the
      // requests waiting on this read and is kept nowhere. One short by whole top-level entries still passes.
      const derived = gitListing(entries.filter(entry => entry.type !== 'tree'), sha.length);
      if (derived?.length !== entries.length || !entries.every((entry, index) => sameEntry(entry, derived[index]))) return frozen(entries);
    }
    // Held first: a store that will not take the listing leaves the process holding it, and the request its answer.
    this.hold(sha, entries);
    await this.store(sha, entries).catch(() => undefined);
    return entries;
  }
  /** Keeps a listing for the requests of every reader this process serves. */
  private hold(sha: string, entries: RemoteEntry[]): RemoteEntry[] {
    const { held } = this.memory(), key = `${this.listingKey()}:${sha}`;
    frozen(entries);
    held.delete(key);
    held.set(key, entries);
    let total = 0;
    for (const listing of held.values()) total += listing.length + 1;
    for (const [oldest, listing] of held) {
      if (total <= PROCESS_LISTING_ENTRIES || oldest === key) break;
      held.delete(oldest);
      total -= listing.length + 1;
    }
    return entries;
  }
  /** The listing of this branch this process used last, to follow a comparison from. */
  private lastHeld(): Listing | undefined {
    const prefix = `${this.listingKey()}:`;
    let last: Listing | undefined;
    for (const [key, entries] of this.memory().held) {
      if (key.startsWith(prefix)) last = { sha: key.slice(prefix.length), entries };
    }
    return last;
  }
  /**
   * The shared cache's listing of this branch, whichever commit it is of. GitLab's REST API names no root tree to
   * hash a listing back to, so the value is trusted only under the cache's seal over its key, commit and content: a
   * writer of the store can then neither change a listing nor present one as another commit's or another project's.
   */
  private async storedListing(): Promise<Listing | undefined> {
    const cache = this.cache, key = this.listingKey();
    if (!cache?.sign) return undefined;
    const [first] = await cache.get([key]);
    if (first === null) return undefined;
    let slot: { sha?: unknown; seal?: unknown; parts?: unknown; data?: unknown; };
    try {
      slot = JSON.parse(first);
    } catch {
      return undefined;
    }
    const { sha, seal, parts } = slot || {};
    let { data } = slot || {};
    if (typeof sha !== 'string' || !OBJECT_ID.test(sha) || typeof seal !== 'string' || typeof data !== 'string' || typeof parts !== 'number' || !Number.isInteger(parts) || parts < 1 || parts > 64) return undefined;
    // One value per read keeps each within the store's request size.
    for (let part = 1; part < parts; part++) {
      const [next] = await cache.get([`${key}:${part}`]);
      if (next === null) return undefined;
      data += next;
    }
    const expected = Buffer.from(this.seal(sha, data) ?? ''), given = Buffer.from(seal);
    if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    try {
      const rows = JSON.parse(inflateRawSync(Buffer.from(data, 'base64'), { maxOutputLength: LISTING_MAX_BYTES }).toString()) as ListingRow[];
      return { sha, entries: rows.map(([path, mode, type, id]) => ({ path, mode, type, sha: id })) };
    } catch {
      return undefined;
    }
  }
  /** Seals a listing into the shared cache as this branch's latest. One per branch is kept, so the store does not grow with every commit. */
  private async store(sha: string, entries: RemoteEntry[]) {
    const cache = this.cache, key = this.listingKey();
    if (!cache?.sign) return;
    const data = deflateRawSync(JSON.stringify(entries.map((entry): ListingRow => [entry.path, entry.mode, entry.type, entry.sha]))).toString('base64');
    const seal = this.seal(sha, data);
    if (!seal) return;
    const parts: string[] = [];
    for (let start = 0; start < data.length; start += LISTING_PART) parts.push(data.slice(start, start + LISTING_PART));
    // The parts beyond the first are written before the value that names them; a reader of a torn write finds the seal broken and reads for itself.
    await cache.set([...parts.slice(1).map((part, index): [string, string] => [`${key}:${index + 1}`, part]), [key, JSON.stringify({ sha, seal, parts: parts.length, data: parts[0] })]], REMOTE_CACHE_TTL);
  }
  /** The tree of `commit` as GitLab lists it, every level of it or the top one. */
  private async list(commit: string, recursive: boolean, keyset = true): Promise<RemoteEntry[]> {
    const entries: RemoteEntry[] = [];
    const seen = new Set<string>(), asked = new Set<string>();
    for (let pointer = keyset ? '' : '&page=1', page = 1;; page++) {
      const response = await this.response(`/repository/tree?ref=${commit}${recursive ? '&recursive=true' : ''}&per_page=100${keyset ? '&pagination=keyset' : ''}${pointer}`);
      const tree = await response.json() as { path: string; type: string; mode: string; id: string; }[];
      if (!Array.isArray(tree)) throw new SourceError('GitLab returned an invalid repository tree.', 502);
      for (const entry of tree) {
        // A page token that names an entry by its object id resumes after the first entry of that id, so files of one content repeat pages; pages by number do not.
        if (keyset && seen.has(entry.path)) return this.list(commit, recursive, false);
        if (!entry.path || !entry.id || seen.has(entry.path)) throw new SourceError('GitLab returned an incomplete repository listing.', 502);
        seen.add(entry.path);
        entries.push({ path: entry.path, type: entry.type, mode: entry.mode, sha: entry.id });
      }
      if (entries.length > 100000) throw new SourceError('Repository exceeds the supported file listing size.', 422);
      const token = keyset ? nextPageToken(response.headers.get('link'), this.url) : null, numbered = response.headers.get('x-next-page');
      if (token) pointer = `&page_token=${encodeURIComponent(token)}`;
      // A site without keyset pagination of trees ignores the request for it and names the next page by number.
      else if (numbered) pointer = `&page=${numbered}`;
      // A full first page that names no next one is all there is, or comes through a proxy that drops the paging headers; pages by number, counted by their length, tell which.
      else if (keyset && page === 1 && numbered === null && tree.length === 100) return this.list(commit, recursive, false);
      else if (!keyset && numbered === null && tree.length === 100) pointer = `&page=${page + 1}`;
      else break;
      if (!tree.length || asked.has(pointer) || numbered && numbered !== String(page + 1)) throw new SourceError('GitLab returned invalid pagination.', 502);
      asked.add(pointer);
    }
    return entries;
  }
  /** The object id of the file at `file` in `commit`, from the response headers alone; null when the commit holds no file there. */
  private async blobAt(commit: string, file: string): Promise<string | null> {
    try {
      const id = (await this.response(`/repository/files/${encodeURIComponent(file)}?ref=${commit}`, { method: 'HEAD' })).headers.get('x-gitlab-blob-id');
      return id && OBJECT_ID.test(id) ? id : null;
    } catch (error) {
      if (error instanceof SourceError && error.status === 404) return null;
      throw error;
    }
  }
  /**
   * The listing git gives `files`, kept only when its top level is what GitLab lists for `commit`. A directory's id
   * hashes everything under it, so equal top levels are equal trees.
   */
  private async checked(commit: string, files: RemoteEntry[]): Promise<RemoteEntry[] | undefined> {
    const entries = gitListing(files, commit.length);
    if (!entries) return undefined;
    const top = new Map((await this.list(commit, false)).map(entry => [entry.path, entry]));
    const derived = entries.filter(entry => !entry.path.includes('/'));
    return derived.length === top.size && derived.every(entry => sameEntry(entry, top.get(entry.path))) ? entries : undefined;
  }
  /**
   * `base` moved to commit `sha`: the files GitLab's comparison of the two names, each read at `sha`, replace the
   * base's. Undefined when the comparison is unavailable or left a change out, or when listing again takes no more
   * requests than following would.
   */
  private async follow(base: Listing, sha: string): Promise<RemoteEntry[] | undefined> {
    // Following takes the comparison, a read per changed file and the check; listing takes a request per hundred entries.
    const budget = Math.min(FOLLOWED_FILES, Math.ceil(base.entries.length / 100) - 2);
    if (budget < 1) return undefined;
    try {
      // `straight` compares the two commits themselves. The default starts from their merge base, which misses what a rewritten branch dropped.
      const compared = await this.json(`/repository/compare?from=${base.sha}&to=${sha}&straight=true`) as { compare_timeout?: boolean; diffs?: { old_path?: unknown; new_path?: unknown; b_mode?: unknown; deleted_file?: boolean; }[]; };
      if (compared.compare_timeout || !Array.isArray(compared.diffs)) return undefined;
      const files = new Map(base.entries.filter(entry => entry.type !== 'tree').map(entry => [entry.path, entry]));
      /** The mode of each file the comparison says `sha` holds changed. */
      const changed = new Map<string, string>();
      for (const diff of compared.diffs) {
        if (typeof diff.old_path !== 'string' || typeof diff.new_path !== 'string') return undefined;
        if (diff.deleted_file || diff.old_path !== diff.new_path) files.delete(diff.old_path);
        if (!diff.deleted_file) changed.set(diff.new_path, String(diff.b_mode));
      }
      if (changed.size > budget) return undefined;
      const pending = [...changed];
      for (let i = 0; i < pending.length; i += 6) {
        await Promise.all(
          pending.slice(i, i + 6).map(async ([path, mode]) => {
            const blob = await this.blobAt(sha, path);
            // Anything but a file GitLab can read, a submodule for one, is left out, and the check then refuses the listing.
            if (blob && /^(100644|100755|120000)$/.test(mode)) files.set(path, { path, mode, type: 'blob', sha: blob });
            else files.delete(path);
          }),
        );
      }
      return await this.checked(sha, [...files.values()]);
    } catch (error) {
      // Never list again through a cooldown or lost access.
      if (error instanceof SourceError && [401, 403, 429].includes(error.status)) throw error;
      return undefined;
    }
  }
  /**
   * The listing of this reader's own commit, derived without listing: the snapshot's files with the committed ones
   * replaced. It is kept only when the commit's one parent is the snapshot and GitLab lists the same top level,
   * because another push may have landed first, and GitLab may store other bytes than it was sent, as a site that
   * normalizes line endings does. A commit that fails either is followed by comparison on the next read.
   */
  private async adopt(snapshot: RemoteSnapshot, written: Map<string, string | null>, commit: { id: string; parent_ids?: unknown; }) {
    if (!Array.isArray(commit.parent_ids) || commit.parent_ids.length !== 1 || commit.parent_ids[0] !== snapshot.sha) return;
    const files = new Map(snapshot.entries.filter(entry => entry.type !== 'tree').map(entry => [entry.path, entry]));
    for (const [path, sha] of written) {
      if (sha === null) files.delete(path);
      else files.set(path, { path, mode: files.get(path)?.mode ?? '100644', type: 'blob', sha });
    }
    const entries = await this.checked(commit.id, [...files.values()]);
    if (!entries) return;
    this.hold(commit.id, entries);
    await this.store(commit.id, entries);
  }
  protected async readBlob(sha: string): Promise<Buffer> {
    let pending = this.blobs.get(sha);
    if (!pending) {
      pending = (async () => {
        const blob = await this.json(`/repository/blobs/${encodeURIComponent(sha)}`);
        if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new SourceError('Unsupported GitLab blob encoding.', 422);
        if (blob.size > 5 * 1024 * 1024 || blob.content.length > 7 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
        return Buffer.from(blob.content, 'base64');
      })();
      this.blobs.set(sha, pending);
    }
    return pending;
  }
  protected async historyPage(file: string, head: string, page: number, perPage: number): Promise<{ commits: RemoteCommit[]; more: boolean; }> {
    const response = await this.response(`/repository/commits?ref_name=${head}&path=${encodeURIComponent(file)}&per_page=${perPage}&page=${page}`);
    const listed = await response.json() as { id: string; parent_ids?: string[]; authored_date?: string; author_name?: string; message?: string; }[];
    if (!Array.isArray(listed)) throw new SourceError('GitLab returned an invalid commit list.', 502);
    const next = response.headers.get('x-next-page');
    return { commits: listed.map(commit => ({ sha: commit.id, parents: commit.parent_ids || [], date: commit.authored_date || '', author: commit.author_name || '', message: commit.message || '' })), more: next === null ? listed.length === perPage : next !== '' };
  }
  protected async objectAt(commit: string, file: string): Promise<{ sha: string; size: number; } | null> {
    try {
      const found = await this.json(`/repository/files/${encodeURIComponent(file)}?ref=${commit}`);
      return typeof found.blob_id === 'string' ? { sha: found.blob_id, size: Number(found.size) || 0 } : null;
    } catch (error) {
      if (error instanceof SourceError && error.status === 404) return null;
      throw error;
    }
  }
  protected async commitInfo(commit: string): Promise<{ date: string; paths: string[]; } | null> {
    let found: { authored_date?: string; };
    try {
      found = await this.json(`/repository/commits/${commit}`);
    } catch (error) {
      if (error instanceof SourceError && error.status === 404) return null;
      throw error;
    }
    const diff = await this.json(`/repository/commits/${commit}/diff?per_page=100`) as { new_path: string; deleted_file?: boolean; }[];
    return { date: found.authored_date || '', paths: Array.isArray(diff) ? diff.filter(entry => !entry.deleted_file).map(entry => entry.new_path) : [] };
  }
  /** Readers on one `fetch` share what history they learned, as they share the provider's runtime. */
  protected override historyMemoOwner() {
    return this.request;
  }
  /**
   * The last commits of twenty paths per GraphQL request (`tree(path).lastCommit`). A site or project path GraphQL does
   * not answer, such as a project named by its numeric id, asks per path over REST instead.
   */
  protected override async lastCommits(head: string, paths: string[]): Promise<Map<string, LastCommit | null>> {
    const found = new Map<string, LastCommit | null>();
    const batches: string[][] = [];
    for (let i = 0; i < paths.length; i += LAST_COMMIT_BATCH) batches.push(paths.slice(i, i + LAST_COMMIT_BATCH));
    try {
      for (let i = 0; i < batches.length; i += LAST_COMMIT_REQUESTS) await Promise.all(batches.slice(i, i + LAST_COMMIT_REQUESTS).map(batch => this.graphLastCommits(head, batch, found)));
    } catch (error) {
      // Lost access or a cooldown stops the dating; REST answers whatever else GraphQL did not.
      if (error instanceof SourceError && [401, 403, 429].includes(error.status)) throw error;
      for (const [path, commit] of await super.lastCommits(head, paths.filter(path => !found.has(path)))) found.set(path, commit);
    }
    return found;
  }
  private async graphLastCommits(head: string, paths: string[], found: Map<string, LastCommit | null>) {
    const query = `query($project: ID!, $ref: String!${paths.map((_, i) => `, $p${i}: String!`).join('')}) { project(fullPath: $project) { repository { ${paths.map((_, i) => `f${i}: tree(ref: $ref, path: $p${i}) { lastCommit { sha authoredDate } }`).join(' ')} } } }`;
    let response: Response;
    try {
      response = await this.request(`${this.url}/api/graphql`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'MyGitNotes', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: JSON.stringify({ query, variables: { project: this.repository, ref: head, ...Object.fromEntries(paths.map((path, i) => [`p${i}`, path])) } }) });
    } catch {
      throw new Error('GitLab GraphQL could not be reached.');
    }
    if (response.status === 429) throw new SourceError('GitLab rate limit reached. Retry later.', 429, 60);
    if (response.status === 401) throw new SourceError('Sign in again to authorize GitLab access.', 401);
    const result = await response.json().catch(() => undefined) as { data?: { project?: { repository?: Record<string, { lastCommit?: { sha?: string; authoredDate?: string; } | null; } | null> | null; } | null; }; errors?: unknown[]; } | undefined;
    const repository = result?.data?.project?.repository;
    // Anything else GraphQL refuses or does not answer is asked over REST.
    if (!response.ok || result?.errors?.length || !repository) throw new Error('GitLab GraphQL did not answer last commits.');
    paths.forEach((path, i) => {
      const commit = repository[`f${i}`]?.lastCommit;
      found.set(path, commit?.sha && commit.authoredDate ? { sha: commit.sha, date: commit.authoredDate } : null);
    });
  }
  /** A commit's renames whose diff is empty, the text unchanged, with its first parent; at most 3,000 changed files are read. */
  protected override async pureRenames(commit: string): Promise<CommitRenames> {
    let parent: string | null;
    try {
      parent = (await this.json(`/repository/commits/${commit}`) as { parent_ids?: string[]; }).parent_ids?.[0] ?? null;
    } catch (error) {
      if (error instanceof SourceError && error.status === 404) return { parent: null, renames: new Map() };
      throw error;
    }
    const renames = new Map<string, string>();
    for (let page = 1; page <= 30; page++) {
      const diff = await this.json(`/repository/commits/${commit}/diff?per_page=100&page=${page}`) as { old_path?: string; new_path?: string; renamed_file?: boolean; diff?: string; too_large?: boolean; collapsed?: boolean; }[];
      if (!Array.isArray(diff)) break;
      for (const entry of diff) {
        if (entry.renamed_file && entry.old_path && entry.new_path && entry.old_path !== entry.new_path && entry.diff === '' && !entry.too_large && !entry.collapsed) renames.set(entry.new_path, entry.old_path);
      }
      if (diff.length < 100) break;
    }
    return { parent, renames };
  }
  /** GitLab lists a commit's diff a page at a time, a rename as one entry with both paths. */
  protected async renamedFrom(commit: string, file: string): Promise<string | null> {
    for (let page = 1; page <= 30; page++) {
      let diff: { old_path?: string; new_path?: string; renamed_file?: boolean; }[];
      try {
        diff = await this.json(`/repository/commits/${commit}/diff?per_page=100&page=${page}`);
      } catch (error) {
        if (error instanceof SourceError && error.status === 404) return null;
        throw error;
      }
      if (!Array.isArray(diff)) return null;
      const entry = diff.find(candidate => candidate.new_path === file);
      if (entry) return entry.renamed_file && entry.old_path ? entry.old_path : null;
      if (diff.length < 100) return null;
    }
    return null;
  }
  protected async publishChanges(changes: RemoteChange[], snapshot: RemoteSnapshot, message: string, author?: CommitAuthor): Promise<string> {
    const actions = [];
    /** What the commit leaves at each path: the object id of the bytes sent, or null where it deletes. */
    const written = new Map<string, string | null>();
    let total = 0;
    for (const change of changes) {
      const existing = snapshot.entries.find(entry => entry.path === change.path);
      let lastCommit: string | undefined;
      if (existing) {
        const file = await this.json(`/repository/files/${encodeURIComponent(change.path)}?ref=${snapshot.sha}`);
        if (file.blob_id !== existing.sha || typeof file.last_commit_id !== 'string') throw new SourceError('GitLab file version is unavailable.', 409);
        lastCommit = file.last_commit_id;
      }
      if (change.sha === null) {
        actions.push({ action: 'delete', file_path: change.path, last_commit_id: lastCommit });
        written.set(change.path, null);
        continue;
      }
      const bytes = change.content !== undefined ? Buffer.from(change.content) : change.base64 !== undefined ? Buffer.from(change.base64, 'base64') : await this.readBlob(change.sha!);
      total += bytes.length;
      if (total > 5 * 1024 * 1024) throw new SourceError('Mutation exceeds the 5 MiB limit.', 413);
      written.set(change.path, gitBlobId(bytes, snapshot.sha.length));
      actions.push({ action: existing ? 'update' : 'create', file_path: change.path, content: bytes.toString('base64'), encoding: 'base64', ...(lastCommit ? { last_commit_id: lastCommit } : {}) });
    }
    // Refresh permissions and the branch after preparing actions; GitLab validates file versions atomically.
    const branch = await this.json(`/repository/branches/${encodeURIComponent(this.branch)}`);
    if (!branch.can_push) throw new SourceError('Write access on the main workspace branch is required.', 403);
    if (branch.commit?.id !== snapshot.sha) throw new SourceError('The repository changed. Reload before saving.', 409);
    // GitLab records the author it is given and keeps the token's account as the committer.
    const commit = await this.json('/repository/commits', { method: 'POST', body: JSON.stringify({ branch: this.branch, commit_message: message, actions, force: false, ...(author ? { author_name: author.name, author_email: author.email } : {}) }) });
    if (typeof commit.id !== 'string' || !/^[a-f0-9]{40,64}$/.test(commit.id)) throw new SourceError('GitLab returned no commit revision. Reload to check whether the change was saved.', 502);
    // The commit is published whatever happens to its listing, so the save answers once that has had a few seconds. A
    // listing that comes later is still kept; one that fails or never comes is the next read's to follow.
    await within(this.adopt(snapshot, written, commit), ADOPT_WAIT);
    return commit.id;
  }
}
