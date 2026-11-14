import picomatch from 'picomatch';

/** Longest exclude glob a manifest may carry; the notes shell's glob has the same bound. */
const GLOB_LIMIT = 256;

/**
 * The glob dialect of a manifest's `exclude`: picomatch with `dot` on and negation off. `**` crosses folders, `*` and `?`
 * stay inside one name, `[ab]` and `{a,b}` work as in a shell, matching is case-sensitive, and the path matched is the
 * one inside the notebook, with `/` separators and no leading `./`.
 */
const DIALECT = { dot: true, strictBrackets: true, nonegate: true } as const;

/** What is wrong with `pattern` as an exclude glob, or undefined when it is usable. */
export function excludeGlobError(pattern: string): string | undefined {
  /* eslint-disable no-control-regex -- A control character in a persisted path pattern is never intended. */
  if (!pattern.trim()) return 'it is empty';
  if (pattern.length > GLOB_LIMIT) return `it is longer than ${GLOB_LIMIT} characters`;
  if (/[\x00-\x1f\x7f]/.test(pattern)) return 'it holds a control character';
  /* eslint-enable no-control-regex */
  if (pattern.startsWith('!')) return 'it is negated; list what to exclude, not what to keep';
  if (pattern.startsWith('/') || pattern.includes('\\') || pattern.split('/').some((part, index, parts) => part === '..' || part === '' && index < parts.length - 1)) return 'use a path relative to the notebook, with / separators and no .. or empty segments';
  try {
    picomatch(withoutDotSlash(pattern), DIALECT);
  } catch (error) {
    return error instanceof Error ? error.message : 'it is not a valid glob';
  }
  return undefined;
}

const withoutDotSlash = (pattern: string) => pattern.startsWith('./') ? pattern.slice(2) : pattern;

const compiled = new WeakMap<readonly string[], (relative: string) => boolean>();

function compile(patterns: readonly string[]): (relative: string) => boolean {
  const matchers = patterns.map(pattern => picomatch(withoutDotSlash(pattern), DIALECT));
  return relative => matchers.some(match => match(relative));
}

/**
 * Whether `relative`, a path inside a notebook, is excluded by `patterns`: the path or a folder above it matches one, so a
 * glob naming a folder takes everything under it.
 */
export function isExcludedPath(relative: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns?.length) return false;
  let matches = compiled.get(patterns);
  if (!matches) compiled.set(patterns, matches = compile(patterns));
  const parts = relative.split('/');
  for (let length = 1; length <= parts.length; length++) if (matches(parts.slice(0, length).join('/'))) return true;
  return false;
}
