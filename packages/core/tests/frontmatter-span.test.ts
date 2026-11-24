import { describe, expect, it } from 'vitest';
import { fillMissingNoteTimestamps, hasUnreadableFrontmatter, noteFrontmatterSpan, parseNoteContent, patchNoteFrontmatter, replaceNoteStatus, replaceNoteTags, serializeNoteContent } from '../src/frontmatter.js';
import { retitleNoteFile } from '../src/file-manager.js';
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
    // And says it cannot read it, so a backfill reports it rather than counting it complete.
    expect(fillMissingNoteTimestamps(raw, '2026-11-17', undefined)).toEqual({ raw, changed: false, unreadable: true });
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
    expect(next).toBe('---\n# keep me\ntitle: A\ntags: [x, "y"]\nnested:\n  a: 1\n---\n\nBody\n');
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
    expect(unreadable('---\ntitle: A\n')).toBe(true);
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

// C230-F001: an empty block whose opening and closing lines end differently keeps its closing fence and everything after
// it byte for byte; the lines written into it end as the line before the closing fence does.
describe('filling an empty block with mixed line endings', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  const cases: [string, string, string][] = [['LF', '---\n\n---\n# T\nx\n', '\n'], ['CRLF', '---\r\n\r\n---\r\n# T\r\nx\r\n', '\r\n'], ['LF opening, CRLF closing', '---\n\n---\r\n# T\r\nx\r\n', '\n'], ['CRLF opening, LF closing', '---\r\n\n---\n# T\nx\n', '\n'], ['LF opening, CRLF inside', '---\n\r\n---\n# T\nx\n', '\r\n'], ['no line between, LF then CRLF', '---\n---\r\n# T\r\nx\r\n', '\n'], ['no line between, CRLF then LF', '---\r\n---\n# T\nx\n', '\r\n']];
  it.each(cases)('%s', (_name, raw, inserted) => {
    const opening = raw.slice(0, raw.indexOf('\n') + 1);
    const fence = raw.lastIndexOf('---');
    const tail = raw.slice(fence);
    const expectFilled = (out: string, lines: string[]) => {
      expect(out).toBe(opening + lines.map(line => line + inserted).join('') + tail);
      expect(noteFrontmatterSpan(out)).not.toHaveProperty('invalid');
    };
    expectFilled(replaceNoteStatus(raw, 'done'), ['status: done']);
    expectFilled(patchFrontmatterField(raw, 'tags', ['a']), ['tags:', '  - a']);
    expectFilled(fillMissingNoteTimestamps(raw, 'c', 'u').raw, ['created: "c"', 'updated: "u"']);
    // A save through the editor patches the same block.
    const { metadata, content } = parseNoteContent(raw);
    const saved = serializeNoteFile('notes/a.md', { ...metadata, status: 'x' }, content, false, now, raw);
    expect(saved.endsWith(tail)).toBe(true);
    expect(parseNoteFile(saved, 'notes/a.md')).toMatchObject({ metadata: { status: 'x' }, extra: {} });
  });
});

// FM-F002 (owner: 「像 YAML 才算壞掉」): an opening `---` that no fence closes is a broken frontmatter only when what follows
// looks like YAML, its first line with text on it a `key:` line. Otherwise it is a horizontal rule in a note without
// frontmatter: no list, editor or writer marks it, and a write puts a block in front of it as before 0.23.0.
describe('a leading `---` that no fence closes', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  const rules = ['---\n\nHR body\n', '---\r\n\r\nHR body\r\n', '---\nIntro after a rule\n', '---\n- a list\n', '---\n# Heading\ntitle: x\n', '---\n\nSee http://example.com\n----\nMore\n', '---\n', '---\n\n\n'];
  it.each(rules)('is a rule, not a block: %j', raw => {
    expect(noteFrontmatterSpan(raw)).toBeNull();
    expect(hasUnreadableFrontmatter(raw)).toBe(false);
    expect(parseNoteFile(raw, 'notes/a.md').extra).toEqual({});
    expect(parseNoteContent(raw)).toMatchObject({ hasFrontmatter: false, content: raw });
  });

  it.each(rules)('takes metadata with a block put in front, the rule kept as body: %j', raw => {
    const status = replaceNoteStatus(raw, 'done');
    expect(status).toBe(`---\nstatus: done\n---\n${raw}`);
    expect(parseNoteFile(status, 'notes/a.md')).toMatchObject({ metadata: { status: 'done' }, content: raw, extra: {} });
    expect(fillMissingNoteTimestamps(raw, 'c', 'u')).toEqual({ raw: `---\ncreated: "c"\nupdated: "u"\n---\n${raw}`, changed: true });
    const patched = patchNoteFrontmatter(raw, {}, { status: 'done' });
    expect(parseNoteFile(patched, 'notes/a.md')).toMatchObject({ metadata: { status: 'done' }, extra: {} });
    expect(patched.endsWith(raw)).toBe(true);
    const saved = serializeNoteContent({ status: 'done' }, raw, false, now, raw);
    expect(parseNoteFile(saved, 'notes/a.md')).toMatchObject({ metadata: { status: 'done', updated: now.toISOString() }, extra: {} });
    expect(parseNoteFile(retitleNoteFile(raw, 'notes/a.md', 'New', now), 'notes/a.md')).toMatchObject({ title: 'New', extra: {} });
  });

  const blocks = ['---\ntitle: x\n', '---\r\ntitle: x\r\n', '---\n\ntitle: x\nBody\n', '---\n"quoted key": 1\n', '---\n標題: 筆記\n', '---\ntags:\n  - a\n----\nBody\n'];
  it.each(blocks)('is a broken block when it looks like YAML: %j', raw => {
    expect(noteFrontmatterSpan(raw)).toMatchObject({ invalid: true });
    expect(hasUnreadableFrontmatter(raw)).toBe(true);
    expect(parseNoteFile(raw, 'notes/a.md').extra).toEqual({ frontmatterInvalid: true });
    expect(replaceNoteStatus(raw, 'done')).toBe(raw);
    expect(fillMissingNoteTimestamps(raw, 'c', 'u')).toEqual({ raw, changed: false, unreadable: true });
    expect(() => serializeNoteContent({ status: 'done' }, raw, false, now, raw)).toThrow('frontmatter');
    expect(() => retitleNoteFile(raw, 'notes/a.md', 'New', now)).toThrow('frontmatter');
  });

  it('keeps a closed block that is not a map unreadable, rule-like or not', () => {
    for (const raw of ['---\n\nPara\n\n---\n\nMore', '---\n- a\n---\nBody', '---\r\nPlain words\r\n---\r\n']) {
      expect(hasUnreadableFrontmatter(raw)).toBe(true);
      expect(parseNoteFile(raw, 'notes/a.md').extra).toEqual({ frontmatterInvalid: true });
    }
  });
});
