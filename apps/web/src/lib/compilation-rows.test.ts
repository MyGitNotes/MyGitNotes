import { expect, it } from 'vitest';
import type { NotebookConfig } from './types.js';
import { compilationText, parseCompilationNote, writableCompilationText } from './compilation-rows.js';

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
it('reads the graph arrangement as a board, its legacy layout as cards, and writes the board without graph', () => {
  const legacy = 'version: 1\nid: g\ntitle: G\narrangement: graph\nsource: { kind: tag, tag: x }\ngraph:\n  nodes:\n    - { path: notes/nb1/a.md, x: 0, y: 0 }\n    - { path: notes/nb1/b.md, x: 10, y: 10 }\n';
  const row = parseCompilationNote({ ...note, content: legacy }, notebooks).row!;
  expect(row.view).toBe('board');
  expect(row.graph).toBeUndefined();
  expect(row.board?.cards?.map(card => 'path' in card && card.path)).toEqual(['notes/nb1/a.md', 'notes/nb1/b.md']);
  const text = compilationText(row);
  expect(text).toContain('arrangement: board\n');
  expect(text).not.toContain('graph');
});
it('refuses to write a legacy graph that would grow past 512 KiB as a board, though the legacy file opens', () => {
  const nodes = Array.from({ length: 2000 }, (_, index) => `    - { path: notes/nb1/${index}-${'n'.repeat(210)}.md, x: 0, y: ${index * 152} }`).join('\n');
  const legacy = `version: 1\nid: big\ntitle: Big\narrangement: graph\nsource: { kind: tag, tag: x }\ngraph:\n  nodes:\n${nodes}\n`;
  expect(new TextEncoder().encode(legacy).length).toBeLessThan(512 * 1024);
  const parsed = parseCompilationNote({ ...note, content: legacy }, notebooks);
  expect(parsed.error).toBeUndefined();
  const row = parsed.row!;
  expect(() => writableCompilationText(row)).toThrow(/Big: not saved, the file would not open \(Compilation file exceeds 512 KiB\)/);
  expect(writableCompilationText({ ...row, board: undefined })).toContain('arrangement: board');
});
it('draws a legacy graph of more notes than a board holds, and marks it so no write loses the rest', () => {
  const nodes = Array.from({ length: 2001 }, (_, index) => `    - { path: notes/nb1/${index}.md, x: ${index * 300}, y: 0 }`).join('\n');
  const legacy = `version: 1\nid: wide\ntitle: Wide\narrangement: graph\nsource: { kind: tag, tag: x }\ngraph:\n  nodes:\n${nodes}\n`;
  const parsed = parseCompilationNote({ ...note, content: legacy }, notebooks);
  expect(parsed.row?.board?.cards).toHaveLength(2000);
  expect(parsed.upgradeLoss).toBe('Wide: not saved, its legacy graph layout places 2001 notes and a whiteboard keeps 2000; remove positions from its graph section first');
  // A layout that fits, or a file that already has a board, loses nothing.
  expect(parseCompilationNote({ ...note, content: legacy.replace(/\n {4}- \{ path: notes\/nb1\/2000\.md.*\n$/, '\n') }, notebooks).upgradeLoss).toBeUndefined();
});
