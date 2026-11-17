import { describe, expect, it } from 'vitest';
import { fillMissingNoteTimestamps, noteFrontmatterSpan, parseNoteContent, patchNoteFrontmatter, replaceNoteStatus, replaceNoteTags } from '../src/frontmatter.js';
import { patchFrontmatterField } from '../src/frontmatter-patch.js';
import { parseNoteFile, serializeNoteFile } from '../src/note-file.js';

describe('noteFrontmatterSpan', () => {
  it('finds the block and its blank separator as parseNoteContent does', () => {
    const raw = '---\ntitle: A\ntags: [x]\n---\n\nBody\n';
    const span = noteFrontmatterSpan(raw);
    expect(span).toEqual({ yaml: 'title: A\ntags: [x]', end: raw.indexOf('\n\nBody') + 1, bodyStart: raw.indexOf('Body'), metadata: { title: 'A', tags: ['x'] } });
    expect(raw.slice(span!.bodyStart)).toBe(parseNoteContent(raw).content);
  });

  it('handles CRLF', () => {
    const raw = '---\r\nstatus: done\r\n---\r\n\r\nBody';
    const span = noteFrontmatterSpan(raw);
    expect(span && 'metadata' in span && span.metadata).toEqual({ status: 'done' });
    expect(raw.slice(span!.bodyStart)).toBe('Body');
  });

  it('returns null without a block', () => {
    expect(noteFrontmatterSpan('# Hi\n')).toBeNull();
    expect(noteFrontmatterSpan('')).toBeNull();
  });

  // CFR-F001: a closing fence followed by text on its line is no fence, for every reader of the block.
  it('closes a block only with a fence that ends its line', () => {
    const typed = '---\ntitle: x\n---a\nBody\n';
    expect(parseNoteContent(typed)).toMatchObject({ hasFrontmatter: false, metadata: {}, content: typed });
    // The key patch and the tag replacer see no block in it to patch.
    expect(patchFrontmatterField(typed, 'title', 'y')).toBe(typed);
    expect(replaceNoteTags(typed, ['a'])).toBe(typed);
  });

  // VQ P2-2 / CFR2-F001: a note that opens a block and never closes it reads as an unparsable block, not as a note
  // without one, so the collab editor warns instead of drawing its metadata as body text.
  it('reads a block opened by `---` with no closing fence as invalid, up to the line that should have closed it', () => {
    const typed = '---\ntitle: x\n---a\n\nBody\n';
    expect(noteFrontmatterSpan(typed)).toEqual({ invalid: true, yaml: 'title: x', end: typed.indexOf('\nBody'), bodyStart: typed.indexOf('Body'), unclosed: '---a' });
    const dashes = '---\r\ntitle: x\r\n----\r\nBody';
    expect(noteFrontmatterSpan(dashes)).toEqual({ invalid: true, yaml: 'title: x', end: dashes.indexOf('Body'), bodyStart: dashes.indexOf('Body'), unclosed: '----' });
    // Without any line that starts with `---`, the block runs to the end of the text.
    const open = '---\ntitle: x\nBody\n';
    expect(noteFrontmatterSpan(open)).toEqual({ invalid: true, yaml: 'title: x\nBody\n', end: open.length, bodyStart: open.length, unclosed: '' });
    // An empty block is a block with nothing in it: an empty map (FUI-F003).
    expect(noteFrontmatterSpan('---\n---\n\nBody')).toEqual({ yaml: '', end: 8, bodyStart: 9, metadata: {} });
    // A text that does not open with a fence line has no block.
    expect(noteFrontmatterSpan('--- \ntitle: x\n---\n')).toBeNull();
    expect(noteFrontmatterSpan('---')).toBeNull();
  });

  // CFR2-F001: the writers that add a block in front of a text with none must not add a second one in front of a block they cannot read.
  it.each(['---\ntitle: x\n---a\nBody\n', '---\ntitle: x\n----\nBody\n', '---\ntitle: [x\n---\nBody\n', '---\ntitle: x\nBody\n'])('adds no second block in front of a block it cannot read: %j', raw => {
    expect(replaceNoteStatus(raw, 'done')).toBe(raw);
    expect(fillMissingNoteTimestamps(raw, '2026-11-17', undefined)).toEqual({ raw, changed: false });
    expect(patchNoteFrontmatter(raw, {}, { status: 'done' })).toBe(raw);
  });

  it('takes trailing spaces of the closing fence into the fence line, and still closes a block at the end of the text', () => {
    const spaced = '---\ntitle: x\n--- \t\n\nBody\n';
    expect(noteFrontmatterSpan(spaced)).toEqual({ yaml: 'title: x', end: spaced.indexOf('\n\nBody') + 1, bodyStart: spaced.indexOf('Body'), metadata: { title: 'x' } });
    expect(parseNoteContent(spaced)).toMatchObject({ hasFrontmatter: true, content: 'Body\n', lineNumberOffset: 4 });
    expect(noteFrontmatterSpan('---\ntitle: x\n---')).toEqual({ yaml: 'title: x', end: 16, bodyStart: 16, metadata: { title: 'x' } });
    expect(noteFrontmatterSpan('---\r\ntitle: x\r\n---\r\nBody')).toMatchObject({ bodyStart: '---\r\ntitle: x\r\n---\r\n'.length });
  });

  it('marks an unparsable or non-map block invalid', () => {
    const bad = '---\ntitle: [oops\n---\nBody';
    expect(noteFrontmatterSpan(bad)).toEqual({ invalid: true, yaml: 'title: [oops', end: bad.indexOf('Body'), bodyStart: bad.indexOf('Body') });
    const list = '---\n- a\n---\nBody';
    expect(noteFrontmatterSpan(list)).toMatchObject({ invalid: true });
  });
});

