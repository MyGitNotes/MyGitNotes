import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SourceError } from './github-api.js';
import { CheckedOutError, isLiveContentHash, isLiveId, isLiveNotePath, isLiveRevision, LIVE_MAX_BYTES, liveAdapterError, liveCheckoutOf, liveContentHash, type LiveEditorInfo, liveEditorOf, LiveLeasedError, type LiveNotes, LiveNotLiveError, livePendingPath, LiveStaleError, liveTextOf, LiveTooLargeError, LiveUnavailableError, normalizeLiveText, parseLivePendingPath, validateLiveEditorInfo } from './live-notes.js';
import type { NotebookConfig } from './types.js';

const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const notebooks: NotebookConfig[] = [{ id: 'life', title: 'Life', root: 'notes/life' }, { id: 'work', title: 'Work', root: 'notes/life/work', excluded: ['drafts/**'] }];
const editor: LiveEditorInfo = { origin: 'https://live.example.test', messageType: 'live-status' };
const commit = 'a'.repeat(40), blob = 'b'.repeat(40);

describe('live text normal form', () => {
  it('removes every carriage return and NUL and keeps everything else', () => {
    expect(normalizeLiveText('a\r\nb\rc\0d\n')).toBe('a\nbcd\n');
    expect(normalizeLiveText('  tab\t 中文 😀 \n')).toBe('  tab\t 中文 😀 \n');
    expect(normalizeLiveText('')).toBe('');
  });

  it('hashes the UTF-8 normal form with sha256 in lower-case hex', () => {
    expect(liveContentHash('# 標題\n😀')).toBe(sha256('# 標題\n😀'));
    expect(liveContentHash('a\r\nb\0')).toBe(sha256('a\nb'));
    expect(liveContentHash('a\r\nb')).toBe(liveContentHash('a\nb'));
    expect(isLiveContentHash(liveContentHash('x'))).toBe(true);
    expect(isLiveContentHash('A'.repeat(64))).toBe(false);
    expect(isLiveContentHash('a'.repeat(63))).toBe(false);
  });
});

describe('live ids and revisions', () => {
  it('accepts ids of 1 to 64 letters, digits, _ and -', () => {
    for (const id of ['a', 'A-b_9', 'x'.repeat(64)]) expect(isLiveId(id)).toBe(true);
    for (const id of ['', 'x'.repeat(65), 'a/b', 'a.b', '../a', 'a b', 'ä', 7, null]) expect(isLiveId(id)).toBe(false);
  });

  it('accepts revisions of printable ASCII up to 256 characters', () => {
    for (const revision of ['e1:2', 'h:' + 'a'.repeat(64), ' ~', 'x'.repeat(256)]) expect(isLiveRevision(revision)).toBe(true);
    for (const revision of ['', 'x'.repeat(257), 'a\nb', 'a\tb', 'é', '\x7f', 12, undefined]) expect(isLiveRevision(revision)).toBe(false);
  });
});

describe('pending paths', () => {
  it('puts a pending note in the dot folder of its notebook root', () => {
    expect(livePendingPath('notes/life', 'abc')).toBe('notes/life/.live/abc.md');
    expect(() => livePendingPath('notes/life', '../x')).toThrow();
  });

  it('reads the notebook and id back, the longest root first', () => {
    expect(parseLivePendingPath('notes/life/.live/abc.md', notebooks)).toEqual({ notebook: notebooks[0], id: 'abc' });
    expect(parseLivePendingPath('notes/life/work/.live/x-1.md', notebooks)).toEqual({ notebook: notebooks[1], id: 'x-1' });
  });

  it('reads nothing else as a pending path', () => {
    for (const file of ['notes/life/.live/abc.markdown', 'notes/life/.live/a.b.md', 'notes/life/.live/sub/abc.md', 'notes/life/sub/.live/abc.md', 'notes/life/.live/.md', 'other/.live/abc.md', 'notes/life/abc.md', `notes/life/.live/${'x'.repeat(65)}.md`, 'notes/life/.live/abc.md/x']) {
      expect(parseLivePendingPath(file, notebooks), file).toBeNull();
    }
  });
});

describe('live note paths', () => {
  it('takes Markdown notes of the notebook, not outlines, templates, excluded or other kinds', () => {
    expect(isLiveNotePath('a.md', notebooks[0])).toBe(true);
    expect(isLiveNotePath('dir/b.markdown', notebooks[0])).toBe(true);
    for (const relative of ['a.outline.md', '.templates/t.md', 'a.compilation.yml', 'a.txt', 'a.mdx', 'assets/a.md', 'AGENTS.md', '.live/a.md']) {
      expect(isLiveNotePath(relative, notebooks[0]), relative).toBe(false);
    }
    expect(isLiveNotePath('drafts/a.md', notebooks[1])).toBe(false);
  });
});

