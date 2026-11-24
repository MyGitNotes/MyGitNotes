import { describe, expect, it } from 'vitest';
import { mergeCompilation, mergeNote } from './merge-note.js';
const draft = (content: string, metadata: Record<string, unknown> = {}) => ({ content, metadata });
describe('remote note reconciliation', () => {
  it('merges independent line and metadata edits, preserving CRLF', () => {
    const base = draft('one\r\ntwo\r\nthree\r\n', { title: 'old', nested: { a: 1, b: 1 } });
    const local = draft('ONE\r\ntwo\r\nthree\r\n', { title: 'new', nested: { a: 2, b: 1 } });
    const remote = draft('one\r\ntwo\r\nTHREE\r\n', { title: 'old', nested: { a: 1, b: 2 } });
    expect(mergeNote(base, local, remote)).toEqual({ conflict: false, draft: draft('ONE\r\ntwo\r\nTHREE\r\n', { title: 'new', nested: { a: 2, b: 2 } }) });
  });
  it('rejects overlapping content and metadata edits without mutating the draft', () => {
    const local = draft('local');
    expect(mergeNote(draft('base'), local, draft('remote'))).toEqual({ conflict: true });
    expect(local.content).toBe('local');
    expect(mergeNote(draft('', { title: 'base' }), draft('', { title: 'local' }), draft('', { title: 'remote' }))).toEqual({ conflict: true });
  });
  it('accepts identical edits and handles deletion versus modification', () => {
    expect(mergeNote(draft('base'), draft('same'), draft('same'))).toEqual({ conflict: false, draft: draft('same') });
    expect(mergeNote(draft('', { a: 1, b: 2 }), draft('', { b: 2 }), draft('', { a: 1, b: 3 }))).toEqual({ conflict: false, draft: draft('', { b: 3 }) });
    expect(mergeNote(draft('', { a: 1 }), draft('', {}), draft('', { a: 2 }))).toEqual({ conflict: true });
  });
});

