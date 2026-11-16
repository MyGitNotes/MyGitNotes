import { serializeNoteFile } from '@mygitnotes/core/note-file';
import { createLiveNote, isMergeConflict, type LiveCheckoutView, mergeLive } from './live-api.js';
import type { NoteItem } from './types.js';
import type { WorkingNote } from './working-notes.js';

/*
 * Offline handover, draft → live (docs/specs/2026-11-16-collab-first-self-host A3.2): once the browser is back online,
 * a draft the direct editor made of a covered note is merged into the live note, on the text it was made from, through
 * `/api/live/merge`. A note made offline is created pending with its title alone and its text then merged in as an
 * edit: created with the text as its body, a check-in would take the untouched body for an empty draft and discard it.
 */

/** The `blocked` reason of a draft whose merge into the live note conflicted: it stays until the person picks what to keep. */
export const LIVE_MERGE_CONFLICT = 'live-merge-conflict';

/** What handing a draft over to the live note did. */
export type LiveHandover = { kind: 'applied'; } | { kind: 'created'; checkout: LiveCheckoutView; } | { kind: 'conflict'; } | { kind: 'failed'; error: unknown; };

/** A note's file text as the live editor holds it, its frontmatter written as a save writes it at `stamp`. */
const fileText = (note: NoteItem, stamp: Date) => serializeNoteFile(note.path, note.metadata, note.content, false, stamp);

/** A note's file text as a read gives it, its frontmatter written as it was last saved: what a conflict draft is compared with. */
export const noteFileText = (note: NoteItem) => {
  const updated = new Date(String(note.metadata.updated ?? ''));
  return fileText(note, Number.isNaN(updated.getTime()) ? new Date() : updated);
};

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** The merge id of one draft: the same for the same draft, so that a retried merge never applies it twice. */
async function draftMergeId(scope: string, note: NoteItem): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([scope, note.notebookId, note.path, note.metadata, note.content]));
  return hex(await crypto.subtle.digest('SHA-256', data));
}

/** The pending note made for a draft whose merge has not landed yet, by scope, notebook and path: a retry merges into it. */
const created = new Map<string, LiveCheckoutView>();

const titleOf = (note: NoteItem) => note.title?.trim() || (typeof note.metadata.title === 'string' ? note.metadata.title.trim() : '') || note.path.slice(note.path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '');

/** Merges a draft of a covered note into its live note, or files a new note made offline as a pending live note. */
export async function handOverDraft(entry: WorkingNote, { scope, notebookRoot }: { scope: string; notebookRoot: string; }): Promise<LiveHandover> {
  const { note, base } = entry;
  const now = new Date();
  try {
    const mergeId = await draftMergeId(scope, note);
    if (base) {
      // Both sides are written at one stamp, so the person's own change is all that differs between them.
      await mergeLive({ notebookId: note.notebookId, path: note.path, base: fileText(base, now), text: fileText(note, now), mergeId });
      return { kind: 'applied' };
    }
    const key = `${scope}\n${note.notebookId}\n${note.path}`;
    const title = titleOf(note);
    const skeleton = `---\ntitle: ${JSON.stringify(title)}\n---\n`;
    let checkout = created.get(key);
    if (!checkout) {
      const root = notebookRoot.replace(/\/$/, '');
      const directory = note.path.slice(0, note.path.lastIndexOf('/'));
      const folder = directory === root ? '' : directory.startsWith(`${root}/`) ? directory.slice(root.length + 1) : '';
      checkout = (await createLiveNote({ notebookId: note.notebookId, folder, title, content: skeleton })).checkout;
      created.set(key, checkout);
    }
    await mergeLive({ notebookId: note.notebookId, path: checkout.path, base: skeleton, text: serializeNoteFile(note.path, note.metadata, note.content, true, now), mergeId });
    created.delete(key);
    return { kind: 'created', checkout };
  } catch (error) {
    return isMergeConflict(error) ? { kind: 'conflict' } : { kind: 'failed', error };
  }
}
