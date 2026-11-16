import { useCallback, useMemo, useSyncExternalStore } from 'react';
import YAML from 'yaml';
import type * as Y from 'yjs';
import type { NoteMetadata } from '@mygitnotes/core';
import { noteFrontmatterSpan, patchNoteFrontmatter } from '@mygitnotes/core/frontmatter';

/** Frontmatter longer than this is not looked for: a note's metadata is a few lines. */
export const MAX_FRONTMATTER = 64 * 1024;

/**
 * The transaction origin of a metadata write from the panel: not the editor's (y-codemirror's) origin, so the collab
 * editor's Ctrl+Z does not undo it, as the direct editor's history holds only the body.
 */
export const LIVE_FRONTMATTER_ORIGIN = Symbol('live-frontmatter');

/** The live note's frontmatter as the collab editor and its panel read it. */
export interface LiveFrontmatter {
  /** False when a block is there but its YAML does not parse to a map: the editor shows it raw and the panel writes nothing. */
  valid: boolean;
  metadata: NoteMetadata;
  /** The block's YAML as written, comments included; '' without a block. */
  yaml: string;
  /** Where the body starts: the editor hides `[0, bodyStart)`; 0 without a block or with an invalid one. */
  bodyStart: number;
  /** Lines before the body, so body line N is file line N + lineOffset. */
  lineOffset: number;
  /** The parse error of an invalid block. */
  error?: string;
}

const NONE: LiveFrontmatter = { valid: true, metadata: {}, yaml: '', bodyStart: 0, lineOffset: 0 };

/** Reads a live text's leading frontmatter with core's own split, so the editor, the panel and the server agree. */
export function readLiveFrontmatter(text: string): LiveFrontmatter {
  const span = noteFrontmatterSpan(text.length > MAX_FRONTMATTER ? text.slice(0, MAX_FRONTMATTER) : text);
  if (!span) return NONE;
  if ('invalid' in span) {
    let error: string | undefined;
    try {
      const parsed: unknown = YAML.parse(span.yaml);
      error = parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ? 'not a map' : undefined;
    } catch (failure) {
      error = (failure as Error).message;
    }
    return { valid: false, metadata: {}, yaml: span.yaml, bodyStart: 0, lineOffset: 0, ...(error ? { error } : {}) };
  }
  return { valid: true, metadata: span.metadata, yaml: span.yaml, bodyStart: span.bodyStart, lineOffset: (text.slice(0, span.bodyStart).match(/\n/g) ?? []).length };
}

/** Replaces `text` by `next` as one insertion and one deletion between their common prefix and suffix, in one transaction. */
export function replaceLiveText(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;
  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && current[start] === next[start]) start++;
  let tail = 0;
  while (tail < shortest - start && current[current.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const run = () => {
    const removed = current.length - start - tail;
    if (removed > 0) text.delete(start, removed);
    const inserted = next.slice(start, next.length - tail);
    if (inserted) text.insert(start, inserted);
  };
  if (text.doc) text.doc.transact(run, LIVE_FRONTMATTER_ORIGIN);
  else run();
}

/**
 * Writes the keys that differ between `shown` (what the control showed) and `next` into the live text's current
 * frontmatter, key by key; another person's change to any other key stays. False while the block does not parse.
 */
export function writeLiveFrontmatter(text: Y.Text, shown: NoteMetadata, next: NoteMetadata): boolean {
  const current = text.toString();
  if (!readLiveFrontmatter(current).valid) return false;
  replaceLiveText(text, patchNoteFrontmatter(current, shown, next));
  return true;
}

/** Writes the YAML tab's text as the note's frontmatter, only when it parses to a map; an invalid block is replaced. */
export function writeLiveYaml(text: Y.Text, yaml: string): { ok: true; } | { ok: false; error: string; } {
  try {
    const parsed: unknown = YAML.parse(yaml);
    if (parsed !== null && parsed !== undefined && (typeof parsed !== 'object' || Array.isArray(parsed))) return { ok: false, error: 'not a map' };
  } catch (failure) {
    return { ok: false, error: (failure as Error).message };
  }
  const current = text.toString();
  const span = noteFrontmatterSpan(current.length > MAX_FRONTMATTER ? current.slice(0, MAX_FRONTMATTER) : current);
  const block = yaml.trimEnd();
  const newline = span && current.slice(0, span.end).includes('\r\n') ? '\r\n' : '\n';
  const fenced = `---${newline}${block.replace(/\r?\n/g, newline)}${newline}---${newline}`;
  if (!span) replaceLiveText(text, current ? `${fenced}\n${current}` : fenced);
  else replaceLiveText(text, fenced + current.slice(span.end));
  return { ok: true };
}

/** The live text of a collab session and its frontmatter, following every change of the `Y.Text`. */
export function useLiveText(text: Y.Text | null): { text: string; frontmatter: LiveFrontmatter; } {
  const subscribe = useCallback((changed: () => void) => {
    if (!text) return () => {};
    text.observe(changed);
    return () => text.unobserve(changed);
  }, [text]);
  const value = useSyncExternalStore(subscribe, () => text?.toString() ?? '');
  // Parsed again only when the leading block's text changed, not on every keystroke in the body.
  const head = useMemo(() => leadingBlock(value), [value]);
  const frontmatter = useMemo(() => readLiveFrontmatter(head), [head]);
  return { text: value, frontmatter };
}

/** The text up to and including the separator after the frontmatter's closing fence: what the frontmatter reads. */
function leadingBlock(text: string): string {
  if (!text.startsWith('---')) return '';
  const close = text.slice(0, MAX_FRONTMATTER).search(/\r?\n---\r?\n/);
  if (close < 0) return text.slice(0, MAX_FRONTMATTER);
  const after = text.indexOf('\n', close + 1);
  const fenceEnd = text.indexOf('\n', after + 1) + 1 || text.length;
  const separator = text.slice(fenceEnd).match(/^[ \t]*\r?\n/)?.[0] ?? '';
  return text.slice(0, fenceEnd + separator.length);
}
