import { useSyncExternalStore } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { applyUpdate, dismissUpdate, getUpdateReady, subscribeUpdate } from '../pwa/update-store.js';
import { Button } from './Button.js';
import '../pwa/pwa.css';

/** Offered when a newer build is installed behind the open one; the swap happens only on Reload, never in the middle of editing. */
export function UpdateNotice() {
  const { t } = useTranslation();
  const ready = useSyncExternalStore(subscribeUpdate, getUpdateReady);
  if (!ready) return null;
  return (
    <div role='status' className='pwa-notice'>
      <span>{t('pwa.updateAvailable')}</span>
      <Button variant='primary' size='small' onClick={() => applyUpdate(navigator.serviceWorker, () => window.location.reload())}>{t('pwa.reload')}</Button>
      <Button size='small' onClick={dismissUpdate}>{t('pwa.later')}</Button>
    </div>
  );
}
