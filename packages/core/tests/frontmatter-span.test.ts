import { describe, expect, it } from 'vitest';
import { fillMissingNoteTimestamps, noteFrontmatterSpan, parseNoteContent, patchNoteFrontmatter, replaceNoteStatus, replaceNoteTags } from '../src/frontmatter.js';
import { patchFrontmatterField } from '../src/frontmatter-patch.js';

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
    expect(noteFrontmatterSpan(typed)).toBeNull();
    expect(parseNoteContent(typed)).toMatchObject({ hasFrontmatter: false, metadata: {}, content: typed });
    expect(noteFrontmatterSpan('---\ntitle: x\n----\nBody\n')).toBeNull();
    // The key patch, the status and tag replacers and the timestamp backfill see no block in it either.
    expect(patchFrontmatterField(typed, 'title', 'y')).toBe(typed);
    expect(replaceNoteTags(typed, ['a'])).toBe(typed);
    expect(replaceNoteStatus(typed, 'done')).toBe(`---\nstatus: done\n---\n${typed}`);
    expect(fillMissingNoteTimestamps(typed, '2026-11-17', undefined).raw).toBe(`---\ncreated: "2026-11-17"\n---\n${typed}`);
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