describe('patchNoteFrontmatter', () => {
  const raw = '---\n# keep me\ntitle: A\ntags: [x]\nnested:\n  a: 1\n---\n\nBody\n';

  it('rewrites only changed keys, keeping comments, order and body', () => {
    const before = parseNoteContent(raw).metadata;
    const next = patchNoteFrontmatter(raw, before, { ...before, tags: ['x', 'y'] });
    expect(next).toBe('---\n# keep me\ntitle: A\ntags: [x, y]\nnested:\n  a: 1\n---\n\nBody\n');
  });

  it('adds and removes keys', () => {
    const before = parseNoteContent(raw).metadata;
    const { title: _title, ...rest } = before;
    const next = patchNoteFrontmatter(raw, before, { ...rest, status: 'done' });
    expect(next).toContain('status: done');
    expect(next).not.toContain('title:');
    expect(next).toContain('# keep me');
    expect(next.endsWith('\n\nBody\n')).toBe(true);
  });

  it('only patches keys that differ between before and after, even if the text moved on', () => {
    const before = { title: 'A', tags: ['x'] };
    // Someone else changed title meanwhile; this tab only changed tags.
    const current = raw.replace('title: A', 'title: B');
    const next = patchNoteFrontmatter(current, before, { title: 'A', tags: ['z'] });
    expect(next).toContain('title: B');
    expect(next).toContain('tags: [z]');
  });

  it('keeps block lists in block style', () => {
    const block = '---\ntags:\n  - a\n---\nBody';
    const next = patchNoteFrontmatter(block, { tags: ['a'] }, { tags: ['a', 'b'] });
    expect(parseNoteContent(next).metadata.tags).toEqual(['a', 'b']);
    expect(next).toMatch(/tags:\n {2}- a\n {2}- b\n---\nBody$/);
  });

  it('keeps CRLF', () => {
    const crlf = '---\r\ntitle: A\r\n---\r\n\r\nBody';
    const next = patchNoteFrontmatter(crlf, { title: 'A' }, { title: 'A', status: 'done' });
    expect(next).toBe('---\r\ntitle: A\r\nstatus: done\r\n---\r\n\r\nBody');
  });

  it('renders a new block when there is none', () => {
    expect(patchNoteFrontmatter('Body\n', {}, { tags: ['a'] })).toBe('---\ntags:\n  - a\n---\n\nBody\n');
    expect(patchNoteFrontmatter('', {}, { status: 'x' })).toBe('---\nstatus: x\n---\n');
  });

  // CFR-F005: a block put before a CRLF body is written with CRLF, so the file keeps one line ending.
  it('renders a new block in the line endings of the text it goes before', () => {
    expect(patchNoteFrontmatter('Body\r\nmore\r\n', {}, { title: 'x' })).toBe('---\r\ntitle: x\r\n---\r\n\r\nBody\r\nmore\r\n');
    expect(patchNoteFrontmatter('Body\r\n', {}, { tags: ['a'] })).toBe('---\r\ntags:\r\n  - a\r\n---\r\n\r\nBody\r\n');
  });

  it('leaves an invalid block alone', () => {
    const bad = '---\ntitle: [oops\n---\nBody';
    expect(patchNoteFrontmatter(bad, {}, { status: 'x' })).toBe(bad);
  });

  it('does not stamp timestamps', () => {
    expect(patchNoteFrontmatter(raw, parseNoteContent(raw).metadata, parseNoteContent(raw).metadata)).toBe(raw);
  });
});

