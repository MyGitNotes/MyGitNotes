/**
 * A note's edit date comes from Git: the author date of the newest commit that changed the note's text. A commit that
 * only moved or renamed the note, its text unchanged, does not count; the date follows the text back through it. Nor
 * does a commit the repository lists in its `.git-blame-ignore-revs` ({@link IGNORE_REVS_FILE}). The
 * frontmatter `updated` is only a fallback, for a note Git does not hold (an untracked or pending note, a source without
 * history) and for uncommitted changes laid over a committed note, which are newer than its last commit.
 */

/**
 * The file at a repository's top level that lists the commits edit dates skip, as `git blame --ignore-revs-file`
 * reads it: a commit there (a mass frontmatter backfill, a reformat) changed many notes' text but dates none of them;
 * each note it changed is dated by its newest earlier commit that changed its text.
 */
export const IGNORE_REVS_FILE = '.git-blame-ignore-revs';

/**
 * The commits an ignore-revs file ({@link IGNORE_REVS_FILE}) lists, in lowercase, each once, in the order listed. As
 * Git reads the file, a `#` starts a comment and each line holds one full object id (40 hex digits, or 64 in a SHA-256
 * repository); a blank line is skipped, and so is a malformed one, where Git would refuse the whole file.
 */
export function parseIgnoreRevs(text: string): string[] {
  const revs = new Set<string>();
  for (const line of text.split('\n')) {
    const rev = line.replace(/#.*/, '').trim().toLowerCase();
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(rev)) revs.add(rev);
  }
  return [...revs];
}

/** What Git tells of one note's edit date. */
export interface NoteEditFact {
  /** The author date of the newest commit that changed the note's text; absent when no commit holds the note. */
  lastCommitAt?: string;
  /** The note has changes Git does not hold yet: an edited working-tree file, or the live editor's typing. */
  uncommitted?: boolean;
}

/** The dates a listed or read note carries, both ISO 8601 timestamps in UTC. */
export interface EditDated {
  /** The author date of the newest commit that changed the note's text, as {@link NoteEditFact.lastCommitAt}. */
  lastCommitAt?: string;
  /**
   * The note's edit date: `lastCommitAt`; while the note has uncommitted changes, the later of it and the frontmatter
   * `updated`; for a note Git does not hold, the frontmatter `updated`. Absent when none of them is known.
   */
  updated?: string;
}

/** A time as an ISO 8601 UTC timestamp, from a `Date` or a string `Date.parse` reads; undefined for anything else. */
export function isoTime(value: unknown): string | undefined {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' && value.trim() ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** The note with its edit dates resolved from `fact` and its frontmatter, replacing any it carried. */
export function withEditDate<T extends { metadata: Record<string, unknown>; }>(note: T, fact: NoteEditFact | undefined): Omit<T, keyof EditDated> & EditDated {
  const { lastCommitAt: _lastCommitAt, updated: _updated, ...rest } = note as T & EditDated;
  const committed = isoTime(fact?.lastCommitAt);
  const frontmatter = isoTime(note.metadata?.updated);
  let updated = committed ?? frontmatter;
  if (committed && fact?.uncommitted && frontmatter && frontmatter > committed) updated = frontmatter;
  return { ...rest, ...(committed ? { lastCommitAt: committed } : {}), ...(updated ? { updated } : {}) };
}
