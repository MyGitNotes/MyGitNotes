import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { applyCompilationMetadata, CompilationError, parseCompilation, replaceCompilationTags } from '../src/compilation.js';
import { replaceFileTags, serializeNoteFile } from '../src/note-file.js';
import { writeNoteFile } from '../src/note-service.js';

// A tag or status write rewrites only those two fields of a compilation's text, and only into a file that opens: its
// result passes the schema every other compilation write is checked against, every other field (the board and unknown
// keys included) reads as before, and anything else is refused with a `CompilationError` before any file is touched.
const file = 'notes/thesis/chapter.compilation.yml';
const board = `# reading board
version: 1
id: chapter
title: Chapter
arrangement: board
tags: [thesis]
status: working
items:
  - id: h1
    kind: heading
    title: Problem
  - { id: n1, kind: note, path: notes/thesis/a.md }
  - { id: n2, kind: note, path: notes/thesis/b.md }
board:
  sections:
    - { item: h1, x: 0, y: 0, w: 288, h: 384 }
  cards:
    - { item: n1, x: 24, y: 56 }
    - { item: n2, x: 360, y: 56 }
  texts:
    - { id: t1, x: 960, y: 240, w: 200, text: "Decide first", color: teal }
  arrows:
    - { id: a1, from: { item: n1 }, to: { item: n2 }, label: needs }
translationKey: chapter-3
publisher: { editions: [zh, en], available: true }
`;
const withoutFields = (text: string) => {
  const { tags: _tags, status: _status, ...rest } = YAML.parse(text) as Record<string, unknown>;
  return rest;
};

describe('a tag or status write over a valid compilation', () => {
  it('keeps the board, the unknown keys and the comment, and changes nothing but the tags and status', () => {
    const next = applyCompilationMetadata(board, { tags: ['thesis', 'draft'], status: 'review' });
    expect(parseCompilation(next)).toMatchObject({ tags: ['thesis', 'draft'], status: 'review', board: parseCompilation(board).board });
    expect(withoutFields(next)).toEqual(withoutFields(board));
    expect(next.startsWith('# reading board\n')).toBe(true);
    expect(next).toMatch(/\ntranslationKey: chapter-3\npublisher: \{ editions: \[ ?zh, en ?\], available: true \}\n$/);
    const tagged = replaceFileTags(next, file, []);
    expect(withoutFields(tagged)).toEqual(withoutFields(board));
    expect(parseCompilation(tagged)).toMatchObject({ status: 'review', board: parseCompilation(board).board });
    expect(YAML.parse(tagged)).not.toHaveProperty('tags');
    expect(YAML.parse(applyCompilationMetadata(tagged, { tags: ['thesis'], status: 'working' }))).toEqual(YAML.parse(board));
  });

  it('repairs a field of its own that did not validate when the result opens', () => {
    const stringTags = board.replace('tags: [thesis]', 'tags: thesis');
    expect(() => parseCompilation(stringTags)).toThrow(CompilationError);
    expect(parseCompilation(replaceCompilationTags(stringTags, ['thesis'])).tags).toEqual(['thesis']);
  });
});