// A note whose frontmatter cannot be read is listed as such, as the editor shows it, instead of as a note without a status.
describe('parseNoteFile frontmatterInvalid', () => {
  const unreadable = (raw: string, file = 'notes/a.md') => parseNoteFile(raw, file).extra.frontmatterInvalid;
  it('marks a block no fence closes, one closed by a line with more on it, and one that is not a map', () => {
    expect(unreadable('---\ntitle: A\nstatus: done\n---x\n# A\n')).toBe(true);
    expect(unreadable('---\ntitle: A\n----\n# A\n')).toBe(true);
    expect(unreadable('---\ntitle: A\nstatus: done\n# A\n')).toBe(true);
    expect(unreadable('---\ntitle: [oops\n---\nBody')).toBe(true);
    expect(unreadable('---\n- a\n---\nBody')).toBe(true);
    expect(unreadable('---\ntitle: A\n---x\n', 'notes/a.outline.md')).toBe(true);
    expect(parseNoteFile('---\ntitle: A\n---x\n', 'notes/a.outline.md').extra.kind).toBe('outline');
  });
  it('leaves a note with a readable block, with none, or opening with another dash line unmarked', () => {
    expect(parseNoteFile('---\ntitle: A\nstatus: done\n---\n# A\n', 'notes/a.md').extra).toEqual({});
    expect(unreadable('# A\n\n---\n')).toBeUndefined();
    expect(unreadable('----\nBody\n')).toBeUndefined();
    expect(unreadable('')).toBeUndefined();
  });
  it('reads an empty block as an empty map, in LF and CRLF, and keeps an unclosed leading fence unreadable', () => {
    for (const raw of ['---\n---\nBody', '---\n\n---\nBody', '---\r\n---\r\nBody', '---\r\n\r\n---\r\nBody', '---\n---']) {
      expect(parseNoteFile(raw, 'notes/a.md')).toMatchObject({ metadata: {}, extra: {} });
      expect(noteFrontmatterSpan(raw)).toMatchObject({ metadata: {} });
      expect(noteFrontmatterSpan(raw)).not.toHaveProperty('invalid');
    }
    expect(parseNoteFile('---\n---\nBody', 'notes/a.md').content).toBe('Body');
    expect(parseNoteContent('---\r\n\r\n---\r\nBody')).toMatchObject({ hasFrontmatter: true, content: 'Body' });
    expect(unreadable('---\n\nIntro after a rule\n')).toBe(true);
  });
  it('writes keys into an empty block instead of rendering a second one, keeping its comments and line endings', () => {
    expect(replaceNoteStatus('---\n---\nBody', 'done')).toBe('---\nstatus: done\n---\nBody');
    expect(replaceNoteStatus('---\r\n\r\n---\r\nBody', 'done')).toBe('---\r\nstatus: done\r\n---\r\nBody');
    expect(replaceNoteStatus('---\n---\nBody', null)).toBe('---\n---\nBody');
    expect(patchFrontmatterField('---\n# keep\n---\nBody', 'tags', ['a'])).toBe('---\n# keep\ntags:\n  - a\n---\nBody');
    expect(patchNoteFrontmatter('---\n---\n\nBody', {}, { status: 'done' })).toBe('---\nstatus: done\n---\n\nBody');
    expect(fillMissingNoteTimestamps('---\n---\nBody', 'c', 'u').raw).toBe('---\ncreated: "c"\nupdated: "u"\n---\nBody');
    const saved = serializeNoteFile('notes/a.md', { status: 'done' }, 'Body', false, new Date('2026-11-17T00:00:00Z'), '---\n---\nBody');
    expect(saved.match(/^---$/gm)).toHaveLength(2);
    expect(parseNoteFile(saved, 'notes/a.md').metadata).toMatchObject({ status: 'done' });
  });
});
