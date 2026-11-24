// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FocusLayout } from '@mygitnotes/core/focus-page';
import { useShortcutSurface } from './useShortcutSurface.js';
import { browseColumnCommands } from './useBrowseColumns.js';
import { keymapEntry } from '../lib/keyboard/keymap.js';

const layout: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: [{ kind: 'note', path: 'notes/a.compilation.yml' }] } };
const noteFocus = { shown: 'current', editable: true, layout, entry: { activePane: 'p1', shown: { p1: 'note:notes/a.compilation.yml' }, recent: ['p1'], history: {}, ratios: {}, hideToolbar: {} }, view: { last: null }, focuses: [] };
const focusDisplay = { panes: [{ pane: 'p1', panes: ['p1'], key: 'note:notes/a.compilation.yml' }] };

const splitRight = (focusCapacity: 'all' | 1 | 2) => {
  const { result } = renderHook(() => useShortcutSurface({ noteFocus, focusDisplay, t: (key: string) => key, showFocus: async () => {}, requestClear: () => {}, zoomFocusNote: () => {}, focusCapacity } as never));
  return result.current.focusCommands.find(command => command.id === 'focus-split-right')!.availability!();
};

describe('Split commands in the palette', () => {
  it('are available on desktop and unavailable below it', () => {
    expect(splitRight('all')).toEqual({ enabled: true });
    expect(splitRight(1)).toMatchObject({ enabled: false });
    expect(splitRight(2)).toMatchObject({ enabled: false });
  });
});

describe('Close Focus in the palette', () => {
  const closeFocus = (shown: string) => {
    const { result } = renderHook(() => useShortcutSurface({ noteFocus: { ...noteFocus, shown }, focusDisplay, t: (key: string) => key, showFocus: async () => {}, requestClear: () => {}, zoomFocusNote: () => {}, focusCapacity: 'all' } as never));
    return result.current.focusCommands.find(command => command.id === 'focus-close')!.availability!();
  };

  it('closes a named Focus but never the Default', () => {
    expect(closeFocus('saved-id')).toEqual({ enabled: true });
    expect(closeFocus('current')).toMatchObject({ enabled: false });
  });
});

describe('Folding the columns from the palette and the keyboard', () => {
  it('leaves the Focus commands without a browse toggle: the columns have their own commands', () => {
    const { result } = renderHook(() => useShortcutSurface({ noteFocus, focusDisplay, t: (key: string) => key, showFocus: async () => {}, requestClear: () => {}, zoomFocusNote: () => {}, focusCapacity: 'all' } as never));
    expect(result.current.focusCommands.map(command => command.id)).not.toContain('focus-toggle-browse');
  });

  it('folds the notebooks column with Mod+\\ and the list with Mod+Shift+\\', () => {
    const columns = { layout: { notebooks: 'open' as const, list: true }, measure: () => {}, toggleNotebooks: vi.fn(), toggleList: vi.fn() };
    const t = ((key: string) => key) as never;
    const commands = browseColumnCommands(columns, t);
    expect(browseColumnCommands(columns, t, 'kanban').map(command => command.id)).toEqual(['browse.toggleNotebooks']);
    expect(commands.map(command => [command.id, command.title])).toEqual([['browse.toggleNotebooks', 'command.browse.toggleNotebooks'], ['browse.toggleList', 'command.browse.toggleList']]);
    void commands[0].run({} as never);
    expect(columns.toggleNotebooks).toHaveBeenCalledOnce();
    void commands[1].run({} as never);
    expect(columns.toggleList).toHaveBeenCalledOnce();
    expect(keymapEntry('browse.toggleNotebooks').bindings.map(binding => binding.keys)).toEqual(['Mod+\\']);
    expect(keymapEntry('browse.toggleList').bindings.map(binding => binding.keys)).toEqual(['Mod+Shift+\\']);
  });
});
