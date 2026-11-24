import { RefreshCw } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { useWorkspaceGitSync } from '../lib/workspace-git-sync.js';
import { Button } from './Button.js';
import { Tooltip } from './Tooltip.js';

export function HeaderGitSync({ disabled }: { disabled: boolean; }) {
  const { t } = useTranslation();
  const sync = useWorkspaceGitSync();
  const pending = sync?.targets.filter(({ gitStatus }) => gitStatus?.upstream && (gitStatus.ahead || gitStatus.behind)) ?? [];
  if (!sync || !pending.length) return null;

  const ahead = pending.reduce((sum, repo) => sum + (repo.gitStatus?.ahead ?? 0), 0);
  const behind = pending.reduce((sum, repo) => sum + (repo.gitStatus?.behind ?? 0), 0);
  const only = pending.length === 1 ? pending[0] : undefined;
  const busy = pending.some(({ id }) => sync.states.get(id)?.kind === 'busy');
  const label = t(only ? 'panel.headerSync' : 'panel.headerSyncSeveral', { ahead, behind });
  return (
    <Tooltip label={busy ? t('panel.syncing') : label}>
      <Button
        className='header-git-sync'
        aria-label={busy ? `${label} · ${t('panel.syncing')}` : label}
        aria-busy={busy}
        disabled={disabled || busy || !sync.canReveal}
        onClick={() => {
          sync.revealChanges(only?.id);
          if (only) void sync.run(only);
        }}
      >
        {busy && <RefreshCw size={13} className='animate-spin' aria-hidden='true' />}
        <span>{busy ? t('panel.syncing') : `↑ ${ahead} ↓ ${behind}`}</span>
      </Button>
    </Tooltip>
  );
}
