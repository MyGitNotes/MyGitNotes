import { describe, expect, it } from 'vitest';
import { lineHunks, rebaseLiveText, type TextEdit, textEdits } from '../src/live-text.js';

/** The length of a longest common subsequence, by dynamic programming. */
function lcs(a: Int32Array, b: Int32Array): number {
  const row = new Int32Array(b.length + 1);
  for (let i = a.length - 1; i >= 0; i--) {
    let diagonal = 0;
    for (let j = b.length - 1; j >= 0; j--) {
      const below = row[j]!;
      row[j] = a[i] === b[j] ? diagonal + 1 : Math.max(below, row[j + 1]!);
      diagonal = below;
    }
  }
  return row[0]!;
}

describe('lineHunks', () => {
  it('rebuilds the changed lines with a shortest edit script and a common line between hunks, on 3000 seeded cases', () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return Math.floor(seed / 0x80000000 * n);
    };
    for (let test = 0; test < 3000; test++) {
      const alphabet = 1 + random(5);
      const a = Int32Array.from({ length: random(15) }, () => random(alphabet));
      let lines = Array.from({ length: random(15) }, () => random(alphabet));
      if (test % 2) {
        lines = [...a];
        for (let k = random(5); k > 0; k--) {
          const at = random(lines.length + 1), op = random(3);
          if (op === 0) lines.splice(at, 0, random(alphabet));
          else if (op === 1) lines.splice(at, 1);
          else lines[at] = random(alphabet);
        }
      }
      const b = Int32Array.from(lines);
      const out: number[] = [];
      let at = 0, changedAt = 0, edits = 0;
      for (const hunk of lineHunks(a, b)!) {
        expect(hunk.length + hunk.changedLength).toBeGreaterThan(0);
        if (out.length || at) expect(hunk.start).toBeGreaterThan(at);
        expect(hunk.changedStart - changedAt).toBe(hunk.start - at);
        for (let i = at; i < hunk.start; i++) out.push(a[i]!);
        for (let i = 0; i < hunk.changedLength; i++) out.push(b[hunk.changedStart + i]!);
        edits += hunk.length + hunk.changedLength;
        at = hunk.start + hunk.length;
        changedAt = hunk.changedStart + hunk.changedLength;
      }
      for (let i = at; i < a.length; i++) out.push(a[i]!);
      expect(out).toEqual([...b]);
      expect(edits).toBe(a.length + b.length - 2 * lcs(a, b));
    }
  });
});

/** A seeded generator, so a failing case can be found again. */
function seeded(seed: number) {
  return (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return Math.floor(seed / 0x80000000 * n);
  };
}
const applyEdits = (base: string, edits: readonly TextEdit[]) => {
  let out = '', at = 0;
  for (const edit of edits) {
    out += base.slice(at, edit.from) + edit.text;
    at = edit.to;
  }
  return out + base.slice(at);
};
/** Whether cutting `text` at `at` would part a surrogate pair. */
const splitsPair = (text: string, at: number) => at > 0 && at < text.length && /[\ud800-\udbff]/.test(text[at - 1]!) && /[\udc00-\udfff]/.test(text[at]!);
/** Whether every surrogate in `text` has its other half. */
const wholePairs = (text: string) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

describe('textEdits', () => {
  it('lists the changes in order and apart, each off a surrogate pair, and applying them gives the changed text, on 2000 seeded cases', () => {
    const random = seeded(11);
    const pieces = ['a', 'b', ' ', '\n', '中', '文', '😀', '😁', '👍🏽', 'é'];
    const text = (length: number) => Array.from({ length }, () => pieces[random(pieces.length)]!).join('');
    for (let test = 0; test < 2000; test++) {
      const base = text(random(30));
      let changed = text(random(30));
      if (test % 2) {
        const parts = [...base];
        for (let k = random(4); k > 0; k--) parts.splice(random(parts.length + 1), random(3), ...(random(2) ? [pieces[random(pieces.length)]!] : []));
        changed = parts.join('');
      }
      const edits = textEdits(base, changed);
      expect(applyEdits(base, edits), JSON.stringify([base, changed])).toBe(changed);
      if (base === changed) expect(edits).toEqual([]);
      let end = -1;
      for (const edit of edits) {
        expect(edit.from).toBeGreaterThan(end);
        expect(edit.to).toBeGreaterThanOrEqual(edit.from);
        expect(edit.to - edit.from + edit.text.length).toBeGreaterThan(0);
        expect(splitsPair(base, edit.from) || splitsPair(base, edit.to), JSON.stringify([base, changed, edit])).toBe(false);
        expect(wholePairs(edit.text), JSON.stringify([base, changed, edit])).toBe(true);
        end = edit.to;
      }
    }
  });

  it('replaces a whole emoji when only half of its pair differs', () => {
    // 😀 and 😁 share their first half: a diff by UTF-16 unit would leave it and swap only the second.
    expect(textEdits('a😀b', 'a😁b')).toEqual([{ from: 1, to: 3, text: '😁' }]);
    expect(textEdits('😀', '😁😀')).toEqual([{ from: 0, to: 0, text: '😁' }]);
    expect(textEdits('x😀😁y', 'x😁y')).toEqual([{ from: 1, to: 3, text: '' }]);
  });
});

