import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { useDemo } from '../lib/demo.js';
import { demoRemainingMs, demoScenarioNotice, demoScopes, demoVersion, demoWasUpdated, dismissDemoUpdated, resetDemo, setDemoScenarioNotice, subscribeDemo } from '../lib/demo-storage.js';
import { useDemoCallToAction } from '../lib/web-features.js';
import { Button } from './Button.js';

/** The time left, as the banner words it: whole hours while there are any, else minutes. */
export function remainingText(ms: number, t: ReturnType<typeof useTranslation>['t']): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? t('demo.hours', { hours }) : t('demo.minutes', { minutes: Math.max(1, Math.ceil(ms / 60_000)) });
}

/**
 * Above the demo workspace: your edits and commits stay in this browser and are cleared 24 hours after the first change
 * (with the time left once there is one), a way to start over, and a way to keep your own notes: to sign in, or, for a browser
 * that is signed in already, to go to its notes. Renders nothing outside the demo.
 */
export function DemoBanner() {
  const { t } = useTranslation();
  const demo = useDemo();
  const callToAction = useDemoCallToAction();
  useSyncExternalStore(subscribeDemo, demoVersion);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!demo) return null;
  const scope = demoScopes()[0];
  const remaining = scope ? demoRemainingMs(scope.scope, now) : undefined;
  const scenario = demoScenarioNotice();
  const reset = () => {
    if (!window.confirm(t('demo.resetConfirm'))) return;
    resetDemo();
    window.location.reload();
  };
  return (
    <>
      <div role='status' data-testid='demo-banner' className='shrink-0 px-4 py-2 text-sm bg-surface border-b border-line flex flex-wrap items-center gap-2'>
        <span className='flex-1 min-w-0'>{remaining === undefined ? t('demo.banner') : t('demo.bannerClock', { time: remainingText(remaining, t) })}</span>
        <Button size='small' onClick={reset}>{t('demo.reset')}</Button>
        {callToAction ? <callToAction.Component /> : <a className='ui-button' href='/'>{t(demo.signedIn ? 'demo.openMine' : 'demo.callToAction')}</a>}
      </div>
      {demoWasUpdated() && (
        <div role='status' className='shrink-0 px-4 py-2 text-sm bg-surface border-b border-line flex flex-wrap items-center gap-2'>
          <span className='flex-1 min-w-0'>{t('demo.updated')}</span>
          <Button size='small' onClick={dismissDemoUpdated}>{t('demo.dismiss')}</Button>
        </div>
      )}
      {scenario && (
        <div role='status' className='shrink-0 px-4 py-2 text-sm bg-surface border-b border-line flex flex-wrap items-center gap-2'>
          <span className='flex-1 min-w-0'>{t('demo.unknownScenario', { slug: scenario.slug, title: scenario.title })}</span>
          <Button size='small' onClick={() => setDemoScenarioNotice(null)}>{t('demo.dismiss')}</Button>
        </div>
      )}
    </>
  );
}
