import { FilePen, Radio } from 'lucide-react';
import type { LiveNoteState } from '@mygitnotes/core';
import { useTranslation } from '../../lib/i18n/index.js';
import { liveDestination } from './live-drafts.js';
import './live-editor.css';

/**
 * 「編輯中 · N 人」 (「編輯中」 when nobody is in the editor right now) on a checked-out note, 「未歸檔」 on a pending one,
 * whose tooltip says where its check-in files it (「歸檔到：<folder>/<name>」) when the live editor tells.
 */
export function LiveBadge({ live }: { live: LiveNoteState | undefined; }) {
  const { t } = useTranslation();
  if (!live) return null;
  if (live.pending) {
    const destination = liveDestination(live);
    return (
      <span className='live-badge' data-pending='' title={destination ? t('live.fileTo', { path: destination }) : t('live.pendingHint')}>
        <FilePen aria-hidden='true' />
        {t('live.pending')}
      </span>
    );
  }
  return (
    <span className='live-badge' title={t('live.badgeHint')}>
      <Radio aria-hidden='true' />
      {live.activeEditors > 0 ? t('live.badge', { count: live.activeEditors }) : t('live.badgeQuiet')}
    </span>
  );
}
