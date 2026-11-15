import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigValidationError, parseWorkspaceConfig, serializeWorkspaceConfig } from '../src/config.js';
import { isNotebookContent, isNotebookPath, scanNotebookFolders } from '../src/folders.js';
import { EXCLUDE_EXPANSION_LIMIT, EXCLUDE_LIMIT, excludeGlobError, excludeListError, isExcludedPath } from '../src/notebook-exclude.js';
import { expandedLength } from '../src/path-glob.js';
import { scanNotebookEntries, scanNotebookNotes } from '../src/note-service.js';
import type { NotebookConfig } from '../src/types.js';

const manifest = (extra: string, notebookExtra = '') => `schema_version: 4\nworkspace:\n  title: T\n  default_notebook: a\n${extra}notebooks:\n  - id: a\n    title: A\n    root: docs\n${notebookExtra}  - id: b\n    title: B\n    root: other\n`;

describe('exclude glob dialect', () => {
  it('matches a path, or any folder above it, against an exclude glob: ** crosses folders, * and ? stay inside one name', () => {
    const excluded = (relative: string, ...patterns: string[]) => isExcludedPath(relative, patterns);
    expect(excluded('a/analysis/x.md', '**/analysis/**')).toBe(true);
    expect(excluded('analysis/x.md', '**/analysis/**')).toBe(true);
    expect(excluded('analysis', '**/analysis/**')).toBe(true);
    expect(excluded('a/analysis.md', '**/analysis/**')).toBe(false);
    expect(excluded('a/b/c.md', '**/analysis/**')).toBe(false);
    // A pattern naming a folder takes everything under it.
    expect(excluded('a/analysis/deep/x.md', '**/analysis')).toBe(true);
    expect(excluded('vendor/x/y.md', 'vendor')).toBe(true);
    expect(excluded('x/vendor/y.md', 'vendor')).toBe(false);
    // * does not cross a slash, so a bare *.md names top-level files only.
    expect(excluded('a.md', '*.md')).toBe(true);
    expect(excluded('sub/a.md', '*.md')).toBe(false);
    expect(excluded('sub/a.draft.md', '**/*.draft.md')).toBe(true);
    expect(excluded('sub/a.md', '**/*.draft.md')).toBe(false);
    expect(excluded('ab.md', 'a?.md')).toBe(true);
    expect(excluded('a/b.md', 'a?b.md')).toBe(false);
    expect(excluded('b/x.md', '{a,b}/**')).toBe(true);
    expect(excluded('c/x.md', '{a,b}/**')).toBe(false);
    // Case matters, and a dot name is matched like any other.
    expect(excluded('Analysis/x.md', 'analysis/**')).toBe(false);
    expect(excluded('.cache/x.md', '**/x.md')).toBe(true);
    expect(excluded('a.md')).toBe(false);
    expect(isExcludedPath('a.md', undefined)).toBe(false);
  });

  it('names what is wrong with a glob a manifest cannot use', () => {
    for (const good of ['**/analysis/**', '*.md', 'a/b', 'a?', '{a,b}/**', '[ab]/**', './a/**', 'drafts/', '**/drafts/', 'a+b', '[(]x', '[|]x', 'a,b']) expect([good, excludeGlobError(good)]).toEqual([good, undefined]);
    for (const bad of ['', '   ', '!a', '/a', '../a', 'a/../b', 'a\\b', '[abc', '(a', '{a,b', 'a\0b', 'x'.repeat(257), 'a//b']) expect([bad, typeof excludeGlobError(bad)]).toEqual([bad, 'string']);
    // No extended glob, group or quantifier: each is refused, not read as something else.
    expect(excludeGlobError('!(keep)')).toMatch(/negated/);
    for (const bad of ['*(a)', '+(a)', '?(a)', '@(a|b)', 'a/!(keep)/**', '(a+)+b', '(a|b)', 'a)']) expect([bad, excludeGlobError(bad)]).toEqual([bad, expect.stringMatching(/parenthes/i)]);
    expect(excludeGlobError('a|b')).toMatch(/\{a,b\}/);
    // A path that names nothing, an unbalanced or empty group, and ** glued to a name are refused too.
    for (const bad of ['.', './', 'a/./b', 'a//', '/', 'a]', 'a}', '{a}', '{1..3}', '[]', '[z-a]', '[a/b]', '**.md', 'a**', '***', 'a/**b/c']) expect([bad, typeof excludeGlobError(bad)]).toEqual([bad, 'string']);
    expect(excludeGlobError('**.md')).toMatch(/\*\*\/\*\.md|whole/);
  });

  it('reads a glob ending in / as the folder it names, so drafts/ takes everything under drafts', () => {
    const excluded = (relative: string, ...patterns: string[]) => isExcludedPath(relative, patterns);
    expect(excluded('drafts/x.md', 'drafts/')).toBe(true);
    expect(excluded('drafts/deep/x.md', 'drafts/')).toBe(true);
    expect(excluded('drafts', 'drafts/')).toBe(true);
    expect(excluded('a/drafts/x.md', 'drafts/')).toBe(false);
    expect(excluded('a/drafts/x.md', '**/drafts/')).toBe(true);
    expect(excluded('draftsman.md', 'drafts/')).toBe(false);
    expect(excluded('x/y.md', './x/')).toBe(true);
  });

  it('reads [!a] and [^a] as any other character, + as itself, and ? as one whole character', () => {
    const excluded = (relative: string, ...patterns: string[]) => isExcludedPath(relative, patterns);
    expect(excluded('b.md', '[!a].md')).toBe(true);
    expect(excluded('a.md', '[!a].md')).toBe(false);
    expect(excluded('b.md', '[^a].md')).toBe(true);
    expect(excluded('a+b', 'a+b')).toBe(true);
    expect(excluded('aab', 'a+b')).toBe(false);
    expect(excluded('(1).md', '[(]1[)].md')).toBe(true);
    expect(excluded('\u{1F600}.md', '?.md')).toBe(true);
    expect(excluded('筆記/草稿.md', '筆記/草?.md')).toBe(true);
    expect(excluded(']', '[]a]')).toBe(true);
    expect(excluded('-', '[a-]')).toBe(true);
    expect(excluded('b/c/d', '{a,b/c}/d')).toBe(true);
    expect(excluded('cx', '{a,{b,c}}x')).toBe(true);
    expect(excluded('b', '{,a}b')).toBe(true);
  });
});

