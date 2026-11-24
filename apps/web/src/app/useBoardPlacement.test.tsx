// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useBoardPlacement } from './useBoardPlacement.js';

afterEach(() => window.localStorage.clear());

type Props = { presentation: 'list' | 'kanban'; focusOpen: boolean; panes: number; };

describe('the board beside the Focus or folded into the list column', () => {
  it('opens a card beside the board, folds on 開進 Focus, and stands beside the Focus again on 展開看板', () => {
    const { result, rerender } = renderHook((props: Props) => useBoardPlacement(props), { initialProps: { presentation: 'kanban', focusOpen: false, panes: 0 } });
    expect(result.current.placement).toBe('full');
    rerender({ presentation: 'kanban', focusOpen: true, panes: 1 });
    expect(result.current.placement).toBe('side');
    act(() => result.current.fold());
    expect(result.current.placement).toBe('folded');
    expect(result.current.unfold).toBeDefined();
    act(() => result.current.unfold!());
    expect(result.current.placement).toBe('side');
  });

  it('keeps the board folded while the Focus has more panes, offering no way back until they merge, then returns to where it was', () => {
    const { result, rerender } = renderHook((props: Props) => useBoardPlacement(props), { initialProps: { presentation: 'kanban', focusOpen: true, panes: 2 } });
    expect(result.current.placement).toBe('folded');
    expect(result.current.unfold).toBeUndefined();
    rerender({ presentation: 'kanban', focusOpen: true, panes: 1 });
    expect(result.current.placement).toBe('side');
  });

  it('keeps the fold across a reload, and gives it up once the Focus shows no note', () => {
    const first = renderHook((props: Props) => useBoardPlacement(props), { initialProps: { presentation: 'kanban', focusOpen: true, panes: 1 } });
    act(() => first.result.current.fold());
    first.unmount();
    const { result, rerender } = renderHook((props: Props) => useBoardPlacement(props), { initialProps: { presentation: 'kanban', focusOpen: true, panes: 1 } });
    expect(result.current.placement).toBe('folded');
    rerender({ presentation: 'kanban', focusOpen: false, panes: 0 });
    expect(result.current.placement).toBe('full');
    rerender({ presentation: 'kanban', focusOpen: true, panes: 1 });
    expect(result.current.placement).toBe('side');
  });

  it('places nothing while the list shows', () => {
    const { result } = renderHook(() => useBoardPlacement({ presentation: 'list', focusOpen: true, panes: 2 }));
    expect(result.current.placement).toBeUndefined();
  });
});
