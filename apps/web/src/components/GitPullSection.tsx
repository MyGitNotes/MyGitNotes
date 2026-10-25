import { useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { GitSyncError, syncGitWorkspace } from '../lib/api.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useTranslation } from '../lib/i18n/index.js';
import { type PullFailure, pullFailurePrompt } from '../lib/pull-failure-prompt.js';
import { Button } from './Button.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

/**
 * Pulls the default worktree's main from its upstream without pushing, stashing uncommitted changes around it.
 * The result shows under the button; a failure opens a dialog with a prompt the user can hand to a local coding agent.
 */
export function GitPullSection({ onPulled, repoRoot, upstream }: { onPulled: () => Promise<void> | void; repoRoot: string; upstream?: string | null; }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState<PullFailure>();
  const [copied, setCopied] = useState(false);

  const pull = async () => {
    setBusy(true);
    setNotice('');
    try {
      const { pulled } = await syncGitWorkspace(undefined, undefined, true);
      setNotice(pulled ? t('sidebar.pulled', { count: pulled }) : t('sidebar.pullUpToDate'));
      if (pulled) await onPulled();
    } catch (error) {
      const sync = error instanceof GitSyncError ? error : undefined;
      setCopied(false);
      setFailure({ code: sync?.code ?? 'FAILED', message: (error as Error).message, files: sync?.files ?? [] });
      // The pull itself landed; only the stashed changes stayed behind, so the files on disk moved.
      if (sync?.code === 'STASH_CONFLICT') await onPulled();
    } finally {
      setBusy(false);
    }
  };

  const prompt = failure ? pullFailurePrompt(failure, repoRoot) : '';
  return (
    <section className='todo-group git-sync' aria-label={t('panel.pull')}>
      <h4>{t('panel.pull')}</h4>
      <p className='changes-help'>{t('panel.pullHint')}</p>
      <Button className='git-sync-button' aria-busy={busy} disabled={busy || !upstream} onClick={() => void pull()}>
        <ArrowDownToLine aria-hidden='true' size={14} className={busy ? 'animate-pulse' : ''} />
        <span>{t(busy ? 'sidebar.pulling' : 'sidebar.pull')}</span>
      </Button>
      {notice && <p role='status' className='changes-help'>{notice}</p>}
      {failure && (
        <WorkspaceDialog title={t('sidebar.pullFailedTitle')} onClose={() => setFailure(undefined)} className='git-pull-dialog'>
          <p role='alert' className='changes-error'>{failure.message}</p>
          {failure.files.length > 0 && <ul className='changes-file-list'>{failure.files.map(file => <li key={file} className='changes-file-label' title={file}>{file}</li>)}</ul>}
          <p className='changes-help'>{t('sidebar.pullPromptHint')}</p>
          <textarea className='git-pull-prompt' readOnly rows={8} value={prompt} aria-label={t('sidebar.pullPromptHint')} />
          <div className='workspace-dialog-actions'>
            <Button onClick={() => setFailure(undefined)}>{t('common.close')}</Button>
            <Button variant='primary' onClick={async event => setCopied(await copyToClipboard(prompt, event.currentTarget.closest('dialog')?.querySelector('textarea')))}>{t(copied ? 'common.copied' : 'sidebar.pullCopyPrompt')}</Button>
          </div>
        </WorkspaceDialog>
      )}
    </section>
  );
}
