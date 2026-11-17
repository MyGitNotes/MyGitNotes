import { afterEach, describe, expect, it, vi } from 'vitest';
import { followedFrom, followsNote, noteFollowed } from './note-follows.js';

const key = (path: string) => `nb:${path}`;

afterEach(() => vi.useRealTimers());

describe('the notes the page followed', () => {
  it('chains the moves of one note, the latest first', () => {
    vi.useFakeTimers({ now: 1_000 });
    noteFollowed('nb', 'chain/a.md', 'chain/b.md');
    vi.advanceTimersByTime(10);
    noteFollowed('nb', 'chain/b.md', 'chain/c.md');
    expect(followedFrom(key('chain/c.md'))).toEqual([key('chain/b.md'), key('chain/a.md')]);
    expect(followsNote(key('chain/a.md'), key('chain/c.md'))).toBe(true);
  });

  it('does not chain a later move of another note into a path one note left (review6 F002)', () => {
    vi.useFakeTimers({ now: 5_000 });
    // Note X moves A to B; then note Y moves C into A, which X left.
    noteFollowed('nb', 'pair/a.md', 'pair/b.md');
    vi.advanceTimersByTime(10);
    noteFollowed('nb', 'pair/c.md', 'pair/a.md');
    expect(followedFrom(key('pair/b.md'))).toEqual([key('pair/a.md')]);
    expect(followsNote(key('pair/c.md'), key('pair/b.md'))).toBe(false);
    expect(followsNote(key('pair/c.md'), key('pair/a.md'))).toBe(true);
  });
});
