import { describe, expect, it } from 'vitest';
import { noteFrontmatterSpan, parseNoteContent, patchNoteFrontmatter } from '../src/frontmatter.js';

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

  it('leaves an invalid block alone', () => {
    const bad = '---\ntitle: [oops\n---\nBody';
    expect(patchNoteFrontmatter(bad, {}, { status: 'x' })).toBe(bad);
  });

  it('does not stamp timestamps', () => {
    expect(patchNoteFrontmatter(raw, parseNoteContent(raw).metadata, parseNoteContent(raw).metadata)).toBe(raw);
  });
});
