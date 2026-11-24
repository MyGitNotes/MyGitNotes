import { X } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import type { useTagOperations } from '../lib/use-tag-operations.js';
import type { useDeletionUndo } from './useDeletionUndo.js';

interface Props {
  undoToast: ReturnType<typeof useDeletionUndo>['undoToast'];
  setUndoToast: ReturnType<typeof useDeletionUndo>['setUndoToast'];
  handleRestoreNote: ReturnType<typeof useDeletionUndo>['handleRestoreNote'];
  tagOperations: ReturnType<typeof useTagOperations>;
  handleUndoTagOperation: (id: string) => Promise<void>;
}

/** The undo toasts: a note moved to the trash, and the workspace's recent tag changes. */
export function WorkspaceToasts({ undoToast, setUndoToast, handleRestoreNote, tagOperations, handleUndoTagOperation }: Props) {
  const { t } = useTranslation();
  return (
    <>
      {/* Undo Toast Notification */}
      {undoToast && (
        <div className='fixed top-20 right-6 z-50 animate-in fade-in slide-in-from-top-3 duration-200'>
          <div className='ui-glass text-fg px-4 py-3 rounded-xl shadow-xl border border-line/80 flex items-center gap-3 text-xs'>
            <span>{t('toast.noteMovedToTrash', { title: undoToast.note.title })}</span>
            <button onClick={() => handleRestoreNote(undoToast.note)} className='px-2.5 py-1 bg-warning hover:bg-warning/90 active:scale-95 text-on-warning font-semibold rounded-md transition'>{t('common.undo')}</button>
            <button onClick={() => setUndoToast(null)} className='text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition ml-1'>
              <X className='w-3.5 h-3.5' />
            </button>
          </div>
        </div>
      )}
      {
        /* Recent tag operations: session-lifetime, each independently undoable (the list itself
      is not cleared by navigation or further mutations, only by page reload). Undoing a
      record unconditionally restores its recorded prior tags on every note it touched; it
      does not detect or warn about a later edit to the same note's tags in the meantime. */
      }
      {tagOperations.history.length > 0 && (
        <section className='fixed top-28 sm:top-auto sm:bottom-6 right-4 sm:right-16 left-4 sm:left-auto z-50 flex flex-col gap-2 items-end' aria-label={t('sidebar.recentTagChanges')}>
          {tagOperations.history.map(record => (
            <div key={record.id} className='ui-glass text-fg px-4 py-3 rounded-xl shadow-xl border border-line/80 flex items-center gap-3 text-xs max-w-sm'>
              <span>{t(record.label.key, record.label.params)}</span>
              <button
                autoFocus
                onClick={() => void handleUndoTagOperation(record.id)}
                className='px-2.5 py-1 bg-warning hover:bg-warning/90 active:scale-95 text-on-warning font-semibold rounded-md transition shrink-0'
              >
                {t('common.undo')}
              </button>
              <button
                aria-label={t('sidebar.dismissTagOperation')}
                onClick={() => tagOperations.dismiss(record.id)}
                className='text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition ml-1 shrink-0'
              >
                <X className='w-3.5 h-3.5' />
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
