import { ChevronRight, FileText } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';

/** A folder's index.md or README.md, labelled with the folder it belongs to. */
export function FolderIndex({ note, folder, onOpenNote }: { note: NoteListItem; folder: string; onOpenNote: (note: NoteListItem) => void; }) {
  const { t } = useTranslation();
  return (
    <button type='button' className='folder-link folder-index' data-folder-index onClick={() => onOpenNote(note)}>
      <FileText aria-hidden='true' />
      <span className='folder-link-title'>{folder ? t('folder.indexOf', { folder }) : t('folder.index')}</span>
      <ChevronRight aria-hidden='true' className='folder-link-arrow' />
    </button>
  );
}
