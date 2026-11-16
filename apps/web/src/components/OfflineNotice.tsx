import { WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { useDemo } from '../lib/demo.js';
import { offlineDrafts, openedScopes } from '../lib/kept-drafts.js';
import { unsyncedLiveStore, type UnsyncedLiveText } from '../lib/live-unsynced.js';

/**
 * Says the server cannot be reached and lists the drafts of what this session opened, which the app shell can show without any network.
 * Without a session on record it only counts the drafts the browser keeps. In the demo it lists none and counts the demo's own.
 * Live typing the server has not stored (collab-first A3.1) is shown with its text, for the session's own repositories only:
 * a reload made offline still shows it, and the note's editor syncs or merges it once the workspace loads again.
 */
export function OfflineNotice() {
  const { t } = useTranslation();
  const demo = useDemo() !== null;
  const { listed, total } = useMemo(() => offlineDrafts(localStorage, { demo }), [demo]);
  const [live, setLive] = useState<UnsyncedLiveText[]>([]);
  useEffect(() => {
    if (demo) return;
    const scopes = openedScopes(localStorage);
    if (!scopes) return;
    let active = true;
    void unsyncedLiveStore().list().then(entries => {
      if (active) setLive(entries.filter(entry => scopes.includes(entry.scope)).sort((a, b) => b.savedAt - a.savedAt));
    }, () => {});
    return () => {
      active = false;
    };
  }, [demo]);
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
      {live.length > 0 && (
        <section aria-label={t('pwa.offlineLive')}>
          <h2 className='mb-1 text-sm font-medium'>{t('pwa.offlineLive')}</h2>
          {live.map(entry => (
            <details key={entry.key} className='py-1 text-sm' open={live.length === 1}>
              <summary className='truncate' title={entry.path}>{entry.title || entry.path.split('/').pop()}</summary>
              <pre className='max-h-64 overflow-auto whitespace-pre-wrap text-xs'>{entry.text}</pre>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
