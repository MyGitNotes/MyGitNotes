/**
 * Path globs matched in bounded time, for patterns someone else wrote: a manifest's `exclude` and the pattern an agent
 * passes to the notes shell.
 *
 * The dialect is the shell's, with nothing a regular expression would add. `**` as a whole segment crosses folders, `*`
 * and `?` stay inside one name, `[ab]`, `[a-z]` and `[!a]` (or `[^a]`) match one character, and `{a,b}` is either
 * alternative, which may hold a `/` or another group. Every other character is itself, `+` and `!` included. There is no
 * escape, no extended glob (`!(a)`, `*(a)`, `+(a)`, `?(a)`, `@(a)`), no parenthesis, no `|` and no range such as `{1..3}`;
 * a name holding `(`, `|` or `{` is matched with `[(]`, `[|]` or `[{]`. Matching is case-sensitive, over `/` separated paths.
 *
 * No glob is turned into a regular expression. A name is matched against a segment with the two-pointer wildcard walk,
 * and segments against a path by tracking the set of reachable segments, so one pattern costs at most its length times
 * the path's length. Alternatives are the only multiplier, so a glob may expand to at most `GLOB_ALTERNATIVE_LIMIT`
 * patterns of `GLOB_EXPANSION_LIMIT` characters together: a glob then costs at most 1024 character steps per character
 * of the path, whatever it holds. Globs compiled together cost what their distinct patterns hold together, the same
 * pattern counted once, and a caller that takes many globs from someone else bounds that with `expansionLimit`.
 */

/** Longest glob accepted. */
export const GLOB_LENGTH_LIMIT = 256;
/** Most patterns the `{a,b}` groups of one glob may expand to. */
export const GLOB_ALTERNATIVE_LIMIT = 64;
/** Most characters those patterns may hold together, four times the longest glob. */
export const GLOB_EXPANSION_LIMIT = 1024;

/** What is wrong with a glob; the message completes "the glob is invalid: ...". */
export class GlobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlobError';
  }
}

export interface PathGlob {
  /** Whether a glob matches `path`, the path of a file: a trailing `**` then stands for something under the folder. */
  matches(path: string): boolean;
  /**
   * Whether a glob matches `path` or a folder above it. The path may itself be a folder, so a trailing `**` also matches
   * the folder it stands under: `a/**` covers what `a` covers.
   */
  covers(path: string): boolean;
}

export interface GlobOptions {
  /** Whether `*`, `?`, `**` and a negated class may match the dot that begins a name. */
  dot: boolean;
  /** Most characters the distinct patterns of all the globs may hold together; unbounded when left out. */
  expansionLimit?: number;
}

/** A `[...]` class: its members as code points, with the ASCII ones also in a table. */
type ClassToken = { kind: 'class'; negated: boolean; ascii: Uint8Array; singles: Set<number>; ranges: [number, number][]; };
/** What one position of a segment asks of a name: a run of any characters, or one character. */
type Token = { kind: 'star'; } | { kind: 'any'; } | { kind: 'char'; char: string; } | ClassToken;
/** A name of the path matched, as code points the first time a wildcard walks it, for every pattern after. */
interface Part {
  name: string;
  points?: Int32Array;
}
/**
 * A segment of a pattern: `**` (any number of names, or with `some` at least one), a literal name, or tokens. Tokens are
 * walked as numbers: a code point is itself, `STAR` is `*`, `ANY` is `?`, and from `CLASS` down each is a class.
 */
type Segment = { kind: 'globstar'; some?: true; } | { kind: 'literal'; name: string; } | { kind: 'tokens'; codes: Int32Array; classes: ClassToken[]; };
const STAR = -1;
const ANY = -2;
const CLASS = -3;
/**
 * One pattern, as it covers a path and as it matches a file, with the two state rows its matching reuses; matching is
 * synchronous, so they are never shared.
 */
interface Pattern {
  covering: Segment[];
  matching: Segment[];
  reached: Uint8Array;
  next: Uint8Array;
}

