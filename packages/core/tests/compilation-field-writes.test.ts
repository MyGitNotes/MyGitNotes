import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { applyCompilationMetadata, CompilationError, parseCompilation, replaceCompilationTags } from '../src/compilation.js';
import { replaceFileTags, serializeNoteFile } from '../src/note-file.js';
import { writeNoteFile } from '../src/note-service.js';
import { openRemoteRepository } from '../src/remote-factory.js';
import { gitlabFixture } from './fixtures/gitlab.js';

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

  it('writes the requested status over a typed scalar, not the old type with a new value', () => {
    const typed = board.replace('status: working', 'status: !!int 123');
    const next = applyCompilationMetadata(typed, { tags: ['thesis'], status: 'done' });
    expect(next).toBe(board.replace('status: working', 'status: done'));
    expect(parseCompilation(next).status).toBe('done');
    // A file written as one flow mapping is written out again, the status a fresh node.
    const flow = '{ version: 1, id: f, title: F, arrangement: lane, status: !!int 123, source: { kind: tag, tag: x } }\n';
    expect(parseCompilation(applyCompilationMetadata(flow, { tags: ['x'], status: 'done' }))).toMatchObject({ status: 'done', tags: ['x'] });
  });

  it('changes nothing else when an unknown field holds a cyclic alias', () => {
    const cyclic = `${board}extra: &ext { self: *ext }\n`;
    expect(parseCompilation(cyclic).title).toBe('Chapter');
    expect(replaceCompilationTags(cyclic, ['thesis', 'draft'])).toBe(cyclic.replace('tags: [thesis]', 'tags: [thesis, draft]'));
    expect(applyCompilationMetadata(cyclic, { tags: ['thesis'], status: 'done' })).toBe(cyclic.replace('status: working', 'status: done'));
  });

  it('judges a valid status by its normalised value, so a tag write carrying the status it read leaves it alone', () => {
    const spaced = board.replace('status: working', 'status: &state " working "').replace('text: "Decide first"', 'text: *state');
    expect(parseCompilation(spaced).status).toBe('working');
    const next = applyCompilationMetadata(spaced, { tags: ['thesis', 'new'], status: 'working' });
    expect(next).toBe(spaced.replace('tags: [thesis]', 'tags: [thesis, new]'));
    expect(applyCompilationMetadata(spaced, { tags: ['thesis'], status: 'working' })).toBe(spaced);
  });

  it('replaces only the source of the field it writes: style, line endings, order and comments stay', () => {
    const exact = `${board}padding: "${'x'.repeat(512 * 1024 - board.length - 12)}"\n`;
    expect(new TextEncoder().encode(exact).length).toBe(512 * 1024);
    const renamed = replaceCompilationTags(exact.replace('tags: [thesis]', 'tags: [old]'), ['new']);
    expect(renamed).toBe(exact.replace('tags: [thesis]', 'tags: [new]'));
    const crlf = board.replace('translationKey: chapter-3\n', '').replace('tags: [thesis]\n', 'translationKey: chapter-3 # between known fields\ntags:\n  - thesis # first\n').replace('title: Chapter', 'title: &name Chapter').replace(/\n/g, '\r\n') + 'alias: *name # aliases a known field\r\n';
    expect(parseCompilation(crlf).tags).toEqual(['thesis']);
    const next = applyCompilationMetadata(crlf, { tags: ['thesis', 'draft'], status: 'review' });
    expect(next).toBe(crlf.replace('tags:\r\n  - thesis # first\r\n', 'tags:\r\n  - thesis\r\n  - draft\r\n').replace('status: working', 'status: review'));
    const removed = applyCompilationMetadata(next, { tags: [] });
    expect(removed).toBe(next.replace('tags:\r\n  - thesis\r\n  - draft\r\n', '').replace('status: review\r\n', ''));
    expect(applyCompilationMetadata(removed, { tags: ['a b', 'x, y'], status: 'done' })).toBe(removed.replace('arrangement: board\r\n', 'arrangement: board\r\ntags:\r\n  - a b\r\n  - x, y\r\nstatus: done\r\n'));
  });
});

