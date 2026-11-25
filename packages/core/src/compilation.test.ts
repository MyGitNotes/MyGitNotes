import { describe, expect, it } from 'vitest';
import { replaceFileTags } from './note-file.js';
import YAML from 'yaml';
import { applyCompilationMetadata, compilationChapters, compilationCopyPath, compilationFields, type CompilationFile, compilationFile, compilationNotes, compilationRow, compilationSlug, contentItems, copyCompilation, isCompilationPath, moveCompilationItem, parseCompilation, parseYouTubeUrl, relocateCompilation, serializeCompilation, uniqueCompilationPath } from './compilation.js';

const custom = `version: 1
id: reading-queue
title: Reading queue
arrangement: lane
size: medium
tags: [reading]
status: working
items:
  - { id: a1, kind: note, path: notes/one/a.md }
  - { id: v1, kind: youtube, videoId: dQw4w9WgXcQ, start: 0, title: Optional }
  - { id: f1, kind: folder, path: notes/one/sub }
`;
const dynamic = `version: 1
id: clues
title: Clues
arrangement: stack
source:
  kind: tag
  tag: clue
sort: { field: updated, order: desc }
`;
const legacyStack = dynamic;
const book = dynamic.replace('arrangement: stack', 'arrangement: book');
const owner = { notebookId: 'one', path: 'notes/one/reading.compilation.yml' };

