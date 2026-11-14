import { compileGlobs, expandedLength, globError, type PathGlob } from './path-glob.js';

/** Most globs one `exclude` list may hold. */
export const EXCLUDE_LIMIT = 100;

/**
 * Most characters the patterns a notebook applies (the workspace's `exclude` and its own, with their `{a,b}` groups
 * expanded and the same pattern counted once) may hold together. Every path of the notebook is matched against all of
 * them on each list, search and folder walk, at a cost of at most this many character steps per character of the path
 * (`path-glob.ts`). It is what one glob alone may expand to, so a notebook's whole list costs no more than its slowest
 * glob could. The cost grows linearly with the path; measured worst cases are about a tenth of a second over a thousand
 * 300-character paths for brace-heavy lists, and up to about 0.7 s over a thousand paths 150 folders deep for 200
 * distinct `**\/X` globs, more on a busy machine. Lists people write, a few globs of tens of characters, stay far below it.
 */
export const EXCLUDE_EXPANSION_LIMIT = 1024;

/**
 * The glob dialect of a manifest's `exclude` is the one of `path-glob.ts`, with a dot name matched like any other. The
 * path matched is the one inside the notebook, with `/` separators and no leading `./`. A glob ending in `/` names a
 * folder: `drafts/` is read as `drafts`, which takes the folder and everything under it.
 */
const DIALECT = { dot: true, expansionLimit: EXCLUDE_EXPANSION_LIMIT } as const;

/** The glob as it is matched: a folder written with its trailing `/` is the folder. */
const asMatched = (pattern: string) => pattern.length > 1 && pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;

/**
 * What is wrong with `patterns`, exclude globs each usable alone, as the list a notebook applies, or undefined when its
 * patterns stay within `EXCLUDE_EXPANSION_LIMIT`.
 */
export function excludeListError(patterns: readonly string[]): string | undefined {
  const length = expandedLength(patterns.map(asMatched));
  return length > EXCLUDE_EXPANSION_LIMIT ? `its globs expand to patterns of ${length} characters together, more than the ${EXCLUDE_EXPANSION_LIMIT} a notebook may apply` : undefined;
}

/** What is wrong with `pattern` as an exclude glob, or undefined when it is usable. */
export function excludeGlobError(pattern: string): string | undefined {
  if (pattern.startsWith('!')) return 'it is negated; list what to exclude, not what to keep';
  return globError(asMatched(pattern));
}

const compiled = new WeakMap<readonly string[], PathGlob>();

/**
 * Whether `relative`, a path inside a notebook, is excluded by `patterns`: the path or a folder above it matches one, so a
 * glob naming a folder takes everything under it. Throws a `GlobError` for patterns the manifest would have refused.
 */
export function isExcludedPath(relative: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns?.length) return false;
  let globs = compiled.get(patterns);
  if (!globs) compiled.set(patterns, globs = compileGlobs(patterns.map(asMatched), DIALECT));
  return globs.covers(relative);
}