/** The end of the class opening at `open`, or -1; a `]` right after the opening (and its negation) is a member. */
function classEnd(pattern: string, open: number): number {
  let index = open + 1;
  if (pattern[index] === '!' || pattern[index] === '^') index++;
  if (pattern[index] === ']') index++;
  return pattern.indexOf(']', index);
}

/**
 * Expands the `{a,b}` groups of `pattern` into plain patterns, refusing parentheses and unbalanced brackets or braces on
 * the way. The count is checked each time the patterns multiply, so a glob that multiplies past the limit is refused
 * without being built.
 */
function expand(pattern: string): string[] {
  const bounded = (patterns: string[]) => {
    if (patterns.length > GLOB_ALTERNATIVE_LIMIT) throw new GlobError(`its {a,b} groups expand to more than ${GLOB_ALTERNATIVE_LIMIT} alternatives`);
    return patterns;
  };
  // Reads a sequence up to the `,` or `}` that ends it inside a group, or to the end outside one, and expands it.
  const sequence = (start: number, grouped: boolean): { patterns: string[]; end: number; } => {
    let patterns = [''];
    let index = start;
    const append = (alternatives: string[]) => {
      patterns = bounded(patterns.flatMap(prefix => alternatives.map(alternative => prefix + alternative)));
    };
    while (index < pattern.length) {
      const char = pattern[index];
      if (grouped && (char === ',' || char === '}')) break;
      if (char === '(' || char === ')') throw new GlobError('it holds a parenthesis; extended globs and groups are not supported, and [(] matches a literal one');
      if (char === '|') throw new GlobError("it holds a '|'; alternatives are written {a,b}, and [|] matches a literal one");
      if (char === ']') throw new GlobError("it holds a ']' with no '[' before it");
      if (char === '}') throw new GlobError("it holds a '}' with no '{' before it");
      if (char === '[') {
        const end = classEnd(pattern, index);
        if (end < 0) throw new GlobError("it holds a '[' with no closing ']'");
        const written = pattern.slice(index, end + 1);
        if (written.includes('/')) throw new GlobError("it holds a '/' inside [ ]");
        append([written]);
        index = end + 1;
      } else if (char === '{') {
        const alternatives: string[] = [];
        let branches = 0;
        do {
          const branch = sequence(index + 1, true);
          if (branch.end >= pattern.length) throw new GlobError("it holds a '{' with no closing '}'");
          bounded(alternatives).push(...branch.patterns);
          branches++;
          index = branch.end;
        } while (pattern[index] === ',');
        if (branches < 2) throw new GlobError('it holds a {group} without a comma; ranges such as {1..3} are not supported, and [{] matches a literal brace');
        append(alternatives);
        index++;
      } else {
        // A run of plain characters extends every pattern at once; outside a group a comma is plain.
        let end = index + 1;
        while (end < pattern.length && !'()|[]{}'.includes(pattern[end]) && (pattern[end] !== ',' || !grouped)) end++;
        append([pattern.slice(index, end)]);
        index = end;
      }
    }
    return { patterns, end: index };
  };
  const { patterns } = sequence(0, false);
  if (patterns.reduce((total, expanded) => total + expanded.length, 0) > GLOB_EXPANSION_LIMIT) throw new GlobError(`its {a,b} groups expand to alternatives longer than ${GLOB_EXPANSION_LIMIT} characters together`);
  return patterns;
}

function classToken(written: string): ClassToken {
  let body = Array.from(written.slice(1, -1));
  const negated = body[0] === '!' || body[0] === '^';
  if (negated) body = body.slice(1);
  const singles = new Set<number>();
  const ranges: [number, number][] = [];
  for (let index = 0; index < body.length; index++) {
    if (body[index + 1] === '-' && index + 2 < body.length) {
      const from = body[index].codePointAt(0)!;
      const to = body[index + 2].codePointAt(0)!;
      if (from > to) throw new GlobError(`its range ${body[index]}-${body[index + 2]} runs backwards`);
      ranges.push([from, to]);
      index += 2;
    } else singles.add(body[index].codePointAt(0)!);
  }
  // An ASCII character, what most names are made of, is looked up at once.
  const ascii = new Uint8Array(128);
  for (const single of singles) if (single < 128) ascii[single] = 1;
  for (const [from, to] of ranges) for (let code = from; code <= Math.min(to, 127); code++) ascii[code] = 1;
  return { kind: 'class', negated, ascii, singles, ranges };
}

