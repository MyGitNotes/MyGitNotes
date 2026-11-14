import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigValidationError, parseWorkspaceConfig, serializeWorkspaceConfig } from '../src/config.js';
import { isNotebookContent, isNotebookPath, scanNotebookFolders } from '../src/folders.js';
import { excludeGlobError, isExcludedPath } from '../src/notebook-exclude.js';
import { scanNotebookEntries, scanNotebookNotes } from '../src/note-service.js';
import type { NotebookConfig } from '../src/types.js';

const manifest = (extra: string, notebookExtra = '') => `schema_version: 4\nworkspace:\n  title: T\n  default_notebook: a\n${extra}notebooks:\n  - id: a\n    title: A\n    root: docs\n${notebookExtra}  - id: b\n    title: B\n    root: other\n`;

describe('exclude glob dialect', () => {
  it('matches a path, or any folder above it, against a picomatch glob: ** crosses folders, * and ? stay inside one name', () => {
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
    for (const good of ['**/analysis/**', '*.md', 'a/b', 'a?', '{a,b}/**', '[ab]/**', './a/**']) expect([good, excludeGlobError(good)]).toEqual([good, undefined]);
    for (const bad of ['', '   ', '!a', '/a', '../a', 'a/../b', 'a\\b', '[abc', '(a', '{a,b', 'a\0b', 'x'.repeat(257), 'a//b']) expect([bad, typeof excludeGlobError(bad)]).toEqual([bad, 'string']);
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