const compilation = `version: 1
id: chapter-3
title: Chapter 3
arrangement: board
tags:
  - thesis
items:
  - id: h1
    kind: heading
    title: Problem
  - id: n1
    kind: note
    path: notes/thesis/a.md
  - id: n2
    kind: note
    path: notes/thesis/b.md
board:
  sections:
    - { item: h1, x: 0, y: 0, w: 560, h: 384 }
  cards:
    - { item: n1, x: 24, y: 56 }
    - { item: n2, x: 24, y: 216 }
  arrows:
    - { id: a3f9q, from: { item: n1 }, to: { item: n2 } }
translationKey: ch3
`;
const path = 'notes/thesis/chapter-3.compilation.yml';
/** A compilation draft as the app stages it: the YAML, with the title, tags and status shown in listings. */
const file = (content: string, metadata: Record<string, unknown> = { title: 'Chapter 3', tags: ['thesis'] }) => ({ content, metadata });
const replace = (text: string, ...changes: [string, string][]) => changes.reduce((current, [from, to]) => (expect(current).toContain(from), current.replace(from, to)), text);
const moveN1: [string, string] = ['{ item: n1, x: 24, y: 56 }', '{ item: n1, x: 48, y: 80 }'], moveN2: [string, string] = ['{ item: n2, x: 24, y: 216 }', '{ item: n2, x: 24, y: 400 }'];
describe('compilation reconciliation', () => {
  it('merges two drafts moving cards on adjacent lines, which the line merge cannot', () => {
    const base = file(compilation), local = file(replace(compilation, moveN1)), remote = file(replace(compilation, moveN2));
    expect(mergeNote(base, local, remote)).toEqual({ conflict: true });
    expect(mergeCompilation(path, base, local, remote)).toEqual({ conflict: false, draft: file(replace(compilation, moveN1, moveN2)) });
  });
  it('conflicts when both move one card', () => {
    expect(mergeCompilation(path, file(compilation), file(replace(compilation, moveN1)), file(replace(compilation, ['{ item: n1, x: 24, y: 56 }', '{ item: n1, x: 0, y: 0 }'])))).toEqual({ conflict: true });
  });
  it('merges an arrow added on one side with a rename on the other, the draft taking the merged title', () => {
    const arrow: [string, string] = ['  arrows:\n', '  arrows:\n    - { id: b7c1z0qp, from: { item: n2 }, to: { item: n1 } }\n'];
    const renamed = replace(compilation, ['title: Chapter 3', 'title: Virtue']);
    const merged = mergeCompilation(path, file(compilation), file(replace(compilation, arrow)), file(renamed, { title: 'Virtue', tags: ['thesis'] }));
    expect(merged).toEqual({ conflict: false, draft: file(replace(renamed, ['    - { id: a3f9q', '    - { id: b7c1z0qp, from: { item: n2 }, to: { item: n1 } }\n    - { id: a3f9q'])!, { title: 'Virtue', tags: ['thesis'] }) });
  });
  it('keeps external fields, and reads tags and status from each side’s metadata as its commit would', () => {
    const remote = file(replace(compilation, ['translationKey: ch3', 'translationKey: ch3-v2']));
    // The server's note carries its listing summary as metadata; the local draft retags through its metadata only.
    const base = file(compilation, { id: 'chapter-3', title: 'Chapter 3', arrangement: 'board', itemCount: 2, chapterCount: 1, tags: ['thesis'] });
    const merged = mergeCompilation(path, base, file(replace(compilation, moveN1), { title: 'Chapter 3', tags: ['thesis', 'draft'], status: 'writing' }), { ...remote, metadata: base.metadata });
    expect(merged).toMatchObject({ conflict: false, draft: { metadata: { title: 'Chapter 3', tags: ['thesis', 'draft'], status: 'writing' } } });
    const content = (merged as { draft: { content: string; }; }).draft.content;
    expect(content).toContain('translationKey: ch3-v2\n');
    expect(content).toContain('{ item: n1, x: 48, y: 80 }');
    expect(content).toMatch(/tags:\n {2}- thesis\n {2}- draft\nstatus: writing\n/);
  });
  it('merges items reordered on one side and added on the other', () => {
    const reordered = replace(compilation, ['  - id: n1\n    kind: note\n    path: notes/thesis/a.md\n  - id: n2\n    kind: note\n    path: notes/thesis/b.md\n', '  - id: n2\n    kind: note\n    path: notes/thesis/b.md\n  - id: n1\n    kind: note\n    path: notes/thesis/a.md\n']);
    const added = replace(compilation, ['    path: notes/thesis/b.md\n', '    path: notes/thesis/b.md\n  - id: n3\n    kind: note\n    path: notes/thesis/c.md\n']);
    const merged = mergeCompilation(path, file(compilation), file(reordered), file(added));
    expect(merged).toEqual({ conflict: false, draft: file(replace(reordered, ['    path: notes/thesis/a.md\n', '    path: notes/thesis/a.md\n  - id: n3\n    kind: note\n    path: notes/thesis/c.md\n'])) });
  });
  it('falls back to the line merge when a side is not a valid compilation', () => {
    // The local draft names a card for no item, so it cannot be read; its edit is far from the remote's and merges by line.
    const invalid = replace(compilation, ['  arrows:\n', '    - { item: gone, x: 0, y: 0 }\n  arrows:\n']);
    const remote = replace(compilation, ['title: Chapter 3', 'title: Virtue']);
    expect(mergeCompilation(path, file(compilation), file(invalid), file(remote))).toEqual({ conflict: false, draft: file(replace(invalid, ['title: Chapter 3', 'title: Virtue'])) });
    expect(mergeCompilation(path, file(compilation), file(replace(invalid, ['title: Chapter 3', 'title: Other'])), file(remote))).toEqual({ conflict: true });
    // YAML whose alias names no anchor cannot take its metadata; it merges by line too.
    const unresolved = `${compilation}blog: *nowhere\n`;
    expect(mergeCompilation(path, file(compilation), file(unresolved), file(remote))).toEqual({ conflict: false, draft: file(replace(unresolved, ['title: Chapter 3', 'title: Virtue'])) });
  });
});
