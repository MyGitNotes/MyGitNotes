// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FocusDivision, type FocusLayout, type FocusNode, type FocusTab, legacyFocusTree } from '@mygitnotes/core/focus-page';
import { activatePane, adoptedFocusViewKey, browseTarget, CURRENT_FOCUS, displayedPanes, emptyFocusView, entryView, type FocusEntryView, type FocusViewState, focusViewStorageKey, groupShown, hasStoredFocusView, readFocusView, shownAfterClose, showTab, sideTarget } from './focus-view.js';

const note = (path: string): FocusTab => ({ kind: 'note', path });
const lane = (id: string): FocusTab => ({ kind: 'note', path: `notes/${id}.compilation.yml` });
const leaf = (id: string, ...tabs: FocusTab[]): FocusNode => ({ kind: 'pane', id, tabs });
const split = (id: string, orientation: 'horizontal' | 'vertical', ...children: FocusNode[]): FocusNode => ({ kind: 'split', id, orientation, children });
/** A division's layout with the given tabs per pane, ids as a version 1 file migrates to. */
const layout = (division: FocusDivision, ...panes: FocusTab[][]): FocusLayout => ({ root: legacyFocusTree(division, panes) });
const entry = (overrides: Partial<FocusEntryView> = {}): FocusEntryView => ({ activePane: 'p1', shown: {}, recent: [], history: {}, ratios: {}, hideToolbar: {}, ...overrides });
const state = (overrides: Partial<FocusViewState> = {}): FocusViewState => ({ ...emptyFocusView(), ...overrides });

describe('emptyFocusView', () => {
  it('starts with a single empty pane and default dock sizes', () => {
    expect(emptyFocusView()).toEqual({ current: { root: leaf('p1') }, entries: {}, last: null, dock: { left: 320, top: 280, collapsed: true } });
  });
});

describe('readFocusView', () => {
  it('returns an empty view for non-object input', () => {
    for (const raw of [null, undefined, 42, 'garbage', [1, 2]]) expect(readFocusView(raw)).toEqual(emptyFocusView());
  });
  it('falls back to the empty layout when current fails the Focus schema', () => {
    expect(readFocusView({ current: { division: 'single', panes: [] } }).current).toEqual(emptyFocusView().current);
    expect(readFocusView({ current: { root: split('s', 'horizontal') } }).current).toEqual(emptyFocusView().current);
    expect(readFocusView({ current: 'nope' }).current).toEqual(emptyFocusView().current);
  });
  it('keeps a valid current layout', () => {
    const valid = layout('columns-2', [note('a.md')], []);
    expect(readFocusView({ current: valid }).current).toEqual(valid);
  });
  it('reads a scratch layout stored before the tree as its division tree', () => {
    const legacy = { division: 'major-left', panes: [{ tabs: [note('a.md')] }, { tabs: [] }, { tabs: [note('b.md')] }] };
    expect(readFocusView({ current: legacy }).current).toEqual(layout('major-left', [note('a.md')], [], [note('b.md')]));
  });
  it('drops individually invalid entries and keeps valid ones', () => {
    const valid = entry({ activePane: 'p2', shown: { p1: 'note:a.md', p2: null }, recent: ['p2', 'p1'], ratios: { g: { p1: 50, p2: 50 } } });
    const raw = { entries: { good: valid, notAnObject: 42, badActivePane: { ...valid, activePane: 7 }, badShown: { ...valid, shown: { p1: 1 } }, badRecent: { ...valid, recent: [0] }, badRatios: { ...valid, ratios: { g: { p1: 'x' } } }, badHide: { ...valid, hideToolbar: { p1: 'yes' } } } };
    expect(readFocusView(raw).entries).toEqual({ good: valid });
  });
  it('reads an entry stored without hideToolbar or history as having none', () => {
    const { hideToolbar: _hideToolbar, history: _history, ...older } = entry({ shown: { p1: 'note:a.md' } });
    expect(readFocusView({ entries: { f: older } }).entries.f).toEqual(entry({ shown: { p1: 'note:a.md' } }));
  });
  it('drops a non-object entries field entirely', () => {
    expect(readFocusView({ entries: 'nope' }).entries).toEqual({});
  });
  it('accepts current or a valid id for last, otherwise null', () => {
    expect(readFocusView({ last: CURRENT_FOCUS }).last).toBe(CURRENT_FOCUS);
    expect(readFocusView({ last: 'focus-1' }).last).toBe('focus-1');
    expect(readFocusView({ last: 'bad id with spaces' }).last).toBeNull();
    expect(readFocusView({ last: 7 }).last).toBeNull();
    expect(readFocusView({}).last).toBeNull();
  });
  it('falls back to each dock default individually', () => {
    expect(readFocusView({ dock: { left: 'x', top: 200, collapsed: 'false' } }).dock).toEqual({ left: 320, top: 200, collapsed: true });
    expect(readFocusView({ dock: { left: -10, top: 200, collapsed: true } }).dock).toEqual({ left: 320, top: 200, collapsed: true });
    expect(readFocusView({}).dock).toEqual(emptyFocusView().dock);
  });

  it('keeps a dock height stored under the legacy bottom key, preferring top', () => {
    expect(readFocusView({ dock: { left: 320, bottom: 400, collapsed: false } }).dock.top).toBe(400);
    expect(readFocusView({ dock: { top: 200, bottom: 400 } }).dock.top).toBe(200);
  });
});

