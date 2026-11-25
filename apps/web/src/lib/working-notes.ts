import type { NoteItem } from './types.js';
import { sameValue } from './merge-note.js';
import { createUnifiedDiff } from './unified-diff.js';
import { isBareNotebookId } from '@mygitnotes/core/notebook-key';
import { stringifyFrontmatterYaml } from '@mygitnotes/core/frontmatter';
import { isNotebookKey, notebookIdCodec } from './notebook-keys.js';
import { demoExpired, noteDemoWrite } from './demo-storage.js';

export interface WorkingNote {
  note: NoteItem;
  base: NoteItem | null;
  blocked?: string;
  /** The note is deleted: `base` is the committed note it removes, kept for its diff and for the trash's Restore. */
  deleted?: true;
}
export type WorkingNotes = Record<string, WorkingNote>;

/**
 * The `blocked` reason of a draft whose merge into the live note conflicted (collab-first A3.1): it stays until the person
 * picks what to keep, and nothing is staged over it meanwhile (cf16-F002).
 */
export const LIVE_MERGE_CONFLICT = 'live-merge-conflict';
/** The `blocked` reasons a commit from Changes stages, in its own words: the note is gone from where it was, or the remote conflicts. */
export const COMMIT_MOVED_OR_DELETED = 'Moved or deleted remotely. Open the note and refresh after it is restored.';
export const COMMIT_CONFLICT = 'Remote changes conflict with this draft. Open the note and Refresh remote version.';
const prefix = 'gh_notes_working:';
export const workingNotesKey = (scope: string) => prefix + scope;

/** Where one repository's working changes are stored, and the alias that names its notebooks by key. */
export interface DraftStore {
  scope: string;
  alias: string;
}

/** The working changes as this browser stores them: their notes carry the repository's local notebook ids. */
export function readStoredWorkingNotes(scope: string): WorkingNotes {
  const raw = localStorage.getItem(workingNotesKey(scope));
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Local working changes could not be read. Keep browser data for recovery.');
  return value;
}

const named = (note: unknown) => Boolean(note && typeof note === 'object' && isBareNotebookId(String((note as NoteItem).notebookId)));

/**
 * A stored working change with its notebook named by key. One whose notebook ids cannot be read is returned as stored:
 * it stays in storage and in Changes for recovery, and is never dropped.
 */
export function keyedWorkingNote(entry: WorkingNote, alias: string): WorkingNote {
  if (!named(entry?.note) || entry.base && !named(entry.base)) return entry;
  const { toKey } = notebookIdCodec(alias);
  return { ...entry, note: { ...entry.note, notebookId: toKey(entry.note.notebookId) }, base: entry.base ? { ...entry.base, notebookId: toKey(entry.base.notebookId) } : entry.base };
}

/** A working change as it is stored, with the repository's local notebook ids; one kept as stored stays so. */
export function storedWorkingNote(entry: WorkingNote, alias: string): WorkingNote {
  if (!isNotebookKey(String(entry.note?.notebookId))) return entry;
  const { toLocal } = notebookIdCodec(alias);
  return { ...entry, note: { ...entry.note, notebookId: toLocal(entry.note.notebookId) }, base: entry.base ? { ...entry.base, notebookId: toLocal(entry.base.notebookId) } : entry.base };
}

const keyedEntries = (entries: WorkingNotes, alias: string): WorkingNotes => Object.fromEntries(Object.entries(entries).map(([path, entry]) => [path, keyedWorkingNote(entry, alias)]));

/** One repository's working changes, their notebooks named by key. */
export function readWorkingNotes(store: DraftStore): WorkingNotes {
  return keyedEntries(readStoredWorkingNotes(store.scope), store.alias);
}

/**
 * Persist before announcing success; quota errors leave the in-memory draft visible. A draft that holds nothing but its
 * base is dropped, a blocked one too: a conflict or a note gone remotely leaves nothing of the person's to keep then.
 */
export function updateWorkingNote(store: DraftStore, path: string, entry: WorkingNote | null): WorkingNotes {
  if (entry?.base && !entry.deleted && sameValue(entry.note.content, entry.base.content) && sameValue(entry.note.metadata, entry.base.metadata)) entry = null;
  // A demo scope past its 24 hours is cleared and nothing is written over it, or its changes would come back without a clock.
  if (entry ? !noteDemoWrite(store.scope) : demoExpired(store.scope)) return keyedEntries(readStoredWorkingNotes(store.scope), store.alias);
  const entries = readStoredWorkingNotes(store.scope);
  if (entry) entries[path] = storedWorkingNote(entry, store.alias);
  else delete entries[path];
  localStorage.setItem(workingNotesKey(store.scope), JSON.stringify(entries));
  return keyedEntries(entries, store.alias);
}

/**
 * Drops the draft at `path` only while storage still holds `shown`, the version the person was shown and confirmed (or
 * that was just found to hold nothing but its base): one another tab wrote since stays. The entries come back as stored.
 *
 * Browsers apply another tab's localStorage writes between tasks, so this read, compare and write, done in one task with
 * no await or callback between them, is a compare-and-swap no other tab can interleave. It reads storage once: a second
 * read before the delete would decide on one value and delete another.
 */
export function discardShownWorkingNote(store: DraftStore, path: string, shown: WorkingNote): { entries: WorkingNotes; dropped: boolean; } {
  // An expired demo scope is cleared by demoExpired, and nothing is written over it.
  const expired = demoExpired(store.scope);
  const entries = readStoredWorkingNotes(store.scope);
  const stored = entries[path];
  if (expired || !stored || !sameValue(keyedWorkingNote(stored, store.alias), shown)) return { entries: keyedEntries(entries, store.alias), dropped: false };
  delete entries[path];
  localStorage.setItem(workingNotesKey(store.scope), JSON.stringify(entries));
  return { entries: keyedEntries(entries, store.alias), dropped: true };
}

/** Clear only the committed version, preserving any edit made during the request. */
export function clearCommittedNotes(store: DraftStore, sent: WorkingNotes): WorkingNotes {
  const entries = readStoredWorkingNotes(store.scope);
  for (const [path, entry] of Object.entries(sent)) if (entries[path] && sameValue(keyedWorkingNote(entries[path], store.alias), entry)) delete entries[path];
  localStorage.setItem(workingNotesKey(store.scope), JSON.stringify(entries));
  return keyedEntries(entries, store.alias);
}

/** The drafts as a diff; frontmatter is written as a commit writes it, a key without a stored style quoted as there (YQR-F002). */
export function workingDiff(entries: WorkingNotes): string {
  const raw = (note: NoteItem) => `---\n${stringifyFrontmatterYaml(note.metadata)}---\n${note.content}`;
  return Object.values(entries).map(({ note, base, deleted }) => createUnifiedDiff(note.path, note.path, base ? raw(base) : null, deleted ? null : raw(note))).filter(Boolean).join('\n');
}

/** A working change that deletes the committed note `base`. */
export const deletionEntry = (base: NoteItem): WorkingNote => ({ note: base, base, deleted: true });
