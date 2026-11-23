import { timingSafeEqual } from 'node:crypto';
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

/** What the readers of one backend share in this process: facts, datings in flight and commits' renames being read. */
interface Shared {
  memo: Map<string, string>;
  inflight: Map<string, Promise<string | undefined>>;
  renames: Map<string, Promise<CommitRenames>>;
}
const sharedState = new WeakMap<object, Shared>();

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
 * the newest commit that changed a note's text, following back through commits that only moved it.
 *
 * A date is a fact about a path and the text it holds (its blob), so it is kept per path and blob, in this process and,
 * sealed, in the shared cache, and holds at every head where the file is unchanged; only notes whose text is new to the
 * process are asked of the provider. (A text restored byte for byte to one dated before keeps that earlier date.) A
 * request waits at most `wait` milliseconds; notes not dated by then are left out of its answer and dated in the
 * background, so the first listing of a large repository falls back to frontmatter dates for a while. A failure of the
 * provider leaves notes undated and never fails the read.
 */
export class RemoteEditDates {
  private readonly shared: Shared;
  constructor(private readonly repository: string, private readonly history: EditDateHistory, private readonly cache: RemoteCache | undefined, owner: object, private readonly wait = EDIT_DATE_WAIT_MS) {
    let shared = sharedState.get(owner);
    if (!shared) sharedState.set(owner, shared = { memo: new Map(), inflight: new Map(), renames: new Map() });
    this.shared = shared;
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
    const sealed = entries.flatMap(([key, value]): [string, string][] => {
      const seal = sign(JSON.stringify([key, value]));
      return seal ? [[key, JSON.stringify({ value, seal })]] : [];
    });
    if (sealed.length) await this.cache!.set(sealed, REMOTE_CACHE_TTL);
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
   * The dates of `files` at `head`, by path, as ISO timestamps from the provider; a file not dated within the wait, or
   * that the provider could not date, is left out.
   */
  async dates(head: string, files: DatedFile[]): Promise<Map<string, string>> {
    const dates = new Map<string, string>();
    const keyed = files.map(file => ({ ...file, key: this.key('date', file.path, file.blob) }));
    const unknown = keyed.filter(file => {
      const known = this.remembered(file.key);
      if (known !== undefined) dates.set(file.path, known);
      return known === undefined;
    });
    let missing = unknown;
    try {
      const stored = await this.stored(unknown.map(file => file.key));
      missing = unknown.filter(file => {
        const known = stored.get(file.key);
        if (known !== undefined) dates.set(file.path, known);
        return known === undefined;
      });
    } catch (error) {
      console.warn(`[edit-dates] shared cache read failed: ${(error as Error).message}`);
    }
    if (!missing.length) return dates;
    const { inflight } = this.shared;
    const fresh = missing.filter(file => !inflight.has(file.key));
    if (fresh.length) this.date(head, fresh);
    const waits = missing.map(file =>
      inflight.get(file.key)!.then(date => {
        if (date) dates.set(file.path, date);
      })
    );
    await Promise.race([Promise.all(waits), delay(this.wait)]);
    // A copy, so dates that land after the wait do not change an answer already given.
    return new Map(dates);
  }

  /** Starts dating `files` in steps, each file's dating in flight until its date is kept or found unknown. */
  private date(head: string, files: (DatedFile & { key: string; })[]) {
    const { inflight } = this.shared;
    const settle = new Map<string, (date: string | undefined) => void>();
    for (const file of files) inflight.set(file.key, new Promise(resolve => settle.set(file.key, resolve)));
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
        const found = await this.step(head, step);
        await this.keep(step.flatMap(file => found.has(file.key) ? [[file.key, found.get(file.key)!] as [string, string]] : [])).catch(error => console.warn(`[edit-dates] shared cache write failed: ${(error as Error).message}`));
        for (const file of step) done(file, found.get(file.key));
      } catch (error) {
        // Lost access, a cooldown or a provider without history: what is left stays undated, and the next request asks again.
        failed = true;
        if (!(error instanceof SourceError && error.status === 501)) console.warn(`[edit-dates] ${this.repository}: ${(error as Error).message}`);
        for (const file of step) done(file, undefined);
      }
    }).finally(() => {
      for (const file of files) if (settle.has(file.key)) done(file, undefined);
    });
  }

  /** Dates one step of files: the last commit at each path, followed back through each commit that only moved it there. */
  private async step(head: string, files: (DatedFile & { key: string; })[]): Promise<Map<string, string>> {
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
        if (!commit) continue;
        const moved = renames.get(commit.sha);
        const from = moved?.renames.get(item.path);
        if (from && moved!.parent && move < MAX_MOVES) next.push({ file: item.file, path: from, head: moved!.parent });
        else if (commit.date && !Number.isNaN(Date.parse(commit.date))) found.set(item.file.key, new Date(commit.date).toISOString());
      }
      work = next;
    }
    return found;
  }
}
