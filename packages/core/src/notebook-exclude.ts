import { compileGlobs, globError, type PathGlob } from './path-glob.js';

/**
 * Most globs one `exclude` list may hold. A notebook applies the workspace's list and its own, so at most twice this, and
 * every path of the notebook is matched against each: with the bound on one glob (`path-glob.ts`) the cost of a path
 * stays in proportion to its length whatever the manifest holds.
 */
export const EXCLUDE_LIMIT = 100;

/**
 * The glob dialect of a manifest's `exclude` is the one of `path-glob.ts`, with a dot name matched like any other. The
 * path matched is the one inside the notebook, with `/` separators and no leading `./`. A glob ending in `/` names a
 * folder: `drafts/` is read as `drafts`, which takes the folder and everything under it.
 */
const DIALECT = { dot: true } as const;

/** The glob as it is matched: a folder written with its trailing `/` is the folder. */
const asMatched = (pattern: string) => pattern.length > 1 && pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;

/** What is wrong with `pattern` as an exclude glob, or undefined when it is usable. */
export function excludeGlobError(pattern: string): string | undefined {
  if (pattern.startsWith('!')) return 'it is negated; list what to exclude, not what to keep';
  return globError(asMatched(pattern));
}

const compiled = new WeakMap<readonly string[], PathGlob>();

/**
 * Whether `relative`, a path inside a notebook, is excluded by `patterns`: the path or a folder above it matches one, so a
 * glob naming a folder takes everything under it.
 */
export function isExcludedPath(relative: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns?.length) return false;
  let globs = compiled.get(patterns);
  if (!globs) compiled.set(patterns, globs = compileGlobs(patterns.map(asMatched), DIALECT));
  return globs.covers(relative);
}
