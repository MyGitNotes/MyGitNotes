import { describe, expect, it } from 'vitest';
import { browseLayout, browsePath } from './browse-layout.js';

describe('browseLayout', () => {
  it('leaves normal browsing as it was: the sidebar shown, no split, chips only in the phone bar', () => {
    for (const viewMode of ['list', 'flat', 'kanban'] as const) {
      expect(browseLayout({ focusShown: false, capacity: 'all', viewMode })).toEqual({ sidebarFolded: false, split: null, chips: null });
      expect(browseLayout({ focusShown: false, capacity: 2, viewMode })).toEqual({ sidebarFolded: false, split: null, chips: null });
      expect(browseLayout({ focusShown: false, capacity: 1, viewMode })).toEqual({ sidebarFolded: false, split: null, chips: 'bar' });
    }
  });

  it('beside a Focus on a desktop, folds the sidebar away and puts the folders and filters over the list in the left dock, with no rail and no chips', () => {
    for (const viewMode of ['list', 'flat'] as const) {
      expect(browseLayout({ focusShown: true, capacity: 'all', viewMode })).toEqual({ sidebarFolded: true, split: 'filters', chips: null });
    }
  });

  it('keeps the sidebar, holding only folders and filters, when the cards or Kanban board dock above the Focus', () => {
    expect(browseLayout({ focusShown: true, capacity: 'all', viewMode: 'kanban' })).toEqual({ sidebarFolded: false, split: null, chips: null });
  });

  it('below the desktop breakpoint splits the left dock too, and keeps the drawer; a board above the Focus keeps its chips', () => {
    expect(browseLayout({ focusShown: true, capacity: 2, viewMode: 'list' })).toEqual({ sidebarFolded: false, split: 'filters', chips: null });
    expect(browseLayout({ focusShown: true, capacity: 2, viewMode: 'kanban' })).toEqual({ sidebarFolded: false, split: null, chips: 'list' });
  });

  it("on a phone's list screen beside a Focus, puts the folders over the chips and the list", () => {
    expect(browseLayout({ focusShown: true, capacity: 1, viewMode: 'flat' })).toEqual({ sidebarFolded: false, split: 'folders', chips: 'list' });
    expect(browseLayout({ focusShown: true, capacity: 1, viewMode: 'list' })).toEqual({ sidebarFolded: false, split: 'folders', chips: 'list' });
    expect(browseLayout({ focusShown: true, capacity: 1, viewMode: 'kanban' })).toEqual({ sidebarFolded: false, split: null, chips: 'bar' });
  });
});

describe('browsePath', () => {
  const labels = { outline: 'Outlines', compilations: 'Compilations' };
  it('names the folders below the notebook root, or the notebook at its root', () => {
    expect(browsePath({ kind: 'note', notebookTitle: 'Research', breadcrumbs: [{ name: 'All folders', path: null }, { name: 'Projects', path: 'projects' }, { name: 'Thesis', path: 'projects/thesis' }], labels })).toBe('Projects / Thesis');
    expect(browsePath({ kind: 'note', notebookTitle: 'Research', breadcrumbs: [{ name: 'All folders', path: null }], labels })).toBe('Research');
  });

  it('names the outline and compilation lists by their kind', () => {
    expect(browsePath({ kind: 'outline', notebookTitle: 'Research', breadcrumbs: [], labels })).toBe('Outlines');
    expect(browsePath({ kind: 'compilation', notebookTitle: 'Research', breadcrumbs: [], labels })).toBe('Compilations');
  });
});