describe('compilation file', () => {
  it('parses a custom and a dynamic compilation and ties items to the notebook', () => {
    const file = parseCompilation(custom, ['notes/one']);
    expect(file).toMatchObject({ id: 'reading-queue', title: 'Reading queue', arrangement: 'lane', size: 'medium', tags: ['reading'], status: 'working' });
    expect(compilationRow(file, owner)).toMatchObject({ kind: 'custom', view: 'medium', notebookId: 'one', path: owner.path, items: [{ id: 'a1', kind: 'note', notebookId: 'one', path: 'notes/one/a.md' }, { id: 'v1', kind: 'youtube', videoId: 'dQw4w9WgXcQ' }, { id: 'f1', kind: 'folder', notebookId: 'one' }] });
    const row = compilationRow(parseCompilation(dynamic, ['notes/one']), owner);
    expect(row).toMatchObject({ kind: 'dynamic', view: 'book', source: { kind: 'tag', tag: 'clue', notebookId: 'one' }, sort: { field: 'updated', order: 'desc' } });
  });
  it('defaults a lane without a size to small and folder sources to recursive', () => {
    const file = parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/one/sub }\n');
    expect(compilationRow(file, owner)).toMatchObject({ view: 'small', source: { kind: 'folder', recursive: true } });
  });
  it('round-trips through the lane model without changing the file', () => {
    for (const raw of [custom, dynamic]) {
      const file = parseCompilation(raw, ['notes/one']);
      expect(compilationFile(compilationRow(file, owner))).toEqual(file);
      expect(parseCompilation(serializeCompilation(file), ['notes/one'])).toEqual(file);
    }
    const graph = parseCompilation('version: 1\nid: g\ntitle: G\narrangement: graph\nitems: []\ngraph: { nodes: [{ path: notes/one/a.md, x: 1, y: 2, expanded: true }] }\n');
    expect(compilationFile(compilationRow(graph, owner))).toEqual(graph);
  });
  it('keeps the lane size while the compilation is a book, so switching back restores it', () => {
    const row = compilationRow(parseCompilation(custom, ['notes/one']), owner);
    const booked = compilationFile({ ...row, view: 'book' });
    expect(booked).toMatchObject({ arrangement: 'book', size: 'medium' });
    expect(compilationRow(booked, owner).view).toBe('book');
    expect(compilationFile({ ...compilationRow(booked, owner), view: 'medium' })).toMatchObject({ arrangement: 'lane', size: 'medium' });
  });
  it('reads the legacy stack token as a book and writes it as book', () => {
    const file = parseCompilation(legacyStack, ['notes/one']);
    expect(file.arrangement).toBe('book');
    expect(parseCompilation(book, ['notes/one'])).toEqual(file);
    expect(compilationRow(file, owner).view).toBe('book');
    expect(YAML.parse(serializeCompilation(file)).arrangement).toBe('book');
    expect(serializeCompilation(file)).not.toContain('stack');
    expect(YAML.parse(serializeCompilation(compilationFile(compilationRow(file, owner)))).arrangement).toBe('book');
    expect(() => parseCompilation(legacyStack.replace('arrangement: stack', 'arrangement: carousel'))).toThrow('arrangement');
  });
  it('writes a legacy stack file as book when the compilation itself is copied, and the version stays 1', () => {
    const copy = copyCompilation(parseCompilation(legacyStack, ['notes/one']), []);
    expect(YAML.parse(serializeCompilation(copy))).toMatchObject({ version: 1, arrangement: 'book' });
  });
  it('rejects a file that does not hold exactly one of items and source, or sorts pinned items', () => {
    for (const body of ['', 'items: []\nsource: { kind: tag, tag: t }', 'items: []\nsort: { field: title, order: asc }']) {
      expect(() => parseCompilation(`version: 1\nid: x\ntitle: X\narrangement: lane\n${body}\n`)).toThrow(/items|sort/);
    }
  });
  it('keeps a manual order on a dynamic compilation through the lane model and the file', () => {
    const raw = `version: 1\nid: m\ntitle: M\narrangement: lane\nsize: small\nsource: { kind: folder, path: notes/one/sub }\nsort: { field: manual, order: asc }\nmanualOrder: [notes/one/sub/b.md, notes/one/sub/a.md]\n`;
    const file = parseCompilation(raw, ['notes/one']);
    const row = compilationRow(file, owner);
    expect(row).toMatchObject({ kind: 'dynamic', sort: { field: 'manual' }, manualOrder: ['notes/one/sub/b.md', 'notes/one/sub/a.md'] });
    expect(compilationFile(row)).toEqual(file);
    expect(parseCompilation(serializeCompilation(file), ['notes/one'])).toEqual(file);
    // Another sort keeps the order, so choosing manual again restores it.
    if (row.kind !== 'dynamic') throw new Error('expected a dynamic row');
    expect(compilationFile({ ...row, sort: { field: 'title', order: 'asc' } })).toMatchObject({ sort: { field: 'title' }, manualOrder: ['notes/one/sub/b.md', 'notes/one/sub/a.md'] });
  });
  it('rejects a manual order on pinned items or a repeated path, and lets it name any path', () => {
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems: []\nmanualOrder: [notes/one/a.md]\n')).toThrow(/manualOrder/);
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: tag, tag: t }\nmanualOrder: [notes/one/a.md, notes/one/a.md]\n')).toThrow(/repeats/);
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: tag, tag: t }\nmanualOrder: [notes/two/a.md]\n', ['notes/one'])).not.toThrow();
  });
  it('names the problem of an invalid file instead of dropping it', () => {
    expect(() => parseCompilation('version: 1\nid: bad id\ntitle: X\narrangement: lane\nitems: []\n')).toThrow('id:');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: carousel\nitems: []\n')).toThrow('arrangement');
    expect(() => parseCompilation('version: 2\nid: x\n')).toThrow('version');
    expect(() => parseCompilation('a: [unclosed')).toThrow('Invalid YAML');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: ../secret.md }\n')).toThrow('items.0.path');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: notes/one/a.md, extra: 1 }\n')).toThrow();
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: notes/one/a.md }\n  - { id: a, kind: note, path: notes/one/b.md }\n')).toThrow('Duplicate item id');
    expect(() => parseCompilation(`version: 1\nid: x\ntitle: X\narrangement: lane\nitems: [${Array.from({ length: 101 }, (_, n) => `{ id: i${n}, kind: note, path: notes/one/a.md }`).join(', ')}]\n`)).toThrow();
  });
  it('lets items name any notebook of the repository and keeps a folder source inside one of its notebooks', () => {
    const roots = ['notes/one', 'notes/two'];
    expect(() => parseCompilation(custom.replace('notes/one/a.md', 'notes/two/a.md'), roots)).not.toThrow();
    // An item in no notebook still parses; it renders missing.
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: elsewhere/a.md }\n', roots)).not.toThrow();
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/two/sub }\n', roots)).not.toThrow();
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/other }\n', roots)).toThrow('notes/other is outside every notebook of the repository');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/one2 }\n', roots)).toThrow('outside every notebook');
  });
  it('gives each item the notebook that holds its path, falling back to the owner for a path in none', () => {
    const notebookOf = (path: string) => path.startsWith('notes/two/') ? 'two' : path.startsWith('notes/one/') ? 'one' : undefined;
    const file = parseCompilation('version: 1\nid: x\ntitle: X\narrangement: book\nitems:\n  - { id: a, kind: note, path: notes/two/a.md }\n  - { id: f, kind: folder, path: notes/two/sub }\n  - { id: m, kind: note, path: gone/m.md }\n', ['notes/one', 'notes/two']);
    const row = compilationRow(file, owner, notebookOf);
    expect(row).toMatchObject({ notebookId: 'one', items: [{ id: 'a', notebookId: 'two' }, { id: 'f', notebookId: 'two' }, { id: 'm', notebookId: 'one' }] });
    expect(compilationFile(row)).toEqual(file);
    const dynamicRow = compilationRow(parseCompilation('version: 1\nid: d\ntitle: D\narrangement: lane\nsource: { kind: folder, path: notes/two/sub }\n'), owner, notebookOf);
    expect(dynamicRow).toMatchObject({ notebookId: 'one', source: { kind: 'folder', notebookId: 'two' } });
    expect(compilationRow(parseCompilation(dynamic), owner, notebookOf)).toMatchObject({ source: { kind: 'tag', notebookId: 'one' } });
  });
  it('recognises the file name pattern anywhere under a notebook', () => {
    expect(isCompilationPath('notes/one/deep/er/x.compilation.yml')).toBe(true);
    expect(isCompilationPath('notes/one/x.yml')).toBe(false);
    expect(isCompilationPath('notes/one/x.compilation.yaml')).toBe(false);
  });
});

