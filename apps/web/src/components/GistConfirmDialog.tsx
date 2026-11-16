import { useCallback, useRef, useState } from 'react';
import { Button } from './Button.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import type { GistConfirmation } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';

/** Asks whether to publish notes to Gists a commit did not push; closing it answers no. */
export function GistConfirmDialog({ entries, onAnswer }: { entries: GistConfirmation[]; onAnswer: (publish: boolean) => void; }) {
  const { t } = useTranslation();
  return (
    <WorkspaceDialog title={t('editor.gistConfirmTitle')} onClose={() => onAnswer(false)}>
      <p>{t('editor.gistConfirmBody')}</p>
      <ul>
        {entries.map(entry => (
          <li key={`${entry.path}\0${entry.gist}`}>
            <code>{t('editor.gistConfirmEntry', { path: entry.path, gist: entry.gist })}</code>
          </li>
        ))}
      </ul>
      <div className='workspace-dialog-actions'>
        <Button type='button' onClick={() => onAnswer(false)}>{t('editor.gistConfirmSkip')}</Button>
        <Button type='button' variant='primary' onClick={() => onAnswer(true)}>{t('editor.gistConfirmPublish')}</Button>
      </div>
    </WorkspaceDialog>
  );
}

/**
 * `confirmGists` opens the dialog and settles with the person's answer; render `gistConfirmDialog` where the dialog
 * belongs. A second request while one is open answers the first no.
 */
export function useGistConfirm() {
  const [pending, setPending] = useState<{ entries: GistConfirmation[]; } | null>(null);
  const settle = useRef<((publish: boolean) => void) | null>(null);
  const confirmGists = useCallback((entries: GistConfirmation[]) =>
    new Promise<boolean>(resolve => {
      settle.current?.(false);
      settle.current = resolve;
      setPending({ entries });
    }), []);
  const answer = (publish: boolean) => {
    settle.current?.(publish);
    settle.current = null;
    setPending(null);
  };
  return { confirmGists, gistConfirmDialog: pending ? <GistConfirmDialog entries={pending.entries} onAnswer={answer} /> : null };
}
