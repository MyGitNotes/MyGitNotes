import type { GraphPlacement } from '@mygitnotes/core/compilation';

export { arrangeGraphLayout, type GraphPlacement } from '@mygitnotes/core/compilation';

/** Below this scale lane cards stop being readable; wider lanes pan instead of shrinking further. */
const MIN_LANE_ZOOM = .75;

/** Lane height follows graph-space bounds, never the user's camera transform. */
export function graphLaneViewport(layout: GraphPlacement, width: number) {
  const bounds = layout.nodes.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y)).map(n => ({ x: n.x, y: n.y, w: n.expanded ? n.width || 360 : 32, h: n.expanded ? n.height || 300 : 32 }));
  if (!bounds.length) return { height: 300, zoom: 1, x: 0, y: 0 };
  const left = Math.min(...bounds.map(n => n.x - n.w / 2)), right = Math.max(...bounds.map(n => n.x + n.w / 2));
  const top = Math.min(...bounds.map(n => n.y - n.h / 2)), bottom = Math.max(...bounds.map(n => n.y + n.h / 2));
  const fit = Math.max(1, width - 120) / Math.max(1, right - left), zoom = Math.min(1, Math.max(MIN_LANE_ZOOM, fit));
  // An overflowing lane opens at its left edge; the rest is reached by panning.
  const x = fit < zoom ? left + Math.max(1, width - 120) / 2 / zoom : (left + right) / 2;
  return { height: Math.max(300, Math.ceil((bottom - top) * zoom + 120)), zoom, x, y: (top + bottom) / 2 };
}