describe('compilation listing fields', () => {
  it('lists title, tags, status and a bounded summary', () => {
    const fields = compilationFields(custom, owner.path, ['notes/one']);
    expect(fields).toMatchObject({ title: 'Reading queue', tags: ['reading'], status: 'working', metadata: { id: 'reading-queue', arrangement: 'lane', size: 'medium', itemCount: 3 } });
    expect(fields.invalid).toBeUndefined();
    expect(compilationFields(dynamic, owner.path).metadata).toMatchObject({ arrangement: 'book', sourceKind: 'tag' });
    expect(compilationFields(book, owner.path).metadata).toMatchObject({ arrangement: 'book', sourceKind: 'tag' });
    expect(JSON.stringify(compilationFields(`${custom}graph: { nodes: [] }\n`, owner.path).metadata)).not.toContain('nodes');
  });
  it('still lists an invalid file, with what can be read and the reason', () => {
    const fields = compilationFields('title: Half done\ntags: [a]\nstatus: todo\narrangement: nope\n', 'notes/one/half.compilation.yml');
    expect(fields).toMatchObject({ title: 'Half done', tags: ['a'], status: 'todo' });
    expect(fields.invalid).toContain('arrangement');
    expect(compilationFields('{{{', 'notes/one/broken.compilation.yml')).toMatchObject({ title: 'broken', tags: [] });
    expect(compilationFields('{{{', 'notes/one/broken.compilation.yml').invalid).toContain('Invalid YAML');
  });
  it('reports scope problems as invalid', () => {
    expect(compilationFields(custom, owner.path, ['notes/two']).invalid).toBeUndefined();
    expect(compilationFields('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/one/sub }\n', owner.path, ['notes/two']).invalid).toContain('outside every notebook');
  });
});

describe('tag and status edits', () => {
  it('carry the caller metadata into the file and keep its comments', () => {
    const commented = `# my reading list\n${custom}`;
    const next = applyCompilationMetadata(commented, { tags: ['reading', 'new'], status: 'done' });
    expect(next).toContain('# my reading list');
    expect(YAML.parse(next)).toMatchObject({ tags: ['reading', 'new'], status: 'done' });
    expect(parseCompilation(next, ['notes/one']).items).toHaveLength(3);
  });
  it('removes tags and status when the caller has none, and leaves an unchanged file byte for byte', () => {
    const next = applyCompilationMetadata(custom, { tags: [], status: undefined });
    expect(YAML.parse(next)).not.toHaveProperty('tags');
    expect(YAML.parse(next)).not.toHaveProperty('status');
    expect(applyCompilationMetadata(custom, { tags: ['reading'], status: 'working' })).toBe(custom);
    expect(applyCompilationMetadata('not: [valid', { tags: [] })).toBe('not: [valid');
    expect(() => applyCompilationMetadata('not: [valid', { tags: ['x'] })).toThrow('Tags and status not written: the compilation cannot be read');
  });
  it('keeps the legacy stack token when only tags or status change, so a tag edit is not a rewrite of the arrangement', () => {
    const next = applyCompilationMetadata(legacyStack, { tags: ['new'], status: 'done' });
    expect(YAML.parse(next)).toMatchObject({ arrangement: 'stack', tags: ['new'], status: 'done' });
    expect(parseCompilation(next).arrangement).toBe('book');
  });
});

