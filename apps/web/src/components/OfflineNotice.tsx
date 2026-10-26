import { WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { useDemo } from '../lib/demo.js';
import { offlineDrafts } from '../lib/kept-drafts.js';

/**
 * Says the server cannot be reached and lists the drafts of what this session opened, which the app shell can show without any network.
 * Without a session on record it only counts the drafts the browser keeps. In the demo it lists none and counts the demo's own.
 */
export function OfflineNotice() {
  const { t } = useTranslation();
  const demo = useDemo() !== null;
  const { listed, total } = useMemo(() => offlineDrafts(localStorage, { demo }), [demo]);
  return (
    <div role='status' className='mb-6 flex flex-col gap-3'>
      <p className='flex items-center gap-2 font-medium'>
        <WifiOff size={18} aria-hidden='true' />
        {t('pwa.offlineTitle')}
      </p>
      <p className='text-sm text-muted'>{t('pwa.offlineMessage')}</p>
      {listed.length > 0 && (
        <section aria-label={t('pwa.offlineDrafts')}>
          <h2 className='mb-1 text-sm font-medium'>{t('pwa.offlineDrafts')}</h2>
          <ul className='max-h-48 overflow-auto text-sm'>{listed.map(draft => <li key={draft.key} className='truncate py-1' title={draft.path}>{draft.title}</li>)}</ul>
        </section>
      )}
      {listed.length === 0 && total > 0 && <p className='text-sm'>{t('pwa.offlineDraftCount', { count: total })}</p>}
    </div>
  );
}
