import { createHash, timingSafeEqual } from 'node:crypto';
import { parseIgnoreRevs } from './edit-dates.js';
import { SourceError } from './github-api.js';
import { REMOTE_CACHE_TTL, type RemoteCache } from './remote-cache.js';

/** The newest commit from a head that changed a path: its id and author date. */
export interface LastCommit {
  sha: string;
  date: string;
}
/** The renames a commit made that kept the file's text, new path to former path, with the commit's first parent. */
export interface CommitRenames {
  parent: string | null;
  renames: Map<string, string>;
}
/** What a hosted source answers to date its notes (`RemoteSource` implements it over its provider's history). */
export interface EditDateHistory {
  /** Whose limits the provider counts these questions against, such as a token's hash; a failure pauses its dating. */
  readonly caller?: string;
  /** The newest commit from `head` that changed each of `paths`, by path; null where none did. */
  lastCommits(head: string, paths: string[]): Promise<Map<string, LastCommit | null>>;
  /** The renames `commit` made with the text unchanged; none for a provider that cannot tell. */
  pureRenames(commit: string): Promise<CommitRenames>;
}
/** A file to date: its path at the head and the object id of its text there. */
export interface DatedFile {
  path: string;
  blob: string;
}

/** The shape of a remembered fact; a change of what a fact means raises it. */
const FACTS_VERSION = 'v1';
/** How long a request waits for dates before it answers without the rest, which go on being dated for later requests. */
export const EDIT_DATE_WAIT_MS = 5000;
/** How many moves one note's date follows back. */
const MAX_MOVES = 20;
/** How many notes one dating step asks the provider about together, so a long dating keeps what it learned as it goes. */
const STEP_FILES = 100;
/** Steps run at once; each provider batches and bounds its own requests. */
const STEPS_AT_ONCE = 2;
/** Commits whose renames are asked at once. */
const RENAMES_AT_ONCE = 6;
/** Facts a process remembers per backend, the least recently used going first. */
const MEMO_ENTRIES = 100_000;
/** Keys per shared-cache read. */
const CACHE_BATCH = 500;
/** How long dating pauses after a provider failure that names no wait of its own. */
const FAILURE_PAUSE_MS = 60_000;
/** How long the shared cache keeps that no commit holds a path and text, in seconds: a provider that missed one asks again. */
const UNDATED_TTL = 24 * 60 * 60;
/** The value a fact takes when no commit changed the path to its text. */
const UNDATED = '';

/** What the readers of one backend share in this process: facts, datings in flight and commits' renames being read. */
interface Shared {
  memo: Map<string, string>;
  /** Each file's dating in flight, with when the request that started it stops waiting for it. */
  inflight: Map<string, { date: Promise<string | undefined>; until: number; }>;
  renames: Map<string, Promise<CommitRenames>>;
  /** Until when dating pauses after a provider failure, by repository and caller. */
  paused: Map<string, number>;
}
const sharedState = new WeakMap<object, Shared>();

/**
 * What a list of commits to skip adds to the key of a date: a hash of the distinct commits, sorted, so the same list
 * in another order or with other comments keeps its dates and another list dates the notes again. An empty list adds
 * nothing, so a repository without one keeps the dates it had.
 */
function ignoredKey(ignored: readonly string[]): string[] {
  const revs = [...new Set(ignored)].sort();
  return revs.length ? [`ignore:${createHash('sha256').update(revs.join('\n')).digest('hex').slice(0, 32)}`] : [];
}

/** The commits ignore-revs files list, by the file's object id, per history backend; a blob never changes. */
const ignoreLists = new WeakMap<object, Map<string, string[]>>();

/**
 * The commits a repository's `.git-blame-ignore-revs` (blob `blob`, its bytes from `read`) lists, read once per text
 * and backend (`owner`, as `RemoteEditDates` shares its facts).
 */
