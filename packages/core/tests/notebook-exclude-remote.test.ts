import { describe, expect, it } from 'vitest';
import { gitlabFixture } from './fixtures/gitlab.js';
import { openRemoteRepository } from '../src/remote-factory.js';
import { workspaceCatalog } from '../src/note-catalog.js';
import { callNoteShell } from '../src/note-shell.js';
import { classifyResource } from '../src/classifier.js';

const MANIFEST = 'schema_version: 4\nworkspace:\n  title: Test\n  default_notebook: ex\nexclude:\n  - "**/analysis/**"\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n    exclude:\n      - "*.draft.md"\n';
const files = { 'notes/.mygitnotes.yaml': MANIFEST, 'notes/ex/analysis/report.md': '# Report\n\nkeyword\n', 'notes/ex/folder/analysis/deep.md': '# Deep\n\nkeyword\n', 'notes/ex/analysis/schema.sql': 'select 1;\n', 'notes/ex/analysis/spec.pdf': '%PDF', 'notes/ex/wip.draft.md': '# Draft\n\nkeyword\n', 'notes/ex/folder/wip.draft.md': '# Kept\n\nkeyword\n', 'notes/ex/folder/data.csv': 'a,b\n' };
const open = (f: ReturnType<typeof gitlabFixture>) => openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'token', f.request).reader;

describe('a remote notebook with excluded paths', () => {
  it('lists, indexes and searches only the notes the globs leave, and never lists a plain file as a note', async () => {
    const reader = open(gitlabFixture(undefined, files));
    expect((await reader.notes()).map(note => note.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/folder/b.md', 'notes/ex/folder/wip.draft.md']);
    expect((await reader.folders()).map(folder => folder.path)).toEqual(['folder']);
    const config = await reader.config();
    expect(config.exclude).toEqual(['**/analysis/**']);
    expect(config.notebooks[0].excluded).toEqual(['**/analysis/**', '*.draft.md']);
    const catalog = await workspaceCatalog(config, [{ id: reader.id, alias: 'qa', notebooks: config.notebooks, catalog: reader.catalog() }]);
    expect((await catalog.index((await catalog.config()).notebooks[0])).map(note => note.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/folder/b.md', 'notes/ex/folder/wip.draft.md']);
  });

  it('keeps the excluded notes out of the shell listings and searches an agent runs, and refuses a note written there', async () => {
    const f = gitlabFixture(undefined, files);
    expect((await callNoteShell(open(f), 'glob', { pattern: 'notes/ex/**' }, false)).paths).toEqual(['notes/ex/a.md', 'notes/ex/folder/_dir.yml', 'notes/ex/folder/b.md', 'notes/ex/folder/wip.draft.md']);
    const found = await callNoteShell(open(f), 'find', { query: 'keyword', pattern: 'notes/ex/**' }, false);
    expect((found.matches as { path: string; }[]).map(match => match.path)).toEqual(['notes/ex/folder/wip.draft.md']);
    await expect(callNoteShell(open(f), 'write', { path: 'notes/ex/analysis/new.md', content: '# New\n', revision: f.head, createOnly: true }, true)).rejects.toMatchObject({ status: 403 });
    await expect(callNoteShell(open(f), 'read', { path: 'notes/ex/analysis/report.md' }, false)).rejects.toMatchObject({ status: 404 });
  });

  it('still reaches an excluded path as a file of its notebook, and a note path as a note', async () => {
    const config = await open(gitlabFixture(undefined, files)).config();
    const kind = (file: string) => classifyResource(file, config).type;
    expect(kind('notes/ex/analysis/report.md')).toBe('text_file');
    expect(kind('notes/ex/analysis/schema.sql')).toBe('text_file');
    expect(kind('notes/ex/analysis/spec.pdf')).toBe('pdf_file');
    expect(kind('notes/ex/folder/data.csv')).toBe('text_file');
    expect(kind('notes/ex/wip.draft.md')).toBe('text_file');
    expect(kind('notes/ex/folder/b.md')).toBe('note');
  });
});
