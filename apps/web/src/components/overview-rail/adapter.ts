import type { LineColumn } from '../../lib/overview-rail/landmarks.js';
import { positionsOfOffsets } from '../../lib/overview-rail/landmarks.js';
import type { Extent } from '../../lib/overview-rail/minimap.js';
import { type RailContent, type RailLabels, textLandmarks } from './landmarks-of.js';

/** `doc`: the text changed; `layout`: heights, scroll or the caret moved. */
export type RailChange = 'doc' | 'layout';

/** What the overview rail reads from an editor, the live CodeMirror view or the source textarea alike. */
export interface RailAdapter {
  /** The element the rail scrolls, its native scrollbar hidden while the rail shows; null while there is none. */
  scroller: () => HTMLElement | null;
  landmarks: () => RailContent;
  /** Each place's top within the scroller's content, as `scrollTop` counts it. */
  tops: (places: readonly LineColumn[]) => number[];
  /** Each line's top and bottom within the scroller's content: the rows a wrapped line takes, or the drawing that shows it. */
  extents: (lines: readonly number[]) => Extent[];
  /** The height of one row of text, and how many columns a row holds. */
  metrics: () => { lineHeight: number; columns: number; };
  /** The caret, or null while the editor has none to show. */
  cursor: () => LineColumn | null;
  /** Scrolls a line to the top of the view, the caret staying where it is, as dragging the scrollbar leaves it. */
  jumpTo: (line: number) => void;
  /** Lets go of a line a jump still holds in place, before the rail scrolls by itself. */
  releaseJump?: () => void;
  /** Text that does not wrap runs on under the rail, which then hides it behind the scroller's ground. */
  covers?: boolean;
  /** Measures again after the rail changed the room the text takes. */
  remeasure: () => void;
  subscribe: (listener: (change: RailChange) => void) => () => void;
}

/**
 * The room the rail asks of the text on the scroller's right (`RAIL_SPACE`), as a custom property each editor's padding adds, so no
 * text ever lies under the rail.
 */
export const RAIL_SPACE_PROPERTY = '--overview-rail-space';
/** Set on the scroller while the rail is its scrollbar: its own vertical scrollbar is hidden (overview-rail.css). */
export const RAIL_SCROLLER_ATTRIBUTE = 'data-overview-rail-scroller';

/**
 * The source textarea's rail. It does not wrap, so every line takes the same height and a line's top is exact. Text set from outside
 * (another editor, an agent) fires no event; the rail is told of it by its `revision` instead.
 */
export function textareaRailAdapter(area: HTMLTextAreaElement, slides: boolean, labels: () => RailLabels): RailAdapter {
  const lineHeight = (style: CSSStyleDeclaration) => Number.parseFloat(style.lineHeight) || 22.75;
  const top = (line: number, style = getComputedStyle(area)) => (Number.parseFloat(style.paddingTop) || 0) + (line - 1) * lineHeight(style);
  return {
    scroller: () => area.isConnected ? area : null,
    landmarks: () => textLandmarks(area.value, slides, labels()),
    tops(places) {
      const style = getComputedStyle(area);
      return places.map(place => top(place.line, style));
    },
    extents(lines) {
      const style = getComputedStyle(area), height = lineHeight(style);
      return lines.map(line => {
        const at = top(line, style);
        return { top: at, bottom: at + height };
      });
    },
    metrics() {
      // The textarea does not wrap: a row holds what its width shows, in a monospace font about 0.6 em wide.
      const style = getComputedStyle(area), width = area.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
      return { lineHeight: lineHeight(style), columns: Math.max(20, Math.floor(width / ((Number.parseFloat(style.fontSize) || 14) * 0.6))) };
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