/** An entry as a device stored it before layouts were trees: arrays by pane position, sizes under the old group names. */
const legacyEntry = (overrides: Record<string, unknown> = {}) => ({ activePane: 0, shown: [], recent: [], history: [], ratios: {}, hideToolbar: [], ...overrides });

describe('entryView', () => {
  const twoPane = layout('columns-2', [note('a.md'), note('b.md')], [lane('l1')]);
  it('normalizes a fresh key against the layout', () => {
    expect(entryView(state(), 'missing', twoPane)).toEqual({ activePane: 'p1', shown: { p1: 'note:a.md', p2: 'note:notes/l1.compilation.yml' }, recent: ['p1', 'p2'], history: { p1: ['note:a.md'], p2: ['note:notes/l1.compilation.yml'] }, ratios: {}, hideToolbar: { p1: false, p2: false } });
  });
  it('falls back to the first tab when the stored shown key is stale', () => {
    const stored = entry({ shown: { p1: 'note:gone.md', p2: 'note:notes/gone.compilation.yml' } });
    expect(entryView(state({ entries: { f: stored } }), 'f', twoPane).shown).toEqual({ p1: 'note:a.md', p2: 'note:notes/l1.compilation.yml' });
  });
  it('shows null for a pane with no tabs', () => {
    const withEmpty = layout('columns-2', [note('a.md')], []);
    expect(entryView(state(), 'f', withEmpty).shown).toEqual({ p1: 'note:a.md', p2: null });
  });
  it('falls back to the first pane when the stored active pane is unknown', () => {
    for (const activePane of ['', 'p9', 'columns-2']) {
      expect(entryView(state({ entries: { f: entry({ activePane }) } }), 'f', twoPane).activePane).toBe('p1');
    }
    expect(entryView(state({ entries: { f: entry({ activePane: 'p2' }) } }), 'f', twoPane).activePane).toBe('p2');
  });
  it('drops invalid or duplicate recent entries and appends missing panes in pane order', () => {
    const stored = entry({ recent: ['p2', 'p2', 'gone', 'p2'] });
    expect(entryView(state({ entries: { f: stored } }), 'f', twoPane).recent).toEqual(['p2', 'p1']);
  });
  it('keeps one hide-toolbar flag per pane id and drops those of panes that are gone', () => {
    expect(entryView(state({ entries: { f: entry({ hideToolbar: { p1: false, p2: true, p3: true } }) } }), 'f', twoPane).hideToolbar).toEqual({ p1: false, p2: true });
    expect(entryView(state({ entries: { f: entry({ hideToolbar: { p1: true } }) } }), 'f', twoPane).hideToolbar).toEqual({ p1: true, p2: false });
  });
  it('passes ratios through unchanged', () => {
    const stored = entry({ ratios: { 'columns-2': { p1: 30, p2: 70 } } });
    expect(entryView(state({ entries: { f: stored } }), 'f', twoPane).ratios).toEqual({ 'columns-2': { p1: 30, p2: 70 } });
  });
  it('keeps the view of a pane when another pane appears or goes, because it is keyed by id', () => {
    const stored = entry({ shown: { p1: 'note:b.md', p2: null }, hideToolbar: { p1: true, p2: false } });
    const grown = layout('major-left', [note('a.md'), note('b.md')], [], []);
    expect(entryView(state({ entries: { f: stored } }), 'f', grown)).toMatchObject({ shown: { p1: 'note:b.md', p2: null, p3: null }, hideToolbar: { p1: true, p2: false, p3: false } });
  });
});

