import { Tooltip } from '../Tooltip.js';
import { useEffect, useState } from 'react';
import { GitCommit, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { primaryShortcutHint } from '../../lib/keyboard/keymap.js';
import type { DiffStats as Stats } from '../../lib/diff-preview.js';
import { DiffStats } from '../DiffStats.js';

/** How long a first click keeps an action armed for its confirming second click. */
const ARM_MS = 3000;

/** Pulls the note's latest version at once; the footer shows it labelled, the zoomed editor's toolbar as an icon button. */
export function NoteRefreshAction({ onRefresh, disabled, className = '', iconOnly = false }: { onRefresh: () => Promise<void>; disabled: boolean; className?: string; iconOnly?: boolean; }) {
  const { t } = useTranslation();
  if (iconOnly) {
    return (
      <Tooltip label={t('editor.quickRefreshHint')}>
        <button type='button' className={`ui-icon-button toolbar-icon-button ${className}`} data-action='refresh' disabled={disabled} aria-label={t('editor.quickRefresh')} onClick={() => !disabled && void onRefresh()}>
          <RefreshCw aria-hidden='true' />
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={t('editor.quickRefreshHint')}>
      <button type='button' className={`note-quick-action ${className}`} data-action='refresh' disabled={disabled} onClick={() => !disabled && void onRefresh()}>
        <RefreshCw aria-hidden='true' />
        <span>{t('editor.quickRefresh')}</span>
      </button>
    </Tooltip>
  );
}

/**
 * Refresh pulls the note's latest version at once. Commit and Restore appear for a dirty note only
 * and each runs on a second click while armed, after the line counts of what they would commit or discard.
 */
export function NoteQuickActions({ onRefresh, onCommit, onRestore, changes, disabled }: { onRefresh?: () => Promise<void>; onCommit?: () => Promise<void>; onRestore?: () => Promise<void>; changes?: Stats | null; disabled: boolean; }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState<'commit' | 'restore' | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const press = (action: 'commit' | 'restore', run: () => Promise<void>) => {
    if (disabled) return;
    if (armed !== action) return setArmed(action);
    setArmed(null);
    void run();
  };
  return (
    <div className='note-quick-actions flex items-center gap-2'>
      {onRefresh && <NoteRefreshAction onRefresh={onRefresh} disabled={disabled} />}
      {changes && (onRestore || onCommit) && <DiffStats stats={changes} />}
      {onRestore && (
        <Tooltip label={t('editor.quickRestoreHint')}>
          <button
            type='button'
            className='note-quick-action'
            data-action='restore'
            data-armed={armed === 'restore' || undefined}
            disabled={disabled}
            onClick={() => press('restore', onRestore)}
          >
            <RotateCcw aria-hidden='true' />
            <span>{t(armed === 'restore' ? 'editor.confirmQuickRestore' : 'editor.quickRestore')}</span>
          </button>
        </Tooltip>
      )}
      {onCommit && (
        <Tooltip label={t('editor.quickCommitHint')} detail={primaryShortcutHint('editor.commit')}>
          <button type='button' className='note-quick-action' data-action='commit' data-armed={armed === 'commit' || undefined} disabled={disabled} onClick={() => press('commit', onCommit)}>
            <GitCommit aria-hidden='true' />
            <span>{t(armed === 'commit' ? 'editor.confirmQuickCommit' : 'editor.quickCommit')}</span>
          </button>
        </Tooltip>
      )}
    </div>
  );
}
