import { afterEach, expect, it, vi } from 'vitest';
import { beginNoteMove, isNoteMoving } from './moving-notes.js';

afterEach(() => vi.useRealTimers());

it('marks a note as moving until a failed move ends at once, or a finished one after its grace period', () => {
  vi.useFakeTimers();
  const failed = beginNoteMove('nb:notes/a.md');
  expect(isNoteMoving('nb:notes/a.md')).toBe(true);
  expect(isNoteMoving('nb:notes/b.md')).toBe(false);
  failed(false);
  expect(isNoteMoving('nb:notes/a.md')).toBe(false);
  const moved = beginNoteMove('nb:notes/a.md');
  moved(true);
  expect(isNoteMoving('nb:notes/a.md')).toBe(true);
  vi.advanceTimersByTime(20000);
  expect(isNoteMoving('nb:notes/a.md')).toBe(false);
});
