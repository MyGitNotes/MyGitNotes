import { FilePen, Radio } from 'lucide-react';
import type { LiveNoteState } from '@mygitnotes/core';
import { useTranslation } from '../../lib/i18n/index.js';
import { liveDestinationPreview } from './live-drafts.js';
import './live-editor.css';

/**
 * 「編輯中 · N 人」 (「編輯中」 when nobody is in the editor right now but its text differs from Git) on a checked-out note,
 * none on one only viewed (nobody in it, its text Git's: collab-first checks out every note a writer opens), and 「未歸檔」
 * on a pending one, whose tooltip says where its check-in files it (「歸檔到：<folder>/<name>」, by its title now) when the
 * live editor tells.
 */
export function LiveBadge({ live, title }: { live: LiveNoteState | undefined; title?: string; }) {
  const { t } = useTranslation();
  if (!live) return null;
  if (live.pending) {
    const destination = liveDestinationPreview(live, title);
    return (
      <span className='live-badge' data-pending='' title={destination ? t(destination.followsTitle ? 'live.fileToTitle' : 'live.fileTo', { path: destination.path }) : t('live.pendingHint')}>
        <FilePen aria-hidden='true' />
        {t('live.pending')}
      </span>
    );
  }
  if (live.activeEditors === 0 && !live.changed) return null;
  return (
    <span className='live-badge' title={t('live.badgeHint')}>
      <Radio aria-hidden='true' />
      {live.activeEditors > 0 ? t('live.badge', { count: live.activeEditors }) : t('live.badgeQuiet')}
    </span>
  );
}
