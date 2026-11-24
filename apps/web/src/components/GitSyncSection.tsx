import { RefreshCw } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { hasTrackedChanges, type SyncTarget, useWorkspaceGitSync } from '../lib/workspace-git-sync.js';
import { Button } from './Button.js';
import { Tooltip } from './Tooltip.js';

/** The shared sync action, with the per-worktree outcomes and conflict choices in Changes. */
export function GitSyncSection({ target }: { target: SyncTarget; }) {
  const { t } = useTranslation();
  const sync = useWorkspaceGitSync();
  if (!sync) return null;
  const { id, label, gitStatus } = target;
  const state = sync.states.get(id);
  const busy = state?.kind === 'busy';
  const upstream = gitStatus?.upstream;
  const dirty = hasTrackedChanges(gitStatus);
  const disabled = busy || sync.committing || !upstream || dirty;
  const summary = state?.kind === 'done' && (state.result.pulled || state.result.pushed ? t('panel.syncDone', { pulled: state.result.pulled, pushed: state.result.pushed }) : t('panel.syncUpToDate'));
  const chosen = state?.kind === 'conflict' || state?.kind === 'unresolved';

  return (
    <section tabIndex={-1} data-sync-repository={id} className='todo-group git-sync' aria-label={sync.targets.length > 1 ? `${t('panel.sync')} ${label}` : t('panel.sync')}>
      <h4>{t('panel.sync')}</h4>
      {sync.targets.length > 1 && (
        <Tooltip label={label}>
          <p className='git-sync-repository'>{label}</p>
        </Tooltip>
      )}
      {upstream && (
        <Tooltip label={t('panel.syncStatusHint')}>
          <p className='git-sync-status'>{t('panel.syncStatus', { upstream, ahead: gitStatus?.ahead ?? 0, behind: gitStatus?.behind ?? 0 })}</p>
        </Tooltip>
      )}
      {(!upstream || state?.kind === 'no-upstream') && <p className='changes-help'>{t('panel.syncNoUpstream')}</p>}
      {upstream && (dirty || state?.kind === 'dirty') && <p className='changes-help'>{t('panel.syncDirty')}</p>}
      <Button className='git-sync-button' aria-busy={busy} disabled={disabled} onClick={() => void sync.run(target)}>
        <RefreshCw aria-hidden='true' size={14} className={busy ? 'animate-spin' : ''} />
        <span>{t(busy ? 'panel.syncing' : 'panel.syncNow')}</span>
      </Button>
      {chosen && (
        <div className='changes-confirm git-sync-conflict' role='alert'>
          <p>{t(state.kind === 'unresolved' ? 'panel.syncUnresolved' : 'panel.syncConflict')}</p>
          <ul className='changes-file-list'>
            {state.files.map(file => (
              <Tooltip key={file} label={file}>
                <li className='changes-file-label'>{file}</li>
              </Tooltip>
            ))}
          </ul>
          {state.kind === 'conflict' && (
            <>
              <Button disabled={disabled} onClick={() => void sync.run(target, 'remote')}>{t('panel.syncUseRemote')}</Button>
              <Button variant='danger' disabled={disabled} onClick={() => void sync.run(target, 'local')}>{t('panel.syncUseLocal')}</Button>
            </>
          )}
          <Button onClick={() => sync.resolveManually(id)}>{t('panel.syncManual')}</Button>
        </div>
      )}
      {state?.kind === 'error' && <p role='alert' className='changes-error'>{state.message}</p>}
      {state?.kind === 'manual' && <p role='status' className='changes-help'>{t('panel.syncManualHint')}</p>}
      {state?.kind === 'done' && <p role='status' className='changes-help'>{summary}{state.result.backup && ` ${t('panel.syncBackup', { ref: state.result.backup })}`}</p>}
    </section>
  );
}
