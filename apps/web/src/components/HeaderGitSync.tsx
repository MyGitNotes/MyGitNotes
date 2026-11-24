import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { primaryShortcutHint } from '../lib/keyboard/keymap.js';
import { COMMIT_AND_SYNC_COMMAND, useWorkspaceGitSync } from '../lib/workspace-git-sync.js';
import { Button } from './Button.js';
import { Tooltip } from './Tooltip.js';

export function HeaderGitSync({ disabled }: { disabled: boolean; }) {
  const { t } = useTranslation();
  const sync = useWorkspaceGitSync();
  if (!sync) return null;
  const pending = sync.targets.filter(({ gitStatus }) => gitStatus?.upstream && (gitStatus.ahead || gitStatus.behind));
  const dirty = sync.changedCount > 0;
  const syncing = sync.targets.some(({ id }) => sync.states.get(id)?.kind === 'busy');
  const busy = syncing || sync.committing;
  if (!dirty && !pending.length && !busy) return null;

  const ahead = pending.reduce((sum, repo) => sum + (repo.gitStatus?.ahead ?? 0), 0);
  const behind = pending.reduce((sum, repo) => sum + (repo.gitStatus?.behind ?? 0), 0);
  const only = pending.length === 1 ? pending[0] : undefined;
  const counts = [dirty && `● ${sync.changedCount}`, ahead > 0 && `↑ ${ahead}`, behind > 0 && `↓ ${behind}`].filter(Boolean).join(' ');
  const label = dirty ? t('panel.headerCommitAll', { count: sync.changedCount }) : t(only ? 'panel.headerSync' : 'panel.headerSyncSeveral', { ahead, behind });
  const busyLabel = t(syncing ? 'panel.syncing' : 'commit.committing');
  const buttonProps = { 'aria-label': busy ? `${label} · ${busyLabel}` : label, 'aria-busy': busy, disabled: disabled || busy || !sync.canReveal };
  const content = (
    <>
      {busy && <RefreshCw size={13} className='animate-spin' aria-hidden='true' />}
      <span>{busy ? busyLabel : counts}</span>
    </>
  );
  const hint = busy ? busyLabel : label;
  if (!dirty) {
    return (
      <Tooltip label={hint}>
        <Button
          {...buttonProps}
          className='header-git-sync'
          onClick={() => {
            sync.revealChanges(only?.id);
            if (only) void sync.run(only);
          }}
        >
          {content}
        </Button>
      </Tooltip>
    );
  }
  return (
    <DropdownMenu.Root>
      <Tooltip label={hint}>
        <DropdownMenu.Trigger {...buttonProps} className='ui-button header-git-sync'>{content}</DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} onEscapeKeyDown={event => event.stopPropagation()}>
          <DropdownMenu.Item onSelect={() => void sync.commitAll(true)}>
            <span>{t('command.workspace.commitAndSync')}</span>
            <kbd>{primaryShortcutHint(COMMIT_AND_SYNC_COMMAND)}</kbd>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void sync.commitAll(false)}>{t('panel.commitAllOnly')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => sync.revealChanges()}>{t('panel.openChanges')}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