export async function ignoredRevs(owner: object, blob: string, read: () => Promise<Buffer>): Promise<string[]> {
  let lists = ignoreLists.get(owner);
  if (!lists) ignoreLists.set(owner, lists = new Map());
  let revs = lists.get(blob);
  if (!revs) {
    revs = parseIgnoreRevs((await read()).toString('utf8'));
    lists.set(blob, revs);
    while (lists.size > 100) lists.delete(lists.keys().next().value!);
  }
  return revs;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms).unref?.());

/** Runs `task` over `items`, at most `limit` at a time. */
async function eachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}

/**
 * Dates a hosted repository's notes as a worktree's are (`noteEditFacts` in `@mygitnotes/git`): by the author date of
 * the newest commit that changed a note's text, following back through commits that only moved it and past commits
 * the caller skips (a repository's `.git-blame-ignore-revs`), from each one's first parent.
 *
 * A date is a fact about a path and the text it holds (its blob), so it is kept per path and blob, in this process and,
 * sealed, in the shared cache, and holds at every head where the file is unchanged, under the same list of skipped
 * commits; only notes whose text is new to the process are asked of the provider. (A text restored byte for byte to
 * one dated before keeps that earlier date.) A request waits at most `wait` milliseconds; notes not dated by then are
 * left out of its answer and dated in the background, so the first listing of a large repository falls back to
 * frontmatter dates for a while. A failure of the provider leaves notes undated and never fails the read.
 */
export class RemoteEditDates {
  private readonly shared: Shared;
  constructor(private readonly repository: string, private readonly history: EditDateHistory, private readonly cache: RemoteCache | undefined, owner: object, private readonly wait = EDIT_DATE_WAIT_MS) {
    let shared = sharedState.get(owner);
    if (!shared) sharedState.set(owner, shared = { memo: new Map(), inflight: new Map(), renames: new Map(), paused: new Map() });
    this.shared = shared;
  }

