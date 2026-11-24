// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KANBAN_PREFS, KANBAN_PREFS_KEY, LEGACY_BOARD_SHARE_KEY, parseKanbanPrefs, readKanbanPrefs, updateKanbanPrefs } from './kanban-prefs.js';
import { DOCK_SPLIT_MAX, DOCK_SPLIT_MIN } from './focus-view.js';

afterEach(() => window.localStorage.clear());

describe('the board preferences on this device', () => {
  it('reads a missing, damaged or partly wrong value field by field as the defaults', () => {
    expect(parseKanbanPrefs(null)).toEqual(DEFAULT_KANBAN_PREFS);
    expect(parseKanbanPrefs('{oops')).toEqual(DEFAULT_KANBAN_PREFS);
    expect(parseKanbanPrefs('[]')).toEqual(DEFAULT_KANBAN_PREFS);
    expect(parseKanbanPrefs(JSON.stringify({ density: 'tiny', columns: { done: 'strip', inbox: 'wide', '': 'open' }, foldedGroups: ['done', 3], folded: 'yes', boardShare: 200 }))).toEqual({ density: 'normal', columns: { done: 'strip', '': 'open' }, foldedGroups: ['done'], folded: false, boardShare: DOCK_SPLIT_MAX });
    expect(parseKanbanPrefs(JSON.stringify({ boardShare: 1 })).boardShare).toBe(DOCK_SPLIT_MIN);
  });

  it('stores a change, keeps the rest, and drops the old board height that meant the board above the Focus', () => {
    window.localStorage.setItem(LEGACY_BOARD_SHARE_KEY, '70');
    updateKanbanPrefs({ density: 'compact' });
    updateKanbanPrefs(current => ({ columns: { ...current.columns, done: 'strip' } }));
    expect(window.localStorage.getItem(LEGACY_BOARD_SHARE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(KANBAN_PREFS_KEY)!)).toEqual({ ...DEFAULT_KANBAN_PREFS, density: 'compact', columns: { done: 'strip' } });
    expect(readKanbanPrefs()).toBe(readKanbanPrefs());
    window.localStorage.clear();
    expect(readKanbanPrefs()).toEqual(DEFAULT_KANBAN_PREFS);
  });
});