describe('editor info', () => {
  it('accepts an https origin, or http on a loopback host, with no path', () => {
    for (const origin of ['https://live.example.test', 'https://live.example.test:8443', 'http://localhost:3000', 'http://127.0.0.1:9', 'http://[::1]:8080']) {
      expect(validateLiveEditorInfo({ origin, messageType: 'live-status', themeParam: 'theme' })).toEqual({ origin, messageType: 'live-status', themeParam: 'theme' });
    }
    expect(validateLiveEditorInfo({ origin: 'https://a.test', messageType: 'm' })).toEqual({ origin: 'https://a.test', messageType: 'm' });
  });

  it('refuses any other origin, message type or theme parameter', () => {
    for (const origin of ['http://live.example.test', 'https://live.example.test/', 'https://live.example.test/path', 'https://user:pw@live.example.test', 'https://Live.example.test', 'ftp://live.example.test', 'javascript:alert(1)', '', 'https://live.example.test?x=1']) {
      expect(() => validateLiveEditorInfo({ origin, messageType: 'm' }), origin).toThrow();
    }
    for (const messageType of ['', 'a:b', 'a b', 'x'.repeat(65), 1]) expect(() => validateLiveEditorInfo({ origin: 'https://a.test', messageType })).toThrow();
    for (const themeParam of ['', 'a=b', 'a&b', 3]) expect(() => validateLiveEditorInfo({ origin: 'https://a.test', messageType: 'm', themeParam })).toThrow();
    expect(() => validateLiveEditorInfo(null)).toThrow();
  });

  it("answers a repository's editor only when the adapter declared it", () => {
    const declared: Pick<LiveNotes, 'editors' | 'editor'> = { editors: [editor], editor: repository => repository === 'covered' ? editor : repository === 'other' ? { ...editor, origin: 'https://elsewhere.test' } : null };
    expect(liveEditorOf(declared, 'covered')).toEqual(editor);
    expect(liveEditorOf(declared, 'uncovered')).toBeNull();
    expect(() => liveEditorOf(declared, 'other')).toThrow();
  });
});

const row = (overrides: Record<string, unknown> = {}) => ({ id: 'link-1', notebook: 'repo~life', path: 'notes/life/a.md', since: '2026-11-15T01:00:00.000Z', editorUrl: 'https://live.example.test/n/link-1', embedUrl: 'https://live.example.test/n/link-1?embed=1', contentHash: liveContentHash('# A\n'), activeEditors: 2, lastEditAt: '2026-11-15T01:02:00.000Z', syncedAt: null, base: { commit, blob, contentHash: liveContentHash('# A\n') }, conflict: null, ...overrides });

