import { describe, expect, it } from 'vitest';
import { BROWSE_COLUMNS_STORAGE_KEY, browseColumnsLayout, browsePresentation, notebooksCramped, paneColumns, readBrowseColumns, saveBrowseColumns, toggleList, toggleNotebooks } from './browse-columns.js';

const memory = () => {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
};
const OPEN = { notebooksCollapsed: false, listCollapsed: false };

describe('stored columns', () => {
  it('reads both columns open when nothing or something damaged is stored', () => {
    expect(readBrowseColumns(memory())).toEqual(OPEN);
    const storage = memory();
    storage.setItem(BROWSE_COLUMNS_STORAGE_KEY, '{oops');
    expect(readBrowseColumns(storage)).toEqual(OPEN);
    storage.setItem(BROWSE_COLUMNS_STORAGE_KEY, '[true]');
    expect(readBrowseColumns(storage)).toEqual(OPEN);
  });

  it('keeps what the person folded for the next visit', () => {
    const storage = memory();
    saveBrowseColumns({ notebooksCollapsed: true, listCollapsed: false }, storage);
    expect(readBrowseColumns(storage)).toEqual({ notebooksCollapsed: true, listCollapsed: false });
  });
});

describe('layout', () => {
  it('shows all three columns (A1), the rail (A2), and the rail beside the note once the list folds too (A3)', () => {
    expect(browseColumnsLayout({ stored: OPEN, cramped: false, heldOpen: false })).toEqual({ notebooks: 'open', list: true });
    expect(browseColumnsLayout({ stored: { notebooksCollapsed: true, listCollapsed: false }, cramped: false, heldOpen: false })).toEqual({ notebooks: 'rail', list: true });
    expect(browseColumnsLayout({ stored: { notebooksCollapsed: false, listCollapsed: true }, cramped: false, heldOpen: false })).toEqual({ notebooks: 'open', list: false });
  });

  it('folds the notebooks column to its rail on a cramped page unless the person opened it by hand there', () => {
    expect(browseColumnsLayout({ stored: OPEN, cramped: true, heldOpen: false })).toEqual({ notebooks: 'rail', list: true });
    expect(browseColumnsLayout({ stored: OPEN, cramped: true, heldOpen: true })).toEqual({ notebooks: 'open', list: true });
  });
});

describe('cramped', () => {
  it('gives way below a 1100px viewport', () => {
    expect(notebooksCramped({ viewport: 1099, width: 0, listShown: true, panes: 1 })).toBe(true);
    expect(notebooksCramped({ viewport: 1440, width: 0, listShown: true, panes: 1 })).toBe(false);
  });

  it('keeps the note at least 600px wide, and more for each pane set beside it', () => {
    // 1391px of columns: 1391 - 232 - 320 = 839 for one pane, short of 600 + 360 for two.
    expect(notebooksCramped({ viewport: 1440, width: 1391, listShown: true, panes: 1 })).toBe(false);
    expect(notebooksCramped({ viewport: 1440, width: 1391, listShown: true, panes: 2 })).toBe(true);
    // Without the list beside it, two panes fit.
    expect(notebooksCramped({ viewport: 1440, width: 1391, listShown: false, panes: 2 })).toBe(false);
    expect(notebooksCramped({ viewport: 1200, width: 1100, listShown: true, panes: 1 })).toBe(true);
  });

  it('counts the panes a Focus sets side by side', () => {
    const pane = (id: string) => ({ kind: 'pane' as const, id, panes: [id] });
    expect(paneColumns(undefined)).toBe(1);
    expect(paneColumns(pane('a'))).toBe(1);
    expect(paneColumns({ kind: 'split', id: 's', orientation: 'horizontal', children: [pane('a'), pane('b'), { kind: 'split', id: 't', orientation: 'vertical', children: [pane('c'), pane('d')] }] })).toBe(3);
    expect(paneColumns({ kind: 'split', id: 's', orientation: 'vertical', children: [pane('a'), { kind: 'split', id: 't', orientation: 'horizontal', children: [pane('c'), pane('d')] }] })).toBe(2);
  });
});

describe('toggles', () => {
  it('folds and opens the notebooks column; opening it on a cramped page holds it open', () => {
    expect(toggleNotebooks({ notebooks: 'open', list: true }, OPEN, false)).toEqual({ stored: { notebooksCollapsed: true, listCollapsed: false }, heldOpen: false });
    expect(toggleNotebooks({ notebooks: 'rail', list: true }, OPEN, true)).toEqual({ stored: OPEN, heldOpen: true });
  });

  it('folds and shows the list alone', () => {
    expect(toggleList({ notebooks: 'open', list: true }, OPEN, false)).toEqual({ stored: { notebooksCollapsed: false, listCollapsed: true }, heldOpen: false });
    expect(toggleList({ notebooks: 'rail', list: false }, { notebooksCollapsed: true, listCollapsed: true }, false)).toEqual({ stored: { notebooksCollapsed: true, listCollapsed: false }, heldOpen: false });
  });

  // Boss (0.31.1 review): the list's toggle controls the list alone; folding it leaves the notebooks column as it was, its rail included.
  it('keeps the notebooks rail when the list folds away too', () => {
    expect(browseColumnsLayout({ stored: { notebooksCollapsed: true, listCollapsed: true }, cramped: false, heldOpen: false })).toEqual({ notebooks: 'rail', list: false });
    expect(browseColumnsLayout({ stored: { notebooksCollapsed: false, listCollapsed: true }, cramped: true, heldOpen: false })).toEqual({ notebooks: 'rail', list: false });
  });
});

describe('presentation', () => {
  it('shows the board on a notebook address with view=kanban, and the list beside a note the address names', () => {
    expect(browsePresentation({ viewMode: 'kanban', noteAddress: false })).toBe('kanban');
    expect(browsePresentation({ viewMode: 'kanban', noteAddress: true })).toBe('list');
  });

});