describe('a tag or status write it refuses', () => {
  it.each([['a string', 'thesis'], ['a number', 3], ['a list with a number', ['thesis', 3]], ['a list with an object', [{ name: 'x' }]]])('refuses tags given as %s', (_name, tags) => {
    expect(() => applyCompilationMetadata(board, { tags, status: 'working' })).toThrow(CompilationError);
    expect(() => replaceCompilationTags(board, tags as string[])).toThrow(CompilationError);
  });

  it.each([['a number', 3], ['a list', ['done']], ['true', true]])('refuses a status given as %s', (_name, status) => {
    expect(() => applyCompilationMetadata(board, { tags: ['thesis'], status })).toThrow(CompilationError);
  });

  it.each([['blank', { tags: ['thesis'], status: '   ' }], ['too long', { tags: ['thesis'], status: 's'.repeat(201) }], ['a blank tag', { tags: [' '], status: 'working' }], ['a tag too long', { tags: ['t'.repeat(201)], status: 'working' }], ['too many tags', { tags: Array.from({ length: 101 }, (_, n) => `t${n}`), status: 'working' }]])('refuses a value the schema does not allow: %s', (_name, metadata) => {
    expect(() => applyCompilationMetadata(board, metadata)).toThrow(/not written: the compilation would not open \((tags|status)/);
  });

  it('refuses a write into a file that does not open, instead of writing an invalid result', () => {
    const odd = 'version: 1\nid: odd\ntitle: Odd\nstatus: 3\nsource:\n  kind: tag\n  tag: x\ntags: [old]\n';
    expect(() => replaceCompilationTags(odd, ['new'])).toThrow(CompilationError);
    expect(() => applyCompilationMetadata(odd, { tags: ['new'] })).toThrow(/would not open \(arrangement/);
    const brokenBoard = board.replace('- { item: n2, x: 360, y: 56 }', '- { item: gone, x: 360, y: 56 }');
    expect(() => applyCompilationMetadata(brokenBoard, { tags: ['thesis'], status: 'done' })).toThrow(CompilationError);
  });

  it('refuses a write whose result would exceed the size cap', () => {
    const padded = `${board}padding: "${'x'.repeat(512 * 1024 - board.length - 40)}"\n`;
    expect(parseCompilation(padded).title).toBe('Chapter');
    expect(() => replaceCompilationTags(padded, ['thesis', 'a much longer tag than the file had'])).toThrow(/exceeds 512 KiB/);
  });

  it('refuses tags or status for text that is not a compilation mapping, and passes it through when it sets none', () => {
    for (const raw of ['not: [valid', '- just\n- a list\n', 'title: *nowhere\n']) {
      expect(() => applyCompilationMetadata(raw, { tags: ['x'] })).toThrow(/Tags and status not written: the compilation cannot be read/);
      expect(() => applyCompilationMetadata(raw, { tags: [], status: 'done' })).toThrow(CompilationError);
      expect(() => replaceCompilationTags(raw, ['x'])).toThrow(/Tags not written/);
      expect(applyCompilationMetadata(raw, { tags: [] })).toBe(raw);
      expect(replaceCompilationTags(raw, [])).toBe(raw);
    }
  });

  it('refuses a write that would change the board through an alias of the status', () => {
    const aliased = board.replace('status: working', 'status: &state working').replace('text: "Decide first"', 'text: *state');
    expect(parseCompilation(aliased).board?.texts?.[0].text).toBe('working');
    expect(() => applyCompilationMetadata(aliased, { tags: ['thesis'], status: 'done' })).toThrow(/would change other fields/);
    expect(() => applyCompilationMetadata(aliased, { tags: ['thesis'] })).toThrow(/would change other fields|would not open/);
    // Tags alone leave the aliased status, and so the board, as they were.
    expect(parseCompilation(replaceCompilationTags(aliased, ['new'])).board?.texts?.[0].text).toBe('working');
  });
});

describe('the callers of a refused write', () => {
  it('names the file in the refusal of a save or a tag rewrite', () => {
    expect(() => serializeNoteFile(file, { tags: 'thesis' }, board, false, new Date(), board)).toThrow(`${file}: `);
    expect(() => replaceFileTags('- just\n', file, ['x'])).toThrow(CompilationError);
    expect(() => replaceFileTags('- just\n', file, ['x'])).toThrow(`${file}: Tags not written`);
  });

  it('leaves the stored file untouched when writeNoteFile is refused', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgn-compilation-write-'));
    try {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, board, 'utf8');
      expect(() => writeNoteFile(root, file, board, { tags: ['thesis'], status: ' ' }, 'thesis')).toThrow(CompilationError);
      expect(() => writeNoteFile(root, file, board, { tags: ['thesis'], status: 3 }, 'thesis')).toThrow(CompilationError);
      expect(fs.readFileSync(target, 'utf8')).toBe(board);
      const saved = writeNoteFile(root, file, board, { tags: ['thesis'], status: 'done' }, 'thesis');
      expect(saved).toMatchObject({ status: 'done', kind: 'compilation' });
      expect(saved.invalid).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
