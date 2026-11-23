import { Tooltip } from '../Tooltip.js';
import { AlertTriangle, FilePen, FolderInput, Radio } from 'lucide-react';
import type { LiveNoteState } from '@mygitnotes/core';
import { useTranslation } from '../../lib/i18n/index.js';
import { liveDestinationPreview } from './live-drafts.js';
import './live-editor.css';

/**
 * 「編輯中 · N 人」 (「編輯中」 when nobody is in the editor right now but its text differs from Git) on a checked-out note,
 * none on one only viewed (nobody in it, its text Git's: collab-first checks out every note a writer opens), and 「未歸檔」
 * on a pending one, whose tooltip says where its check-in files it (「歸檔到：<folder>/<name>」, by its title now) when the
 * live editor tells. A filed note moving at its next check-in adds 「簽回後移到這裡」, whose tooltip names where it lies now,
 * and one its last check-in could not move 「沒有移動：目標已存在」.
 */
export function LiveBadge({ live, title }: { live: LiveNoteState | undefined; title?: string; }) {
  const { t } = useTranslation();
  if (!live) return null;
  if (live.pending) {
    const destination = liveDestinationPreview(live, title);
    return (
      <Tooltip label={destination ? t(destination.followsTitle ? 'live.fileToTitle' : 'live.fileTo', { path: destination.path }) : t('live.pendingHint')}>
        <span className='live-badge' data-pending=''>
          <FilePen aria-hidden='true' />
          {t('live.pending')}
        </span>
      </Tooltip>
    );
  }
  const editing = live.activeEditors > 0 || live.changed
    ? (
      <Tooltip label={t('live.badgeHint')}>
        <span className='live-badge'>
          <Radio aria-hidden='true' />
          {live.activeEditors > 0 ? t('live.badge', { count: live.activeEditors }) : t('live.badgeQuiet')}
        </span>
      </Tooltip>
    )
    : null;
  // A note moving at its next check-in is listed where it goes (docs/specs/2026-11-15-builtin-live-editor §20.4).
  const moving = live.movingFrom !== undefined && (
    <Tooltip label={t('live.movingHereHint', { path: live.movingFrom })}>
      <span className='live-badge' data-moving=''>
        <FolderInput aria-hidden='true' />
        {t('live.movingHere')}
      </span>
    </Tooltip>
  );
  const unmoved = live.unmoved !== undefined && (
    <Tooltip label={t(live.unmovedReason === 'too-large' ? 'live.unmovedTooLargeHint' : 'live.unmovedHint', { path: live.unmoved })}>
      <span className='live-badge' data-unmoved=''>
        <AlertTriangle aria-hidden='true' />
        {t(live.unmovedReason === 'too-large' ? 'live.unmovedTooLarge' : 'live.unmoved')}
      </span>
    </Tooltip>
  );
  if (!moving && !unmoved) return editing;
  return <span className='live-badges'>{moving}{unmoved}{editing}</span>;
}