describe('reference rewrite', () => {
  const move = (path: string) => path.startsWith('notes/one/sub') ? 'notes/one/renamed' + path.slice('notes/one/sub'.length) : path === 'notes/one/a.md' ? 'notes/one/b.md' : path;
  it('rewrites pinned items, folder items, folder sources, the manual order and graph nodes', () => {
    const raw = `${custom}graph:\n  nodes:\n    - { path: notes/one/a.md, x: 0, y: 0 }\n`;
    const next = relocateCompilation(raw, move)!;
    const value = YAML.parse(next);
    expect(value.items.map((item: { path?: string; }) => item.path)).toEqual(['notes/one/b.md', undefined, 'notes/one/renamed']);
    expect(value.graph.nodes[0].path).toBe('notes/one/b.md');
    expect(YAML.parse(relocateCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/one/sub }\n', move)!).source.path).toBe('notes/one/renamed');
    const ordered = YAML.parse(relocateCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: tag, tag: t }\nmanualOrder: [notes/one/a.md, notes/one/c.md]\n', move)!);
    expect(ordered.manualOrder).toEqual(['notes/one/b.md', 'notes/one/c.md']);
  });
  it('returns null when nothing it names moved, and for an unreadable file', () => {
    expect(relocateCompilation(dynamic, move)).toBeNull();
    expect(relocateCompilation('{{{', move)).toBeNull();
    expect(relocateCompilation(custom, path => path)).toBeNull();
  });
});

describe('copy', () => {
  const file = parseCompilation(custom, ['notes/one']);
  it('titles the copy, gives it a new identity and fresh item ids', () => {
    let n = 0;
    const copy = copyCompilation(file, [file.id], () => `new-${++n}`);
    expect(copy).toMatchObject({ id: 'reading-queue-copy', title: 'Reading queue copy' });
    expect(copy.items!.map(item => item.id)).toEqual(['new-1', 'new-2', 'new-3']);
    expect(copy.items!.map(item => item.kind)).toEqual(file.items!.map(item => item.kind));
    expect(file.items![0].id).toBe('a1');
    expect(parseCompilation(serializeCompilation(copy), ['notes/one'])).toEqual(copy);
  });
  it('picks an unused id, bounds the title and copies a dynamic compilation without items', () => {
    expect(copyCompilation(file, [file.id, 'reading-queue-copy']).id).toBe('reading-queue-copy-2');
    expect(copyCompilation({ ...file, title: 'x'.repeat(100) }, []).title).toHaveLength(100);
    const dynamicFile = parseCompilation(dynamic);
    expect(copyCompilation(dynamicFile, []).items).toBeUndefined();
    expect(copyCompilation({ ...file, id: 'a'.repeat(64) }, []).id.length).toBeLessThanOrEqual(64);
  });
  it('writes the copy beside the original as <name>-copy.compilation.yml', () => {
    expect(compilationCopyPath('notes/one/sub/reading.compilation.yml', () => false)).toBe('notes/one/sub/reading-copy.compilation.yml');
    expect(compilationCopyPath('notes/one/reading.compilation.yml', path => path.endsWith('reading-copy.compilation.yml'))).toBe('notes/one/reading-copy-2.compilation.yml');
  });
});

describe('file names', () => {
  it('derives a stem from a title in any script', () => {
    expect(compilationSlug('Reading Queue!')).toBe('reading-queue');
    expect(compilationSlug('閱讀 清單')).toBe('閱讀-清單');
    expect(compilationSlug('///')).toBe('compilation');
    expect(compilationSlug('a'.repeat(100)).length).toBe(60);
  });
  it('suffixes collisions', () => {
    const taken = new Set(['notes/one/a.compilation.yml', 'notes/one/a-2.compilation.yml']);
    expect(uniqueCompilationPath('notes/one', 'a', path => taken.has(path))).toBe('notes/one/a-3.compilation.yml');
    expect(uniqueCompilationPath('', 'b', () => false)).toBe('b.compilation.yml');
  });
});

describe('membership and item moves', () => {
  const rows = (): ReturnType<typeof compilationRow>[] => ['one', 'two'].map((id, index) => compilationRow({ version: 1, id, title: id, arrangement: 'lane', items: [{ id: `n${index}`, kind: 'note', path: 'notes/one/a.md' }] } satisfies CompilationFile, { notebookId: 'one', path: `notes/one/${id}.compilation.yml` }));
  it('moves an item between custom compilations of one notebook', () => {
    const page = { rows: rows() };
    const moved = moveCompilationItem(page, 'n0', 'two', 1);
    expect(moved.rows[0]).toMatchObject({ items: [] });
    expect(moved.rows[1]).toMatchObject({ items: [{ id: 'n1' }, { id: 'n0' }] });
    expect(page.rows[0]).toMatchObject({ items: [{ id: 'n0' }] });
    expect(() => moveCompilationItem({ rows: [...rows(), compilationRow(parseCompilation(dynamic), { notebookId: 'one', path: 'notes/one/d.compilation.yml' })] }, 'n0', 'clues', 0)).toThrow('Only custom');
    expect(() => moveCompilationItem({ rows: [rows()[0], { ...rows()[1], notebookId: 'other' }] }, 'n0', 'two', 0)).toThrow('Items stay inside their repository');
  });
  it('moves an item between compilations of different notebooks of one repository, never across repositories', () => {
    const keyed = (notebookId: string) => rows().map(row => ({ ...row, notebookId }));
    const page = { rows: [keyed('qa~one')[0], keyed('qa~two')[1]] };
    expect(moveCompilationItem(page, 'n0', 'two', 0).rows[1]).toMatchObject({ items: [{ id: 'n0' }, { id: 'n1' }] });
    expect(() => moveCompilationItem({ rows: [keyed('qa~one')[0], keyed('other~one')[1]] }, 'n0', 'two', 0)).toThrow('Items stay inside their repository');
  });
  it('keeps a pinned note of another notebook and takes a dynamic folder source from its own notebook', () => {
    const notebookOf = (path: string) => path === 'notes/two' || path.startsWith('notes/two/') ? 'two' : 'one';
    const notes = [{ notebookId: 'two', path: 'notes/two/z.md', tags: [], metadata: {} }, { notebookId: 'one', path: 'notes/two/z.md', tags: [], metadata: {} }, { notebookId: 'two', path: 'notes/two/sub/y.md', tags: [], metadata: {} }];
    const pinnedRow = compilationRow({ version: 1, id: 'p', title: 'P', arrangement: 'book', items: [{ id: 'z', kind: 'note', path: 'notes/two/z.md' }] }, owner, notebookOf);
    expect(compilationNotes(pinnedRow, notes)).toEqual([notes[0]]);
    const folderRow = compilationRow(parseCompilation('version: 1\nid: d\ntitle: D\narrangement: lane\nsource: { kind: folder, path: notes/two }\n'), owner, notebookOf);
    expect(compilationNotes(folderRow, notes)).toEqual([notes[0], notes[2]]);
  });
  it('judges membership by pinned notes, tag or folder, hiding archived notes from dynamic ones', () => {
    const note = (path: string, extra: object = {}) => ({ notebookId: 'one', path, tags: [] as string[], metadata: {}, ...extra });
    const notes = [note('notes/one/a.md'), note('notes/one/sub/b.md', { tags: ['clue'] }), note('notes/one/sub/deep/c.md'), note('notes/one/d.md', { tags: ['clue'], status: 'archived' })];
    expect(compilationNotes(rows()[0], notes).map(item => item.path)).toEqual(['notes/one/a.md']);
    expect(compilationNotes(compilationRow(parseCompilation(dynamic), owner), notes).map(item => item.path)).toEqual(['notes/one/sub/b.md']);
    const folder = compilationRow(parseCompilation('version: 1\nid: f\ntitle: F\narrangement: lane\nsource: { kind: folder, path: notes/one/sub, recursive: false }\n'), owner);
    expect(compilationNotes(folder, notes).map(item => item.path)).toEqual(['notes/one/sub/b.md']);
  });
});

describe('YouTube URLs', () => {
  it('accepts only recognized YouTube URLs and extracts playback start time', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toEqual({ videoId: 'dQw4w9WgXcQ', start: 90 });
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', start: 0 });
    for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=bad', 'https://u:p@youtube.com/watch?v=dQw4w9WgXcQ']) expect(parseYouTubeUrl(url)).toBeNull();
  });
});