  /** What a pause after a failure applies to: this repository as this caller asks it. */
  private get pauseKey() {
    return JSON.stringify([this.repository, this.history.caller ?? '']);
  }
  private key(kind: 'date' | 'renames', ...parts: string[]) {
    return `mgn:edit-${kind}:${FACTS_VERSION}:${JSON.stringify([this.repository, ...parts])}`;
  }
  private remembered(key: string): string | undefined {
    const { memo } = this.shared, value = memo.get(key);
    if (value === undefined) return undefined;
    memo.delete(key);
    memo.set(key, value);
    return value;
  }
  private remember(key: string, value: string) {
    const { memo } = this.shared;
    memo.delete(key);
    memo.set(key, value);
    while (memo.size > MEMO_ENTRIES) memo.delete(memo.keys().next().value!);
  }
  /** Facts of the shared cache by key, trusted only under the cache's seal over key and value; none without a seal. */
  private async stored(keys: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>(), sign = this.cache?.sign?.bind(this.cache);
    if (!sign || !keys.length) return found;
    for (let start = 0; start < keys.length; start += CACHE_BATCH) {
      const batch = keys.slice(start, start + CACHE_BATCH);
      const values = await this.cache!.get(batch);
      batch.forEach((key, index) => {
        let slot: { value?: unknown; seal?: unknown; };
        try {
          slot = JSON.parse(values[index] ?? 'null') ?? {};
        } catch {
          return;
        }
        if (typeof slot.value !== 'string' || typeof slot.seal !== 'string') return;
        const expected = Buffer.from(sign(JSON.stringify([key, slot.value])) ?? ''), given = Buffer.from(slot.seal);
        if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) return;
        this.remember(key, slot.value);
        found.set(key, slot.value);
      });
    }
    return found;
  }
  private async keep(entries: [string, string][]) {
    for (const [key, value] of entries) this.remember(key, value);
    const sign = this.cache?.sign?.bind(this.cache);
    if (!sign || !entries.length) return;
    const sealed = (wanted: [string, string][]) =>
      wanted.flatMap(([key, value]): [string, string][] => {
        const seal = sign(JSON.stringify([key, value]));
        return seal ? [[key, JSON.stringify({ value, seal })]] : [];
      });
    const dated = sealed(entries.filter(([, value]) => value !== UNDATED)), undated = sealed(entries.filter(([, value]) => value === UNDATED));
    if (dated.length) await this.cache!.set(dated, REMOTE_CACHE_TTL);
    if (undated.length) await this.cache!.set(undated, UNDATED_TTL);
  }

  /** The renames of `commit` that kept the text, read once per process and kept, since a commit never changes. */
  private renamesOf(commit: string): Promise<CommitRenames> {
    const { renames } = this.shared;
    let pending = renames.get(commit);
    if (!pending) {
      pending = (async () => {
        const key = this.key('renames', commit);
        const known = this.remembered(key) ?? (await this.stored([key])).get(key);
        if (known !== undefined) {
          const { parent, renames: pairs } = JSON.parse(known) as { parent: string | null; renames: [string, string][]; };
          return { parent, renames: new Map(pairs) };
        }
        const found = await this.history.pureRenames(commit);
        await this.keep([[key, JSON.stringify({ parent: found.parent, renames: [...found.renames] })]]);
        return found;
      })();
      renames.set(commit, pending);
      pending.catch(() => renames.delete(commit));
      while (renames.size > 10_000) renames.delete(renames.keys().next().value!);
    }
    return pending;
  }

  /**
   * The dates of `files` at `head`, by path, as ISO timestamps from the provider, passing the `ignored` commits; a file
   * not dated within the wait, or that the provider could not date, is left out. After a provider failure nothing new
   * is dated for this caller until the pause the failure set is over.
   */
  async dates(head: string, files: DatedFile[], ignored: readonly string[] = []): Promise<Map<string, string>> {
    const dates = new Map<string, string>(), list = ignoredKey(ignored);
    const keyed = files.map(file => ({ ...file, key: this.key('date', file.path, file.blob, ...list) }));
    const unknown = keyed.filter(file => {
      const known = this.remembered(file.key);
      if (known) dates.set(file.path, known);
      return known === undefined;
    });
    let missing = unknown;
    try {
      const stored = await this.stored(unknown.map(file => file.key));
      missing = unknown.filter(file => {
        const known = stored.get(file.key);
        if (known) dates.set(file.path, known);
        return known === undefined;
      });
    } catch (error) {
      console.warn(`[edit-dates] shared cache read failed: ${(error as Error).message}`);
    }
    if (!missing.length) return dates;
    const { inflight, paused } = this.shared;
    const pausedUntil = paused.get(this.pauseKey) ?? 0;
    if (pausedUntil <= Date.now()) {
      paused.delete(this.pauseKey);
      const fresh = missing.filter(file => !inflight.has(file.key));
      if (fresh.length) this.date(head, fresh, new Set(ignored), Date.now() + this.wait);
    }
    // A file another request is dating is waited for only as long as that request waits, so the requests that come
    // while a large repository is dated in the background answer at once with what is known.
    const joined = missing.flatMap(file => {
      const dating = inflight.get(file.key);
      return dating ? [{ ...dating, path: file.path }] : [];
    });
    const waits = joined.map(({ date, path }) =>
      date.then(found => {
        if (found) dates.set(path, found);
      })
    );
    await Promise.race([Promise.all(waits), delay(Math.max(0, ...joined.map(({ until }) => until)) - Date.now())]);
    // A copy, so dates that land after the wait do not change an answer already given.
    return new Map(dates);
  }

  /** Starts dating `files` in steps, each file's dating in flight until its date is kept or found unknown. */
  private date(head: string, files: (DatedFile & { key: string; })[], ignored: ReadonlySet<string>, until: number) {
    const { inflight } = this.shared;
    const settle = new Map<string, (date: string | undefined) => void>();
    for (const file of files) inflight.set(file.key, { date: new Promise(resolve => settle.set(file.key, resolve)), until });
    const done = (file: DatedFile & { key: string; }, date: string | undefined) => {
      settle.get(file.key)?.(date);
      settle.delete(file.key);
      inflight.delete(file.key);
    };
    const steps: (typeof files)[] = [];
    for (let start = 0; start < files.length; start += STEP_FILES) steps.push(files.slice(start, start + STEP_FILES));
    let failed = false;
    void eachLimited(steps, STEPS_AT_ONCE, async step => {
      if (failed) return step.forEach(file => done(file, undefined));
      try {
        const found = await this.step(head, step, ignored);
        await this.keep(step.flatMap(file => found.has(file.key) ? [[file.key, found.get(file.key)!] as [string, string]] : [])).catch(error => console.warn(`[edit-dates] shared cache write failed: ${(error as Error).message}`));
        for (const file of step) done(file, found.get(file.key) || undefined);
      } catch (error) {
        // Lost access, a cooldown, a provider failure or one without history: what is left stays undated, and no
        // request asks again until the pause is over, the provider's own wait or a minute.
        failed = true;
        const wait = error instanceof SourceError && error.retryAfter ? error.retryAfter * 1000 : FAILURE_PAUSE_MS;
        const { paused } = this.shared;
        paused.set(this.pauseKey, Math.max(paused.get(this.pauseKey) ?? 0, Date.now() + wait));
        while (paused.size > 10_000) paused.delete(paused.keys().next().value!);
        if (!(error instanceof SourceError && error.status === 501)) console.warn(`[edit-dates] ${this.repository}: ${(error as Error).message}`);
        for (const file of step) done(file, undefined);
      }
    }).finally(() => {
      for (const file of files) if (settle.has(file.key)) done(file, undefined);
    });
  }

  /**
   * Dates one step of files: the last commit at each path, followed back through each commit that only moved it there
   * and past each `ignored` one, at the same path from its first parent. A file no commit holds, other than ignored
   * ones, is answered `UNDATED`, so it is not asked again; so is one whose ignored commit names no parent or lies more
   * than `MAX_MOVES` back.
   */
  private async step(head: string, files: (DatedFile & { key: string; })[], ignored: ReadonlySet<string>): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    let work = files.map(file => ({ file, path: file.path, head }));
    for (let move = 0; move <= MAX_MOVES && work.length; move++) {
      const heads = new Map<string, typeof work>();
      for (const item of work) heads.set(item.head, [...heads.get(item.head) ?? [], item]);
      const last = new Map<(typeof work)[number], LastCommit | null>();
      for (const [at, items] of heads) {
        const commits = await this.history.lastCommits(at, [...new Set(items.map(item => item.path))]);
        for (const item of items) last.set(item, commits.get(item.path) ?? null);
      }
      const commits = [...new Set([...last.values()].flatMap(commit => commit ? [commit.sha] : []))];
      const renames = new Map<string, CommitRenames>();
      await eachLimited(commits, RENAMES_AT_ONCE, async commit => {
        renames.set(commit, await this.renamesOf(commit));
      });
      const next: typeof work = [];
      for (const item of work) {
        const commit = last.get(item)!;
        if (!commit) {
          found.set(item.file.key, UNDATED);
          continue;
        }
        const moved = renames.get(commit.sha), skipped = ignored.has(commit.sha.toLowerCase());
        const from = moved?.renames.get(item.path);
        if ((from || skipped) && moved?.parent && move < MAX_MOVES) next.push({ file: item.file, path: from ?? item.path, head: moved.parent });
        else if (skipped) found.set(item.file.key, UNDATED);
        else if (commit.date && !Number.isNaN(Date.parse(commit.date))) found.set(item.file.key, new Date(commit.date).toISOString());
      }
      work = next;
    }
    return found;
  }
}
