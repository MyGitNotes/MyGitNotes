import { describe, expect, it } from 'vitest';
import { isoTime, parseIgnoreRevs, withEditDate } from '../src/edit-dates.js';
import { noteUpdatedTime, sortNotes } from '../src/note-sort.js';
import { noteSummary } from '../src/note-query.js';

const note = (metadata: Record<string, unknown> = {}) => ({ path: 'notes/a.md', title: 'A', metadata });

describe('a note’s edit date', () => {
  it('is the last commit, in UTC, when Git holds the note as it is, whatever its frontmatter says', () => {
    const dated = withEditDate(note({ updated: '2030-01-01T00:00:00Z' }), { lastCommitAt: '2026-11-24T00:37:17+08:00' });
    expect(dated.lastCommitAt).toBe('2026-11-23T16:37:17.000Z');
    expect(dated.updated).toBe('2026-11-23T16:37:17.000Z');
    expect(dated.metadata.updated).toBe('2030-01-01T00:00:00Z');
  });

  it('is the later of the last commit and the frontmatter while the note has uncommitted changes', () => {
    const fact = { lastCommitAt: '2026-11-20T10:00:00Z', uncommitted: true };
    expect(withEditDate(note({ updated: '2026-11-22T08:00:00+08:00' }), fact).updated).toBe('2026-11-22T00:00:00.000Z');
    expect(withEditDate(note({ updated: '2026-11-01' }), fact).updated).toBe('2026-11-20T10:00:00.000Z');
    expect(withEditDate(note(), fact)).toMatchObject({ lastCommitAt: '2026-11-20T10:00:00.000Z', updated: '2026-11-20T10:00:00.000Z' });
  });

  it('falls back to the frontmatter for a note Git does not hold, and is absent when that cannot be read', () => {
    expect(withEditDate(note({ updated: '2026-11-14' }), undefined)).toEqual({ ...note({ updated: '2026-11-14' }), updated: '2026-11-14T00:00:00.000Z' });
    expect(withEditDate(note({ updated: new Date('2026-11-14T09:30:00Z') }), {}).updated).toBe('2026-11-14T09:30:00.000Z');
    const unread = withEditDate(note({ updated: 'last week' }), { uncommitted: true });
    expect('updated' in unread).toBe(false);
    expect('lastCommitAt' in unread).toBe(false);
  });

  it('is recomputed, not kept, when a dated note is dated again', () => {
    const once = withEditDate(note(), { lastCommitAt: '2026-11-20T10:00:00Z' });
    const again = withEditDate(once, undefined);
    expect('lastCommitAt' in again).toBe(false);
    expect('updated' in again).toBe(false);
  });

  it('reads a time from a string or a Date, and nothing else', () => {
    expect(isoTime('2026-11-24T00:37:17+08:00')).toBe('2026-11-23T16:37:17.000Z');
    expect(isoTime(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    for (const value of [undefined, null, '', 'soon', 42, new Date(Number.NaN), {}]) expect(isoTime(value)).toBeUndefined();
  });
});

describe('sorting and listing by the edit date', () => {
  it('sorts by the resolved date before the frontmatter `updated`', () => {
    const fresh = { title: 'fresh', metadata: { updated: '2020-01-01' }, updated: '2026-11-24T00:00:00.000Z' };
    const stale = { title: 'stale', metadata: { updated: '2027-01-01' }, updated: '2025-01-01T00:00:00.000Z' };
    expect(sortNotes([stale, fresh], 'updated', 'desc').map(item => item.title)).toEqual(['fresh', 'stale']);
    expect(noteUpdatedTime(fresh)).toBe(Date.parse('2026-11-24T00:00:00.000Z'));
    expect(noteUpdatedTime({ metadata: { updated: '2026-01-01T00:00:00Z' } })).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('keeps both dates in a listing entry', () => {
    const dated = withEditDate({ id: 'a', path: 'notes/a.md', notebookId: 'n', title: 'A', tags: [], metadata: {}, content: 'Body' }, { lastCommitAt: '2026-11-20T10:00:00Z' });
    expect(noteSummary(dated)).toMatchObject({ lastCommitAt: '2026-11-20T10:00:00.000Z', updated: '2026-11-20T10:00:00.000Z' });
    expect(noteSummary({ id: 'b', path: 'notes/b.md', notebookId: 'n', title: 'B', tags: [], metadata: {}, content: '' })).not.toHaveProperty('updated');
  });
});

describe('the commits a repository’s .git-blame-ignore-revs leaves out of edit dates', () => {
  it('are its full object ids, one a line, with comments, blank and malformed lines skipped', () => {
    const a = 'a'.repeat(40), b = 'B'.repeat(40), c = 'c'.repeat(64);
    const text = `# Frontmatter backfill (!216)\n${a}\n\n  ${b}  # inline note\r\n${a}\nabc123\n${'d'.repeat(39)}\n${'e'.repeat(40)} trailing words\nnot a sha\n${c}\n`;
    expect(parseIgnoreRevs(text)).toEqual([a, 'b'.repeat(40), c]);
    expect(parseIgnoreRevs('')).toEqual([]);
  });
});