describe('matching time', () => {
  const timed = (run: () => unknown) => {
    const started = performance.now();
    run();
    return performance.now() - started;
  };
  const deep = `${'a/'.repeat(200)}${'a'.repeat(255)}`;
  // Each is a glob the manifest accepts; under a backtracking matcher the first took 1.9 s on a 30-character name and
  // the others did not finish.
  const worst = { 'stars and letters in one name': `${'*a'.repeat(127)}b`, 'one long run after a star': `*${'a'.repeat(254)}b`, 'folders at any depth, many times': `${'**/a/'.repeat(50)}b`, 'folders and stars together': `${'**/*a*a/'.repeat(28)}b`, 'as many alternatives as a glob may hold': `${'{a,aa}'.repeat(6)}*a*b` };
  it('keeps the glob that hung a 30-character name under 200 ms', () => {
    const glob = '*a*a*a*a*a*a*a*a*a*a*a*ab';
    expect(excludeGlobError(glob)).toBeUndefined();
    expect(timed(() => expect(isExcludedPath('a'.repeat(30), [glob])).toBe(false))).toBeLessThan(200);
  });
  it.each(Object.entries(worst))('matches a 255-character name and a path 200 folders deep in under 200 ms: %s', (_name, glob) => {
    expect(glob.length).toBeLessThanOrEqual(256);
    expect(excludeGlobError(glob)).toBeUndefined();
    const patterns = [glob];
    isExcludedPath('warm', patterns);
    expect(timed(() => {
      expect(isExcludedPath('a'.repeat(255), patterns)).toBe(false);
      expect(isExcludedPath(deep, patterns)).toBe(false);
      expect(isExcludedPath(`${'a'.repeat(100)}.md`, patterns)).toBe(false);
    })).toBeLessThan(200);
  });
  it('matches the slowest globs a notebook may apply together against one deep path in under 200 ms', () => {
    // The five above expand to more than a notebook may apply, so as many of them as fit.
    const patterns: string[] = [];
    for (const glob of Object.values(worst)) if (excludeListError([...patterns, glob]) === undefined) patterns.push(glob);
    expect(patterns.length).toBeGreaterThan(1);
    isExcludedPath('warm', patterns);
    expect(timed(() => expect(isExcludedPath(deep, patterns)).toBe(false))).toBeLessThan(200);
  });
  it('refuses a glob whose alternatives multiply past the limit, before expanding it', () => {
    expect(timed(() => expect(excludeGlobError('{a,b}'.repeat(51))).toMatch(/alternatives/))).toBeLessThan(200);
    expect(timed(() => expect(excludeGlobError('{,}'.repeat(85))).toMatch(/alternatives/))).toBeLessThan(200);
    expect(excludeGlobError(`{${'a'.repeat(120)},${'b'.repeat(120)}}{c,d}{e,f}{g,h}`)).toMatch(/alternatives|long/);
    expect(excludeGlobError('{a,b}'.repeat(6))).toBeUndefined();
  });
});

