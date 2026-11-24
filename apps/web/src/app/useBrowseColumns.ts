import { useCallback, useEffect, useState } from 'react';
import { type BrowseColumnsChange, type BrowseColumnsLayout, type BrowsePresentation, browseColumnsLayout, notebooksCramped, readBrowseColumns, saveBrowseColumns, toggleList, toggleNotebooks } from '../lib/browse-columns.js';
import type { CommandSpec } from '../lib/commands/registry.js';
import type { I18nContextValue } from '../lib/i18n/index.js';

export interface BrowseColumns {
  layout: BrowseColumnsLayout;
  /** Attach to the element the three columns share, so the room the note keeps is measured. */
  measure: (element: HTMLElement | null) => void;
  /** ⌘\ and the header's button left of the logo: the notebooks column, open or as its rail. */
  toggleNotebooks: () => void;
  /** ⌘⇧\ and the list header's button: the note list alone. */
  toggleList: () => void;
}

const viewportWidth = () => typeof window === 'undefined' ? 0 : window.innerWidth;

/**
 * The Notes page's notebooks and list columns: folded by hand (kept for this browser), and the notebooks column to its rail by itself where
 * the page is too narrow or the Focus's panes need the room, unless the person opened it by hand since.
 */
export function useBrowseColumns({ panes }: { panes: number; }): BrowseColumns {
  const [stored, setStored] = useState(readBrowseColumns);
  const [heldOpen, setHeldOpen] = useState(false);
  const [viewport, setViewport] = useState(viewportWidth);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const update = () => setViewport(viewportWidth());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    if (!element) return;
    /* eslint-disable react/set-state-in-effect -- The columns' width is known only once their element is laid out. */
    setWidth(element.getBoundingClientRect().width);
    /* eslint-enable react/set-state-in-effect */
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const cramped = notebooksCramped({ viewport, width, listShown: !stored.listCollapsed, panes });
  // Holding the column open by hand lasts while the page stays cramped; once there is room again, the next squeeze folds it by itself.
  const [wasCramped, setWasCramped] = useState(cramped);
  if (wasCramped !== cramped) {
    setWasCramped(cramped);
    if (!cramped && heldOpen) setHeldOpen(false);
  }
  const layout = browseColumnsLayout({ stored, cramped, heldOpen });
  const apply = (change: BrowseColumnsChange) => {
    setStored(change.stored);
    setHeldOpen(change.heldOpen);
    saveBrowseColumns(change.stored);
  };
  const measure = useCallback((next: HTMLElement | null) => setElement(next), []);
  return { layout, measure, toggleNotebooks: () => apply(toggleNotebooks(layout, stored, cramped)), toggleList: () => apply(toggleList(layout, stored, heldOpen)) };
}

/** ⌘\ and ⌘⇧\: the palette's and the keyboard's way to fold the notebooks column and the list. */
export function browseColumnCommands(columns: BrowseColumns, t: I18nContextValue['t'], presentation: BrowsePresentation = 'list'): CommandSpec[] {
  const notebooks: CommandSpec = { id: 'browse.toggleNotebooks', group: 'panes', title: t('command.browse.toggleNotebooks'), description: t('command.browse.toggleNotebooks.describe'), run: columns.toggleNotebooks };
  // Folding the List is not a board action and must not change the stored List preference.
  return presentation === 'kanban' ? [notebooks] : [notebooks, { id: 'browse.toggleList', group: 'panes', title: t('command.browse.toggleList'), description: t('command.browse.toggleList.describe'), run: columns.toggleList }];
}
