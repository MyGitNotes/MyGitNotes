/**
 * Line diffs for live notes, computed with Myers' O(ND) algorithm in linear space (E. W. Myers, "An O(ND) Difference
 * Algorithm and Its Variations", Algorithmica 1, 1986), so a note of many repeated lines, such as the blank lines between
 * paragraphs, diffs in time proportional to its length times the number of lines changed.
 */

/** The lines of a text with their line ends, so a merge keeps the final newline, or its absence, as written. */
export const textLines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** Numbers equal lines across all the given line lists alike, so a diff compares numbers instead of strings. */
export function lineIds(...texts: readonly (readonly string[])[]): Int32Array[] {
  const ids = new Map<string, number>();
  return texts.map(lines =>
    Int32Array.from(lines, line => {
      let id = ids.get(line);
      if (id === undefined) ids.set(line, id = ids.size);
      return id;
    })
  );
}

/** `length` lines of the base at `start` became `changedLength` lines of the changed text at `changedStart`. */
export interface LineHunk {
  start: number;
  length: number;
  changedStart: number;
  changedLength: number;
}

/**
 * The runs of lines that differ between `base` and `changed`, in order, from a shortest edit script. Each hunk that only
 * inserts or only deletes is moved as far down as the lines allow, as `node-diff3` placed it (a paragraph and blank line
 * inserted between two paragraphs follows the first one's blank line), and hunks left touching become one, so two hunks
 * always have a common line between them.
 */
export function lineHunks(base: Int32Array, changed: Int32Array, budget: LineDiffBudget = { left: Infinity }): LineHunk[] | undefined {
  const [keptBase, baseAt] = sharedLines(base, changed);
  const [keptChanged, changedAt] = sharedLines(changed, base);
  const filtered: number[] = [];
  if (!commonRuns(keptBase, keptChanged, 0, keptBase.length, 0, keptChanged.length, filtered, budget)) return undefined;
  const runs: number[] = [];
  for (let i = 0; i < filtered.length; i += 3) {
    for (let j = 0; j < filtered[i + 2]!; j++) {
      const a = baseAt[filtered[i]! + j]!, b = changedAt[filtered[i + 1]! + j]!;
      const last = runs.length - 3;
      if (last >= 0 && runs[last]! + runs[last + 2]! === a && runs[last + 1]! + runs[last + 2]! === b) runs[last + 2]!++;
      else runs.push(a, b, 1);
    }
  }
  const hunks: LineHunk[] = [];
  let a = 0, b = 0;
  for (let i = 0; i <= runs.length; i += 3) {
    const runA = i < runs.length ? runs[i]! : base.length;
    const runB = i < runs.length ? runs[i + 1]! : changed.length;
    if (runA > a || runB > b) hunks.push({ start: a, length: runA - a, changedStart: b, changedLength: runB - b });
    if (i < runs.length) {
      a = runA + runs[i + 2]!;
      b = runB + runs[i + 2]!;
    }
  }
  return slideDown(hunks, base, changed);
}

/**
 * The work a diff may still do, counted in diagonal steps and matched lines; a diff that runs out gives up, so a rewrite
 * of a large note of repeated lines cannot block for minutes.
 */
export interface LineDiffBudget {
  left: number;
}

/**
 * The lines of `lines` that also occur in `other`, with their indices. A line that never occurs in the other text cannot
 * be common, so dropping it before the diff keeps the same longest common lines while a rewrite with new lines becomes
 * a short diff, as xdiff does.
 */
function sharedLines(lines: Int32Array, other: Int32Array): [Int32Array, Int32Array] {
  let size = 0;
  for (const id of lines) size = Math.max(size, id + 1);
  const present = new Uint8Array(size);
  for (const id of other) if (id < size) present[id] = 1;
  const at: number[] = [];
  for (let i = 0; i < lines.length; i++) if (present[lines[i]!]) at.push(i);
  if (at.length === lines.length) return [lines, Int32Array.from(at)];
  return [Int32Array.from(at, i => lines[i]!), Int32Array.from(at)];
}