describe('entries stored before the tree', () => {
  const grid = layout('grid-2x2', [note('a.md')], [note('b.md')], [note('c.md')], [note('d.md')]);
  it('map array positions to the layout panes in pane order', () => {
    const stored = legacyEntry({ activePane: 2, shown: ['note:a.md', 'note:b.md', 'note:c.md', 'note:d.md'], recent: [2, 0, 3, 1], history: [['note:a.md'], ['note:b.md'], ['note:c.md'], ['note:d.md']], hideToolbar: [false, true, false, false] });
    expect(readFocusView({ entries: { f: stored } }).entries.f).toEqual(stored);
    expect(entryView(state({ entries: { f: stored as never } }), 'f', grid)).toEqual({ activePane: 'p3', shown: { p1: 'note:a.md', p2: 'note:b.md', p3: 'note:c.md', p4: 'note:d.md' }, recent: ['p3', 'p1', 'p4', 'p2'], history: { p1: ['note:a.md'], p2: ['note:b.md'], p3: ['note:c.md'], p4: ['note:d.md'] }, ratios: {}, hideToolbar: { p1: false, p2: true, p3: false, p4: false } });
  });
  it('carry splitter sizes over to the split a group name stands for', () => {
    const stored = legacyEntry({ ratios: { 'grid-2x2': [30, 70], 'grid-2x2.0': [60, 40], 'grid-2x2.1': [20, 80] } });
    expect(entryView(state({ entries: { f: stored as never } }), 'f', grid).ratios).toEqual({ 'grid-2x2': { 'grid-2x2-0': 30, 'grid-2x2-1': 70 }, 'grid-2x2-0': { p1: 60, p2: 40 }, 'grid-2x2-1': { p3: 20, p4: 80 } });
    const major = layout('major-left', [], [], []);
    expect(entryView(state({ entries: { f: legacyEntry({ ratios: { 'major-left': [40, 60], 'major-left.1': [25, 75] } }) as never } }), 'f', major).ratios).toEqual({ 'major-left': { p1: 40, 'major-left-1': 60 }, 'major-left-1': { p2: 25, p3: 75 } });
  });
  it('drop a size group that matches no split or covers a different number of children', () => {
    const stored = legacyEntry({ ratios: { 'columns-3': [50, 50], 'grid-2x2': [100], 'grid-2x2.9': [50, 50] } });
    expect(entryView(state({ entries: { f: stored as never } }), 'f', grid).ratios).toEqual({});
  });
  it('drop positions beyond the panes the layout has', () => {
    const stored = legacyEntry({ activePane: 3, shown: ['note:a.md', 'note:b.md', 'note:c.md'], recent: [3, 1], hideToolbar: [true, true, true] });
    expect(entryView(state({ entries: { f: stored as never } }), 'f', layout('columns-2', [note('a.md')], [note('b.md')]))).toMatchObject({ activePane: 'p1', recent: ['p2', 'p1'], hideToolbar: { p1: true, p2: true } });
  });
});

describe('tab history', () => {
  it("keeps each pane's shown tabs most recent first, and only tabs still open there", () => {
    const shownTwice = showTab(showTab(showTab(entry({ shown: { p1: 'note:a.md' }, history: { p1: ['note:a.md'] } }), 'p1', 'note:b.md'), 'p1', 'note:c.md'), 'p1', 'note:a.md');
    expect(shownTwice.history.p1).toEqual(['note:a.md', 'note:c.md', 'note:b.md']);
    const closedB = layout('single', [note('a.md'), note('c.md')]);
    expect(entryView(state({ entries: { k: shownTwice } }), 'k', closedB).history).toEqual({ p1: ['note:a.md', 'note:c.md'] });
  });
  it('reads an entry stored before the history with none', () => {
    const { history: _, ...old } = entry({ shown: { p1: 'note:a.md' }, recent: ['p1'] });
    expect(readFocusView({ entries: { k: old } }).entries.k).toMatchObject({ history: {} });
  });
});