describe('replaceFileTags', () => {
  it('replaces the tags of a compilation and keeps status, items and comments', () => {
    const raw = `# my list\n${custom}`;
    const next = replaceFileTags(raw, 'notes/one/reading.compilation.yml', ['queue', 'later']);
    expect(YAML.parse(next)).toMatchObject({ id: 'reading-queue', status: 'working', tags: ['queue', 'later'], items: expect.any(Array) });
    expect(next.startsWith('# my list')).toBe(true);
  });
  it('removes the key when the tags become empty', () => {
    expect(YAML.parse(replaceFileTags(custom, 'notes/one/reading.compilation.yml', [])).tags).toBeUndefined();
  });
  it('touches nothing but the tags, and refuses a file that would not open', () => {
    const odd = 'version: 1\nid: odd\ntitle: Odd\narrangement: lane\nstatus: x\nunknown: {a: 1}\nsource:\n  kind: tag\n  tag: x\ntags: [old]\n';
    const next = replaceFileTags(odd, 'notes/one/odd.compilation.yml', ['new']);
    expect(YAML.parse(next)).toMatchObject({ status: 'x', unknown: { a: 1 }, tags: ['new'] });
    expect(() => replaceFileTags(odd.replace('status: x', 'status: 3'), 'notes/one/odd.compilation.yml', ['new'])).toThrow('notes/one/odd.compilation.yml: Tags not written: the compilation would not open (status: Expected string, received number)');
  });
  it('returns the text itself when the tags already match, and refuses tags for one that is not a mapping', () => {
    expect(replaceFileTags(custom, 'notes/one/reading.compilation.yml', ['reading'])).toBe(custom);
    expect(replaceFileTags('- just\n- a list\n', 'notes/one/x.compilation.yml', [])).toBe('- just\n- a list\n');
    expect(() => replaceFileTags('- just\n- a list\n', 'notes/one/x.compilation.yml', ['a'])).toThrow('notes/one/x.compilation.yml: Tags not written: the compilation cannot be read');
  });
  it('patches the frontmatter of a note', () => {
    expect(replaceFileTags('---\ntags: [a]\n---\nBody\n', 'notes/one/a.md', ['b'])).toBe('---\ntags: [b]\n---\nBody\n');
  });
});

