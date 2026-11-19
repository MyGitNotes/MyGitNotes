/** A note by notebook and repository-relative path, as the page names it. */
export interface ScopedNote {
  notebookId: string;
  path: string;
}

/**
 * The notes the agent may change when a tool call arrives: the note open in the editor, and the notes the person has
 * kept editable. A path counts only when it is the same note; it is never matched by case, folder or prefix.
 */
export interface WriteScope {
  /** The note open in the editor (the most recent editor or pane); null when none is. */
  open: ScopedNote | null;
  /** Notes the person allowed beyond the open one. */
  allowed: readonly ScopedNote[];
}

/** The scope in force when no page state reaches the guard: no note may change. */
export const NO_WRITE_SCOPE: WriteScope = { open: null, allowed: [] };

/** A note's identity in a set: the notebook tells repositories with the same path apart. */
export const scopedNoteKey = (note: ScopedNote) => `${note.notebookId}\0${note.path}`;

/** The notes in scope, the open one first, without repeats. */
export function scopeNotes(scope: WriteScope): ScopedNote[] {
  const seen = new Set<string>();
  return [...scope.open ? [scope.open] : [], ...scope.allowed].filter(note => {
    const key = scopedNoteKey(note);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const inWriteScope = (scope: WriteScope, note: ScopedNote) => scopeNotes(scope).some(candidate => candidate.notebookId === note.notebookId && candidate.path === note.path);

/**
 * Throws the refusal for a change to `note` outside `scope`. The message is the agent's to read: it names what may
 * change and sends the change back to the person as text.
 */
export function assertInWriteScope(scope: WriteScope, note: ScopedNote) {
  if (inWriteScope(scope, note)) return;
  const allowed = scopeNotes(scope).map(candidate => candidate.path);
  throw new Error(`Refused: ${note.path} is not a note the person has put in scope for you. ${allowed.length ? `You may change only ${allowed.join(', ')}.` : 'You may change no note now: none is open in their editor.'} Do not change ${note.path}: propose the change as text in your reply, and the person will apply it.`);
}