function segmentOf(written: string): Segment {
  if (written === '**') return { kind: 'globstar' };
  const tokens: Token[] = [];
  for (let index = 0; index < written.length;) {
    const char = written[index];
    if (char === '*') {
      if (tokens.at(-1)?.kind === 'star') throw new GlobError('its ** is joined to a name; ** crosses folders only as a whole segment, as in **/*.md');
      tokens.push({ kind: 'star' });
      index++;
    } else if (char === '?') {
      tokens.push({ kind: 'any' });
      index++;
    } else if (char === '[') {
      const end = classEnd(written, index);
      tokens.push(classToken(written.slice(index, end + 1)));
      index = end + 1;
    } else {
      const point = String.fromCodePoint(written.codePointAt(index)!);
      tokens.push({ kind: 'char', char: point });
      index += point.length;
    }
  }
  if (tokens.every(token => token.kind === 'char')) return { kind: 'literal', name: written };
  const classes: ClassToken[] = [];
  const codes = Int32Array.from(tokens, token => token.kind === 'star' ? STAR : token.kind === 'any' ? ANY : token.kind === 'char' ? token.char.codePointAt(0)! : CLASS - classes.push(token) + 1);
  return { kind: 'tokens', codes, classes };
}

function classMatches(token: ClassToken, point: number): boolean {
  if (point < 128) return (token.ascii[point] === 1) !== token.negated;
  return (token.singles.has(point) || token.ranges.some(([from, to]) => point >= from && point <= to)) !== token.negated;
}

/**
 * Whether the tokens match the whole of the name: on a mismatch the walk returns to the last `*` and lets it take one
 * more character. An earlier `*` is never revisited, since the leftmost place the text up to the last one fits leaves
 * the most name for the rest, so the walk costs at most the name's length times the tokens' count.
 */
function nameMatches(segment: Extract<Segment, { kind: 'tokens'; }>, part: Part, dot: boolean): boolean {
  const { codes, classes } = segment;
  // Only a dot written in the pattern, or in a class that lists it, matches the dot that begins a name.
  if (!dot && part.name.startsWith('.') && (codes[0] === STAR || codes[0] === ANY || (codes[0] <= CLASS && classes[CLASS - codes[0]].negated))) return false;
  const points = part.points ??= Int32Array.from(part.name, char => char.codePointAt(0)!);
  const length = points.length;
  const count = codes.length;
  let token = 0;
  let char = 0;
  let star = -1;
  let mark = 0;
  while (char < length) {
    if (token < count) {
      const code = codes[token];
      if (code === STAR) {
        star = token++;
        mark = char;
        continue;
      }
      if (code >= 0 ? code === points[char] : code === ANY || classMatches(classes[CLASS - code], points[char])) {
        token++;
        char++;
        continue;
      }
    }
    if (star < 0) return false;
    token = star + 1;
    char = ++mark;
  }
  while (token < count && codes[token] === STAR) token++;
  return token === count;
}

/**
 * Whether the pattern matches `parts`, or with `within` any leading run of them. `reached[n]` says the first n segments
 * have matched the parts read so far; a `**` may match no part at all, so reaching it reaches the segment after it too,
 * unless it must take some. Each segment meets each part at most once.
 */
