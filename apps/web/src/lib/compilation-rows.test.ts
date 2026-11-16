import { expect, it } from 'vitest';
import type { NotebookConfig } from './types.js';
import { parseCompilationNote } from './compilation-rows.js';

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const content = 'version: 1\nid: dup\ntitle: Dup\narrangement: lane\nsource:\n  kind: tag\n  tag: x\n';
const note = { path: 'notes/nb1/dup.compilation.yml', notebookId: 'nb1', title: 'Dup', content };

it('parses a valid compilation entry into a row', () => {
  expect(parseCompilationNote(note, notebooks)).toMatchObject({ row: { id: 'dup', name: 'Dup' } });
});
it('opens an entry the catalog marks invalid to its error although the text parses', () => {
  const parsed = parseCompilationNote({ ...note, invalid: 'Duplicate compilation id "dup" in notes/nb1/other.compilation.yml' }, notebooks);
  expect(parsed.row).toBeUndefined();
  expect(parsed.error).toContain('Duplicate compilation id');
});
it('reports a notebook that is not configured', () => {
  expect(parseCompilationNote({ ...note, notebookId: 'ghost' }, notebooks).error).toContain('ghost');
});

const repository: NotebookConfig[] = [{ id: 'r1~a', title: 'A', root: 'notes/a' }, { id: 'r1~b', title: 'B', root: 'notes/b' }, { id: 'r2~b', title: 'B elsewhere', root: 'notes/b' }];
const book = 'version: 1\nid: manual\ntitle: Manual\narrangement: book\nitems:\n  - { id: x, kind: note, path: notes/b/x.md }\n  - { id: f, kind: folder, path: notes/b/sec }\n  - { id: g, kind: note, path: gone/y.md }\n  - { id: z, kind: note, path: notes/a/z.md }\n';
const manual = { path: 'notes/a/manual.compilation.yml', notebookId: 'r1~a', title: 'Manual', content: book };

it("gives each item the notebook of the compilation's repository that holds its path, never another repository's, and the owner's for a path in none", () => {
  const items = parseCompilationNote(manual, repository).row?.kind === 'custom' ? (parseCompilationNote(manual, repository).row as { items: { notebookId?: string; }[]; }).items : [];
  expect(items.map(item => item.notebookId)).toEqual(['r1~b', 'r1~b', 'r1~a', 'r1~a']);
  // In repository r2, the same root resolves to r2's notebook only.
  const elsewhere = parseCompilationNote({ ...manual, notebookId: 'r2~b', path: 'notes/b/manual.compilation.yml' }, repository).row as { items: { notebookId?: string; }[]; };
  expect(elsewhere.items.map(item => item.notebookId)).toEqual(['r2~b', 'r2~b', 'r2~b', 'r2~b']);
});
it("takes a dynamic folder source's notebook from its path and refuses a folder source in no notebook of the repository", () => {
  const folder = (path: string) => ({ ...manual, content: `version: 1\nid: d\ntitle: D\narrangement: lane\nsource: { kind: folder, path: ${path} }\n` });
  expect(parseCompilationNote(folder('notes/b/sec'), repository).row).toMatchObject({ notebookId: 'r1~a', source: { notebookId: 'r1~b' } });
  expect(parseCompilationNote(folder('gone'), repository).error).toContain('outside every notebook');
});
