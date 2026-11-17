import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteFrontmatterUnreadableError, parseNoteContent, serializeNoteContent } from '../src/frontmatter.js';
import { type FileSnapshot, planFileChange, retitleNoteFile } from '../src/file-manager.js';
import { parseNoteFile, serializeNoteFile } from '../src/note-file.js';
import { writeNoteFile } from '../src/note-service.js';

// A note whose frontmatter cannot be read keeps it as body. No write puts a second block in front of it: a save of the
// text writes it as it is, and one that sets metadata or a title is refused until the block is fixed in the text.
const now = new Date('2026-11-17T00:00:00Z');
const unreadable = ['---\nnot: [yaml\n---\n# Old\n', '---\ntitle: x\n# Old\nBody\n', '---\ntitle: x\n---a\n# Old\n', '---\r\n- a\r\n---\r\n# Old\r\n'];

describe('serializeNoteContent over a block it cannot read', () => {
  it.each(unreadable)('writes a body-only save as it is: %j', raw => {
    const { metadata, content } = parseNoteContent(raw);
    expect(metadata).toEqual({});
    expect(serializeNoteContent(metadata, content, false, now, raw)).toBe(raw);
    const edited = `${content}More\n`;
    expect(serializeNoteFile('notes/a.md', metadata, edited, false, now, raw)).toBe(edited);
  });

  it.each(unreadable)('refuses metadata over a text that still opens a block: %j', raw => {
    const { content } = parseNoteContent(raw);
    expect(() => serializeNoteContent({ status: 'done' }, content, false, now, raw)).toThrow(NoteFrontmatterUnreadableError);
    expect(() => serializeNoteFile('notes/a.md', { title: 'New' }, content, false, now, raw)).toThrow('The frontmatter cannot be read');
    // With the block fixed in the text, a block is still not put in front of it.
    expect(() => serializeNoteContent({ status: 'done' }, '---\ntitle: x\n---\n# Old\n', false, now, raw)).toThrow(NoteFrontmatterUnreadableError);
  });

  it('writes a restored version, whose body opens no block, as a note of its own', () => {
    const saved = serializeNoteContent({ status: 'done' }, '# Old\n', false, now, unreadable[0]);
    expect(saved.match(/^---$/gm)).toHaveLength(2);
    expect(parseNoteFile(saved, 'notes/a.md')).toMatchObject({ metadata: { status: 'done' }, content: '# Old\n', extra: {} });
  });
});

// FM-F001: a text that itself opens a block that cannot be read gets no block in front of it either, whatever the note
// held before: an undone deletion writes a new file with metadata `{}`, and a create may carry such a text.
describe('serializeNoteContent of a text that opens a block it cannot read', () => {
  it.each(unreadable)('writes a new note of it as it is, unstamped: %j', raw => {
    expect(serializeNoteFile('notes/a.md', {}, raw, true, now)).toBe(raw);
    expect(serializeNoteContent({}, raw, false, now)).toBe(raw);
    expect(serializeNoteFile('notes/a.outline.md', {}, raw, true, now)).toBe(raw);
  });

  it.each(unreadable)('refuses metadata over it, new or over a readable note: %j', raw => {
    expect(() => serializeNoteFile('notes/a.md', { status: 'done' }, raw, true, now)).toThrow(NoteFrontmatterUnreadableError);
    expect(() => serializeNoteContent({ title: 'A' }, raw, false, now, '---\ntitle: A\n---\n\nBody\n')).toThrow(NoteFrontmatterUnreadableError);
  });

  it('restores a deleted note through writeNoteFile byte for byte', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgn-undo-'));
    try {
      const saved = writeNoteFile(dir, 'notes/a.md', unreadable[0], {});
      expect(fs.readFileSync(path.join(dir, 'notes/a.md'), 'utf8')).toBe(unreadable[0]);
      expect(saved.frontmatterInvalid).toBe(true);
      expect(() => writeNoteFile(dir, 'notes/b.md', unreadable[1], { status: 'done' })).toThrow(NoteFrontmatterUnreadableError);
      expect(fs.existsSync(path.join(dir, 'notes/b.md'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('retitling a note whose block cannot be read', () => {
  it.each(unreadable)('is refused: %j', raw => {
    expect(() => retitleNoteFile(raw, 'notes/a/a.md', 'New', now)).toThrow(NoteFrontmatterUnreadableError);
  });

  const snapshot = (files: Record<string, string>): FileSnapshot => ({ notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }], directories: ['notes/a'], protectedPaths: [], files: new Map(Object.entries(files).map(([file, text]) => [file, Buffer.from(text)])) });
  it('refuses a move with a title, and moves its bytes as they are without one', () => {
    const raw = unreadable[0];
    expect(() => planFileChange(snapshot({ 'notes/a/old.md': raw }), { kind: 'move', notebookId: 'a', path: 'notes/a/old.md', destination: 'notes/a/new.md', title: 'New' })).toThrow(NoteFrontmatterUnreadableError);
    const plan = planFileChange(snapshot({ 'notes/a/old.md': raw }), { kind: 'move', notebookId: 'a', path: 'notes/a/old.md', destination: 'notes/a/new.md' });
    expect(plan.files.get('notes/a/new.md')?.toString('utf8')).toBe(raw);
  });
});

describe('writeNoteFile over a block it cannot read', () => {
  let root: string;
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it('keeps a body-only save as it is and refuses metadata, leaving the file alone', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgn-unreadable-'));
    const file = path.join(root, 'notes/a.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = unreadable[0];
    fs.writeFileSync(file, raw);
    expect(() => writeNoteFile(root, 'notes/a.md', raw, { status: 'done' })).toThrow(NoteFrontmatterUnreadableError);
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    const saved = writeNoteFile(root, 'notes/a.md', `${raw}More\n`, {});
    expect(fs.readFileSync(file, 'utf8')).toBe(`${raw}More\n`);
    expect(saved.frontmatterInvalid).toBe(true);
  });
});
