import './browse-columns.css';
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { BrowseColumnsLayout, BrowsePresentation } from '../lib/browse-columns.js';
import { useTranslation } from '../lib/i18n/index.js';
import { KanbanFocusSplit } from './KanbanFocusSplit.js';

export const NOTEBOOK_COLUMN_ID = 'browse-notebooks';
export const LIST_COLUMN_ID = 'browse-list';

export interface BrowseColumnsProps {
  layout: BrowseColumnsLayout;
  /** Measures the width the columns share. */
  measure?: (element: HTMLElement | null) => void;
  presentation: BrowsePresentation;
  /** The board takes the whole width unless there is a note in the Focus. */
  focusOpen: boolean;
  /** With a note in the Focus, the board folds into the list column (the status list) instead of standing beside the Focus. */
  boardFolded?: boolean;
  /** Column 1: the notebooks, open or as the rail. */
  notebooks: ReactNode;
  /** Column 2: the note list. */
  list: ReactNode;
  /** Column 3: the Focus. */
  note: ReactNode;
  /** At the note column's top left while the list is folded away: what brings it back. */
  restore?: ReactNode;
  /** At the note column's top left while the board stands beside it: what folds the board into the list column. */
  fold?: ReactNode;
}

/** Whether `element` no longer takes focus where it is: removed from the page, or inside a column that folded away or is sliding shut. */
const lost = (element: Element | null) => !element || !element.isConnected || Boolean(element.closest('[hidden], [inert]'));

/** Where motion is welcome, the list slides shut and open as the notebooks column slides to its rail (browse-columns.css). */
const motionWelcome = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches === true;
/** Past the 160ms slide: a list whose transition never ends (an interrupted or skipped one) hides anyway. */
const SLIDE_FALLBACK_MS = 300;

/** The list column on its way: `closing` slides its width to nothing before it hides, `opening` shows it at no width for a frame to slide from. */
type ListPhase = 'open' | 'closing' | 'closed' | 'opening';

/**
 * The Notes page's three columns: the notebooks, the note list and the note. Their elements stay the same whatever the person opens, closes or
 * switches; only their content follows. Folding the list hides it in place; the notebooks column turns into its rail inside the same element.
 * When the focused control goes with a fold, the keyboard moves to the toggle that brings that column back, else to the first toggle left.
 */
export function BrowseColumns({ layout, measure, presentation, focusOpen, boardFolded = false, notebooks, list, note, restore, fold }: BrowseColumnsProps): JSX.Element {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement | null>(null);
  const focused = useRef<Element | null>(null);
  const focusId = useId();
  // Folded beside the Focus, the board is the list column's status list and the columns behave as for the list.
  const board = presentation === 'kanban' && !(focusOpen && boardFolded);
  const split = board && focusOpen;
  const listShown = layout.list || board;
  const [phase, setPhase] = useState<ListPhase>(listShown ? 'open' : 'closed');
  const [wasShown, setWasShown] = useState(listShown);
  if (wasShown !== listShown) {
    setWasShown(listShown);
    setPhase(listShown ? (!board && motionWelcome() ? 'opening' : 'open') : (motionWelcome() ? 'closing' : 'closed'));
  }
  useEffect(() => {
    if (phase === 'closing') {
      const timer = window.setTimeout(() => setPhase('closed'), SLIDE_FALLBACK_MS);
      return () => window.clearTimeout(timer);
    }
    if (phase !== 'opening') return;
    // Two frames: the first lays the list out at no width, the second gives it its width to slide to.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPhase('open'));
    });
    return () => cancelAnimationFrame(frame);
  }, [phase]);
  useLayoutEffect(() => {
    const was = focused.current;
    if (!was || !lost(was) || !root.current) return;
    const column = was.isConnected ? was.closest('.browse-column')?.id : undefined;
    const toggles = [...root.current.querySelectorAll<HTMLElement>('[data-column-toggle]')].filter(toggle => !lost(toggle));
    const target = toggles.find(toggle => column && toggle.getAttribute('aria-controls') === column) ?? toggles.find(toggle => toggle.getAttribute('aria-controls') === LIST_COLUMN_ID && !layout.list) ?? toggles[0];
    focused.current = null;
    target?.focus();
  }, [layout.notebooks, layout.list, board, split]);
  // Stable across renders: a new callback each render would hand `measure` null and the element again on every commit, and its state update
  // would render the page again without end.
  const attach = useCallback((element: HTMLDivElement | null) => {
    root.current = element;
    measure?.(element);
  }, [measure]);
  return (
    <div
      ref={attach}
      className='browse-columns'
      data-notebooks={layout.notebooks}
      data-list={phase === 'open' ? 'open' : 'closed'}
      onFocus={event => {
        focused.current = event.target;
      }}
      onBlur={event => {
        if (!event.relatedTarget || !root.current?.contains(event.relatedTarget as Node)) focused.current = event.relatedTarget ? null : focused.current;
      }}
    >
      <aside id={NOTEBOOK_COLUMN_ID} className='browse-column browse-column-notebooks' aria-label={t('sidebar.notebooks')}>{notebooks}</aside>
      <KanbanFocusSplit
        board={board}
        split={split}
        focusId={focusId}
        list={
          <section
            id={LIST_COLUMN_ID}
            className='browse-column browse-column-list'
            aria-label={t('browse.listColumn')}
            hidden={!board && phase === 'closed'}
            {...(!board && phase === 'closing' ? { inert: '' } : {})}
            onTransitionEnd={event => {
              if (event.target === event.currentTarget && phase === 'closing') setPhase('closed');
            }}
          >
            {list}
          </section>
        }
        focus={<div id={focusId} className='browse-column browse-column-note' hidden={board && !split}>{!board && !layout.list && restore && <div className='browse-column-restore'>{restore}</div>}{split && fold && <div className='browse-column-restore'>{fold}</div>}{(!board || split) && <div className='browse-column-note-body'>{note}</div>}</div>}
      />
    </div>
  );
}
