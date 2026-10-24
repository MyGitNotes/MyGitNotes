import { describe, expect, it } from 'vitest';
import { FOCUS_MAX_DEPTH, FOCUS_MAX_PANES, type FocusLayout, type FocusTab, splitPane } from '@mygitnotes/core/focus-page';
import { dropRefusal, dropZone } from './focus-drop.js';

const box = { left: 100, top: 50, width: 400, height: 200 };
const at = (fx: number, fy: number) => dropZone(box, box.left + box.width * fx, box.top + box.height * fy);
const note = (path: string): FocusTab => ({ kind: 'note', path });

describe('dropZone', () => {
  it('is the centre away from every edge', () => {
    expect(at(0.5, 0.5)).toBe('center');
    expect(at(0.25, 0.5)).toBe('center');
    expect(at(0.75, 0.25)).toBe('center');
  });
  it('is the edge whose outer quarter holds the pointer', () => {
    expect(at(0.1, 0.5)).toBe('left');
    expect(at(0.9, 0.5)).toBe('right');
    expect(at(0.5, 0.1)).toBe('top');
    expect(at(0.5, 0.9)).toBe('bottom');
  });
  it('stops short of the quarter boundary and goes to the nearer edge in a corner', () => {
    expect(at(0.2499, 0.5)).toBe('left');
    expect(at(0.2501, 0.5)).toBe('center');
    expect(at(0.05, 0.2)).toBe('left');
    expect(at(0.2, 0.05)).toBe('top');
    expect(at(0.95, 0.8)).toBe('right');
    expect(at(0.8, 0.95)).toBe('bottom');
  });
});

describe('dropRefusal', () => {
  let wide: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: [note('a.md')] } };
  for (let count = 1; count < FOCUS_MAX_PANES; count++) wide = splitPane(wide, 'p1', 'right', note(`n${count}.md`)).layout;
  it('names the limit a split would hit, and nothing while there is room', () => {
    expect(dropRefusal({ root: { kind: 'pane', id: 'p1', tabs: [] } }, 'p1', 'right')).toBeUndefined();
    expect(dropRefusal(wide, 'p1', 'left')).toBe('pane-limit');
  });
  it('ignores a stale source pane instead of throwing', () => {
    expect(dropRefusal(wide, 'p1', 'bottom', { pane: 'gone', key: 'note:n1.md' })).toBeUndefined();
  });
  it('lets a move that empties its source pane through at the limit, but not a copy', () => {
    expect(dropRefusal(wide, 'p1', 'bottom', { pane: 'p2', key: 'note:n1.md' })).toBeUndefined();
    expect(dropRefusal(wide, 'p1', 'bottom', { pane: 'p2', key: 'note:n1.md' }, true)).toBe('pane-limit');
  });
  it('names the depth limit', () => {
    let deep: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: [] } }, target = 'p1';
    for (let level = 0; level < FOCUS_MAX_DEPTH; level++) {
      const result = splitPane(deep, target, level % 2 === 0 ? 'right' : 'bottom', note(`n${level}.md`));
      deep = result.layout;
      target = result.pane;
    }
    expect(dropRefusal(deep, target, 'right')).toBe('depth-limit');
    expect(dropRefusal(deep, target, 'bottom')).toBeUndefined();
  });
});