describe('activatePane and showTab', () => {
  it('activatePane sets activePane and moves the pane to the front of recent', () => {
    const result = activatePane(entry({ activePane: 'p1', recent: ['p1', 'p3', 'p2'] }), 'p2');
    expect(result).toEqual(entry({ activePane: 'p2', recent: ['p2', 'p1', 'p3'] }));
  });
  it('showTab sets the shown key for the pane and activates it', () => {
    const result = showTab(entry({ shown: { p1: 'note:a.md', p2: 'note:b.md' }, recent: ['p1', 'p2'] }), 'p2', 'note:c.md');
    expect(result).toEqual(entry({ activePane: 'p2', shown: { p1: 'note:a.md', p2: 'note:c.md' }, recent: ['p2', 'p1'], history: { p2: ['note:c.md'] } }));
  });
});

describe('browseTarget', () => {
  it('opens into the active pane', () => {
    expect(browseTarget(entry({ activePane: 'p3' }))).toBe('p3');
  });
});

describe('sideTarget', () => {
  it('returns nothing when there is only one pane', () => {
    expect(sideTarget(entry({ recent: ['p1'] }), 'p1', ['p1'])).toBeUndefined();
  });
  it('returns the most recently used pane other than the source', () => {
    expect(sideTarget(entry({ recent: ['p3', 'p1', 'p2'] }), 'p3', ['p1', 'p2', 'p3'])).toBe('p1');
    expect(sideTarget(entry({ recent: ['p1', 'p3', 'p2'] }), 'p1', ['p1', 'p2', 'p3'])).toBe('p3');
  });
  it('falls back to the next pane in pane order when recent has no other pane', () => {
    expect(sideTarget(entry({ recent: ['p1'] }), 'p1', ['p1', 'p2', 'p3'])).toBe('p2');
  });
  it('ignores a recent pane the layout no longer has', () => {
    expect(sideTarget(entry({ recent: ['gone', 'p2'] }), 'p1', ['p1', 'p2'])).toBe('p2');
  });
});

describe('shownAfterClose', () => {
  const three = layout('columns-3', [note('a.md'), note('b.md'), note('c.md')], [], []);
  it('returns to the tab shown before the closed one, as a stack', () => {
    expect(shownAfterClose(three, 'p1', 'note:b.md', ['note:b.md', 'note:a.md', 'note:c.md'])).toBe('note:a.md');
    expect(shownAfterClose(three, 'p1', 'note:a.md', ['note:a.md', 'note:gone.md', 'note:c.md'])).toBe('note:c.md');
  });
  it('without history, prefers the next tab to the right', () => {
    expect(shownAfterClose(three, 'p1', 'note:a.md')).toBe('note:b.md');
    expect(shownAfterClose(three, 'p1', 'note:b.md')).toBe('note:c.md');
  });
  it('falls back to the tab on the left when there is no tab to the right', () => {
    expect(shownAfterClose(three, 'p1', 'note:c.md')).toBe('note:b.md');
  });
  it('returns null when the pane becomes empty', () => {
    const single = layout('single', [note('only.md')]);
    expect(shownAfterClose(single, 'p1', 'note:only.md')).toBeNull();
  });
  it('returns null when the key is not in the pane', () => {
    expect(shownAfterClose(three, 'p1', 'note:missing.md')).toBeNull();
  });
  it('only looks inside the given pane, even when the key is open elsewhere', () => {
    const twoPanes = layout('columns-2', [note('a.md')], [note('b.md')]);
    expect(shownAfterClose(twoPanes, 'p2', 'note:a.md')).toBeNull();
  });
});

describe('groupShown', () => {
  const grouped = layout('columns-3', [note('a.md')], [note('b.md')], []);
  it('shows the active pane when it is in the group', () => {
    const view = entry({ activePane: 'p2', shown: { p1: 'note:a.md', p2: 'note:b.md', p3: null } });
    expect(groupShown(view, grouped, ['p2', 'p3'])).toEqual({ pane: 'p2', key: 'note:b.md' });
  });
  it('falls back to the first pane in the group with a shown key', () => {
    const view = entry({ activePane: 'p1', shown: { p1: 'note:a.md', p2: 'note:b.md', p3: null } });
    expect(groupShown(view, grouped, ['p2', 'p3'])).toEqual({ pane: 'p2', key: 'note:b.md' });
  });
  it('falls back to the first group pane with a null key when none has a shown tab', () => {
    const view = entry({ activePane: 'p1', shown: { p1: 'note:a.md', p2: null, p3: null } });
    expect(groupShown(view, grouped, ['p2', 'p3'])).toEqual({ pane: 'p2', key: null });
  });
  it('ignores a shown key that is stale against the layout', () => {
    const view = entry({ activePane: 'p2', shown: { p1: 'note:a.md', p2: 'note:gone.md', p3: null } });
    expect(groupShown(view, grouped, ['p2', 'p3'])).toEqual({ pane: 'p2', key: null });
  });
});

