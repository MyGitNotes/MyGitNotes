import { describe, expect, it } from 'vitest';
import { lineHunks } from '../src/live-text.js';

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
