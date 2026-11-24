import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { compilationFile, compilationRow, parseCompilation, serializeCompilation } from './compilation.js';
import { mergeCompilationText } from './compilation-merge.js';

// The example of the whiteboard spec's file format.
const example = `version: 1
id: chapter-3
title: 第三章：德性與依據
arrangement: board
items:
  - id: h1
    kind: heading
    title: 一、問題
  - id: n1
    kind: note
    path: notes/thesis/第三章導論.md
  - id: n2
    kind: note
    path: notes/thesis/依據關係的因果條件.md
  - id: h2
    kind: heading
    title: 二、德性知識論
  - id: n3
    kind: note
    path: notes/thesis/德性與能力的區分.md
board:
  sections:
    - { item: h1, x: 0, y: 0, w: 288, h: 384 }
    - { item: h2, x: 336, y: 0, w: 560, h: 384 }
  cards:
    - { item: n1, x: 24, y: 56 }
    - { item: n2, x: 24, y: 216 }
    - { item: n3, x: 360, y: 56 }
  texts:
    - { id: t8k2m, x: 960, y: 240, w: 200, text: "口試前要定案：\\n德性是否必要？", color: teal }
  arrows:
    - { id: a3f9q, from: { item: n1 }, to: { item: n2 }, label: 提出 }
    - { id: b7c1z, from: { item: n2 }, to: { item: n3 }, label: 需要 }
`;
const n1 = '    - { item: n1, x: 24, y: 56 }\n', n2 = '    - { item: n2, x: 24, y: 216 }\n';
/** `text` with each `[from, to]` replaced once, checking that `from` is there. */
const edit = (text: string, ...changes: [string, string][]) =>
  changes.reduce((current, [from, to]) => {
    expect(current).toContain(from);
    return current.replace(from, to);
  }, text);
const item = (id: string, path: string) => `  - id: ${id}\n    kind: note\n    path: ${path}\n`;
const itemsOf = (text: string) => parseCompilation(text).items!.map(entry => entry.id);

