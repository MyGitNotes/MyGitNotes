import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowDown, RotateCw } from 'lucide-react';
import { lockAxis, overlayOpen } from '../lib/gesture-arbiter.js';
import { useTranslation } from '../lib/i18n/index.js';
import { PULL_CLOSE_MS, PULL_SETTLE_MS, PULL_SYNC_PX, pullArmed, pullDistance, type PullLabel, pullMayStart } from '../lib/pull-refresh.js';
import './phone-browse-list.css';

type Phase = 'pulling' | 'syncing' | 'returning' | 'closing';

/**
 * A phone's list screen below its bar: beside a Focus, the path line (where the list is and how many notes it holds), then the list,
 * which scrolls on its own. The notebook's folders live in the drawer's 目錄 tab, so nothing sits under the list.
 *
 * With `onRefresh`, pulling the list down from its top shows 下拉以同步, past 64 px 放開以同步; letting go there runs `onRefresh` once
 * (正在同步…) and the list closes over the indicator when it answers; short of it, the list just returns. A pull while a sync runs, or
 * with a sheet or the drawer open, is a plain scroll.
 */
export function PhoneBrowseList({ path, onRefresh, children }: { path?: ReactNode; onRefresh?: () => Promise<void>; children: ReactNode; }) {
  const { t } = useTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [armed, setArmed] = useState(false);
  const refresh = useRef(onRefresh);
  /* eslint-disable react/refs -- Keep the current callback in a ref for the native listeners without resubscribing them. */
  refresh.current = onRefresh;
  /* eslint-enable react/refs */
  const enabled = Boolean(onRefresh);

  useEffect(() => {
    const element = scroll.current;
    if (!element || !enabled) return;
    let disposed = false;
    let syncing = false;
    let pull: { x: number; y: number; pulling: boolean; distance: number; } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (distance: number) => element.style.setProperty('--pull-distance', `${distance}px`);
    const settle = (next: Phase, distance: number, ms: number, then: () => void) => {
      setPhase(next);
      show(distance);
      clearTimeout(timer);
      timer = setTimeout(then, ms);
    };
    const rest = () => {
      element.style.removeProperty('--pull-distance');
      setArmed(false);
      setPhase(null);
    };
    const onStart = (event: TouchEvent) => {
      pull = null;
      if (event.touches.length !== 1 || !pullMayStart({ scrollTop: element.scrollTop, overlay: overlayOpen(), syncing: syncing || timer !== undefined })) return;
      pull = { x: event.touches[0].clientX, y: event.touches[0].clientY, pulling: false, distance: 0 };
    };
    const onMove = (event: TouchEvent) => {
      if (!pull) return;
      if (event.touches.length !== 1) return void (pull = null);
      const dx = event.touches[0].clientX - pull.x, dy = event.touches[0].clientY - pull.y;
      if (!pull.pulling) {
        const axis = lockAxis(dx, dy);
        if (!axis) return;
        // A sideways move is a row's or the drawer's; an upward one, or one after the list scrolled, is a scroll.
        if (axis === 'horizontal' || dy < 0 || element.scrollTop > 0) return void (pull = null);
        pull.pulling = true;
        setPhase('pulling');
      }
      event.preventDefault();
      pull.distance = pullDistance(dy);
      show(pull.distance);
      setArmed(pullArmed(pull.distance));
    };
    const onEnd = () => {
      const ended = pull;
      pull = null;
      if (!ended?.pulling) return;
      if (!pullArmed(ended.distance)) {
        return settle('returning', 0, PULL_SETTLE_MS, () => {
          timer = undefined;
          rest();
        });
      }
      syncing = true;
      // A local refresh can finish before the list has even settled on the spinner.
      const settled = new Promise<void>(resolve => settle('syncing', PULL_SYNC_PX, PULL_SETTLE_MS, resolve));
      const refreshed = Promise.resolve().then(() => refresh.current?.()).catch(() => {});
      void Promise.all([settled, refreshed]).then(() => {
        if (disposed) return;
        syncing = false;
        settle('closing', 0, PULL_CLOSE_MS, () => {
          timer = undefined;
          rest();
        });
      });
    };
    const onCancel = () => {
      const ended = pull;
      pull = null;
      if (ended?.pulling) {
        settle('returning', 0, PULL_SETTLE_MS, () => {
          timer = undefined;
          rest();
        });
      }
    };
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onCancel);
    return () => {
      disposed = true;
      clearTimeout(timer);
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onCancel);
    };
  }, [enabled]);

  const label: PullLabel | null = phase === 'syncing' || phase === 'closing' ? 'syncing' : phase === 'pulling' ? (armed ? 'release' : 'pull') : null;
  return (
    <div className='phone-browse-list'>
      {path && (
        <div className='phone-browse-path'>
          <div className='phone-browse-path-content'>{path}</div>
        </div>
      )}
      <div ref={scroll} className='workspace-scroll phone-browse-scroll' data-pull={phase ?? undefined}>
        {enabled && (
          <div className='pull-refresh' data-label={label ?? undefined} role='status' aria-live='polite'>
            {label && (
              <>
                {label === 'syncing' ? <RotateCw className='pull-refresh-spin' aria-hidden='true' /> : <ArrowDown aria-hidden='true' />}
                <span>{t(label === 'syncing' ? 'pullRefresh.syncing' : label === 'release' ? 'pullRefresh.release' : 'pullRefresh.pull')}</span>
              </>
            )}
          </div>
        )}
        <div className='pull-refresh-content'>{children}</div>
      </div>
    </div>
  );
}
