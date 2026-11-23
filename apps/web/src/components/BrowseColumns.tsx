import './browse-columns.css';
import { type ReactNode, useCallback, useLayoutEffect, useRef } from 'react';
import type { BrowseColumnsLayout } from '../lib/browse-columns.js';
import { useTranslation } from '../lib/i18n/index.js';

export const NOTEBOOK_COLUMN_ID = 'browse-notebooks';
export const LIST_COLUMN_ID = 'browse-list';

export interface BrowseColumnsProps {
  layout: BrowseColumnsLayout;
  /** Measures the width the columns share. */
  measure?: (element: HTMLElement | null) => void;
  /** The table or the board: the list column spans the note column, which stays mounted out of sight. */
  merged: boolean;
  /** Column 1: the notebooks, open or as the rail. */
  notebooks: ReactNode;
  /** Column 2: the note list. */
  list: ReactNode;
  /** Column 3: the Focus. */
  note: ReactNode;
  /** At the note column's top left while the list is folded away: what brings it back. */
  restore?: ReactNode;
}

/** Whether `element` no longer takes focus where it is: removed from the page, or inside a column that folded away. */
const lost = (element: Element | null) => !element || !element.isConnected || Boolean(element.closest('[hidden]'));

/**
 * The Notes page's three columns: the notebooks, the note list and the note. Their elements stay the same whatever the person opens, closes or
 * switches; only their content follows. Folding the list hides it in place; the notebooks column turns into its rail inside the same element.
 * When the focused control goes with a fold, the keyboard moves to the toggle that brings that column back, else to the first toggle left.
 */
export function BrowseColumns({ layout, measure, merged, notebooks, list, note, restore }: BrowseColumnsProps): JSX.Element {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement | null>(null);
  const focused = useRef<Element | null>(null);
  const listShown = layout.list || merged;
  useLayoutEffect(() => {
    const was = focused.current;
    if (!was || !lost(was) || !root.current) return;
    const column = was.isConnected ? was.closest('.browse-column')?.id : undefined;
    const toggles = [...root.current.querySelectorAll<HTMLElement>('[data-column-toggle]')].filter(toggle => !lost(toggle));
    const target = toggles.find(toggle => column && toggle.getAttribute('aria-controls') === column) ?? toggles.find(toggle => toggle.getAttribute('aria-controls') === LIST_COLUMN_ID && !layout.list) ?? toggles[0];
    focused.current = null;
    target?.focus();
  }, [layout.notebooks, layout.list, merged]);
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
      data-list={listShown ? 'open' : 'closed'}
      data-merged={merged || undefined}
      onFocus={event => {
        focused.current = event.target;
      }}
      onBlur={event => {
        if (!event.relatedTarget || !root.current?.contains(event.relatedTarget as Node)) focused.current = event.relatedTarget ? null : focused.current;
      }}
    >
      <aside id={NOTEBOOK_COLUMN_ID} className='browse-column browse-column-notebooks' aria-label={t('sidebar.notebooks')}>{notebooks}</aside>
      <section id={LIST_COLUMN_ID} className='browse-column browse-column-list' aria-label={t('browse.listColumn')} hidden={!listShown}>{list}</section>
      <div className='browse-column browse-column-note' hidden={merged}>
        {!layout.list && restore && <div className='browse-column-restore'>{restore}</div>}
        <div className='browse-column-note-body'>{note}</div>
      </div>
    </div>
  );
}
