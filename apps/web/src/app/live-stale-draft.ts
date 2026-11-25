import type { LiveStaleDraft } from '../lib/live-api.js';
import { noteFileText } from '../lib/live-handover.js';
import { sameValue } from '../lib/merge-note.js';
import { clearLocalDraftIf, getDismissedConflictDraftNoticeAt, getLocalDraft } from '../lib/storage.js';
import type { LocalDraft, NoteItem } from '../lib/types.js';
import type { WorkingNote } from '../lib/working-notes.js';

export interface LiveStaleDraftSource {
  /** The live note. */
  note: NoteItem;
  /** Its working-note draft as the page holds it now, if any. */
  draft: WorkingNote | undefined;
  /** Where the editor keeps the conflict draft it preserved of the note. */
  conflictScope: string;
  /**
   * Drops the working-note draft only while storage still holds `shown`; without one it drops nothing. Either way the
   * page reads the drafts again, so the notice it offers next is for what storage keeps.
   */
  discardShown: (shown?: WorkingNote) => boolean;
}

const holds = (kept: LocalDraft, note: Pick<NoteItem, 'content' | 'metadata'>) => sameValue(kept.content, note.content) && sameValue(kept.metadata ?? {}, note.metadata ?? {});

/**
 * What the live editor offers of a draft this browser kept of a live note from before the live editor held it: the
 * note's working-note draft, or with none, the conflict draft the direct editor preserved (a refresh of the remote
 * version drops the one and keeps the other). Each is dropped only as it was shown: one another tab wrote since stays
 * and is offered next, and the conflict draft goes with the working note only when it holds the same text.
 */
export function liveStaleDraft({ note, draft, conflictScope, discardShown }: LiveStaleDraftSource): LiveStaleDraft | undefined {
  const path = note.path;
  const backup = getLocalDraft(conflictScope, path);
  if (draft) {
    if (draft.deleted) return;
    return {
      text: noteFileText(draft.note),
      ...(backup ? { savedAt: backup.savedAt } : {}),
      differs: !draft.base || !sameValue(draft.note.content, draft.base.content) || !sameValue(draft.note.metadata, draft.base.metadata),
      // The text dropped is the one shown, which for a draft that holds nothing of its own is its base: a conflict draft
      // that holds anything else is the person's own and is offered next.
      discard: () => {
        if (discardShown(draft)) clearLocalDraftIf(conflictScope, path, kept => holds(kept, draft.note));
      },
    };
  }
  // A conflict draft whose notice the person dismissed in the direct editor is not offered again until a newer one.
  if (!backup || getDismissedConflictDraftNoticeAt(conflictScope, path) === backup.savedAt) return;
  return {
    text: noteFileText({ ...note, content: backup.content, metadata: backup.metadata ?? {} }),
    savedAt: backup.savedAt,
    differs: true,
    discard: () => {
      clearLocalDraftIf(conflictScope, path, kept => kept.savedAt === backup.savedAt && holds(kept, backup));
      discardShown();
    },
  };
}
