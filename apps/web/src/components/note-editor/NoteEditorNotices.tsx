import { Tooltip } from '../Tooltip.js';
import { X } from 'lucide-react';
import { CrashRecoveryBanner } from '../CrashRecoveryBanner.js';
import { EditorNotice } from '../EditorNotice.js';
import { Button } from '../Button.js';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import type { BlockReason, NoteEditorSessionState } from './useNoteEditorSession.js';

/** Whether the editor shows any notice, which sits above the text. */
export function hasEditorNotices(session: NoteEditorSessionState): boolean {
  return Boolean((session.recoveredDraft && !session.blocked) || session.saveError || session.blocked || session.showRemoteNotice || session.showConflictDraftNotice);
}

/** What a blocked session's one notice says. */
function blockText(reason: BlockReason | null, t: ReturnType<typeof useTranslation>['t']): string {
  switch (reason?.kind) {
    case 'moved':
      return t('editor.noteMovedTo', { path: reason.to });
    case 'deleted':
      return t('editor.noteDeletedRemotely');
    case 'gone':
      return t('editor.remoteNoteMovedOrDeleted');
    case 'other':
      return t(reason.reason as TranslationKey);
    default:
      return t('editor.remoteConflict');
  }
}

/**
 * The editor's notices: crash recovery, a failed write or read, and the remote change or conflict notice. A blocked
 * session says why in one notice, with what can be done first: open the note where it moved, refresh a conflicting
 * remote version, download the draft it kept.
 */
export function NoteEditorNotices({ session, notePath }: { session: NoteEditorSessionState; notePath: string; }) {
  const { t } = useTranslation();
  const { recoveredDraft, blocked, blockReason } = session;
  const download = session.conflictDraft && <Button size='small' onClick={session.downloadConflictDraft}>{t('editor.downloadMyDraft')}</Button>;
  const gone = blockReason?.kind === 'moved' || blockReason?.kind === 'deleted' || blockReason?.kind === 'gone';
  return (
    <div className='editor-notices'>
      {/* Crash recovery banner if draft differs from disk */}
      {recoveredDraft && !blocked && <CrashRecoveryBanner draft={{ path: notePath, content: recoveredDraft.content, metadata: recoveredDraft.metadata, savedAt: recoveredDraft.savedAt }} onRestore={session.handleRestoreDraft} onDiscard={session.handleDiscardDraft} />}
      {session.saveError && <EditorNotice tone='error'>{t(session.saveError as TranslationKey, session.saveErrorParams)}</EditorNotice>}
      {blocked && <EditorNotice actions={<>{session.openMoved && <Button size='small' variant='primary' onClick={session.openMoved}>{t('editor.openNewLocation')}</Button>}{!gone && <Button size='small' disabled={session.isSaving} onClick={session.refreshRemote}>{t('editor.refreshRemote')}</Button>}{download}</>}>{blockText(blockReason, t)}</EditorNotice>}
      {!blocked && (session.showRemoteNotice || session.showConflictDraftNotice) && (
        <EditorNotice
          actions={
            <>
              {download}
              <Tooltip label={t('editor.dismissNotice')}>
                <button type='button' aria-label={t('editor.dismissNotice')} onClick={session.dismissNotice} className='ui-icon-button'>
                  <X aria-hidden='true' />
                </button>
              </Tooltip>
            </>
          }
        >
          {session.showRemoteNotice ? t(session.remoteNotice as TranslationKey) : t('editor.localChangesPreserved')}
        </EditorNotice>
      )}
    </div>
  );
}
