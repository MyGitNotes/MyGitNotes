import { describe, expect, it } from 'vitest';
import picomatch from 'picomatch';
import { compileGlobs, GLOB_ALTERNATIVE_LIMIT, GLOB_EXPANSION_LIMIT, GLOB_LENGTH_LIMIT, globError } from '../src/path-glob.js';

const matches = (glob: string, path: string, dot = true) => compileGlobs([glob], { dot }).matches(path);
const covers = (glob: string, path: string, dot = true) => compileGlobs([glob], { dot }).covers(path);

describe('path glob dialect', () => {
  it('matches names with *, ? and classes, and folders with ** as a whole segment', () => {
    expect(matches('*.md', 'a.md')).toBe(true);
    expect(matches('*.md', 'sub/a.md')).toBe(false);
    expect(matches('**/*.md', 'a.md')).toBe(true);
    expect(matches('**/*.md', 'sub/deep/a.md')).toBe(true);
    expect(matches('a/**/b', 'a/b')).toBe(true);
    expect(matches('a/**/b', 'a/x/y/b')).toBe(true);
    expect(matches('a/**/b', 'a/x/y/c')).toBe(false);
    expect(matches('**/**/a', 'a')).toBe(true);
    expect(matches('a*', 'a')).toBe(true);
    expect(matches('*a*b*', 'xaybz')).toBe(true);
    expect(matches('*a*b*', 'xbya')).toBe(false);
    expect(matches('a?c', 'abc')).toBe(true);
    expect(matches('a?c', 'ac')).toBe(false);
    expect(matches('a?c', 'a/c')).toBe(false);
    expect(matches('[a-c]x', 'bx')).toBe(true);
    expect(matches('[a-c]x', 'dx')).toBe(false);
    expect(matches('[!a-c]x', 'dx')).toBe(true);
    expect(matches('[^a-c]x', 'bx')).toBe(false);
    expect(matches('A', 'a')).toBe(false);
    expect(matches('./a/*', 'a/b')).toBe(true);
    expect(matches('a', '')).toBe(false);
  });

  it('takes either alternative of a group, across a slash or nested, and reads a comma outside one as itself', () => {
    expect(matches('notes/**/*.{md,txt}', 'notes/s/a.txt')).toBe(true);
    expect(matches('notes/**/*.{md,txt}', 'notes/s/a.pdf')).toBe(false);
    expect(matches('{a,b/c}/d', 'b/c/d')).toBe(true);
    expect(matches('{a,{b,c}}x', 'cx')).toBe(true);
    expect(matches('a{,b}', 'a')).toBe(true);
    expect(matches('a,b', 'a,b')).toBe(true);
    expect(matches('[{,}]', ',')).toBe(true);
  });

  it('lets a trailing ** stand for something under the folder when matching a file, and for the folder too when covering', () => {
    expect(matches('a/**', 'a/b/c')).toBe(true);
    expect(matches('a/**', 'a')).toBe(false);
    expect(matches('notes/*/**', 'notes/a.md')).toBe(false);
    expect(matches('notes/*/**', 'notes/sub/a.md')).toBe(true);
    expect(matches('**', 'a/b')).toBe(true);
    expect(covers('a/**', 'a')).toBe(true);
    expect(covers('a/**', 'a/b/c')).toBe(true);
    expect(covers('a', 'a/b/c')).toBe(true);
    expect(covers('a', 'ab/c')).toBe(false);
    expect(covers('*/b', 'a/b/c/d')).toBe(true);
    expect(covers('**/b', 'a/c/d')).toBe(false);
    expect(matches('a', 'a/b')).toBe(false);
  });

  it('keeps wildcards off the dot that begins a name unless dot names are asked for', () => {
    expect(matches('*', '.a', false)).toBe(false);
    expect(matches('?a', '.a', false)).toBe(false);
    expect(matches('[!x]a', '.a', false)).toBe(false);
    expect(matches('[.]a', '.a', false)).toBe(true);
    expect(matches('.*', '.a', false)).toBe(true);
    expect(matches('**/x', 'a/.h/x', false)).toBe(false);
    expect(matches('*/.h/*', 'a/.h/x', false)).toBe(true);
    expect(matches('a*', 'a.b', false)).toBe(true);
    expect(matches('**/x', 'a/.h/x', true)).toBe(true);
    expect(matches('*', '.a', true)).toBe(true);
  });

  it('refuses what it does not read, saying why', () => {
    for (const [glob, reason] of [['*(a)', /parenthes/], ['a|b', /\{a,b\}/], ['[ab', /closing '\]'/], ['ab]', /no '\['/], ['{a,b', /closing '\}'/], ['a}', /no '\{'/], ['{a}', /comma/], ['{1..3}', /comma/], ['[z-a]', /backwards/], ['[a/b]', /inside \[ \]/], ['a**', /whole segment/], ['***', /whole segment/], ['a//b', /relative/], ['/a', /relative/], ['a/../b', /relative/], ['a\\b', /relative/], ['.', /relative/], ['', /empty/], ['x'.repeat(GLOB_LENGTH_LIMIT + 1), /longer/], ['a\nb', /control/]] as const) expect([glob, globError(glob)]).toEqual([glob, expect.stringMatching(reason)]);
    expect(() => compileGlobs(['ok', '(bad)'], { dot: true })).toThrow(/parenthes/);
    expect(globError('x'.repeat(GLOB_LENGTH_LIMIT))).toBeUndefined();
  });

  it('bounds what the groups of one glob expand to, by count and by length', () => {
    expect(globError('{a,b}'.repeat(6))).toBeUndefined();
    expect(2 ** 6).toBe(GLOB_ALTERNATIVE_LIMIT);
    expect(globError('{a,b}'.repeat(7))).toMatch(/more than 64 alternatives/);
    expect(globError(`{${Array.from({ length: GLOB_ALTERNATIVE_LIMIT + 1 }, () => 'a').join(',')}}`)).toMatch(/more than 64 alternatives/);
    // Sixteen alternatives of 70 characters are within the count and past the length.
    const long = `${'{a,b}'.repeat(4)}${'x'.repeat(66)}`;
    expect(16 * 70).toBeGreaterThan(GLOB_EXPANSION_LIMIT);
    expect(globError(long)).toMatch(/longer than 1024 characters/);
    expect(globError(`${'{a,b}'.repeat(4)}${'x'.repeat(60)}`)).toBeUndefined();
  });
});

