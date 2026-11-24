import { createHash, timingSafeEqual } from 'node:crypto';
import { SourceError } from '../github-api.js';
import { REMOTE_CACHE_TTL } from '../remote-cache.js';
import { type HistoryEntry, isAgentEdit } from '../note-versions.js';
import { liveNoteState } from '../live-repository.js';
import { type CommitRenames, ignoredRevs, type LastCommit, RemoteEditDates } from '../remote-edit-dates.js';
import { type EditDated, IGNORE_REVS_FILE, type NoteEditFact, withEditDate } from '../edit-dates.js';
import type { HistoryRead, RemoteCommit } from './types.js';
import { LiveSource } from './live.js';

/** History reads show at most this much of a file. */
const HISTORY_MAX_BYTES = 1024 * 1024;
/** How many renames or moves a file's history follows back, each costing the provider a few more requests. */
const MAX_FOLLOWED_RENAMES = 50;
/** The shape of a remembered history fact; a change of `HistorySpan` or of what a fact means raises it. */
const HISTORY_FACTS_VERSION = 'v1';
/** How many history facts a process remembers per backend, the least recently used going first. */
const HISTORY_MEMO_ENTRIES = 10_000;
/** History facts this process remembers, by the backend its readers share (see `historyMemoOwner`). */
const historyMemos = new WeakMap<object, Map<string, string>>();
/** A path's commits from a head, once listed to the end: how many, the oldest, and that one's first parent ('' for none). */
interface HistorySpan {
  count: number;
  oldest: string;
  parent: string;
}
const OBJECT_ID = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