describe('chapter headings', () => {
  const chaptered = `version: 1
id: meeting-notes
title: Meeting notes
arrangement: book
items:
  - { id: intro, kind: note, path: notes/one/README.md }
  - { id: internal, kind: heading, title: Internal meetings }
  - { id: m1, kind: note, path: notes/one/weekly-1.md }
  - { id: m2, kind: note, path: notes/one/weekly-2.md }
  - { id: external, kind: heading, title: External meetings }
  - { id: product, kind: heading, title: Product meetings }
  - { id: m5, kind: folder, path: notes/one/product }
  - { id: v1, kind: youtube, videoId: dQw4w9WgXcQ, title: Demo recording }
`;
  const items = (body: string) => `version: 1\nid: x\ntitle: X\narrangement: book\nitems:\n${body}`;
  const many = (count: number, make: (n: number) => string) => Array.from({ length: count }, (_, n) => `  - ${make(n)}\n`).join('');
  it('parses heading items and round-trips them in place through the model and the file', () => {
    const file = parseCompilation(chaptered, ['notes/one']);
    expect(file.items!.map(item => item.kind)).toEqual(['note', 'heading', 'note', 'note', 'heading', 'heading', 'folder', 'youtube']);
    const row = compilationRow(file, owner);
    if (row.kind !== 'custom') throw new Error('expected a custom row');
    expect(row.items.slice(0, 2)).toEqual([{ id: 'intro', kind: 'note', notebookId: 'one', path: 'notes/one/README.md' }, { id: 'internal', kind: 'heading', title: 'Internal meetings' }]);
    expect(row.items[1]).not.toHaveProperty('notebookId');
    expect(compilationFile(row)).toEqual(file);
    expect(parseCompilation(serializeCompilation(file), ['notes/one'])).toEqual(file);
    expect(YAML.parse(serializeCompilation(file)).items[1]).toEqual({ id: 'internal', kind: 'heading', title: 'Internal meetings' });
  });
  it('serializes a file without headings exactly as before', () => {
    const file = parseCompilation(custom, ['notes/one']);
    // The app writes what the model holds; a 0.20.4 client wrote these bytes.
    expect(serializeCompilation(compilationFile(compilationRow(file, owner)))).toBe('version: 1\nid: reading-queue\ntitle: Reading queue\narrangement: lane\nsize: medium\ntags:\n  - reading\nstatus: working\nitems:\n  - id: a1\n    kind: note\n    path: notes/one/a.md\n  - id: v1\n    kind: youtube\n    videoId: dQw4w9WgXcQ\n    start: 0\n    title: Optional\n  - id: f1\n    kind: folder\n    path: notes/one/sub\n');
  });
  it('refuses a heading with a path, an empty or long title, a repeated id, or one in a dynamic file, naming the field', () => {
    expect(() => parseCompilation(items('  - { id: h, kind: heading, title: T, path: notes/one/a.md }\n'))).toThrow('items.0');
    expect(() => parseCompilation(items('  - { id: h, kind: heading, title: "  " }\n'))).toThrow('items.0.title');
    expect(() => parseCompilation(items(`  - { id: h, kind: heading, title: ${'x'.repeat(101)} }\n`))).toThrow('items.0.title');
    expect(() => parseCompilation(items('  - { id: h, kind: heading }\n'))).toThrow('items.0.title');
    expect(() => parseCompilation(items('  - { id: a, kind: note, path: notes/one/a.md }\n  - { id: a, kind: heading, title: T }\n'))).toThrow('Duplicate item id a');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: book\nsource: { kind: tag, tag: t }\nitems:\n  - { id: h, kind: heading, title: T }\n')).toThrow('Give exactly one of items or source');
    expect(parseCompilation(items(`  - { id: h, kind: heading, title: ${'x'.repeat(100)} }\n`)).items![0]).toMatchObject({ kind: 'heading' });
  });
  it('counts content items and headings against separate caps of 100: 73 items in 20 chapters fit', () => {
    const book = many(20, n => `{ id: h${n}, kind: heading, title: Chapter ${n} }`) + many(73, n => `{ id: i${n}, kind: note, path: notes/one/n${n}.md }`);
    expect(parseCompilation(items(book)).items).toHaveLength(93);
    expect(parseCompilation(items(many(100, n => `{ id: h${n}, kind: heading, title: C${n} }`) + many(100, n => `{ id: i${n}, kind: note, path: notes/one/n${n}.md }`))).items).toHaveLength(200);
    expect(() => parseCompilation(items(many(101, n => `{ id: i${n}, kind: note, path: notes/one/n${n}.md }`)))).toThrow(/items/);
    expect(() => parseCompilation(items(many(101, n => `{ id: h${n}, kind: heading, title: C${n} }`)))).toThrow(/items: .*101 chapter headings|chapter headings/);
    expect(() => parseCompilation(items(many(5, n => `{ id: h${n}, kind: heading, title: C${n} }`) + many(101, n => `{ id: i${n}, kind: note, path: notes/one/n${n}.md }`)))).toThrow(/items/);
  });
  it('groups items into chapters: a leading group without a heading per item before the first, and an empty chapter', () => {
    const row = compilationRow(parseCompilation(chaptered, ['notes/one']), owner);
    if (row.kind !== 'custom') throw new Error('expected a custom row');
    const chapters = compilationChapters(row.items);
    expect(chapters.map(chapter => [chapter.heading?.title ?? null, chapter.items.map(item => item.id)])).toEqual([[null, ['intro']], ['Internal meetings', ['m1', 'm2']], ['External meetings', []], ['Product meetings', ['m5', 'v1']]]);
    expect(compilationChapters([{ id: 'a', kind: 'note', notebookId: 'one', path: 'notes/one/a.md' }, { id: 'b', kind: 'note', notebookId: 'one', path: 'notes/one/b.md' }]).map(chapter => chapter.items.map(item => item.id))).toEqual([['a'], ['b']]);
    expect(compilationChapters([])).toEqual([]);
    expect(contentItems(row.items).map(item => item.id)).toEqual(['intro', 'm1', 'm2', 'm5', 'v1']);
  });
  it('gives headings fresh ids when the compilation is copied', () => {
    let n = 0;
    const copy = copyCompilation(parseCompilation(chaptered, ['notes/one']), [], () => `new-${++n}`);
    expect(copy.items!.filter(item => item.kind === 'heading').map(item => item.id)).toEqual(['new-2', 'new-5', 'new-6']);
    expect(copy.items![1]).toMatchObject({ kind: 'heading', title: 'Internal meetings' });
  });
  it('lists a chaptered file as valid, counting content items only and naming the chapter count', () => {
    const fields = compilationFields(chaptered, owner.path, ['notes/one']);
    expect(fields.invalid).toBeUndefined();
    expect(fields.metadata).toMatchObject({ itemCount: 5, chapterCount: 3 });
    expect(compilationFields(custom, owner.path, ['notes/one']).metadata).not.toHaveProperty('chapterCount');
  });
  it('keeps headings and their titles when a pinned path is relocated, as a 0.20.4 client would', () => {
    const next = relocateCompilation(chaptered, path => path === 'notes/one/weekly-1.md' ? 'notes/one/2026/weekly-1.md' : path.startsWith('notes/one/product') ? `notes/one/products${path.slice('notes/one/product'.length)}` : path)!;
    const value = YAML.parse(next);
    expect(value.items.map((item: { path?: string; title?: string; }) => item.path ?? item.title)).toEqual(['notes/one/README.md', 'Internal meetings', 'notes/one/2026/weekly-1.md', 'notes/one/weekly-2.md', 'External meetings', 'Product meetings', 'notes/one/products', 'Demo recording']);
    expect(next.split('\n').filter(line => line.includes('kind: heading'))).toEqual(chaptered.split('\n').filter(line => line.includes('kind: heading')));
  });
  it('moves a content item into the chapter at its index, refuses a heading across compilations, and caps content only', () => {
    const make = (id: string, list: CompilationFile['items']) => compilationRow({ version: 1, id, title: id, arrangement: 'book', items: list } satisfies CompilationFile, { notebookId: 'one', path: `notes/one/${id}.compilation.yml` });
    const page = { rows: [make('one', [{ id: 'h1', kind: 'heading', title: 'One' }, { id: 'n1', kind: 'note', path: 'notes/one/a.md' }]), make('two', [{ id: 'h2', kind: 'heading', title: 'Two' }, { id: 'n2', kind: 'note', path: 'notes/one/b.md' }, { id: 'h3', kind: 'heading', title: 'Three' }])] };
    expect(moveCompilationItem(page, 'n1', 'two', 3).rows[1]).toMatchObject({ items: [{ id: 'h2' }, { id: 'n2' }, { id: 'h3' }, { id: 'n1' }] });
    expect(() => moveCompilationItem(page, 'h1', 'two', 0)).toThrow('Chapter headings stay in their compilation');
    // Within one compilation a heading moves alone, which shifts the chapter boundary.
    expect(moveCompilationItem(page, 'h3', 'two', 1).rows[1]).toMatchObject({ items: [{ id: 'h2' }, { id: 'h3' }, { id: 'n2' }] });
    const full = make('full', [...Array.from({ length: 100 }, (_, n) => ({ id: `c${n}`, kind: 'note' as const, path: `notes/one/c${n}.md` })), { id: 'hx', kind: 'heading', title: 'X' }]);
    const roomy = make('roomy', [...Array.from({ length: 99 }, (_, n) => ({ id: `r${n}`, kind: 'note' as const, path: `notes/one/r${n}.md` })), ...Array.from({ length: 50 }, (_, n) => ({ id: `rh${n}`, kind: 'heading' as const, title: `H${n}` }))]);
    expect(() => moveCompilationItem({ rows: [page.rows[0], full] }, 'n1', 'full', 0)).toThrow('too many pinned items');
    expect(moveCompilationItem({ rows: [page.rows[0], roomy] }, 'n1', 'roomy', 0).rows[1]).toMatchObject({ items: expect.arrayContaining([{ id: 'n1', kind: 'note', notebookId: 'one', path: 'notes/one/a.md' }]) });
  });
  it('leaves headings out of membership', () => {
    const row = compilationRow(parseCompilation(chaptered, ['notes/one']), owner);
    const notes = ['README', 'weekly-1', 'weekly-2'].map(name => ({ notebookId: 'one', path: `notes/one/${name}.md`, tags: [], metadata: {} }));
    expect(compilationNotes(row, notes).map(note => note.path)).toEqual(['notes/one/README.md', 'notes/one/weekly-1.md', 'notes/one/weekly-2.md']);
  });
});

