import { describe, expect, it } from 'vitest';
import { browsePath, phoneBrowseLayout } from './browse-layout.js';

describe('phoneBrowseLayout', () => {
  it('lays out nothing wider than a phone, beside a Focus or not: the notebooks column holds the folders and the list column the filters', () => {
    for (const viewMode of ['list', 'flat', 'kanban'] as const) {
      for (const focusShown of [false, true]) expect(phoneBrowseLayout({ phone: false, focusShown, viewMode })).toEqual({ path: false, chips: null });
    }
  });

  it("keeps a phone's list screen with no Focus as it was: no path line, chips in the bar", () => {
    for (const viewMode of ['list', 'flat', 'kanban'] as const) expect(phoneBrowseLayout({ phone: true, focusShown: false, viewMode })).toEqual({ path: false, chips: 'bar' });
  });

  it("on a phone's list screen beside a Focus, puts the path line and the chips over the list and nothing under it; the board keeps the chips in the bar", () => {
    expect(phoneBrowseLayout({ phone: true, focusShown: true, viewMode: 'flat' })).toEqual({ path: true, chips: 'list' });
    expect(phoneBrowseLayout({ phone: true, focusShown: true, viewMode: 'list' })).toEqual({ path: true, chips: 'list' });
    expect(phoneBrowseLayout({ phone: true, focusShown: true, viewMode: 'kanban' })).toEqual({ path: false, chips: 'bar' });
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
