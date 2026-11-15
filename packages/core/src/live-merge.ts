import { diff3Merge } from 'node-diff3';

/** A three-way merge of a live note: the merged text, or a conflict the live text wins. */
export type LiveMerge = { conflict: false; text: string; } | { conflict: true; };

/** The lines of a text with their line ends, so a merge keeps the final newline, or its absence, as written. */
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * Merges the Git changes since `base` into the `live` text, line by line over the whole file, frontmatter included
 * (docs/specs/2026-11-15-live-notes/spec.md §5.3). Both sides making the same change is no conflict, so a check-in
 * whose commit landed but was never acknowledged merges cleanly with the Git text that holds it. Every text is in
 * normal form.
 */
export function mergeLiveText(base: string, live: string, git: string): LiveMerge {
  const blocks = diff3Merge(lines(live), lines(base), lines(git), { excludeFalseConflicts: true });
  if (blocks.some(block => block.conflict)) return { conflict: true };
  return { conflict: false, text: blocks.flatMap(block => block.ok ?? []).join('') };
}