describe('what a notebook applies, taken together', () => {
  // The cheapest of several runs: what is measured is the matching, not what else the machine is doing.
  // About 0.1 s and 1 ms on a developer machine; the bounds leave room for a loaded CI runner (0.58 s seen) and still
  // catch the superlinear matching they guard against, which took 17 to 51 s over these paths.
  const BULK_BOUND_MS = 2000;
  const LONG_BOUND_MS = 200;
  const fastest = (run: () => unknown) =>
    Math.min(...Array.from({ length: 3 }, () => {
      const started = performance.now();
      run();
      return performance.now() - started;
    }));
  // A thousand paths of about 305 characters, ten folders deep, of names the globs below walk to the end and then refuse.
  const paths = Array.from({ length: 1000 }, (_unused, path) => [...Array.from({ length: 10 }, (_folder, folder) => `${'ab'.repeat(14)}${(path * 10 + folder) % 10}`), `ab${path}.md`].join('/'));
  const long = Array.from({ length: 16 }, () => 'ab'.repeat(127) + 'a').join('/');
  const alternatives = '**/{*a,*b}{*a,*b}{*a,*b}{*a,*b}{*a,*b}{*a,*b}c';
  // Fills a workspace list and a notebook list with distinct globs of one shape until the next would not be allowed.
  const filled = (shape: (index: number) => string) => {
    const workspace: string[] = [];
    const notebook: string[] = [];
    for (let index = 0; workspace.length + notebook.length < 2 * EXCLUDE_LIMIT; index++) {
      const glob = shape(index);
      if (excludeListError([...workspace, ...notebook, glob]) !== undefined) break;
      (workspace.length < EXCLUDE_LIMIT ? workspace : notebook).push(glob);
    }
    return { workspace, notebook };
  };
  const listed = (globs: string[], indent: string) => globs.length ? `${indent}exclude:\n${globs.map(glob => `${indent}  - '${glob}'\n`).join('')}` : '';
  const applied = ({ workspace, notebook }: { workspace: string[]; notebook: string[]; }) => parseWorkspaceConfig(manifest(listed(workspace, ''), listed(notebook, '    '))).notebooks[0].excluded!;
  // The shapes that cost the most per character a notebook may apply: one glob of as many alternatives as it may hold,
  // and many short globs of stars, of classes and of ? that each walk every name of the path.
  const worstLists = { 'one glob of 64 alternatives': { workspace: [alternatives], notebook: [] }, 'short globs of a star': filled(index => `**/*a${index}c`), 'short globs of two stars': filled(index => `**/*a*a${index}c`), 'short globs of classes': filled(index => `**/*[ab]*[ab]${index}c`), 'short globs of ? and a star': filled(index => `**/?*a${index}c`) };

  it('counts the characters of the distinct patterns, so a pattern written twice or reached through two groups costs once', () => {
    expect(expandedLength(['{x,y}/**', 'x/**', 'x/**'])).toBe('x/**'.length + 'y/**'.length);
    expect(expandedLength([alternatives])).toBe(EXCLUDE_EXPANSION_LIMIT);
    expect(excludeListError(Array.from({ length: EXCLUDE_LIMIT }, () => alternatives))).toBeUndefined();
    expect(excludeListError([alternatives, 'x'])).toMatch(/1025 characters together, more than the 1024/);
    // A folder written with its trailing / is the folder.
    expect(expandedLength(['drafts'])).toBe(expandedLength(['drafts/'].map(glob => glob.slice(0, -1))));
    expect(excludeListError([alternatives, 'x/', 'x'])).toMatch(/1025 characters/);
  });

  it('matches a list of the same slow glob written a hundred times as fast as the glob alone', () => {
    const copies = Array.from({ length: EXCLUDE_LIMIT }, () => alternatives);
    isExcludedPath('warm', copies);
    expect(fastest(() => paths.forEach(path => expect(isExcludedPath(path, copies)).toBe(false)))).toBeLessThan(BULK_BOUND_MS);
  });

  it('refuses a manifest whose workspace and notebook globs expand past the limit together, naming the list', () => {
    const rejected = (extra: string, notebookExtra = '') => {
      try {
        parseWorkspaceConfig(manifest(extra, notebookExtra));
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        return (error as Error).message;
      }
      throw new Error('accepted');
    };
    // Each ends in its own character in place of the c, so each expands to 1024 characters as the one above does.
    const distinct = (count: number, offset = 0) => Array.from({ length: count }, (_unused, index) => `${alternatives.slice(0, -1)}${String.fromCodePoint(0x4e00 + index + offset)}`);
    // What took 51 s over these paths: a hundred distinct slow globs in each list.
    expect(rejected(listed(distinct(EXCLUDE_LIMIT), ''), listed(distinct(EXCLUDE_LIMIT, EXCLUDE_LIMIT), '    '))).toMatch(/^Workspace exclude is too large: .* more than the 1024/);
    expect(rejected('', listed(distinct(2), '    '))).toMatch(/^Notebook 'a' exclude is too large/);
    // Each list fits alone, but a notebook applies both.
    const half = ['**/{*a,*b}{*a,*b}{*a,*b}{*a,*b}{*a,*b}c'];
    expect(expandedLength(half)).toBeLessThanOrEqual(EXCLUDE_EXPANSION_LIMIT / 2);
    const both = rejected(listed(half, ''), listed([`${half[0]}d`, `${half[0]}e`], '    '));
    expect(both).toMatch(/^Notebook 'a' exclude, with the workspace exclude, is too large/);
    // The same glob in both lists is applied once.
    expect(applied({ workspace: [alternatives], notebook: [alternatives] })).toEqual([alternatives]);
  });

  it.each(Object.entries(worstLists))('matches the slowest list a manifest allows against a thousand 305-character paths and a 4,000-character path in linear time: %s', (_name, lists) => {
    const globs = applied(lists);
    expect(expandedLength(globs)).toBeGreaterThan(EXCLUDE_EXPANSION_LIMIT - 30);
    expect(paths[0].length).toBeGreaterThanOrEqual(300);
    expect(paths[0].length).toBeLessThanOrEqual(310);
    isExcludedPath('warm', globs);
    expect(fastest(() => paths.forEach(path => expect(isExcludedPath(path, globs)).toBe(false)))).toBeLessThan(BULK_BOUND_MS);
    expect(long.length).toBeGreaterThan(4000);
    expect(fastest(() => expect(isExcludedPath(long, globs)).toBe(false))).toBeLessThan(LONG_BOUND_MS);
  });

  it('refuses to match patterns past the limit that reached it without the manifest', () => {
    expect(() => isExcludedPath('a', [alternatives, 'x'])).toThrow(/longer than 1024 characters together/);
  });
});

