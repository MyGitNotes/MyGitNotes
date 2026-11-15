import { describe, expect, it } from 'vitest';
import { mergeLiveText } from '../src/live-merge.js';

/** A note of short paragraphs separated by blank lines, the shape that made the old line merge quadratic. */
function paragraphs(bytes: number) {
  const parts: string[] = ['---\ntitle: Long\n---\n'];
  let size = parts[0]!.length;
  for (let i = 0; size < bytes; i++) {
    const paragraph = `Paragraph ${i} of a long live note.\n\n`;
    parts.push(paragraph);
    size += paragraph.length;
  }
  return parts;
}

const edit = (parts: string[], index: number, text: string) => parts.map((part, i) => i === index ? text : part).join('');

describe('mergeLiveText', () => {
  it('merges Git changes and live changes on different lines', () => {
    expect(mergeLiveText('a\nb\nc\nd\n', 'a\nB\nc\nd\n', 'a\nb\nc\nD\n')).toEqual({ conflict: false, text: 'a\nB\nc\nD\n' });
  });

  it('takes the same change made on both sides once, with no conflict', () => {
    expect(mergeLiveText('a\nb\nc\n', 'a\nB\nc\nd\n', 'a\nB\nc\nd\n')).toEqual({ conflict: false, text: 'a\nB\nc\nd\n' });
  });

  it('is a conflict when both sides change the same line differently', () => {
    expect(mergeLiveText('a\nb\nc\n', 'a\nlive\nc\n', 'a\ngit\nc\n')).toEqual({ conflict: true });
  });

  it('is a conflict when one side inserts next to a line the other changed', () => {
    // The inserted paragraph goes after the blank line, touching the paragraph Git changed.
    expect(mergeLiveText('A\n\nB\n', 'A\n\nX\n\nB\n', 'A\n\nB2\n')).toEqual({ conflict: true });
    expect(mergeLiveText('A\n\nB\n', 'A\n\nB2\n', 'A\n\nX\n\nB\n')).toEqual({ conflict: true });
  });

  it('keeps the final newline, or its absence, and carriage returns as written', () => {
    expect(mergeLiveText('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toEqual({ conflict: false, text: 'A\nb\nC' });
    expect(mergeLiveText('a\r\nb\r\nc\r\n', 'A\r\nb\r\nc\r\n', 'a\r\nb\r\nc\r\nd')).toEqual({ conflict: false, text: 'A\r\nb\r\nc\r\nd' });
    expect(mergeLiveText('', 'live\n', '')).toEqual({ conflict: false, text: 'live\n' });
    expect(mergeLiveText('a\n', '', 'a\n')).toEqual({ conflict: false, text: '' });
  });

  it('merges a 233 KiB note of paragraphs separated by blank lines in well under two seconds', () => {
    const parts = paragraphs(233 * 1024);
    expect(parts.length).toBeGreaterThan(5000);
    const base = parts.join('');
    const live = edit(parts, 10, 'Paragraph 10, typed in the live editor.\n\n');
    const git = edit(parts, parts.length - 10, 'Paragraph near the end, changed in Git.\n\n');
    const started = performance.now();
    const merged = mergeLiveText(base, live, git);
    const elapsed = performance.now() - started;
    expect(merged).toEqual({ conflict: false, text: parts.map((part, i) => i === 10 ? 'Paragraph 10, typed in the live editor.\n\n' : i === parts.length - 10 ? 'Paragraph near the end, changed in Git.\n\n' : part).join('') });
    expect(elapsed).toBeLessThan(2000);
  });

  it('still finds a conflict when both sides change the same paragraph of a long note', () => {
    const parts = paragraphs(233 * 1024);
    const base = parts.join('');
    const started = performance.now();
    expect(mergeLiveText(base, edit(parts, 3000, 'Live words.\n\n'), edit(parts, 3000, 'Git words.\n\n'))).toEqual({ conflict: true });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
