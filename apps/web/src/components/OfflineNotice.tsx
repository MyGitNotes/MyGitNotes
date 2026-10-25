import { WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { listKeptDrafts } from '../lib/kept-drafts.js';

/** Says the server cannot be reached and lists the drafts this browser keeps, which the app shell can show without any network. */
export function OfflineNotice() {
  const { t } = useTranslation();
  const drafts = useMemo(() => listKeptDrafts(localStorage), []);
  return (
    <div role='status' className='mb-6 flex flex-col gap-3'>
      <p className='flex items-center gap-2 font-medium'>
        <WifiOff size={18} aria-hidden='true' />
        {t('pwa.offlineTitle')}
      </p>
      <p className='text-sm text-muted'>{t('pwa.offlineMessage')}</p>
      {drafts.length > 0 && (
        <section aria-label={t('pwa.offlineDrafts')}>
          <h2 className='mb-1 text-sm font-medium'>{t('pwa.offlineDrafts')}</h2>
          <ul className='max-h-48 overflow-auto text-sm'>{drafts.map(draft => <li key={draft.key} className='truncate py-1' title={draft.path}>{draft.title}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
