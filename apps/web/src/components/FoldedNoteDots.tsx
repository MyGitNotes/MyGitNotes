import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusDotClass, useStatusLabel } from '../lib/status-color.js';
import { Tooltip } from './Tooltip.js';

export interface FoldedNoteDotsProps {
  /** The notes the folded list holds, in its order. */
  notes: readonly NoteListItem[];
  /** The path of the note open in the Focus, marked among the dots. */
  openPath: string | null | undefined;
  onOpenNote: (note: NoteListItem) => void;
}

/**
 * The folded note list kept as a column of status dots under the toggle that brings it back: one dot per note, in the list's order, its
 * title and status in a tooltip, and a press opens it as a row of the list would.
 */
export function FoldedNoteDots({ notes, openPath, onOpenNote }: FoldedNoteDotsProps) {
  const { t } = useTranslation();
  const dotClass = useStatusDotClass();
  const labelOf = useStatusLabel();
  if (notes.length === 0) return null;
  return (
    <ul className='browse-folded-notes' aria-label={t('browse.foldedNotes')}>
      {notes.map(note => {
        const status = note.status ?? '';
        const title = note.title || note.path;
        return (
          <li key={noteRefKey(note)}>
            <Tooltip label={title} detail={status ? labelOf(status) : t('notes.noStatus')} side='right'>
              <button type='button' className='browse-folded-note' aria-label={title} aria-current={openPath === note.path ? 'true' : undefined} onClick={() => onOpenNote(note)}>
                <span className={status ? `status-dot ${dotClass(status)}` : 'status-dot status-dot-empty'} aria-hidden='true' />
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
