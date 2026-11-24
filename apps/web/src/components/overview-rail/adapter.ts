import type { LineColumn, RailLandmarks } from '../../lib/overview-rail/landmarks.js';
import { positionsOfOffsets } from '../../lib/overview-rail/landmarks.js';
import { type RailLabels, textLandmarks } from './landmarks-of.js';

/** `doc`: the text changed; `layout`: heights, scroll or the caret moved. */
export type RailChange = 'doc' | 'layout';

/** What the overview rail reads from an editor, the live CodeMirror view or the source textarea alike. */
export interface RailAdapter {
  /** The element whose native scrollbar the rail sits beside; null while there is none. */
  scroller: () => HTMLElement | null;
  landmarks: () => RailLandmarks;
  /** Each place's top within the scroller's content, as `scrollTop` counts it. */
  tops: (places: readonly LineColumn[]) => number[];
  /** The caret, or null while the editor has none to show. */
  cursor: () => LineColumn | null;
  /** Scrolls a line to the top of the view, the caret staying where it is, as dragging the scrollbar leaves it. */
  jumpTo: (line: number) => void;
  /** Text that does not wrap runs on under the rail, which then hides it behind the scroller's ground. */
  covers?: boolean;
  /** Measures again after the rail changed the room the text takes. */
  remeasure: () => void;
  subscribe: (listener: (change: RailChange) => void) => () => void;
}

/**
 * The room the rail asks of the text on the scroller's right, as a custom property each editor's padding adds: with the scroller's own
 * 16 px it clears the wide rail with a gap, and the narrow rail's 24 px reach for the pointer, so no text ever lies under either.
 */
export const RAIL_SPACE_PROPERTY = '--overview-rail-space';
export const RAIL_SPACE = '12px';

/**
 * The source textarea's rail. It does not wrap, so every line takes the same height and a line's top is exact. Text set from outside
 * (another editor, an agent) fires no event; the rail is told of it by its `revision` instead.
 */
export function textareaRailAdapter(area: HTMLTextAreaElement, slides: boolean, labels: RailLabels): RailAdapter {
  const top = (line: number, style = getComputedStyle(area)) => (Number.parseFloat(style.paddingTop) || 0) + (line - 1) * (Number.parseFloat(style.lineHeight) || 22.75);
  return {
    scroller: () => area.isConnected ? area : null,
    landmarks: () => textLandmarks(area.value, slides, labels),
    tops(places) {
      const style = getComputedStyle(area);
      return places.map(place => top(place.line, style));
    },
    cursor: () => positionsOfOffsets(area.value, [area.selectionStart])[0],
    jumpTo: line => area.scrollTo({ top: Math.max(0, top(line) - 16) }),
    covers: true,
    remeasure: () => {},
    subscribe(listener) {
      const doc = () => listener('doc'), layout = () => listener('layout');
      const events: [string, () => void][] = [['input', doc], ['scroll', layout], ['select', layout], ['keyup', layout], ['pointerup', layout], ['focus', layout], ['blur', layout]];
      for (const [name, handler] of events) area.addEventListener(name, handler);
      // Absent outside a browser (the test DOM); a resize there needs no rail.
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(layout);
      resize?.observe(area);
      return () => {
        for (const [name, handler] of events) area.removeEventListener(name, handler);
        resize?.disconnect();
      };
    },
  };
}