describe('compilation merge by entry', () => {
  it('merges two drafts that move cards on adjacent lines', () => {
    const local = edit(example, [n1, '    - { item: n1, x: 48, y: 80 }\n']);
    const remote = edit(example, [n2, '    - { item: n2, x: 24, y: 400 }\n']);
    expect(mergeCompilationText(example, local, remote)).toEqual({ conflict: false, text: edit(example, [n1, '    - { item: n1, x: 48, y: 80 }\n'], [n2, '    - { item: n2, x: 24, y: 400 }\n']) });
  });
  it('conflicts when both move one card differently, and agrees when they move it alike', () => {
    const local = edit(example, [n1, '    - { item: n1, x: 48, y: 56 }\n']);
    expect(mergeCompilationText(example, local, edit(example, [n1, '    - { item: n1, x: 24, y: 80 }\n']))).toEqual({ conflict: true });
    expect(mergeCompilationText(example, local, local)).toEqual({ conflict: false, text: local });
  });
  it('merges an arrow added on one side with a rename on the other', () => {
    const arrow = '    - { id: c9d2e1x0, from: { item: n3 }, to: { text: t8k2m } }\n';
    const local = example + arrow;
    const remote = edit(example, ['title: 第三章：德性與依據\n', 'title: 第三章：德性\n']);
    expect(mergeCompilationText(example, local, remote)).toEqual({ conflict: false, text: edit(local, ['title: 第三章：德性與依據\n', 'title: 第三章：德性\n']) });
    // Texts added on both sides are both kept.
    const text = (id: string) => `    - { id: ${id}, x: 0, y: 600, text: A }\n`;
    const texts = (id: string) => edit(example, ['  arrows:\n', `${text(id)}  arrows:\n`]);
    expect(mergeCompilationText(example, texts('ta'), texts('tb'))).toEqual({ conflict: false, text: edit(example, ['  arrows:\n', `${text('ta')}${text('tb')}  arrows:\n`]) });
  });
  it('keeps external fields, merging them as values', () => {
    const base = `${example}translationKey: ch3 # the blog's key\nblog: { slug: chapter-3 }\n`;
    const local = edit(base, [n1, '    - { item: n1, x: 48, y: 80 }\n']);
    const remote = edit(base, ['translationKey: ch3', 'translationKey: ch3b']);
    // The side whose external fields stand keeps their text, comments included.
    expect(mergeCompilationText(base, local, remote)).toEqual({ conflict: false, text: edit(remote, [n1, '    - { item: n1, x: 48, y: 80 }\n']) });
    expect(mergeCompilationText(base, remote, local)).toEqual({ conflict: false, text: edit(remote, [n1, '    - { item: n1, x: 48, y: 80 }\n']) });
    // External fields changed on both sides merge field by field, and one field changed differently conflicts.
    const both = mergeCompilationText(base, edit(local, ['slug: chapter-3', 'slug: c3']), remote);
    expect(both).toMatchObject({ conflict: false });
    expect(externalFields(both)).toEqual({ translationKey: 'ch3b', blog: { slug: 'c3' } });
    expect(mergeCompilationText(base, edit(base, ['translationKey: ch3', 'translationKey: other']), remote)).toEqual({ conflict: true });
  });
  it('answers undefined, for the line merge, when a side is not a valid compilation', () => {
    const invalid = edit(example, [n1, '    - { item: gone, x: 24, y: 56 }\n']);
    expect(mergeCompilationText(example, invalid, example)).toBeUndefined();
    expect(mergeCompilationText(example, example, 'items: [')).toBeUndefined();
    expect(mergeCompilationText(invalid, example, example)).toBeUndefined();
  });
  it('merges items reordered on one side and added on the other, and conflicts on two different orders', () => {
    const reordered = edit(example, [item('n1', 'notes/thesis/第三章導論.md') + item('n2', 'notes/thesis/依據關係的因果條件.md'), item('n2', 'notes/thesis/依據關係的因果條件.md') + item('n1', 'notes/thesis/第三章導論.md')]);
    const added = edit(example, [item('n1', 'notes/thesis/第三章導論.md'), item('n1', 'notes/thesis/第三章導論.md') + item('n4', 'notes/thesis/new.md')]);
    for (const [local, remote] of [[reordered, added], [added, reordered]]) {
      const merged = mergeCompilationText(example, local, remote);
      expect(merged).toMatchObject({ conflict: false });
      expect(itemsOf((merged as { text: string; }).text)).toEqual(['h1', 'n2', 'n1', 'n4', 'h2', 'n3']);
    }
    // An item added to the end of a chapter stays at its end.
    const appended = edit(example, ['  - id: h2\n', `${item('n4', 'notes/thesis/new.md')}  - id: h2\n`]);
    const swapped = edit(reordered, ['  - id: h1\n    kind: heading\n    title: 一、問題\n' + item('n2', 'notes/thesis/依據關係的因果條件.md'), item('n2', 'notes/thesis/依據關係的因果條件.md') + '  - id: h1\n    kind: heading\n    title: 一、問題\n']);
    expect(itemsOf((mergeCompilationText(example, swapped, appended) as { text: string; }).text)).toEqual(['n2', 'h1', 'n1', 'n4', 'h2', 'n3']);
    const other = edit(example, [item('n3', 'notes/thesis/德性與能力的區分.md'), ''], ['  - id: h2\n', `${item('n3', 'notes/thesis/德性與能力的區分.md')}  - id: h2\n`]);
    expect(mergeCompilationText(example, reordered, other)).toEqual({ conflict: true });
    expect(mergeCompilationText(example, reordered, reordered)).toEqual({ conflict: false, text: reordered });
  });
  it('conflicts when one side removes what the other changed or newly names', () => {
    const file = parseCompilation(example);
    const row = compilationRow(file, { notebookId: 'thesis', path: 'notes/thesis/chapter-3.compilation.yml' });
    if (row.kind !== 'custom') throw new Error('expected a custom row');
    // Removing an item removes its card and arrows, through compilationFile.
    const removed = serializeCompilation(compilationFile({ ...row, items: row.items.filter(entry => entry.id !== 'n2') }));
    expect(mergeCompilationText(example, removed, edit(example, [n2, '    - { item: n2, x: 24, y: 400 }\n']))).toEqual({ conflict: true });
    // An arrow added to the removed item would name nothing: the merged file is invalid, so the drafts conflict.
    const arrowed = `${example}    - { id: d4, from: { item: n1 }, to: { item: n2 } }\n`;
    expect(mergeCompilationText(example, removed, arrowed)).toEqual({ conflict: true });
    // Untouched elsewhere, the removal merges with a move of another card.
    const moved = edit(example, ['    - { item: n3, x: 360, y: 56 }\n', '    - { item: n3, x: 360, y: 90 }\n']);
    expect(mergeCompilationText(example, removed, moved)).toEqual({ conflict: false, text: edit(removed, ['    - { item: n3, x: 360, y: 56 }\n', '    - { item: n3, x: 360, y: 90 }\n']) });
  });
  it('keeps an item added to a chapter in that chapter, wherever the other side moved the chapter', () => {
    const items = (...ids: string[]) => `version: 1\nid: c\ntitle: C\narrangement: book\nitems:\n${ids.map(id => id.startsWith('h') ? `  - id: ${id}\n    kind: heading\n    title: ${id}\n` : item(id, `notes/${id}.md`)).join('')}`;
    const base = items('h1', 'a', 'h2', 'b');
    const merge = (local: string, remote: string) => mergeCompilationText(base, local, remote);
    for (const [local, remote] of [[items('h2', 'b', 'h1', 'a'), items('h1', 'a', 'c', 'h2', 'b')], [items('h1', 'a', 'c', 'h2', 'b'), items('h2', 'b', 'h1', 'a')]]) {
      expect(itemsOf((merge(local, remote) as { text: string; }).text)).toEqual(['h2', 'b', 'h1', 'a', 'c']);
    }
    // Added after an item the other side moved to another chapter, it still joins the chapter it was added to.
    const after = mergeCompilationText(items('h1', 'a', 'd', 'h2', 'b'), items('h1', 'd', 'h2', 'b', 'a'), items('h1', 'a', 'c', 'd', 'h2', 'b'));
    expect(itemsOf((after as { text: string; }).text)).toEqual(['h1', 'd', 'c', 'h2', 'b', 'a']);
    // A chapter one side removed cannot take the item the other side added to it.
    expect(merge(items('a', 'h2', 'b'), items('h1', 'a', 'c', 'h2', 'b'))).toEqual({ conflict: true });
  });
  it('conflicts when one side removes an item the other moved to another chapter', () => {
    const items = (...ids: string[]) => `version: 1\nid: c\ntitle: C\narrangement: book\nitems:\n${ids.map(id => id.startsWith('h') ? `  - id: ${id}\n    kind: heading\n    title: ${id}\n` : item(id, `notes/${id}.md`)).join('')}`;
    const base = items('h1', 'a', 'h2', 'b');
    expect(mergeCompilationText(base, items('h1', 'h2', 'b'), items('h1', 'h2', 'b', 'a'))).toEqual({ conflict: true });
    expect(mergeCompilationText(base, items('h1', 'h2', 'b', 'a'), items('h1', 'h2', 'b'))).toEqual({ conflict: true });
    // So does a move into a chapter a new heading starts, which passes no entry the base had.
    const sectioned = 'version: 1\nid: c\ntitle: C\narrangement: board\nitems:\n' + item('b', 'notes/b.md') + '  - id: h1\n    kind: heading\n    title: h1\n' + item('a', 'notes/a.md') + 'board:\n  sections:\n    - { item: h1, x: 0, y: 0, w: 288, h: 176 }\n';
    for (const [local, remote] of [[items('b'), sectioned], [sectioned, items('b')]]) expect(mergeCompilationText(items('b', 'a'), local, remote)).toEqual({ conflict: true });
    // So does a move within a chapter, or in a book without chapters: which entry moved cannot be told.
    const within = items('h1', 'a', 'x', 'h2', 'b');
    expect(mergeCompilationText(within, items('h1', 'x', 'h2', 'b'), items('h1', 'x', 'a', 'h2', 'b'))).toEqual({ conflict: true });
    expect(mergeCompilationText(items('a', 'b', 'c'), items('b', 'c'), items('b', 'a', 'c'))).toEqual({ conflict: true });
    expect(mergeCompilationText(items('a', 'b', 'c'), items('b', 'a', 'c'), items('b', 'c'))).toEqual({ conflict: true });
    // A removal and a move of other entries both stand.
    const merged = mergeCompilationText(items('a', 'b', 'c', 'd'), items('a', 'b', 'c'), items('b', 'a', 'c', 'd'));
    expect(itemsOf((merged as { text: string; }).text)).toEqual(['b', 'a', 'c']);
  });
  it('merges each item’s chapter as a value, conflicting when both sides put it in different chapters', () => {
    // Each side draws a new section around a: its heading goes before a, and the board gets the section.
    const base = 'version: 1\nid: c\ntitle: C\narrangement: board\nitems:\n' + item('a', 'notes/a.md') + item('b', 'notes/b.md');
    const sectioned = (id: string) => `version: 1\nid: c\ntitle: C\narrangement: board\nitems:\n${item('b', 'notes/b.md')}  - id: ${id}\n    kind: heading\n    title: ${id}\n${item('a', 'notes/a.md')}board:\n  sections:\n    - { item: ${id}, x: 0, y: 0, w: 288, h: 176 }\n`;
    expect(() => parseCompilation(sectioned('h1'))).not.toThrow();
    expect(mergeCompilationText(base, sectioned('h1'), sectioned('h2'))).toEqual({ conflict: true });
    expect(mergeCompilationText(base, sectioned('h2'), sectioned('h1'))).toEqual({ conflict: true });
    expect(mergeCompilationText(base, sectioned('h1'), sectioned('h1'))).toEqual({ conflict: false, text: sectioned('h1') });
  });
  it('compares and keeps external values with typed keys', () => {
    const base = `${example}external: { 1: old, "1": string }\nother: x\n`;
    const renamed = edit(base, ['title: 第三章：德性與依據\n', 'title: 第三章\n']);
    const typed = edit(base, ['{ 1: old', '{ 1: new']);
    const values = (merged: ReturnType<typeof mergeCompilationText>) => YAML.parseDocument((merged as { text: string; }).text).toJS({ mapAsMap: true }) as Map<unknown, unknown>;
    expect(values(mergeCompilationText(base, renamed, typed)).get('external')).toEqual(new Map<unknown, unknown>([[1, 'new'], ['1', 'string']]));
    // Two external fields changed, one on each side, are combined as written.
    const merged = mergeCompilationText(base, edit(renamed, ['other: x', 'other: y']), typed);
    expect(values(merged).get('external')).toEqual(new Map<unknown, unknown>([[1, 'new'], ['1', 'string']]));
    expect(values(merged).get('other')).toBe('y');
    expect((merged as { text: string; }).text).toContain('external: { 1: new, "1": string }\nother: y\n');
    // Explicit tags are part of a value, at the top and nested.
    const tagged = `${example}external: !internal value\nnested: { state: !draft x }\nother: x\n`;
    const retitled = edit(tagged, ['title: 第三章：德性與依據\n', 'title: 第三章\n']);
    expect((mergeCompilationText(tagged, retitled, edit(tagged, ['!internal', '!published'])) as { text: string; }).text).toContain('external: !published value\n');
    const combined = mergeCompilationText(tagged, edit(retitled, ['other: x', 'other: y']), edit(tagged, ['!draft', '!final']));
    expect((combined as { text: string; }).text).toContain('external: !internal value\nnested: { state: !final x }\nother: y\n');
    // An external field holding an anchor or alias is not combined with the other side's fields: the edits conflict.
    const anchored = `${example}shared: &s { a: 1, self: *s }\nother: x\n`;
    expect(mergeCompilationText(anchored, edit(anchored, ['other: x', 'other: y']), edit(anchored, ['a: 1', 'a: 2']))).toEqual({ conflict: true });
    // Left as one side has them, they stand.
    expect(mergeCompilationText(anchored, edit(anchored, [n1, '    - { item: n1, x: 48, y: 80 }\n']), edit(anchored, ['other: x', 'other: y']))).toEqual({ conflict: false, text: edit(anchored, [n1, '    - { item: n1, x: 48, y: 80 }\n'], ['other: x', 'other: y']) });
    // External fields with a key that is not a scalar merge as a whole.
    const complex = `${example}? [ a, b ]\n: pair\nother: x\n`;
    const moved = edit(complex, [n1, '    - { item: n1, x: 48, y: 80 }\n']);
    expect(mergeCompilationText(complex, moved, edit(complex, ['other: x', 'other: y']))).toEqual({ conflict: false, text: edit(moved, ['other: x', 'other: y']) });
    expect(mergeCompilationText(complex, edit(complex, [': pair', ': two']), edit(complex, ['other: x', 'other: y']))).toEqual({ conflict: true });
  });
  it('keeps an empty board one side added, and an emptied list the side that emptied it still writes', () => {
    const lane = 'version: 1\nid: c\ntitle: C\narrangement: lane\nitems:\n' + item('a', 'notes/a.md');
    const merged = mergeCompilationText(lane, `${lane}board: {}\n`, edit(lane, ['title: C\n', 'title: D\n']));
    expect(parseCompilation((merged as { text: string; }).text)).toMatchObject({ title: 'D', board: {} });
    const withCard = `${lane}board:\n  cards:\n    - { item: a, x: 0, y: 0 }\n`;
    const emptied = mergeCompilationText(withCard, edit(withCard, ['    - { item: a, x: 0, y: 0 }\n', '    []\n']), edit(withCard, ['title: C\n', 'title: D\n']));
    expect(parseCompilation((emptied as { text: string; }).text)).toMatchObject({ title: 'D', board: { cards: [] } });
  });
  it('merges a dynamic board by path and folder', () => {
    const dynamic = `version: 1\nid: clues\ntitle: Clues\narrangement: board\nsource:\n  kind: folder\n  path: notes/one/cases\n  recursive: true\ngroup: folder\nboard:\n  sections:\n    - { folder: notes/one/cases/a, x: 0, y: 0 }\n  cards:\n    - { path: notes/one/cases/a/x.md, x: 24, y: 56 }\n    - { path: notes/one/cases/b/y.md, x: 400, y: 56 }\n`;
    const local = edit(dynamic, ['a/x.md, x: 24', 'a/x.md, x: 30']);
    const remote = edit(dynamic, ['b/y.md, x: 400', 'b/y.md, x: 420'], ['cases/a, x: 0', 'cases/a, x: 8']);
    expect(mergeCompilationText(dynamic, local, remote)).toEqual({ conflict: false, text: edit(remote, ['a/x.md, x: 24', 'a/x.md, x: 30']) });
  });
});

/** The external fields of a merged file. */
function externalFields(merged: ReturnType<typeof mergeCompilationText>) {
  const { translationKey, blog } = YAML.parse((merged as { text: string; }).text) as Record<string, unknown>;
  return { translationKey, blog };
}
