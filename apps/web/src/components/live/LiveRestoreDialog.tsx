import { useTranslation } from '../../lib/i18n/index.js';
import { Button } from '../Button.js';
import { WorkspaceDialog } from '../WorkspaceDialog.js';

/** Asks, in the app's own dialog, before a history version replaces a live note's text for everyone; closing it answers no. */
export function LiveRestoreDialog({ onAnswer }: { onAnswer: (replace: boolean) => void; }) {
  const { t } = useTranslation();
  return (
    <WorkspaceDialog title={t('history.restoreLiveTitle')} onClose={() => onAnswer(false)}>
      <p>{t('history.restoreLiveConfirm')}</p>
      <div className='workspace-dialog-actions'>
        <Button type='button' onClick={() => onAnswer(false)}>{t('common.cancel')}</Button>
        <Button type='button' variant='primary' onClick={() => onAnswer(true)}>{t('history.restoreLiveReplace')}</Button>
      </div>
    </WorkspaceDialog>
  );
}
