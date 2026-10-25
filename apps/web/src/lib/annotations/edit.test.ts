// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addRow, deleteRow, fixNumbering, formatPercent, nextId, removeAnnotations, setComment, setGeometry, setResolved, wrapImage } from './edit.js';
import { parseAnnotate } from './parse.js';

const review = readFileSync(new URL('./fixtures/review.md', import.meta.url), 'utf8').replace(/\n$/, '');
const lines = (source: string) => source.split('\n');
const IMG = '![a](a.png)';
const block = (...rows: string[]) => [':::annotate', IMG, '', ...rows, ':::'].join('\n');

/** Every line of `before` that is not in `touched` appears unchanged and in order in `after`. */
function untouched(before: string, after: string, touched: number[]) {
  const kept = lines(before).filter((_, index) => !touched.includes(index));
  const rest = lines(after);
  let cursor = 0;
  for (const line of kept) {
    cursor = rest.indexOf(line, cursor);
    expect(cursor).toBeGreaterThanOrEqual(0);
    cursor++;
  }
}

describe('formatPercent', () => {
  it('writes one decimal and drops a trailing .0', () => {
    expect(formatPercent(41.24)).toBe('41.2%');
    expect(formatPercent(8)).toBe('8%');
    expect(formatPercent(8.04)).toBe('8%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('nextId', () => {
  it('is highest id plus one, counting problem rows', () => {
    expect(nextId(review)).toBe(4);
    expect(nextId(block('- {#2 pin x=1% y=1%} a', '- {#7 arrow x=1% y=1%} b'))).toBe(8);
    expect(nextId(block())).toBe(1);
  });
});

describe('addRow', () => {
  it('appends one row at the end with the next id', () => {
    const next = addRow(review, { kind: 'pin', x: 10, y: 20, comment: 'new' });
    expect(next).toBe(review.replace('\n:::', '\n- {#4 pin x=10% y=20%} new\n:::'));
  });

  it('writes a region with its size and a multi-line comment indented', () => {
    const next = addRow(review, { kind: 'region', x: 1, y: 2, w: 3, h: 4, by: 'ann', comment: 'a\nb' });
    expect(next).toContain('\n- {#4 region x=1% y=2% w=3% h=4% by=ann} a\n  b\n:::');
  });

  it('quotes an author with spaces', () => {
    expect(addRow(review, { kind: 'pin', x: 1, y: 2, by: 'Ann Lee', comment: 'c' })).toContain('by="Ann Lee"} c');
  });

  it('starts the list after a blank line in a block with no rows', () => {
    const empty = `:::annotate\n${IMG}\n:::`;
    expect(addRow(empty, { kind: 'pin', x: 1, y: 2, comment: 'c' })).toBe(`:::annotate\n${IMG}\n\n- {#1 pin x=1% y=2%} c\n:::`);
  });

  it('leaves every existing line byte-identical', () => {
    untouched(review, addRow(review, { kind: 'pin', x: 5, y: 5, comment: 'z' }), []);
  });

  it('clamps a region into the image after rounding', () => {
    const next = addRow(review, { kind: 'region', x: 33.35, y: 0, w: 66.65, h: 10, comment: '' });
    const row = parseAnnotate(next).rows[3];
    expect(row.problems).toEqual([]);
  });
});

describe('setGeometry', () => {
  it('replaces the values in place and leaves other lines alone', () => {
    const next = setGeometry(review, 0, { x: 50, y: 60 });
    expect(lines(next)[3]).toBe('- {#1 pin x=50% y=60%} Logo 太小，和導覽列的基線沒有對齊。');
    untouched(review, next, [3]);
  });

  it('keeps the token order a person wrote', () => {
    const source = block('- {#1 pin y=2% by=bob x=1% resolved} c');
    expect(lines(setGeometry(source, 0, { x: 9, y: 8 }))[3]).toBe('- {#1 pin y=8% by=bob x=9% resolved} c');
  });

  it('resizes a region', () => {
    const next = setGeometry(review, 1, { x: 10, y: 20, w: 30, h: 40 });
    expect(next).toContain('- {#2 region x=10% y=20% w=30% h=40% by=alice} CTA');
    untouched(review, next, [4]);
  });

  it('adds a missing token at its canonical place', () => {
    const source = block('- {#1 region x=1% y=2% by=bob} c');
    const next = setGeometry(source, 0, { x: 1, y: 2, w: 5, h: 6 });
    expect(lines(next)[3]).toBe('- {#1 region x=1% y=2% w=5% h=6% by=bob} c');
  });

  it('writes the result so that it parses without problems', () => {
    const next = setGeometry(review, 1, { x: 95, y: 95, w: 30, h: 30 });
    expect(parseAnnotate(next).rows[1].problems).toEqual([]);
  });
});

describe('setResolved', () => {
  it('adds the word before by', () => {
    const next = setResolved(review, 1, true);
    expect(next).toContain('- {#2 region x=8% y=61.5% w=35% h=12% resolved by=alice} CTA');
    untouched(review, next, [4]);
  });

  it('adds the word at the end when there is no author', () => {
    expect(lines(setResolved(review, 0, true))[3]).toBe('- {#1 pin x=41.2% y=23.3% resolved} Logo 太小，和導覽列的基線沒有對齊。');
  });

  it('removes the word and one space', () => {
    const next = setResolved(review, 2, false);
    expect(next).toContain('- {#3 pin x=88% y=7% by=bob} 右上角');
  });

  it('is a no-op when already in that state', () => {
    expect(setResolved(review, 0, false)).toBe(review);
    expect(setResolved(review, 2, true)).toBe(review);
  });
});

describe('setComment', () => {
  it('replaces the comment, continuation lines included', () => {
    const next = setComment(review, 1, 'short');
    expect(next).toContain('by=alice} short\n- {#3');
    untouched(review, next, [4, 5]);
  });

  it('writes a multi-line comment with an indent', () => {
    expect(setComment(review, 0, 'a\n\nb')).toContain('} a\n\n  b\n- {#2');
  });

  it('clears a comment', () => {
    expect(lines(setComment(review, 0, ''))[3]).toBe('- {#1 pin x=41.2% y=23.3%}');
  });

  it('round-trips through the parser', () => {
    const comment = 'one\n- a\n- b\n\n```\ncode\n```';
    expect(parseAnnotate(setComment(review, 0, comment)).rows[0].comment).toBe(comment);
  });
});

describe('deleteRow', () => {
  it('removes the row with its continuation lines and keeps the others', () => {
    const next = deleteRow(review, 1);
    expect(next).toBe(lines(review).filter((_, i) => i !== 4 && i !== 5).join('\n'));
    expect(parseAnnotate(next).rows.map(row => row.id)).toEqual([1, 3]);
  });

  it('does not renumber', () => {
    expect(parseAnnotate(deleteRow(review, 0)).rows.map(row => row.id)).toEqual([2, 3]);
  });

  it('deletes the only row', () => {
    expect(parseAnnotate(deleteRow(block('- {#1 pin x=1% y=1%} a'), 0)).rows).toEqual([]);
  });
});

describe('fixNumbering', () => {
  it('gives a duplicate a new id and keeps the first', () => {
    const source = block('- {#1 pin x=1% y=1%} a', '- {#1 pin x=2% y=2%} b', '- {#3 pin x=3% y=3%} c');
    const next = fixNumbering(source);
    expect(lines(next).slice(3, 6)).toEqual(['- {#1 pin x=1% y=1%} a', '- {#4 pin x=2% y=2%} b', '- {#3 pin x=3% y=3%} c']);
  });

  it('inserts a missing id and replaces an invalid one', () => {
    const source = block('- {pin x=1% y=1%} a', '- {#0 pin x=2% y=2%} b', '- {#2 pin x=3% y=3%} c');
    const next = fixNumbering(source);
    expect(lines(next).slice(3, 6)).toEqual(['- {#3 pin x=1% y=1%} a', '- {#4 pin x=2% y=2%} b', '- {#2 pin x=3% y=3%} c']);
  });

  it('leaves a clean block untouched', () => {
    expect(fixNumbering(review)).toBe(review);
  });

  it('leaves a malformed row byte for byte', () => {
    const source = block('- plain', '- {#1 pin x=1% y=1%} a', '- {#1 pin x=1% y=1%} b');
    expect(lines(fixNumbering(source))[3]).toBe('- plain');
  });
});

describe('wrapImage and removeAnnotations', () => {
  it('wraps an image line into a block', () => {
    expect(wrapImage('![a](a.png)')).toBe(':::annotate\n![a](a.png)\n:::');
  });

  it('keeps an image line indent out of the block', () => {
    expect(wrapImage('  ![a](a.png)  ')).toBe(':::annotate\n![a](a.png)\n:::');
  });

  it('gives back the media line only', () => {
    expect(removeAnnotations(review)).toBe('![首頁 v3](/raw-assets/by-hash/3f2a9c0d6b1e4f5a8c7d2e9b0a1f3c4d5e6f7a8b)');
  });
});
