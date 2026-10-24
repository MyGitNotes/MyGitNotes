import { type FocusEdge, FocusError, type FocusLayout, moveTabToSplit, splitPane } from '@mygitnotes/core/focus-page';

export type DropZone = FocusEdge | 'center';

/** The outer quarter of a pane's body on each side is that edge's zone (a corner goes to the nearer edge); the rest is the centre. */
export const EDGE_ZONE = 0.25;

export function dropZone(box: { left: number; top: number; width: number; height: number; }, x: number, y: number): DropZone {
  const dx = (x - box.left) / box.width, dy = (y - box.top) / box.height;
  const nearest = ([['left', dx], ['right', 1 - dx], ['top', dy], ['bottom', 1 - dy]] as [FocusEdge, number][]).reduce((best, edge) => edge[1] < best[1] ? edge : best);
  return nearest[1] < EDGE_ZONE ? nearest[0] : 'center';
}

export type DropRefusal = 'pane-limit' | 'depth-limit' | 'tab-limit';
const PROBE = { kind: 'note', path: 'probe.md' } as const;

/** The limit a split drop onto `pane`'s `edge` would hit, or undefined. A move (`source` without `copy`) can free the room it needs by emptying its source pane. */
export function dropRefusal(layout: FocusLayout, pane: string, edge: FocusEdge, source?: { pane: string; key: string; }, copy = false): DropRefusal | undefined {
  try {
    if (source && !copy) moveTabToSplit(layout, source.pane, source.key, pane, edge);
    else splitPane(layout, pane, edge, PROBE);
    return undefined;
  } catch (caught) {
    // A source pane that no longer exists is a stale drag, not a limit.
    if (caught instanceof FocusError && caught.code === 'invalid-pane') return undefined;
    if (caught instanceof FocusError && (caught.code === 'pane-limit' || caught.code === 'depth-limit' || caught.code === 'tab-limit')) return caught.code;
    throw caught;
  }
}