/** Moves each insert-only or delete-only hunk down past the common lines equal to its own first line. */
function slideDown(hunks: LineHunk[], base: Int32Array, changed: Int32Array): LineHunk[] {
  const out: LineHunk[] = [];
  for (let i = 0; i < hunks.length; i++) {
    const hunk = { ...hunks[i]! };
    const next = hunks[i + 1];
    const end = next ? next.start : base.length;
    if (hunk.length === 0 || hunk.changedLength === 0) {
      const lines = hunk.length === 0 ? changed : base;
      const length = hunk.length || hunk.changedLength;
      let at = hunk.length === 0 ? hunk.changedStart : hunk.start;
      while (hunk.start + hunk.length < end && lines[at] === lines[at + length]) {
        hunk.start++;
        hunk.changedStart++;
        at++;
      }
      if (next && hunk.start + hunk.length === end) {
        hunks[i + 1] = { start: hunk.start, length: hunk.length + next.length, changedStart: hunk.changedStart, changedLength: hunk.changedLength + next.changedLength };
        continue;
      }
    }
    out.push(hunk);
  }
  return out;
}

/**
 * Appends `[baseStart, changedStart, length]` for each run of common lines in the given ranges, in order; false when the
 * budget ran out.
 */
function commonRuns(a: Int32Array, b: Int32Array, aLo: number, aHi: number, bLo: number, bHi: number, runs: number[], budget: LineDiffBudget): boolean {
  let prefix = 0;
  while (aLo + prefix < aHi && bLo + prefix < bHi && a[aLo + prefix] === b[bLo + prefix]) prefix++;
  if (prefix) runs.push(aLo, bLo, prefix);
  aLo += prefix;
  bLo += prefix;
  let suffix = 0;
  while (aHi - suffix > aLo && bHi - suffix > bLo && a[aHi - suffix - 1] === b[bHi - suffix - 1]) suffix++;
  aHi -= suffix;
  bHi -= suffix;
  if (aLo < aHi && bLo < bHi) {
    const split = middleSnake(a, b, aLo, aHi, bLo, bHi, budget);
    if (split === null) return false;
    if (split) {
      if (!commonRuns(a, b, aLo, split[0], bLo, split[1], runs, budget)) return false;
      if (!commonRuns(a, b, split[0], aHi, split[1], bHi, runs, budget)) return false;
    }
  }
  if (suffix) runs.push(aHi, bHi, suffix);
  return true;
}

/**
 * Where a shortest edit script of `a[aLo, aHi)` into `b[bLo, bHi)` crosses its middle, found by running the forward and
 * the reverse search until they overlap; undefined when the ranges have no line in common, null when the budget ran out.
 * The ranges are non-empty and share no first or last line.
 */
function middleSnake(a: Int32Array, b: Int32Array, aLo: number, aHi: number, bLo: number, bHi: number, budget: LineDiffBudget): [number, number] | undefined | null {
  const n = aHi - aLo, m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const offset = maxD + 1;
  const size = 2 * maxD + 3;
  const forward = new Int32Array(size).fill(-1);
  const reverse = new Int32Array(size).fill(-1);
  forward[offset + 1] = 0;
  reverse[offset + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1start = 0, k1end = 0, k2start = 0, k2end = 0;
  for (let d = 0; d < maxD; d++) {
    // Each round walks at most 2d + 2 diagonals, and its snakes cover at most n + m lines.
    budget.left -= 2 * d + 2 + n + m;
    if (budget.left < 0) return null;
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const at = offset + k1;
      let x1 = k1 === -d || (k1 !== d && forward[at - 1]! < forward[at + 1]!) ? forward[at + 1]! : forward[at - 1]! + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1++;
        y1++;
      }
      forward[at] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const other = offset + delta - k1;
        if (other >= 0 && other < size && reverse[other] !== -1 && x1 >= n - reverse[other]!) return [aLo + x1, bLo + y1];
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const at = offset + k2;
      let x2 = k2 === -d || (k2 !== d && reverse[at - 1]! < reverse[at + 1]!) ? reverse[at + 1]! : reverse[at - 1]! + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) {
        x2++;
        y2++;
      }
      reverse[at] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const other = offset + delta - k2;
        if (other >= 0 && other < size && forward[other] !== -1) {
          const x1 = forward[other]!;
          if (x1 >= n - x2) return [aLo + x1, bLo + x1 - (other - offset)];
        }
      }
    }
  }
  return undefined;
}