describe('manifest exclude', () => {
  it('reads workspace and notebook globs, applying workspace ones to every notebook, and writes back only what was written', () => {
    const config = parseWorkspaceConfig(manifest('exclude:\n  - "**/analysis/**"\n  - "*.draft.md"\n', '    exclude:\n      - "reports/**"\n'));
    expect(config.exclude).toEqual(['**/analysis/**', '*.draft.md']);
    expect(config.notebooks[0].exclude).toEqual(['reports/**']);
    expect(config.notebooks[0].excluded).toEqual(['**/analysis/**', '*.draft.md', 'reports/**']);
    expect(config.notebooks[1].exclude).toBeUndefined();
    expect(config.notebooks[1].excluded).toEqual(['**/analysis/**', '*.draft.md']);
    const written = serializeWorkspaceConfig(config);
    expect(written).not.toContain('excluded');
    expect((written.match(/analysis/g) ?? []).length).toBe(1);
    const reread = parseWorkspaceConfig(written);
    expect(reread).toEqual(config);
    expect(serializeWorkspaceConfig(reread)).toBe(written);
  });

  it('leaves a manifest without exclude exactly as it was', () => {
    const config = parseWorkspaceConfig(manifest(''));
    expect(config).not.toHaveProperty('exclude');
    expect(config.notebooks.every(notebook => !('exclude' in notebook) && !('excluded' in notebook))).toBe(true);
    expect(serializeWorkspaceConfig(config)).not.toContain('exclude');
    // An empty list is a valid manifest and excludes nothing.
    expect(parseWorkspaceConfig(manifest('exclude: []\n')).notebooks[0].excluded).toBeUndefined();
  });

  it('rejects an exclude that is not a list of usable globs, naming where it was written', () => {
    const rejected = (extra: string, notebookExtra = '') => {
      try {
        parseWorkspaceConfig(manifest(extra, notebookExtra));
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        return (error as Error).message;
      }
      throw new Error('accepted');
    };
    expect(rejected('exclude: "**/x/**"\n')).toMatch(/workspace exclude must be a list/i);
    expect(rejected('exclude:\n  - 3\n')).toMatch(/workspace exclude/i);
    expect(rejected('exclude:\n  - "[abc"\n')).toMatch(/workspace exclude.*\[abc/i);
    expect(rejected('exclude:\n  - "!keep/**"\n')).toMatch(/negat/i);
    expect(rejected('exclude:\n  - "/abs/**"\n')).toMatch(/relative/i);
    expect(rejected('exclude:\n  - "../up/**"\n')).toMatch(/relative|\.\./);
    expect(rejected('', '    exclude:\n      - "{a,b"\n')).toMatch(/notebook 'a' exclude.*\{a,b/i);
    expect(rejected('', '    exclude: reports\n')).toMatch(/notebook 'a' exclude must be a list/i);
    // A list is capped, so a manifest cannot make every path pay for thousands of globs.
    const list = (count: number) => `exclude:\n${Array.from({ length: count }, (_unused, index) => `  - "d${index}/**"\n`).join('')}`;
    expect(parseWorkspaceConfig(manifest(list(EXCLUDE_LIMIT))).exclude).toHaveLength(EXCLUDE_LIMIT);
    expect(rejected(list(EXCLUDE_LIMIT + 1))).toMatch(/workspace exclude holds more than 100 globs/i);
    expect(rejected('', list(EXCLUDE_LIMIT + 1).replace(/^(?=.)/gm, '    '))).toMatch(/notebook 'a' exclude holds more than 100 globs/i);
    expect(rejected('exclude:\n  - "keep/!(this)"\n')).toMatch(/workspace exclude.*parenthes/i);
  });
});

describe('what an excluded path is', () => {
  const notebook: NotebookConfig = { id: 'a', title: 'A', root: 'docs', excluded: ['**/analysis/**'] };
  it('is no note content, yet stays a path of the notebook, so a link to it can still open the file', () => {
    expect(isNotebookContent('guide/a.md', notebook)).toBe(true);
    expect(isNotebookContent('guide/analysis/a.md', notebook)).toBe(false);
    expect(isNotebookContent('guide/analysis', notebook)).toBe(false);
    expect(isNotebookPath('guide/analysis/a.md', notebook)).toBe(true);
    expect(isNotebookPath('guide/analysis/schema.sql', notebook)).toBe(true);
    // Hidden, dependency, agent and asset paths are no notebook path either way.
    for (const hidden of ['.git/x', 'a/.templates/x.md', 'node_modules/x', 'dist/x', 'build/x', 'AGENTS.md', 'docs/agent/x.md', 'assets/x.png']) expect([hidden, isNotebookPath(hidden, notebook)]).toEqual([hidden, false]);
    // A notebook built by hand with only its own list still excludes.
    expect(isNotebookContent('r/x.md', { id: 'a', title: 'A', root: 'docs', exclude: ['r/**'] })).toBe(false);
  });

  describe('on disk', () => {
    let root: string;
    const write = (file: string, content = '# Title\n') => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    };
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-exclude-'));
      for (const file of ['docs/keep.md', 'docs/guide/a.md', 'docs/guide/analysis/b.md', 'docs/analysis/c.txt', 'docs/analysis/d.md', 'docs/note.draft.md', 'docs/guide/n.draft.md', 'docs/schema.sql']) write(file);
      write('docs/analysis/set.compilation.yml', 'title: Set\n');
      write('docs/analysis/_dir.yml', 'title: Analysis\n');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    it('is absent from the notes, the compilations and the folders of a scan, and a plain file was never a note', () => {
      const config = parseWorkspaceConfig(manifest('exclude:\n  - "**/analysis/**"\n  - "*.draft.md"\n'));
      const [docs] = config.notebooks;
      expect(scanNotebookNotes(root, docs).map(note => note.path).sort()).toEqual(['docs/guide/a.md', 'docs/guide/n.draft.md', 'docs/keep.md']);
      expect(scanNotebookEntries(root, docs).map(note => note.path).sort()).toEqual(['docs/guide/a.md', 'docs/guide/n.draft.md', 'docs/keep.md']);
      expect(scanNotebookFolders(root, docs).map(folder => folder.path)).toEqual(['guide']);
      // Without the globs every note and folder is there, so the manifest alone made the difference.
      const plain = parseWorkspaceConfig(manifest('')).notebooks[0];
      expect(scanNotebookNotes(root, plain).map(note => note.path).sort()).toEqual(['docs/analysis/c.txt', 'docs/analysis/d.md', 'docs/guide/a.md', 'docs/guide/analysis/b.md', 'docs/guide/n.draft.md', 'docs/keep.md', 'docs/note.draft.md']);
      expect(scanNotebookFolders(root, plain).map(folder => folder.path).sort()).toEqual(['analysis', 'guide', 'guide/analysis']);
    });
  });
});
