import { applyCompilationMetadata, CompilationError, compilationFields, isCompilationPath, replaceCompilationTags } from './compilation.js';
import { noteFrontmatterSpan, parseNoteContent, replaceNoteTags, serializeNoteContent } from './frontmatter.js';
import { isOutlinePath, OUTLINE_SUFFIX } from './outline.js';
import type { NoteMetadata } from './types.js';

/** Extensions of Markdown and plain-text notes. */
export const NOTE_EXTENSIONS = /\.(md|markdown|mdx|txt)$/i;
/** A file the note pipelines read, list, save and commit: a note or a compilation. */
export const isNoteFile = (file: string) => NOTE_EXTENSIONS.test(file) || isCompilationPath(file);

export interface ParsedNoteFile {
  metadata: NoteMetadata;
  content: string;
  title: string;
  lineNumberOffset: number;
  /**
   * Specialized kind, leaving an ordinary note's shape unchanged, and `frontmatterInvalid` on a note that opens a
   * frontmatter block which does not parse to a map, or is never closed and looks like YAML (`noteFrontmatterSpan`): its
   * body then holds the block, and it has no status or tags.
   */
  extra: { kind?: 'compilation' | 'outline'; invalid?: string; frontmatterInvalid?: true; };
}

/**
 * Splits a stored file into the fields the note pipelines carry. A note is Markdown with
 * frontmatter; a compilation keeps its whole YAML as content, with a bounded summary as metadata.
 * `scope`, the roots of every notebook in the repository, lets a compilation report a folder source in none of them as invalid.
 */
export function parseNoteFile(raw: string, filePath: string, scope?: readonly string[]): ParsedNoteFile {
  const name = filePath.split('/').pop() ?? filePath;
  if (!isCompilationPath(filePath)) {
    const outline = isOutlinePath(filePath);
    const fallback = outline ? name.slice(0, -OUTLINE_SUFFIX.length) + '.md' : name;
    const { metadata, content, title, lineNumberOffset, hasFrontmatter } = parseNoteContent(raw, fallback);
    // A block that parsed needs no second read; only one that did not is told from a note without any.
    const span = !hasFrontmatter && raw.startsWith('---') ? noteFrontmatterSpan(raw) : null;
    const unreadable = span !== null && 'invalid' in span;
    return { metadata, content, title, lineNumberOffset, extra: { ...(outline ? { kind: 'outline' as const } : {}), ...(unreadable ? { frontmatterInvalid: true as const } : {}) } };
  }
  const fields = compilationFields(raw, filePath, scope);
  return { metadata: fields.metadata, content: raw, title: fields.title, lineNumberOffset: 0, extra: { kind: 'compilation', ...(fields.invalid ? { invalid: fields.invalid } : {}) } };
}

/** A compilation write, its refusal naming the file. */
function compilationWrite(filePath: string, write: () => string): string {
  try {
    return write();
  } catch (error) {
    throw error instanceof CompilationError ? new CompilationError(`${filePath}: ${error.message}`) : error;
  }
}

/**
 * The stored form of a save: a note's frontmatter and body, or a compilation's YAML carrying the caller's tags and
 * status, refused with a `CompilationError` naming the file when that YAML would not open (`applyCompilationMetadata`).
 */
export function serializeNoteFile(filePath: string, metadata: NoteMetadata, content: string, isNew: boolean, now: Date, existingRaw?: string): string {
  if (isCompilationPath(filePath)) return compilationWrite(filePath, () => applyCompilationMetadata(content, metadata));
  return serializeNoteContent(metadata, content, isNew, now, existingRaw, isOutlinePath(filePath));
}

/**
 * The metadata a save that names only some frontmatter keys writes over an existing note: its current frontmatter with
 * the given keys replaced, so keys the caller left out are kept. A new note, a note without frontmatter and a compilation,
 * whose content carries its own fields, take the given metadata as it is.
 */
export function keptNoteMetadata(filePath: string, existingRaw: string | undefined, given: NoteMetadata | undefined): NoteMetadata | undefined {
  if (existingRaw === undefined || isCompilationPath(filePath)) return given;
  const { metadata } = parseNoteFile(existingRaw, filePath);
  return Object.keys(metadata).length ? { ...metadata, ...given } : given;
}

/**
 * Replaces only the tags of a stored file: a compilation's `tags` key, or a note's frontmatter `tags`; every other field
 * stays as it is. A compilation whose YAML would not open is refused with a `CompilationError` naming the file.
 */
export function replaceFileTags(raw: string, filePath: string, tags: string[]): string {
  if (!isCompilationPath(filePath)) return replaceNoteTags(raw, tags);
  return compilationWrite(filePath, () => replaceCompilationTags(raw, tags));
}
