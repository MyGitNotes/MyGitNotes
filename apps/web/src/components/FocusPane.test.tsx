// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { FocusLayout } from '@mygitnotes/core/focus-page';
import type { NoteFocus } from '../lib/use-note-focus.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { FocusPane } from './FocusPane.js';

// The pane body hosts a note editor; this test is about the tab bar and the pane frame.
vi.mock('./NoteEditorHost.js', () => ({ HostedNoteEditor: () => null }));

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const layout: FocusLayout = { root: { kind: 'split', id: 'columns-2', orientation: 'horizontal', children: [{ kind: 'pane', id: 'p1', tabs: [{ kind: 'note', path: 'notes/a.md' }, { kind: 'note', path: 'notes/b.compilation.yml' }] }, { kind: 'pane', id: 'p2', tabs: [{ kind: 'note', path: 'notes/c.md' }] }] } };
const focus = { notebookId: 'life', layout, entry: { activePane: 'p1', shown: { p1: 'note:notes/a.md', p2: 'note:notes/c.md' }, recent: ['p1', 'p2'], history: { p1: ['note:notes/a.md'], p2: ['note:notes/c.md'] }, ratios: {}, hideToolbar: { p1: false, p2: false } }, notes: new Map([['notes/a.md', { title: 'Alpha' }], ['notes/b.compilation.yml', { title: 'Beta list' }], ['notes/c.md', { title: 'Gamma' }]]), editable: false, shown: null } as unknown as NoteFocus;

function pane(index: number, searchMatches: ReadonlySet<string> | null) {
  const id = `p${index + 1}`;
  const displayed = { panes: [id], pane: id, key: index === 0 ? 'note:notes/a.md' : 'note:notes/c.md' };
  return render(createElement(I18nProvider, null, createElement(FocusPane, { focus, notebookRoot: 'notes', folders: [], renderCompilation: path => createElement('div', null, path), onZoomNote: () => {}, searchMatches, displayed })));
}
const dimmedTabs = () => [...document.querySelectorAll('.focus-tab[data-dimmed]')].map(tab => tab.textContent);

it('dims nothing while the search is inactive', () => {
  pane(0, null);
  expect(dimmedTabs()).toEqual([]);
  expect(document.querySelector('.focus-pane[data-dimmed]')).toBeNull();
});

it('dims the tabs that do not match, notes and compilations alike, and keeps a pane with a match undimmed', () => {
  pane(0, new Set(['notes/a.md']));
  expect(dimmedTabs()).toEqual(['Beta list']);
  expect(document.querySelector('.focus-pane[data-dimmed]')).toBeNull();
});

it('dims a pane as a whole when none of its tabs match, and clearing the search restores it', () => {
  const view = pane(1, new Set(['notes/a.md']));
  expect(dimmedTabs()).toEqual(['Gamma']);
  expect(document.querySelector('.focus-pane[data-dimmed]')).not.toBeNull();
  view.rerender(createElement(I18nProvider, null, createElement(FocusPane, { focus, notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote: () => {}, searchMatches: null, displayed: { panes: ['p2'], pane: 'p2', key: 'note:notes/c.md' } })));
  expect(dimmedTabs()).toEqual([]);
  expect(document.querySelector('.focus-pane[data-dimmed]')).toBeNull();
});