function pathMatches(pattern: Pattern, parts: Part[], dot: boolean, within: boolean): boolean {
  const segments = within ? pattern.covering : pattern.matching;
  const count = segments.length;
  let { reached, next } = pattern;
  const reach = (states: Uint8Array, from: number) => {
    for (let index = from; !states[index]; index++) {
      states[index] = 1;
      const segment = segments[index];
      if (index === count || segment.kind !== 'globstar' || segment.some) break;
    }
  };
  reached.fill(0);
  reach(reached, 0);
  for (const part of parts) {
    const { name } = part;
    next.fill(0);
    let alive = false;
    for (let index = 0; index < count; index++) {
      if (!reached[index]) continue;
      const segment = segments[index];
      if (segment.kind === 'globstar' ? dot || !name.startsWith('.') : segment.kind === 'literal' ? segment.name === name : nameMatches(segment, part, dot)) {
        // A `**` stays to take more names; one that had to take some has now done so and may also end here.
        if (segment.kind === 'globstar') reach(next, index);
        if (segment.kind !== 'globstar' || segment.some) reach(next, index + 1);
        alive = true;
      }
    }
    if (!alive) return false;
    [reached, next] = [next, reached];
    if (within && reached[count]) return true;
  }
  return reached[count] === 1;
}

/** The plain patterns `glob` expands to; throws a `GlobError` saying what is wrong with it. */
function expandGlob(glob: string): string[] {
  /* eslint-disable no-control-regex -- A control character in a path pattern is never intended. */
  if (!glob.trim()) throw new GlobError('it is empty');
  if (glob.length > GLOB_LENGTH_LIMIT) throw new GlobError(`it is longer than ${GLOB_LENGTH_LIMIT} characters`);
  if (/[\x00-\x1f\x7f]/.test(glob)) throw new GlobError('it holds a control character');
  /* eslint-enable no-control-regex */
  const pattern = glob.startsWith('./') ? glob.slice(2) : glob;
  if (pattern.startsWith('/') || pattern.includes('\\') || pattern.split('/').some(part => part === '' || part === '.' || part === '..')) throw new GlobError('use a relative path with / separators and no empty, . or .. segments');
  return expand(pattern);
}

function compile(expanded: string): Pattern {
  const covering = expanded.split('/').map(segmentOf);
  // A file is never the folder a trailing `**` stands under, so there the `**` takes at least one name.
  const matching = covering.at(-1)?.kind === 'globstar' ? [...covering.slice(0, -1), { kind: 'globstar' as const, some: true as const }] : covering;
  return { covering, matching, reached: new Uint8Array(covering.length + 1), next: new Uint8Array(covering.length + 1) };
}

/**
 * The distinct plain patterns `globs` expand to, so a pattern written twice, or reached through two groups, is matched
 * once; throws a `GlobError` for a glob outside the dialect.
 */
export function expandGlobs(globs: readonly string[]): string[] {
  return [...new Set(globs.flatMap(expandGlob))];
}

/** The characters the distinct patterns of `globs` hold together: what matching a path against all of them costs per character of the path. */
export function expandedLength(globs: readonly string[]): number {
  return expandGlobs(globs).reduce((total, pattern) => total + pattern.length, 0);
}

/**
 * Compiles globs into one matcher that answers for any of them; throws a `GlobError` for a glob outside the dialect, or
 * for globs whose patterns hold more than `options.expansionLimit` characters together. A path is split once however
 * many globs there are, and each of its names is read into code points at most once.
 */
export function compileGlobs(globs: readonly string[], options: GlobOptions): PathGlob {
  const expanded = expandGlobs(globs);
  const { expansionLimit } = options;
  if (expansionLimit !== undefined && expanded.reduce((total, pattern) => total + pattern.length, 0) > expansionLimit) throw new GlobError(`they expand to patterns longer than ${expansionLimit} characters together`);
  const patterns = expanded.map(compile);
  const test = (path: string, within: boolean) => {
    if (!path) return false;
    const parts = path.split('/').map((name): Part => ({ name }));
    return patterns.some(pattern => pathMatches(pattern, parts, options.dot, within));
  };
  return { matches: path => test(path, false), covers: path => test(path, true) };
}

/** What is wrong with `glob`, or undefined when it compiles. */
export function globError(glob: string): string | undefined {
  try {
    expandGlob(glob).forEach(compile);
    return undefined;
  } catch (error) {
    if (error instanceof GlobError) return error.message;
    throw error;
  }
}