describe('checkout rows', () => {
  const context = { editor, notebook: (key: string) => key === 'repo~life' ? notebooks[0] : key === 'repo~work' ? notebooks[1] : undefined };
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('keeps a valid row with only the contract fields', () => {
    expect(liveCheckoutOf({ ...row(), extra: 'dropped' }, context)).toEqual(row());
    const pending = row({ path: null, pathRule: 'meetings/{{date}} {{title}}.md', base: null });
    expect(liveCheckoutOf(pending, context)).toEqual(pending);
    expect(liveCheckoutOf(row({ conflict: { kind: 'overwrote', overwritten: 'c'.repeat(40), commit, at: '2026-11-15T03:00:00.000Z' } }), context)).toMatchObject({ conflict: { kind: 'overwrote' } });
  });

  it('drops a filed row’s path rule', () => {
    expect(liveCheckoutOf(row({ pathRule: '{{title}}.md' }), context)).toEqual(row());
  });

  it('keeps a filed row’s target and the target a check-in found taken, both notes of its notebook, and drops them on a pending row (§20.4)', () => {
    expect(liveCheckoutOf(row({ target: 'notes/life/archive/a.md' }), context)).toEqual(row({ target: 'notes/life/archive/a.md' }));
    expect(liveCheckoutOf(row({ unmoved: 'notes/life/archive/a.md' }), context)).toEqual(row({ unmoved: 'notes/life/archive/a.md' }));
    const pending = row({ path: null, pathRule: '{{title}}.md', base: null });
    expect(liveCheckoutOf({ ...pending, target: 'notes/life/x.md', unmoved: 'notes/life/y.md' }, context)).toEqual(pending);
    const warn = quiet();
    for (const target of ['notes/other/a.md', 'notes/life/a.outline.md', 'notes/life/.live/a.md', '../x.md', 3]) expect(liveCheckoutOf(row({ target }), context), String(target)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('drops a bad row and logs it by id only', () => {
    const warn = quiet();
    const bad: Record<string, unknown>[] = [{ id: '../x' }, { editorUrl: 'https://evil.test/n/link-1' }, { embedUrl: 'http://live.example.test/n/link-1' }, { embedUrl: 'https://user:pw@live.example.test/n' }, { notebook: 'repo~unknown' }, { path: 'notes/other/a.md' }, { path: 'notes/life/a.outline.md' }, { path: 'notes/life/../life/a.md' }, { path: 'notes/life/.live/a.md' }, { path: 'notes/life/work/drafts/a.md', notebook: 'repo~work' }, { path: null }, { path: null, pathRule: '../x.md' }, { path: null, pathRule: '/x.md' }, { contentHash: 'nope' }, { activeEditors: -1 }, { activeEditors: 1.5 }, { since: 'yesterday' }, { lastEditAt: 'soon' }, { base: { commit: 'xyz', blob, contentHash: liveContentHash('') } }, { conflict: { kind: 'other', overwritten: commit, commit, at: '2026-11-15T03:00:00.000Z' } }];
    for (const overrides of bad) expect(liveCheckoutOf(row(overrides), context), JSON.stringify(overrides)).toBeNull();
    expect(liveCheckoutOf('not a row', context)).toBeNull();
    const logged = warn.mock.calls.map(call => call.join(' '));
    expect(logged.some(line => line.includes('link-1'))).toBe(true);
    expect(logged.some(line => line.includes('../x'))).toBe(false);
    expect(logged.some(line => line.includes('evil.test'))).toBe(false);
  });
});

describe('live texts', () => {
  it('keeps a text whose revision and hash are valid', () => {
    const content = '# A\n中文\n';
    expect(liveTextOf({ content, liveRevision: 'e1:3', contentHash: liveContentHash(content), extra: 1 })).toEqual({ content, liveRevision: 'e1:3', contentHash: liveContentHash(content) });
  });

  it('refuses a bad revision, a hash that does not match, or a text past the limit', () => {
    const content = '# A\n';
    for (const value of [{ content, liveRevision: 'é', contentHash: liveContentHash(content) }, { content, liveRevision: 'x'.repeat(257), contentHash: liveContentHash(content) }, { content, liveRevision: 'r', contentHash: liveContentHash('other') }, { content: 1, liveRevision: 'r', contentHash: liveContentHash('') }, null]) {
      expect(() => liveTextOf(value)).toThrow(LiveUnavailableError);
    }
    const large = 'x'.repeat(LIVE_MAX_BYTES + 1);
    expect(() => liveTextOf({ content: large, liveRevision: 'r', contentHash: liveContentHash(large) })).toThrow(LiveTooLargeError);
  });
});

describe('live errors', () => {
  it('are source errors with their statuses', () => {
    expect(new LiveStaleError()).toMatchObject({ status: 409, message: 'The note changed in the live editor. Read it again.' });
    expect(new LiveLeasedError().status).toBe(409);
    expect(new LiveNotLiveError().status).toBe(409);
    expect(new LiveTooLargeError().status).toBe(413);
    expect(new LiveUnavailableError()).toMatchObject({ status: 502, message: 'Live editor unavailable.' });
    const checkedOut = new CheckedOutError(['notes/life/a.md', 'notes/life/b.md']);
    expect(checkedOut).toBeInstanceOf(SourceError);
    expect(checkedOut).toMatchObject({ status: 409, code: 'checked-out', paths: ['notes/life/a.md', 'notes/life/b.md'] });
    expect(checkedOut.message).toContain('notes/life/a.md');
    expect(checkedOut.message).toContain('check_in_note');
    expect(new CheckedOutError(['a.md'], 'edited live; read it again').message).toBe('edited live; read it again');
  });

  it("maps an adapter's own failures to one that names no detail", () => {
    const stale = new LiveStaleError();
    expect(liveAdapterError(stale)).toBe(stale);
    const mapped = liveAdapterError(new Error('ECONNREFUSED 10.0.0.7:3000 token=secret'));
    expect(mapped).toBeInstanceOf(LiveUnavailableError);
    expect(mapped.message).toBe('Live editor unavailable.');
    expect(liveAdapterError(new SourceError('Upstream said no', 400))).toBeInstanceOf(LiveUnavailableError);
  });
});
