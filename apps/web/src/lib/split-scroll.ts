/**
 * Scroll sync between the two panes of split view. A source line and the rendered block it starts are a pair of scroll
 * offsets, one per pane; between pairs the offsets are interpolated, so a scroll in either pane maps to the other along
 * the same piecewise linear line and back again without drift.
 */
export interface ScrollPoint {
  /** The scroll offset of the source pane that brings the line to its top. */
  source: number;
  /** The scroll offset of the preview pane that brings the block to its top. */
  preview: number;
}

/**
 * The map's points: both tops, the anchors in order, and both scroll ends, so the panes reach their ends together.
 * An anchor that does not move forward in both panes (a block drawn above the one before it, or one past either end)
 * is dropped, which keeps the map monotonic and so invertible.
 */
export function scrollPoints(anchors: readonly ScrollPoint[], end: ScrollPoint): ScrollPoint[] {
  const points: ScrollPoint[] = [{ source: 0, preview: 0 }];
  for (const anchor of anchors) {
    const last = points[points.length - 1]!;
    if (anchor.source > last.source && anchor.preview > last.preview && anchor.source < end.source && anchor.preview < end.preview) points.push({ source: anchor.source, preview: anchor.preview });
  }
  const last = points[points.length - 1]!;
  if (end.source > last.source && end.preview > last.preview) points.push({ source: end.source, preview: end.preview });
  return points;
}

/** The scroll offset of the other pane for offset `y` of the pane `from`, clamped to the map's ends. */
export function mapScroll(points: readonly ScrollPoint[], y: number, from: keyof ScrollPoint): number {
  const to: keyof ScrollPoint = from === 'source' ? 'preview' : 'source';
  if (points.length === 0) return 0;
  if (y <= points[0]![from]) return points[0]![to];
  const last = points[points.length - 1]!;
  if (y >= last[from]) return last[to];
  // The last point at or above `y`, by binary search: a long note has thousands.
  let low = 0, high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (points[middle]![from] <= y) low = middle;
    else high = middle;
  }
  const a = points[low]!, b = points[high]!;
  return a[to] + (y - a[from]) / (b[from] - a[from]) * (b[to] - a[to]);
}