describe('displayedPanes', () => {
  const grid = layout('grid-2x2', [note('a.md')], [note('b.md')], [note('c.md')], [note('d.md')]);
  const shown = { p1: 'note:a.md', p2: 'note:b.md', p3: 'note:c.md', p4: 'note:d.md' };
  it('shows every stored pane when the screen has room', () => {
    const display = displayedPanes(entry({ shown }), grid, 'all');
    expect(display.root).toMatchObject({ kind: 'split', id: 'grid-2x2', orientation: 'vertical' });
    expect(display.panes).toEqual(['p1', 'p2', 'p3', 'p4'].map(id => ({ panes: [id], pane: id, key: shown[id as keyof typeof shown] })));
  });
  it('shows a tablet the root first child and the rest, following the active pane', () => {
    const display = displayedPanes(entry({ shown, activePane: 'p4' }), grid, 2);
    expect(display.root).toMatchObject({ id: 'display-2', orientation: 'vertical' });
    expect(display.panes).toEqual([{ panes: ['p1', 'p2'], pane: 'p1', key: 'note:a.md' }, { panes: ['p3', 'p4'], pane: 'p4', key: 'note:d.md' }]);
  });
  it('shows one pane on a phone', () => {
    expect(displayedPanes(entry({ shown, activePane: 'p3' }), grid, 1).panes).toEqual([{ panes: ['p1', 'p2', 'p3', 'p4'], pane: 'p3', key: 'note:c.md' }]);
  });
});

describe('hasStoredFocusView', () => {
  const repository = 'local:/notes/kb';
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('is false when this device has never recorded Focus-view state for the notebook', () => {
    expect(hasStoredFocusView(repository, 'local:repo', 'kb~life')).toBe(false);
  });

  it('is true once any Focus-view state exists for that notebook on this device', () => {
    localStorage.setItem(focusViewStorageKey(repository, 'kb~life'), JSON.stringify(emptyFocusView()));
    expect(hasStoredFocusView(repository, 'local:repo', 'kb~life')).toBe(true);
  });

  it('does not confuse one notebook with another', () => {
    localStorage.setItem(focusViewStorageKey(repository, 'kb~life'), JSON.stringify(emptyFocusView()));
    expect(hasStoredFocusView(repository, 'local:repo', 'kb~work')).toBe(false);
    expect(hasStoredFocusView(repository, 'local:repo', 'other~life')).toBe(false);
  });

  it('keeps apart two repositories whose names give them the same alias', () => {
    localStorage.setItem(focusViewStorageKey(repository, 'kb~life'), JSON.stringify(emptyFocusView()));
    expect(focusViewStorageKey(repository, 'kb~life')).toBe('github-notes:focus-view:local:/notes/kb:kb~life');
    expect(hasStoredFocusView('local:/elsewhere/kb', null, 'kb~life')).toBe(false);
  });

  it('copies a view kept before notebook keys to the key once, and only from its own scope', () => {
    const before = { ...emptyFocusView(), last: CURRENT_FOCUS };
    localStorage.setItem('github-notes:focus-view:local:repo:life', JSON.stringify(before));
    expect(hasStoredFocusView(repository, 'local:other', 'kb~life')).toBe(false);
    expect(adoptedFocusViewKey(repository, 'local:repo', 'kb~life')).toBe(focusViewStorageKey(repository, 'kb~life'));
    expect(JSON.parse(localStorage.getItem(focusViewStorageKey(repository, 'kb~life'))!)).toEqual(before);
    localStorage.setItem(focusViewStorageKey(repository, 'kb~life'), JSON.stringify(emptyFocusView()));
    adoptedFocusViewKey(repository, 'local:repo', 'kb~life');
    expect(JSON.parse(localStorage.getItem(focusViewStorageKey(repository, 'kb~life'))!)).toEqual(emptyFocusView());
  });

  it('leaves a view kept before notebook keys to the notebook its local id stands for', () => {
    localStorage.setItem('github-notes:focus-view:local:repo:life', JSON.stringify(emptyFocusView()));
    expect(hasStoredFocusView('local:/notes/other', null, 'other~life')).toBe(false);
    expect(localStorage.getItem(focusViewStorageKey('local:/notes/other', 'other~life'))).toBeNull();
  });
});