describe('rebaseLiveText', () => {
  it('gives the other text when one side changed nothing, and the one text when both made the same change', () => {
    expect(rebaseLiveText('one\n', 'one\n', 'two\n')).toBe('two\n');
    expect(rebaseLiveText('one\n', 'two\n', 'one\n')).toBe('two\n');
    expect(rebaseLiveText('one\n', 'two\n', 'two\n')).toBe('two\n');
    expect(rebaseLiveText('', '', '')).toBe('');
  });

  it('applies both sides where they changed different places, down to words of one line', () => {
    expect(rebaseLiveText('first\nsecond\nthird\n', 'first\nsecond\nthird\nfourth\n', 'FIRST\nsecond\nthird\n')).toBe('FIRST\nsecond\nthird\nfourth\n');
    expect(rebaseLiveText('the quick brown fox', 'the quick red fox', 'a quick brown fox')).toBe('a quick red fox');
    expect(rebaseLiveText('---\ntitle: A\n---\nbody\n', '---\ntitle: A\ntags: [x]\n---\nbody\n', '---\ntitle: A\n---\nbody\nmore\n')).toBe('---\ntitle: A\ntags: [x]\n---\nbody\nmore\n');
  });

  it('applies once an edit both sides made, beside edits only one made', () => {
    expect(rebaseLiveText('one\ntwo\nthree\n', 'one\nTWO\nthree\nfour\n', 'ONE\ntwo\nthree\nfour\n')).toBe('ONE\nTWO\nthree\nfour\n');
    expect(rebaseLiveText('abcdefgh', 'abgh', 'abgh!')).toBe('abgh!');
  });

  it('puts two insertions at one point in order: theirs, then mine', () => {
    expect(rebaseLiveText('ab', 'aXb', 'aYb')).toBe('aXYb');
    expect(rebaseLiveText('log\n', 'log\ntheirs\n', 'log\nmine\n')).toBe('log\ntheirs\nmine\n');
  });

  it('with an uncertain base, which may lack typing of mine theirs already holds, conflicts on two different insertions at one point instead of doubling text', () => {
    const uncertain = { uncertainBase: true };
    // The server stored part of the kept typing: merged as two insertions, the stored part would land twice.
    expect(rebaseLiveText('a b c\n', 'a b X c\n', 'a b XZ c\n')).toBe('a b X XZ c\n');
    expect(rebaseLiveText('a b c\n', 'a b X c\n', 'a b XZ c\n', undefined, uncertain)).toBeNull();
    // The session's first acknowledgement never came: the base is empty, and the whole note would land twice.
    expect(rebaseLiveText('', 'whole note\n', 'whole note\nmore\n', undefined, uncertain)).toBeNull();
    // The same insertion applies once, and edits apart still merge.
    expect(rebaseLiveText('ab', 'aXb', 'aXb', undefined, uncertain)).toBe('aXb');
    expect(rebaseLiveText('one\ntwo\n', 'ONE\ntwo\n', 'one\ntwo\nthree\n', undefined, uncertain)).toBe('ONE\ntwo\nthree\n');
  });

  it('with an uncertain base, conflicts on an insertion at the edge of a span the other side replaced instead of doubling it (cfx-F003)', () => {
    const uncertain = { uncertainBase: true };
    // The server stored X; the tab then replaced the character after it.
    expect(rebaseLiveText('a c', 'aX c', 'aXZc', undefined, uncertain)).toBeNull();
    expect(rebaseLiveText('ab', 'aXb', 'aXY', undefined, uncertain)).toBeNull();
    expect(rebaseLiveText('hello world', 'hello Xworld', 'hello XZorld', undefined, uncertain)).toBeNull();
    // At the end of the replaced span too, either side.
    expect(rebaseLiveText('abc', 'aYc', 'abXc', undefined, uncertain)).toBeNull();
    expect(rebaseLiveText('abc', 'abXc', 'aYc', undefined, uncertain)).toBeNull();
    // Apart from it, both still apply.
    expect(rebaseLiveText('abcd', 'aYcd', 'abcXd', undefined, uncertain)).toBe('aYcXd');
  });

  it('keeps an insertion at the edge of a span the other side replaced', () => {
    expect(rebaseLiveText('abcdefgh', 'abgh', 'abXcdefgh')).toBe('abXgh');
    expect(rebaseLiveText('abcdefgh', 'abgh', 'abcdefXgh')).toBe('abXgh');
    expect(rebaseLiveText('abcdefgh', 'abXcdefgh', 'abQRgh')).toBe('abXQRgh');
    expect(rebaseLiveText('abcdefgh', 'abcdefXgh', 'abQRgh')).toBe('abQRXgh');
  });

  it('answers null where the sides changed overlapping spans, or one inserted inside a span the other replaced', () => {
    expect(rebaseLiveText('abcdefgh', 'abgh', 'abcdXYgh')).toBeNull();
    expect(rebaseLiveText('abcdefgh', 'abcdXYgh', 'abgh')).toBeNull();
    expect(rebaseLiveText('abcdefgh', 'abgh', 'abcdXefgh')).toBeNull();
    expect(rebaseLiveText('abcdefgh', 'abcdXefgh', 'abgh')).toBeNull();
    expect(rebaseLiveText('one\ntwo\n', 'one\n2\n', 'one\nII\n')).toBeNull();
    expect(rebaseLiveText('one\n', '', 'one!\n')).toBeNull();
  });

  it('never parts a surrogate pair: a change beside an emoji keeps it whole, and two changes of one emoji conflict', () => {
    const merged = rebaseLiveText('a😀b', 'a😁b', 'a😀b!');
    expect(merged).toBe('a😁b!');
    expect(rebaseLiveText('😀', '😁😀', '😀😂')).toBe('😁😀😂');
    expect(rebaseLiveText('a😀b', 'a😁b', 'a😂b')).toBeNull();
    expect(rebaseLiveText('x👍🏽y', 'x👍y', 'x👍🏽y?')).toBe('x👍y?');
  });

  it('applies both sides of edits kept apart, on 300 seeded notes of unique lines', () => {
    const random = seeded(23);
    let made = 0;
    const line = () => `${(made++).toString(36)}-${random(0x7fffffff).toString(36)}\n`;
    for (let test = 0; test < 300; test++) {
      // Six blocks of four lines: theirs edits within blocks 0, 2 and 4, mine within 1, 3 and 5, and each block's first and last line stays.
      const base = Array.from({ length: 24 }, line);
      const theirs = [...base], mine = [...base], both = [...base];
      for (let block = 5; block >= 0; block--) {
        const side = block % 2 ? mine : theirs;
        const at = block * 4 + 1 + random(2);
        const edit = random(3);
        const replacement = edit === 0 ? [line(), base[at]!] : edit === 1 ? [] : [line()];
        if (random(4) === 0) continue;
        side.splice(at, 1, ...replacement);
        both.splice(at, 1, ...replacement);
      }
      expect(rebaseLiveText(base.join(''), theirs.join(''), mine.join('')), `case ${test}`).toBe(both.join(''));
    }
  });

  it('gives up as a conflict within half a second on texts no diff can align, instead of blocking', () => {
    const scrambled = (step: number) => Array.from({ length: 100_000 }, (_, i) => String.fromCharCode(97 + (i * step % 26))).join('');
    const base = scrambled(7919), theirs = scrambled(104_729);
    const mine = `${base.slice(0, 50_000)}MINE${base.slice(50_000)}`;
    const started = performance.now();
    expect(rebaseLiveText(base, theirs, mine)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });
});