describe('agreement with picomatch', () => {
  // The dialect was picomatch's before it was matched here. Where both read a glob the same way they must agree; left
  // out are the readings picomatch gets from its regular expression and this dialect refuses or defines otherwise: `|`,
  // parentheses, `[!a]` (picomatch reads the ! as a member), a trailing /** (picomatch matches the folder itself or
  // not by what precedes it) and a wildcard at the start of a group under dot: false (picomatch lets it take the dot).
  const segments = ['a', 'b', 'ab', '*', '?', 'a*', '*b', '*.md', 'a?', '[ab]', '[a-c]x', '{a,b}', '**', '.a', '.*', 'x.md', '*a*', '?*', '*?', '[.]a', '[^a]', '{a,.a}', 'a{b,}', '{a,b/c}', '[^.]x', '{a,b}{.md,}', '*.{md,txt}', 'a,b', 'a+', '+a', '!a', '@a', 'a$', '^a', 'a.b', 'a~', 'é*', '?é'];
  const names = ['a+', 'a,b', '!a', 'aé', 'éa', 'axb', 'a.b', 'a.txt', 'a', 'b', 'ab', 'x.md', '.a', 'aab', 'c', 'bx', 'a.md', '.md', 'ax', '.ax', 'abx', 'b/c'];
  const globs = [...segments, ...segments.flatMap(first => segments.map(second => `${first}/${second}`)), ...Array.from({ length: 400 }, (_unused, index) => [0, 1, 2].map(place => segments[(index * 7 + place * 13 + (index >> 3)) % segments.length]).join('/'))].filter(glob => !glob.endsWith('/**'));
  const paths = [...names, ...names.flatMap(first => names.map(second => `${first}/${second}`)), ...names.flatMap(first => ['a', '.a', 'x.md'].flatMap(second => ['b', 'a.md'].map(third => `${first}/${second}/${third}`)))];
  it.each([true, false])('reads the shared globs as picomatch does, dot: %s', dot => {
    const differing: string[] = [];
    for (const glob of globs) {
      const ours = compileGlobs([glob], { dot });
      const theirs = picomatch(glob, { dot, strictBrackets: true, nonegate: true, noextglob: true });
      for (const path of paths) if (ours.matches(path) !== theirs(path)) differing.push(`${glob} on ${path}`);
    }
    expect(globs.length).toBeGreaterThan(1500);
    expect(differing).toEqual([]);
  });
});