describe('dynamic chapters by folder', () => {
  const grouped = 'version: 1\nid: meetings\ntitle: Meetings\narrangement: book\nsource: { kind: tag, tag: meeting }\nsort: { field: created, order: asc }\ngroup: folder\n';
  it('parses group: folder beside a source and round-trips it through the model, written after sort', () => {
    const file = parseCompilation(grouped, ['notes/one']);
    expect(file.group).toBe('folder');
    const row = compilationRow(file, owner);
    expect(row).toMatchObject({ kind: 'dynamic', group: 'folder' });
    expect(compilationFile(row)).toEqual(file);
    expect(parseCompilation(serializeCompilation(file), ['notes/one'])).toEqual(file);
    expect(serializeCompilation(file)).toMatch(/sort:\n {2}field: created\n {2}order: asc\ngroup: folder\n$/);
    if (row.kind !== 'dynamic') throw new Error('expected a dynamic row');
    expect(serializeCompilation(compilationFile({ ...row, group: undefined }))).not.toContain('group');
  });
  it('refuses group with items, or any value but folder', () => {
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: book\nitems: []\ngroup: folder\n')).toThrow('group: group applies to a source');
    expect(() => parseCompilation(grouped.replace('group: folder', 'group: status'))).toThrow('group');
  });
  it('writes a dynamic compilation without group exactly as 0.20.4 did', () => {
    const file = parseCompilation(dynamic);
    expect(serializeCompilation(compilationFile(compilationRow(file, owner)))).toBe('version: 1\nid: clues\ntitle: Clues\narrangement: book\nsource:\n  kind: tag\n  tag: clue\nsort:\n  field: updated\n  order: desc\n');
  });
  it('lists the group in the summary of a dynamic compilation', () => {
    expect(compilationFields(grouped, owner.path).metadata).toMatchObject({ sourceKind: 'tag', group: 'folder' });
    expect(compilationFields(dynamic, owner.path).metadata).not.toHaveProperty('group');
  });
  it('keeps group and rewrites source.path and manualOrder when a folder moves, as a 0.20.4 client would', () => {
    const raw = 'version: 1\nid: f\ntitle: F\narrangement: book\nsource: { kind: folder, path: notes/one/sub }\nsort: { field: manual, order: asc }\ngroup: folder\nmanualOrder: [notes/one/sub/a.md]\n';
    const value = YAML.parse(relocateCompilation(raw, path => path.replace('notes/one/sub', 'notes/one/moved'))!);
    expect(value).toMatchObject({ group: 'folder', source: { path: 'notes/one/moved' }, manualOrder: ['notes/one/moved/a.md'] });
  });
});

