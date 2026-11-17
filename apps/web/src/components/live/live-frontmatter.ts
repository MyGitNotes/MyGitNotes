import { useCallback, useMemo, useSyncExternalStore } from 'react';
import YAML from 'yaml';
import type * as Y from 'yjs';
import type { NoteMetadata } from '@mygitnotes/core';
import { noteFrontmatterSpan, patchNoteFrontmatter } from '@mygitnotes/core/frontmatter';
import { FRONTMATTER_REGEX } from '@mygitnotes/core/frontmatter-patch';

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
    if (span.unclosed !== undefined) return { valid: false, metadata: {}, yaml: span.yaml, bodyStart: 0, lineOffset: 0, error: unclosedError(span.unclosed) };
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

/** Why a block opened by `---` is not closed, in the words of a YAML parser's error. */
const unclosedError = (line: string) => line ? `"${line}" does not close the frontmatter: nothing may follow "---" on its line.` : 'The frontmatter has no closing "---" line.';

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

/**
 * Names a pending live note `title`, as a rename retitles a file (core `retitle`): its frontmatter title, and the first
 * heading where it repeats the `previous` title, or names the note for want of a frontmatter title. Only the heading's
 * own line is rewritten, so typing elsewhere in the body stays; both writes are one transaction. False while the block
 * does not parse.
 */
export function writeLiveTitle(text: Y.Text, shown: NoteMetadata, title: string, previous: string): boolean {
  let written = false;
  const run = () => {
    if (!writeLiveFrontmatter(text, shown, { ...shown, title })) return;
    written = true;
    const current = text.toString();
    const { bodyStart } = readLiveFrontmatter(current);
    const heading = /^#[ \t]+([^\r\n]+)/m.exec(current.slice(bodyStart));
    if (!heading || typeof shown.title === 'string' && heading[1].trim() !== previous.trim()) return;
    const line = `# ${title}`;
    if (heading[0] === line) return;
    text.delete(bodyStart + heading.index, heading[0].length);
    text.insert(bodyStart + heading.index, line);
  };
  if (text.doc) text.doc.transact(run, LIVE_FRONTMATTER_ORIGIN);
  else run();
  return written;
}

/** The map a YAML text holds: `{}` for an empty text, null for one that does not parse to a map. */
function yamlMap(yaml: string): NoteMetadata | null {
  try {
    const parsed: unknown = YAML.parse(yaml);
    if (parsed === null || parsed === undefined) return yaml.trim() ? null : {};
    return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as NoteMetadata : null;
  } catch {
    return null;
  }
}

/** The same YAML text, whatever its line endings and trailing blank lines. */
const sameYaml = (a: string, b: string) => a.replace(/\r\n/g, '\n').trimEnd() === b.replace(/\r\n/g, '\n').trimEnd();

/**
 * Writes the YAML view's text as the note's frontmatter, only when it parses to a map. `shown` is the text the view last
 * wrote or opened on; without it the text is written whole. While the live block is still that text, the new text is
 * written as typed, comments and order included; once someone else changed the block since, only the keys this edit
 * changed are patched into the current text (CFR-F002), so their change stays. A block left with no key is taken out, separator line included, instead of being
 * written empty, which would not parse (CFR-F003). An invalid block is replaced by the text, through the line that
 * should have closed it when no fence did; a new block takes the body's line endings (CFR-F005). Where the block the
 * view was made over is gone, the new block holds only the keys this edit changed, so the removal stays for the rest.
 */
export function writeLiveYaml(text: Y.Text, yaml: string, shown?: string): { ok: true; } | { ok: false; error: string; } {
  const next = yamlMap(yaml);
  if (!next) {
    try {
      YAML.parse(yaml);
    } catch (failure) {
      return { ok: false, error: (failure as Error).message };
    }
    return { ok: false, error: 'not a map' };
  }
  const empty = Object.keys(next).length === 0;
  const current = text.toString();
  const span = noteFrontmatterSpan(current.length > MAX_FRONTMATTER ? current.slice(0, MAX_FRONTMATTER) : current);
  const newline = (span ? current.slice(0, span.end) : current).includes('\r\n') ? '\r\n' : '\n';
  // Only the line endings after the last line go: its trailing spaces are part of what the person wrote.
  let last = yaml.length;
  while (last > 0 && (yaml[last - 1] === '\n' || yaml[last - 1] === '\r')) last--;
  const fenced = `---${newline}${yaml.slice(0, last).replace(/\r?\n/g, newline)}${newline}---${newline}`;
  if (!span) {
    const before = shown === undefined ? null : yamlMap(shown);
    if (before && Object.keys(before).length) {
      const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value)));
      replaceLiveText(text, patchNoteFrontmatter(current, {}, changed));
      return { ok: true };
    }
    if (!empty) replaceLiveText(text, current ? `${fenced}${newline}${current}` : fenced);
    return { ok: true };
  }
  if ('invalid' in span || shown === undefined || sameYaml(span.yaml, shown)) {
    replaceLiveText(text, empty ? current.slice(span.bodyStart) : fenced + current.slice(span.end));
    return { ok: true };
  }
  const patched = patchNoteFrontmatter(current, yamlMap(shown) ?? {}, next);
  const left = noteFrontmatterSpan(patched);
  replaceLiveText(text, left && !('invalid' in left) && Object.keys(left.metadata).length === 0 ? patched.slice(left.bodyStart) : patched);
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

/**
 * The text up to and including the separator after the frontmatter's closing fence, with core's fence: what the
 * frontmatter reads. A block no fence closes runs through the line that should have closed it, or to the end.
 */
function leadingBlock(text: string): string {
  if (!text.startsWith('---')) return '';
  const head = text.slice(0, MAX_FRONTMATTER);
  const fence = FRONTMATTER_REGEX.exec(head);
  if (!fence) return head.slice(0, noteFrontmatterSpan(head)?.bodyStart ?? 0);
  const separator = text.slice(fence[0].length).match(/^[ \t]*\r?\n/)?.[0] ?? '';
  return text.slice(0, fence[0].length + separator.length);
}