describe('a tag or status write replacing a field in place', () => {
  const simple = 'version: 1\nid: s\ntitle: S\narrangement: lane\nstatus: |-\n  draft\nsource: { kind: tag, tag: x }\n';

  it('keeps the line break that ends a block value, with LF, CRLF, before the next key and before `...`', () => {
    expect(applyCompilationMetadata(simple, { tags: [], status: 'done' })).toBe(simple.replace('status: |-\n  draft\n', 'status: done\n'));
    const crlf = simple.replace(/\n/g, '\r\n');
    expect(applyCompilationMetadata(crlf, { tags: [], status: 'done' })).toBe(crlf.replace('status: |-\r\n  draft\r\n', 'status: done\r\n'));
    const last = 'version: 1\nid: s\ntitle: S\narrangement: lane\nsource: { kind: tag, tag: x }\nstatus: |-\n  draft\n...\n';
    expect(applyCompilationMetadata(last, { tags: [], status: 'done' })).toBe(last.replace('status: |-\n  draft\n', 'status: done\n'));
    const tagsBlock = simple.replace('status: |-\n  draft\n', 'tags:\n  - a\n');
    expect(replaceCompilationTags(tagsBlock, ['b'])).toBe(tagsBlock.replace('  - a\n', '  - b\n'));
    expect(replaceCompilationTags(tagsBlock.replace(/\n/g, '\r\n'), ['b'])).toBe(tagsBlock.replace('  - a\n', '  - b\n').replace(/\n/g, '\r\n'));
  });

  it('keeps a comment on the field line and after the value', () => {
    const commented = simple.replace('status: |-\n  draft\n', 'status: # where it stands\n  draft\n');
    const next = applyCompilationMetadata(commented, { tags: [], status: 'done' });
    expect(next).toBe(simple.replace('status: |-\n  draft\n', 'status: # where it stands\n  done\n'));
    expect(parseCompilation(next).status).toBe('done');
    const after = simple.replace('status: |-\n  draft\n', 'status: draft # where it stands\n');
    expect(applyCompilationMetadata(after, { tags: [], status: 'done' })).toBe(after.replace('draft #', 'done #'));
    const quoted = simple.replace('status: |-\n  draft\n', 'status: "draft # not a comment"\n');
    expect(applyCompilationMetadata(quoted, { tags: [], status: 'done' })).toBe(quoted.replace('"draft # not a comment"', '"done"'));
    const tags = simple.replace('status: |-\n  draft\n', 'tags: # topics\n  - a\n');
    const retagged = replaceCompilationTags(tags, ['a', 'b']);
    expect(retagged).toBe(tags.replace('  - a\n', '  - a\n  - b\n'));
    expect(parseCompilation(retagged).tags).toEqual(['a', 'b']);
    const empty = simple.replace('status: |-\n  draft\n', 'status: # to decide\n');
    expect(applyCompilationMetadata(empty, { tags: [], status: 'done' })).toBe(empty.replace('# to decide\n', '# to decide\n  done\n'));
    expect(applyCompilationMetadata(empty.replace(' # to decide', ''), { tags: [], status: 'done' })).toBe(simple.replace('|-\n  draft', 'done'));
    const flow = simple.replace('status: |-\n  draft\n', 'tags: # topics\n  [a]\n');
    expect(replaceCompilationTags(flow, ['b'])).toBe(flow.replace('[a]', '[b]'));
  });

  it('keeps a byte order mark when the first field is written or removed', () => {
    const bom = '\uFEFFtags: [old]\nversion: 1\nid: s\ntitle: S\narrangement: lane\nsource: { kind: tag, tag: x }\n';
    expect(replaceCompilationTags(bom, [])).toBe(bom.replace('tags: [old]\n', ''));
    expect(replaceCompilationTags(bom, ['new'])).toBe(bom.replace('[old]', '[new]'));
    const later = '\uFEFFversion: 1\nid: s\ntitle: S\narrangement: lane\nsource: { kind: tag, tag: x }\n';
    const added = replaceCompilationTags(later, ['a']);
    expect(added.startsWith('\uFEFF')).toBe(true);
    expect(parseCompilation(added).tags).toEqual(['a']);
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

// A full save sends the whole text and stores it as it is: a compilation that does not open is saved and read back as
// invalid, so raw YAML edited half-way and the undo of a deletion go through. Only a change of its tags or status is checked.
describe('a full save of a compilation', () => {
  const broken = board.replace('arrangement: board\n', '');
  const same = { tags: ['thesis'], status: 'working' };

  it('stores text that does not open locally and reports it as invalid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgn-compilation-save-'));
    try {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, board, 'utf8');
      expect(writeNoteFile(root, file, broken, same, 'thesis').invalid).toContain('arrangement');
      expect(fs.readFileSync(target, 'utf8')).toBe(broken);
      expect(writeNoteFile(root, file, board, undefined, 'thesis').invalid).toBeUndefined();
      expect(writeNoteFile(root, file, broken, undefined, 'thesis').invalid).toContain('arrangement');
      expect(fs.readFileSync(target, 'utf8')).toBe(broken);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stores text that does not open remotely, by a save and a commit of working notes', async () => {
    const remote = 'notes/ex/c.compilation.yml';
    const f = gitlabFixture(undefined, { [remote]: board });
    const { reader } = openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'fixture-token', f.request);
    const saved = await reader.save(remote, broken, same, f.head);
    expect(saved.note.invalid).toContain('arrangement');
    expect(f.files.get(remote)).toBe(broken);
  });
});

// A compilation opens only with a folder source inside one of the repository's notebooks; a tag or status write given
// those roots is checked against them, as reading the file is.
describe('a tag or status write checked against the notebook roots', () => {
  const outside = 'version: 1\nid: shelf\ntitle: Shelf\narrangement: lane\ntags: [thesis]\nsource: { kind: folder, path: elsewhere }\n';

  it('is refused when the compilation would not open for its roots, and written without them', () => {
    expect(parseCompilation(outside).title).toBe('Shelf');
    expect(() => parseCompilation(outside, ['notes/thesis'])).toThrow(CompilationError);
    expect(() => replaceCompilationTags(outside, ['new'], ['notes/thesis'])).toThrow(/Tags not written: the compilation would not open/);
    expect(() => replaceFileTags(outside, file, ['new'], ['notes/thesis'])).toThrow(`${file}: Tags not written`);
    expect(() => applyCompilationMetadata(outside, { tags: ['thesis'], status: 'done' }, ['notes/thesis'])).toThrow(CompilationError);
    expect(() => serializeNoteFile(file, { tags: ['new'] }, outside, false, new Date(), outside, ['notes/thesis'])).toThrow(CompilationError);
    // A write that changes nothing stays as it is; with the folder inside a root it is written.
    expect(replaceCompilationTags(outside, ['thesis'], ['notes/thesis'])).toBe(outside);
    expect(parseCompilation(replaceCompilationTags(outside, ['new'], ['notes/thesis', 'elsewhere'])).tags).toEqual(['new']);
  });
});