/** A remote reader's file history: commits that changed a file, following renames, past contents, and notes' edit dates. */
export abstract class HistorySource extends LiveSource {
  /** One page of the commits on the branch head that changed `file`, newest first; a provider lists them by path. */
  protected historyPage(_file: string, _head: string, _page: number, _perPage: number): Promise<{ commits: RemoteCommit[]; more: boolean; }> {
    throw new SourceError('History is unavailable for this source.', 501);
  }
  /** The object id and size of `file` in `commit`, or null when that commit does not hold it. */
  protected objectAt(_commit: string, _file: string): Promise<{ sha: string; size: number; } | null> {
    throw new SourceError('History is unavailable for this source.', 501);
  }
  /** The author date of `commit` and the paths it changed, renamed paths under their new names; null for an unknown commit. */
  protected commitInfo(_commit: string): Promise<{ date: string; paths: string[]; } | null> {
    throw new SourceError('History is unavailable for this source.', 501);
  }
  /** The path `commit` renamed or moved to `file`, as the provider detects renames; null when it added `file` otherwise. */
  protected renamedFrom(_commit: string, _file: string): Promise<string | null> {
    return Promise.resolve(null);
  }
  /** The newest commit from `head` that changed each of `paths`; a provider may batch them, the default asks per path. */
  protected async lastCommits(head: string, paths: string[]): Promise<Map<string, LastCommit | null>> {
    const found = new Map<string, LastCommit | null>();
    for (let i = 0; i < paths.length; i += 6) {
      await Promise.all(
        paths.slice(i, i + 6).map(async file => {
          const [commit] = (await this.historyPage(file, head, 1, 1)).commits;
          found.set(file, commit ? { sha: commit.sha, date: commit.date } : null);
        }),
      );
    }
    return found;
  }
  /** The renames `commit` made that kept the text, with its first parent; by default none are known, so a move dates a note. */
  protected async pureRenames(_commit: string): Promise<CommitRenames> {
    return { parent: null, renames: new Map() };
  }
  private editDating?: RemoteEditDates;
  /**
   * What Git tells of the edit dates of `files` as reads know them (`edit-dates.ts`), by path. A checked-out note is
   * dated by its Git file, with the live editor's typing as uncommitted changes; a pending note has no Git date. The
   * commits the head's `.git-blame-ignore-revs` lists date no note; while that list is unknown (a read that failed,
   * paused a while, or one slower than `EDIT_DATE_WAIT_MS`) no note is dated.
   */
  async editFacts(files: string[]): Promise<Map<string, NoteEditFact>> {
    const snapshot = await this.getSnapshot();
    const list = snapshot.entries.find(entry => entry.path === IGNORE_REVS_FILE && entry.type === 'blob' && entry.mode !== '120000');
    // A provider counts its limits per token, or per address without one, so a failure pauses only this caller's dating.
    const caller = this.token ? createHash('sha256').update(this.token).digest('hex') : 'anonymous';
    const owner = this.historyMemoOwner() ?? this;
    const ignored = list ? await ignoredRevs({ owner, scope: JSON.stringify([this.id, caller]), blob: list.sha, read: () => this.readSnapshotFile(snapshot, IGNORE_REVS_FILE), cache: this.cache }) : [];
    // Dating without the list would remember dates it skips; the notes fall back to their frontmatter instead.
    if (!ignored) return new Map();
    const links = new Map((this.live ? await this.live.links() : []).map(link => [link.path, link]));
    const blobs = new Map(snapshot.entries.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.sha]));
    const wanted = files.flatMap(file => {
      const link = links.get(file), path = link ? link.checkout.path : file, blob = path === null ? undefined : blobs.get(path);
      return blob ? [{ file, path: path!, blob, uncommitted: Boolean(link && liveNoteState(link.checkout).changed) }] : [];
    });
    this.editDating ??= new RemoteEditDates(this.id, { caller, lastCommits: (head, paths) => this.lastCommits(head, paths), pureRenames: commit => this.pureRenames(commit) }, this.cache, owner);
    const dates = await this.editDating.dates(snapshot.sha, wanted, ignored);
    return new Map(wanted.flatMap(({ file, path, uncommitted }) => dates.has(path) ? [[file, { lastCommitAt: dates.get(path), ...(uncommitted ? { uncommitted } : {}) }]] : []));
  }
  /** The notes with their edit dates resolved (`withEditDate`), as reads answer them. */
  async dated<T extends { path: string; metadata: Record<string, unknown>; }>(notes: T[]): Promise<(Omit<T, keyof EditDated> & EditDated)[]> {
    const facts = await this.editFacts(notes.map(note => note.path));
    return notes.map(note => withEditDate(note, facts.get(note.path)));
  }
  /**
   * The backend whose readers share what this process learned of history, such as a provider's `fetch`; undefined for a
   * reader that remembers only for itself.
   */
  protected historyMemoOwner(): object | undefined {
    return undefined;
  }
  private ownHistoryMemo?: Map<string, string>;
  private historyMemo(): Map<string, string> {
    const owner = this.historyMemoOwner();
    if (!owner) return this.ownHistoryMemo ??= new Map();
    let memo = historyMemos.get(owner);
    if (!memo) historyMemos.set(owner, memo = new Map());
    return memo;
  }
  private historyKey(kind: 'span' | 'renamed', commit: string, file: string) {
    return `mgn:history:${HISTORY_FACTS_VERSION}:${JSON.stringify([this.id, kind, commit, file])}`;
  }
  /**
   * A fact of the history that a commit fixes for good, from this process or the shared cache. A provider's answer
   * hashes to no key of its own, so the shared cache's value is trusted only under the cache's seal over key and value.
   */
  private async knownHistoryFact(key: string): Promise<string | undefined> {
    const memo = this.historyMemo(), remembered = memo.get(key);
    if (remembered !== undefined) {
      memo.delete(key);
      memo.set(key, remembered);
      return remembered;
    }
    if (!this.cache?.sign) return undefined;
    const [stored] = await this.cache.get([key]);
    if (stored === null) return undefined;
    let slot: { value?: unknown; seal?: unknown; };
    try {
      slot = JSON.parse(stored);
    } catch {
      return undefined;
    }
    const { value, seal } = slot || {};
    if (typeof value !== 'string' || typeof seal !== 'string') return undefined;
    const expected = Buffer.from(this.cache.sign(JSON.stringify([key, value])) ?? ''), given = Buffer.from(seal);
    if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    this.rememberHistoryFact(key, value);
    return value;
  }
  private rememberHistoryFact(key: string, value: string) {
    const memo = this.historyMemo();
    memo.delete(key);
    memo.set(key, value);
    while (memo.size > HISTORY_MEMO_ENTRIES) memo.delete(memo.keys().next().value!);
  }
  private async keepHistoryFact(key: string, value: string) {
    this.rememberHistoryFact(key, value);
    const seal = this.cache?.sign?.(JSON.stringify([key, value]));
    if (seal) await this.cache!.set([[key, JSON.stringify({ value, seal })]], REMOTE_CACHE_TTL);
  }
  /** {@link renamedFrom}, asked of the provider once per commit and path. */
  private async followedFrom(commit: string, file: string): Promise<string | null> {
    const key = this.historyKey('renamed', commit, file), known = await this.knownHistoryFact(key);
    if (known !== undefined) return known || null;
    const former = await this.renamedFrom(commit, file);
    await this.keepHistoryFact(key, former ?? '');
    return former;
  }
  /** How many commits from `head` changed `file` at that path, and the oldest of them with its first parent, once a listing ran out. */
  private async knownSpan(head: string, file: string): Promise<HistorySpan | undefined> {
    const known = await this.knownHistoryFact(this.historyKey('span', head, file));
    if (known === undefined) return undefined;
    try {
      const { count, oldest, parent } = JSON.parse(known) as Partial<HistorySpan>;
      if (typeof count === 'number' && Number.isInteger(count) && count > 0 && typeof oldest === 'string' && typeof parent === 'string') return { count, oldest, parent };
    } catch {
      // A value from an older shape is read again from the provider.
    }
    return undefined;
  }

  /**
   * One page of the commits that changed `file`, newest first, listed from this reader's snapshot so pages never mix
   * branch states. Renames are followed as `git log --follow` does: once the commits at a path run out, the oldest one
   * that renamed or moved the file there continues the list at its former path, from that commit's parent. Each entry
   * carries the file's path in that commit.
   *
   * How many commits each path holds and where it was renamed from are remembered, since commits never change, so a
   * later page starts at the path that holds it instead of listing every path before it again. A read of one entry (a
   * check-in asks for the newest commit) follows no rename, so its `more` speaks only of the current path.
   */
  async fileHistory(file: string, page: number, perPage = 50): Promise<{ entries: HistoryEntry[]; more: boolean; }> {
    const snapshot = await this.getSnapshot();
    const start = (page - 1) * perPage, wanted = start + perPage + 1;
    /** The commits listed so far, from index `skipped` of the whole history, each with the file's path in it. */
    const listed: (RemoteCommit & { path: string; })[] = [];
    let skipped = 0, path = file, head = snapshot.sha;
    /** The index in the whole history of the first commit at `path`. */
    let offset = 0;
    // A provider page that says more follow past a full page answers `more` without reading on (a check-in asks for one entry).
    const full = () => skipped + listed.length >= start + perPage;
    let more = false;
    for (let hop = 0; hop <= MAX_FOLLOWED_RENAMES; hop++) {
      let span = await this.knownSpan(head, path);
      if (!span || offset + span.count > start) {
        // The path's commits continue the listing, or start it where the page begins at this path.
        if (skipped + listed.length !== offset) {
          listed.length = 0;
          skipped = offset;
        }
        let next = 1, first = 1, exhausted = false, fetched = 0, oldest: RemoteCommit | undefined;
        const take = (found: { commits: RemoteCommit[]; more: boolean; }) => {
          listed.push(...found.commits.map(commit => ({ ...commit, path })));
          fetched += found.commits.length;
          oldest = found.commits.at(-1) ?? oldest;
          exhausted = !found.more || !found.commits.length;
          more = !exhausted && full();
        };
        // The provider page of this path that holds the page's first commit, when this path holds it at all.
        const jump = Math.floor(Math.max(0, start - offset) / perPage) + 1;
        if (jump > 1 && (!span || span.count > (jump - 1) * perPage)) {
          const found = await this.historyPage(path, head, jump, perPage);
          if (found.commits.length) {
            listed.length = 0;
            skipped = offset + (jump - 1) * perPage;
            first = jump;
            take(found);
            next = jump + 1;
          }
        }
        while (!exhausted && !more && skipped + listed.length < wanted) take(await this.historyPage(path, head, next++, perPage));
        if (more || skipped + listed.length >= wanted || !exhausted || !oldest) break;
        span = { count: (first - 1) * perPage + fetched, oldest: oldest.sha, parent: oldest.parents[0] ?? '' };
        await this.keepHistoryFact(this.historyKey('span', head, path), JSON.stringify(span));
      }
      if (perPage === 1 && page === 1 && full()) break;
      // The oldest commit at this path added the file there; where it renamed or moved it, the history goes on before it.
      if (!span.parent) break;
      const former = await this.followedFrom(span.oldest, path);
      if (!former || former === path) break;
      offset += span.count;
      path = former;
      head = span.parent;
    }
    const entries = listed.slice(start - skipped, start - skipped + perPage).map(({ sha, parents, date, author, message, path: at }) => {
      const [subject = '', ...rest] = message.replace(/\n+$/, '').split('\n');
      return { commit: sha, parents, date, author, subject, body: rest.join('\n').trim(), path: at, agent: isAgentEdit(message) };
    });
    return { entries, more: more || skipped + listed.length > start + perPage };
  }
  /** `file` as it was in `commit`, or why it is not shown; undefined when that commit does not hold it. */
  async readFileAt(commit: string, file: string): Promise<HistoryRead | undefined> {
    if (!OBJECT_ID.test(commit)) throw new SourceError('Invalid commit.');
    const object = await this.objectAt(commit, file);
    return object ? this.readHistoryBlob(object.sha, object.size) : undefined;
  }
  /**
   * A blob by object id, bounded like every history read unless `limit` sets another bound (a live note's merge base
   * takes the live editor's); `size` skips the read of a blob known to be too large.
   */
  async readHistoryBlob(sha: string, size?: number, limit = HISTORY_MAX_BYTES): Promise<HistoryRead> {
    if (!OBJECT_ID.test(sha)) throw new SourceError('Invalid object id.');
    if (size !== undefined && size > limit) return { blob: sha, notice: 'too-large' };
    let bytes: Buffer;
    try {
      bytes = this.loaded.get(sha) ?? await this.readBlob(sha);
    } catch (error) {
      if (error instanceof SourceError && error.status === 413) return { blob: sha, notice: 'too-large' };
      throw error;
    }
    if (bytes.length > limit) return { blob: sha, notice: 'too-large' };
    return bytes.includes(0) ? { blob: sha, notice: 'binary' } : { blob: sha, content: bytes.toString('utf8') };
  }
  async commitDetails(commit: string): Promise<{ date: string; paths: string[]; } | null> {
    if (!OBJECT_ID.test(commit)) throw new SourceError('Invalid commit.');
    return this.commitInfo(commit);
  }
}
