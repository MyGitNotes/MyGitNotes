import { type LineHunk, lineHunks, lineIds, textLines } from './live-text.js';

/** A three-way merge of a live note: the merged text, or a conflict the live text wins. */
export type LiveMerge = { conflict: false; text: string; } | { conflict: true; };

/** A hunk of one side: 0 for the live text, 1 for Git. */
type SideHunk = LineHunk & { side: 0 | 1; };

/**
 * Merges the Git changes since `base` into the `live` text, line by line over the whole file, frontmatter included
 * (docs/specs/2026-11-15-live-notes/spec.md §5.3). Hunks of the two sides that overlap or touch form one region, which is
 * a conflict unless both sides turned it into the same lines; so both sides making the same change is no conflict, and a
 * check-in whose commit landed but was never acknowledged merges cleanly with the Git text that holds it. Every text is
 * in normal form. The line diffs are Myers' (`live-text.ts`), linear in the note's length for a few changed lines.
 */
export function mergeLiveText(base: string, live: string, git: string): LiveMerge {
  const lines = [textLines(live), textLines(base), textLines(git)] as const;
  const [liveIds, baseIds, gitIds] = lineIds(...lines);
  const sides = [lines[0], lines[2]] as const;
  const hunks = sortedHunks(lineHunks(baseIds!, liveIds!), lineHunks(baseIds!, gitIds!));
  const out: string[] = [];
  let at = 0;
  for (let i = 0; i < hunks.length;) {
    const first = hunks[i++]!;
    const regionStart = first.start;
    let regionEnd = first.start + first.length;
    const region = [first];
    while (i < hunks.length && hunks[i]!.start <= regionEnd) {
      const next = hunks[i++]!;
      regionEnd = Math.max(regionEnd, next.start + next.length);
      region.push(next);
    }
    for (let line = at; line < regionStart; line++) out.push(lines[1][line]!);
    at = regionEnd;
    if (region.length === 1) {
      for (let line = first.changedStart; line < first.changedStart + first.changedLength; line++) out.push(sides[first.side][line]!);
      continue;
    }
    const [mine, theirs] = [0, 1].map(side => regionLines(region, side as 0 | 1, regionStart, regionEnd, sides[side]!, lines[1]));
    if (mine!.length !== theirs!.length || mine!.some((line, index) => line !== theirs![index])) return { conflict: true };
    for (const line of mine!) out.push(line);
  }
  for (let line = at; line < lines[1].length; line++) out.push(lines[1][line]!);
  return { conflict: false, text: out.join('') };
}

/** Both sides' hunks by base position, the live side's first where they start at the same line. */
function sortedHunks(live: LineHunk[], git: LineHunk[]): SideHunk[] {
  const out: SideHunk[] = [];
  let i = 0, j = 0;
  while (i < live.length || j < git.length) {
    if (j >= git.length || (i < live.length && live[i]!.start <= git[j]!.start)) out.push({ ...live[i++]!, side: 0 });
    else out.push({ ...git[j++]!, side: 1 });
  }
  return out;
}

/** The lines one side holds for the base region `[regionStart, regionEnd)`, from that side's hunks in it. */
function regionLines(region: SideHunk[], side: 0 | 1, regionStart: number, regionEnd: number, lines: readonly string[], base: readonly string[]): string[] {
  let changedStart = Infinity, changedEnd = -Infinity, baseStart = Infinity, baseEnd = -Infinity;
  for (const hunk of region) {
    if (hunk.side !== side) continue;
    changedStart = Math.min(changedStart, hunk.changedStart);
    changedEnd = Math.max(changedEnd, hunk.changedStart + hunk.changedLength);
    baseStart = Math.min(baseStart, hunk.start);
    baseEnd = Math.max(baseEnd, hunk.start + hunk.length);
  }
  // Hunks of one side never touch, so a region of several hunks holds both sides; an untouched side keeps the base lines.
  if (changedStart === Infinity) return base.slice(regionStart, regionEnd);
  return lines.slice(changedStart + regionStart - baseStart, changedEnd + regionEnd - baseEnd);
}
