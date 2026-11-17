import { parseNoteFile } from '@mygitnotes/core/note-file';
import type { NoteItem } from './types.js';

/**
 * The list fields of a staged note, derived from what it stages rather than copied from the note it started as: its
 * status, tags and title from its metadata, and the unreadable-frontmatter mark from its text. A save with metadata writes
 * a block that reads, so only a note staged without any keeps a broken block in its body.
 */
export function stagedNoteFields(note: NoteItem): NoteItem {
  const { frontmatterInvalid: _previous, ...rest } = note;
  const unreadable = Object.keys(note.metadata).length === 0 && parseNoteFile(note.content, note.path).extra.frontmatterInvalid;
  return {
    ...rest,
    status: typeof note.metadata.status === 'string' ? note.metadata.status : undefined,
    tags: Array.isArray(note.metadata.tags) ? note.metadata.tags.map(String) : [],
    title: typeof note.metadata.title === 'string' && note.metadata.title ? note.metadata.title : note.content.match(/^#\s+(.+)$/m)?.[1] || note.title,
    ...(unreadable ? { frontmatterInvalid: true as const } : {}),
  };
}
