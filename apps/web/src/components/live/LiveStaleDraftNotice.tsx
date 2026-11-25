import { useTranslation } from '../../lib/i18n/index.js';
import type { LiveStaleDraft } from '../../lib/live-api.js';
import { Button } from '../Button.js';
import { EditorNotice } from '../EditorNotice.js';

/**
 * 「這則筆記有一份 11/24 的舊草稿」 beside the live editor: the browser still holds a draft of the note from before the live
 * editor held it. 下載 saves it as a Markdown file; 捨棄 drops it once confirmed, unless another tab wrote a newer one since.
 */
export function LiveStaleDraftNotice({ draft, fileName }: { draft: LiveStaleDraft; fileName: string; }) {
  const { t, language } = useTranslation();
  const date = draft.savedAt === undefined ? null : new Intl.DateTimeFormat(language, { month: 'numeric', day: 'numeric' }).format(draft.savedAt);
  const download = () => {
    const url = URL.createObjectURL(new Blob([draft.text], { type: 'text/markdown' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName.replace(/(\.[^.]+)?$/, '.draft$1');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const discard = () => {
    if (window.confirm(t('live.staleDraftDiscardConfirm'))) draft.discard();
  };
  return (
    <EditorNotice
      actions={
        <>
          <Button size='small' onClick={download}>{t('live.staleDraftDownload')}</Button>
          <Button size='small' variant='danger' onClick={discard}>{t('live.staleDraftDiscard')}</Button>
        </>
      }
    >
      {date ? t('live.staleDraft', { date }) : t('live.staleDraftUndated')}
    </EditorNotice>
  );
}
