/**
 * The lines of the web's untouched untemplated new note, in every locale it ships: `# <createNote.untitled>` and
 * `createNote.body` (apps/web/src/lib/new-note.ts). {@link isEmptyLiveDraft} takes them out of a pending draft as it does
 * the lines of its initial text, so a new note nobody wrote in is an empty draft even when the adapter recorded no
 * initial text. A web test checks every shipped locale against this list, so a translation change fails there.
 */
export const LIVE_DEFAULT_DRAFT_LINES: readonly string[] = Object.freeze(['# Untitled', 'Write your note here.', '# 未命名', '在這裡寫下筆記。']);