describe('heading-anchored note items', () => {
  const anchored = 'version: 1\nid: weekly\ntitle: Weekly\narrangement: book\nitems:\n  - { id: w1, kind: note, path: notes/one/2025-weekly.md, anchor: 2025-08-26 週會 }\n  - { id: w2, kind: note, path: notes/one/2025-weekly.md, anchor: 2025-09-02 週會 }\n  - { id: w3, kind: note, path: notes/one/other.md }\n';
  const one = (item: string) => `version: 1\nid: x\ntitle: X\narrangement: book\nitems:\n  - ${item}\n`;
  it('parses an anchor on a note item and round-trips it through the model and the file', () => {
    const file = parseCompilation(anchored, ['notes/one']);
    expect(file.items![0]).toEqual({ id: 'w1', kind: 'note', path: 'notes/one/2025-weekly.md', anchor: '2025-08-26 週會' });
    const row = compilationRow(file, owner);
    expect(row).toMatchObject({ items: [{ anchor: '2025-08-26 週會', notebookId: 'one' }, { anchor: '2025-09-02 週會' }, { id: 'w3' }] });
    expect(compilationFile(row)).toEqual(file);
    expect(parseCompilation(serializeCompilation(compilationFile(row)), ['notes/one'])).toEqual(file);
    expect(serializeCompilation(compilationFile(row))).toContain('  - id: w1\n    kind: note\n    path: notes/one/2025-weekly.md\n    anchor: 2025-08-26 週會\n');
    expect(compilationFile(row).items![2]).not.toHaveProperty('anchor');
  });
  it('refuses an anchor on any other kind, and an empty, long or control-character anchor', () => {
    for (const item of ['{ id: f, kind: folder, path: notes/one/sub, anchor: A }', '{ id: a, kind: asset, path: notes/one/p.png, anchor: A }', '{ id: v, kind: youtube, videoId: dQw4w9WgXcQ, anchor: A }', '{ id: h, kind: heading, title: T, anchor: A }']) expect(() => parseCompilation(one(item)), item).toThrow('items.0');
    expect(() => parseCompilation(one('{ id: n, kind: note, path: notes/one/a.md, anchor: "  " }'))).toThrow('items.0.anchor');
    expect(() => parseCompilation(one(`{ id: n, kind: note, path: notes/one/a.md, anchor: ${'x'.repeat(201)} }`))).toThrow('items.0.anchor');
    expect(() => parseCompilation(one('{ id: n, kind: note, path: notes/one/a.md, anchor: "a\\tb" }'))).toThrow('items.0.anchor');
    expect(parseCompilation(one(`{ id: n, kind: note, path: notes/one/a.md, anchor: ${'x'.repeat(200)} }`)).items![0]).toMatchObject({ anchor: 'x'.repeat(200) });
  });
  it('keeps the anchor when a move rewrites the path, and copies it', () => {
    const value = YAML.parse(relocateCompilation(anchored, path => path.replace('2025-weekly', '2025/weekly'))!);
    expect(value.items.slice(0, 2)).toEqual([{ id: 'w1', kind: 'note', path: 'notes/one/2025/weekly.md', anchor: '2025-08-26 週會' }, { id: 'w2', kind: 'note', path: 'notes/one/2025/weekly.md', anchor: '2025-09-02 週會' }]);
    expect(copyCompilation(parseCompilation(anchored), []).items![0]).toMatchObject({ anchor: '2025-08-26 週會' });
  });
});
