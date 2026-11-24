import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react';
import type { LineColumn } from '../../lib/overview-rail/landmarks.js';
import { type Box, layoutRail, nearbyHeadings, RAIL_HIT_WIDTH, RAIL_SPACE, RAIL_WIDTH, railGrip, type RailModel, railScrolls, type RailWidthMode, railWidthMode, scrollTopForThumb, sectionLabelAt } from '../../lib/overview-rail/layout.js';
import { type Extent, layoutMinimap, type MinimapShape } from '../../lib/overview-rail/minimap.js';
import { RAIL_SCROLLER_ATTRIBUTE, RAIL_SPACE_PROPERTY, type RailAdapter } from './adapter.js';
import type { RailContent } from './landmarks-of.js';
import { RailMarks } from './RailMarks.js';
import { RailPopover } from './RailPopover.js';
import './overview-rail.css';

/** What an editor's host hands it for its rail: the rail shows only where the host gives these. */
export interface OverviewRailOptions {
  /** Find's matches in the editor's text, while the find panel is open; keep the array stable between renders. */
  matches?: readonly LineColumn[];
}

interface OverviewRailProps extends OverviewRailOptions {
  adapter: RailAdapter;
  /** Changes when the text changed without an event the adapter hears: the source textarea's value set from outside. */
  revision?: unknown;
}

interface RailFrame {
  mode: RailWidthMode;
  /** The rail's box within its offset parent. */
  left: number;
  top: number;
  height: number;
  model: RailModel;
  /** How many columns a row of the editor holds: a heading's mark is as long as its label takes of a row. */
  columns: number;
  /** The ground the rail hides unwrapped text behind, for an adapter that `covers`. */
  ground?: string;
}

/** A press on the rail being dragged, as a scrollbar's thumb is. */
interface RailDrag {
  /** Where the pointer holds the visible range, from its top. */
  grip: number;
  /** The scroll before the press, which Escape goes back to. */
  startScroll: number;
  /** The pointer's height on the rail. */
  top: number;
}

const NO_MATCHES: readonly LineColumn[] = [];
const NO_LANDMARKS: RailContent = { headings: [], breaks: [], endLabel: null, blocks: [] };
const NO_SHAPES: MinimapShape[] = [];
/** How long a popover stays after the pointer leaves the rail, so it can be reached. */
const LINGER_MS = 250;
/** How long typing waits before the outline and pages are read again. */
const LANDMARK_DELAY_MS = 200;

/** The first ground that is not transparent from `element` up: what the scroller's text is seen against. */
function groundOf(element: HTMLElement): string | undefined {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const color = getComputedStyle(current).backgroundColor;
    if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return undefined;
}

const sameFrame = (a: RailFrame | null, b: RailFrame | null) => a === b || Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b);
const sameShapes = (a: readonly MinimapShape[], b: readonly MinimapShape[]) => a.length === b.length && a.every((shape, index) => shape.kind === b[index].kind && shape.x === b[index].x && shape.y === b[index].y && shape.width === b[index].width && shape.height === b[index].height);

/** Each block's extent: its first line's top to its last line's bottom. */
function blockExtents(adapter: RailAdapter, blocks: RailContent['blocks']): Extent[] {
  const starts = adapter.extents(blocks.map(block => block.line));
  const spanning = blocks.flatMap((block, index) => block.endLine > block.line ? [index] : []);
  const ends = adapter.extents(spanning.map(index => blocks[index].endLine));
  spanning.forEach((index, at) => {
    starts[index] = { top: starts[index].top, bottom: Math.max(starts[index].bottom, ends[at].bottom) };
  });
  return starts;
}

/**
 * The overview rail at an editor's right edge, in place of its native scrollbar: a minimap of the note's blocks with its headings, page
 * breaks, find matches, caret and visible range at their place in the scroll. It scrolls as a scrollbar does: the visible range drags as
 * its thumb, and a press on the track brings the thumb there at once and drags on. Hovering shows the headings near the pointer, and a
 * click on one goes there. It draws nothing while the note fits its view, and the native scrollbar then is as before.
 */
export function OverviewRail({ adapter, matches = NO_MATCHES, revision }: OverviewRailProps) {
  const root = useRef<HTMLDivElement>(null);
  const [landmarks, setLandmarks] = useState<RailContent>(NO_LANDMARKS);
  const [frame, setFrame] = useState<RailFrame | null>(null);
  const [shapes, setShapes] = useState<MinimapShape[]>(NO_SHAPES);
  /** The pointer's height on the rail while it hovers there unpressed: the popover shows the headings near it. */
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<RailDrag | null>(null);
  const linger = useRef<ReturnType<typeof setTimeout>>();

  // The outline and pages, read again a moment after the text changes.
  const textChanged = useRef(() => {});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, waited = false;
    const read = () => setLandmarks(adapter.landmarks());
    read();
    textChanged.current = () => {
      clearTimeout(timer);
      // The first text is read at once (a view built after the rail announces it); typing waits.
      if (waited) timer = setTimeout(read, LANDMARK_DELAY_MS);
      else read();
      waited = true;
    };
    const unsubscribe = adapter.subscribe(change => {
      if (change === 'doc') textChanged.current();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [adapter]);
  const shownRevision = useRef(revision);
  useEffect(() => {
    if (shownRevision.current === revision) return;
    shownRevision.current = revision;
    textChanged.current();
  }, [revision]);

  // Geometry, once per frame at most: where the rail sits and where each mark goes.
  useEffect(() => {
    let request = 0, spaced: HTMLElement | null = null, spacedMode: RailWidthMode | null = null, drawnKey = '';
    const measure = () => {
      request = 0;
      const scroller = adapter.scroller(), element = root.current, parent = element?.offsetParent;
      if (!scroller || !element || !(parent instanceof HTMLElement)) return setFrame(null);
      // The rail is the scroller's scrollbar: its own goes before its width is read.
      if (!scroller.hasAttribute(RAIL_SCROLLER_ATTRIBUTE)) scroller.setAttribute(RAIL_SCROLLER_ATTRIBUTE, '');
      const mode = railWidthMode(scroller.clientWidth);
      if (spaced !== scroller || spacedMode !== mode) {
        spaced = scroller;
        spacedMode = mode;
        scroller.style.setProperty(RAIL_SPACE_PROPERTY, `${RAIL_SPACE[mode]}px`);
        adapter.remeasure();
      }
      // A drag keeps the thumb under the pointer while the content's heights settle: the editor measures what a scroll brought into view.
      const held = drag.current;
      if (held) {
        const want = scrollTopForThumb(held.top - held.grip, { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, railHeight: scroller.clientHeight });
        if (Math.abs(want - scroller.scrollTop) >= 1) scroller.scrollTop = want;
      }
      const geometry = { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, scrollTop: scroller.scrollTop, railHeight: scroller.clientHeight };
      if (!railScrolls(geometry)) return setFrame(null);
      const cursor = adapter.cursor();
      const places = [...landmarks.headings.map(heading => ({ line: heading.line, column: 0 })), ...landmarks.breaks.map(item => ({ line: item.line, column: 0 })), ...matches, ...cursor ? [cursor] : []];
      const tops = adapter.tops(places);
      const headingCount = landmarks.headings.length, breakCount = landmarks.breaks.length;
      const model = layoutRail({ ...geometry, headings: landmarks.headings.map((heading, index) => ({ ...heading, y: tops[index] })), breaks: landmarks.breaks.map((item, index) => ({ y: tops[headingCount + index], label: item.label })), endLabel: landmarks.endLabel, matches: tops.slice(headingCount + breakCount, headingCount + breakCount + matches.length), cursor: cursor ? tops[tops.length - 1] : null });
      const metrics = adapter.metrics();
      // The minimap moves only when the blocks, the content's heights or the rail's size do, not as the view scrolls.
      const key = `${mode}:${scroller.scrollHeight}:${scroller.clientHeight}:${metrics.columns}:${metrics.lineHeight}`;
      if (key !== drawnKey) {
        drawnKey = key;
        const next = layoutMinimap({ mode, blocks: landmarks.blocks, extents: blockExtents(adapter, landmarks.blocks), scrollHeight: scroller.scrollHeight, railHeight: scroller.clientHeight, lineHeight: metrics.lineHeight, columns: metrics.columns });
        setShapes(previous => sameShapes(previous, next) ? previous : next);
      }
      const scrollerBox = scroller.getBoundingClientRect(), parentBox = parent.getBoundingClientRect();
      const left = scrollerBox.left + scroller.clientLeft + scroller.clientWidth - RAIL_HIT_WIDTH[mode] - parentBox.left - parent.clientLeft + parent.scrollLeft;
      const top = scrollerBox.top + scroller.clientTop - parentBox.top - parent.clientTop + parent.scrollTop;
      const next = { mode, left, top, height: scroller.clientHeight, model, columns: metrics.columns, ground: adapter.covers ? groundOf(scroller) : undefined };
      setFrame(previous => sameFrame(previous, next) ? previous : next);
    };
    const schedule = () => {
      if (!request) request = requestAnimationFrame(measure);
    };
    schedule();
    const unsubscribe = adapter.subscribe(schedule);
    // Absent outside a browser (the test DOM), where nothing is laid out to follow.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const scroller = adapter.scroller();
    if (scroller) resize?.observe(scroller);
    if (root.current?.offsetParent) resize?.observe(root.current.offsetParent);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(request);
      unsubscribe();
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [adapter, landmarks, matches]);

  // The room asked of the text goes with the rail, and the scroller's own scrollbar comes back.
  useEffect(() => () => {
    const scroller = adapter.scroller();
    scroller?.style.removeProperty(RAIL_SPACE_PROPERTY);
    scroller?.removeAttribute(RAIL_SCROLLER_ATTRIBUTE);
    adapter.remeasure();
  }, [adapter]);

  // Escape puts a drag's scroll back, or closes the popover, before the note's panel hears it.
  const open = hover !== null || dragging;
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const scroller = adapter.scroller();
      if (drag.current && scroller) scroller.scrollTop = drag.current.startScroll;
      drag.current = null;
      setDragging(false);
      setHover(null);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, adapter]);
  useEffect(() => () => clearTimeout(linger.current), []);

  const heightAt = (event: ReactPointerEvent) => event.clientY - event.currentTarget.getBoundingClientRect().top;
  const stay = () => clearTimeout(linger.current);
  const leave = () => {
    clearTimeout(linger.current);
    linger.current = setTimeout(() => setHover(null), LINGER_MS);
  };
  const go = (line: number) => {
    setHover(null);
    adapter.jumpTo(line);
  };
  /** Scrolls so the visible range's grip lies at `top` on the rail, at once, as a dragged scrollbar thumb does. */
  const follow = (top: number) => {
    const scroller = adapter.scroller(), held = drag.current;
    if (!scroller || !held || !frame) return;
    held.top = top;
    scroller.scrollTop = scrollTopForThumb(top - held.grip, { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, railHeight: frame.height });
  };
  const press = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scroller = adapter.scroller();
    if (event.button !== 0 || !frame || !scroller) return;
    // No focus, caret or selection moves: the press is the scrollbar's.
    event.preventDefault();
    stay();
    adapter.releaseJump?.();
    event.currentTarget.setPointerCapture(event.pointerId);
    const top = heightAt(event), { visible } = frame.model;
    drag.current = { grip: railGrip(top, visible), startScroll: scroller.scrollTop, top };
    setDragging(true);
    setHover(null);
    const onThumb = top >= visible.top && top <= visible.top + visible.height;
    if (!onThumb) follow(top);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    stay();
    if (drag.current) follow(heightAt(event));
    else if (event.buttons === 0) setHover(heightAt(event));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    endDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // Released over the rail, it shows the headings there; anywhere else, nothing.
    const box = event.currentTarget.getBoundingClientRect();
    const over = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    setHover(over ? heightAt(event) : null);
  };
  // A capture lost without a release (the window lost focus) leaves the scroll where the drag took it.
  const lose = () => {
    if (drag.current) endDrag();
  };
  const wheel = (event: ReactWheelEvent) => {
    const scroller = adapter.scroller();
    if (!scroller || event.altKey || event.ctrlKey) return;
    adapter.releaseJump?.();
    scroller.scrollTop += event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1);
  };

  const nearby = frame && hover !== null && !dragging ? nearbyHeadings(frame.model.headings, hover) : null;
  const activeIndex = nearby ? nearby.items[nearby.active].index : null;
  const railBox = (): Box | null => {
    const element = root.current;
    if (!element || !frame) return null;
    const box = element.getBoundingClientRect();
    return { left: box.right - RAIL_WIDTH[frame.mode], right: box.right, top: box.top, bottom: box.bottom };
  };
  const columnBox = (): Box | null => {
    const box = adapter.scroller()?.getBoundingClientRect();
    return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
  };
  const measure = () => {
    const rail = railBox(), column = columnBox();
    return rail && column ? { rail, column } : null;
  };
  return (
    <>
      <div
        ref={root}
        className='overview-rail'
        data-overview-rail={frame?.mode}
        data-dragging={dragging || undefined}
        // Out of sight but laid out while there is nothing to show, so its offset parent can still be read.
        style={frame ? { left: frame.left, top: frame.top, width: RAIL_HIT_WIDTH[frame.mode], height: frame.height, ...frame.ground && { background: frame.ground } } : { visibility: 'hidden', pointerEvents: 'none', width: 0, height: 0 }}
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={release}
        onPointerLeave={leave}
        onLostPointerCapture={lose}
        onMouseDown={event => event.preventDefault()}
        onWheel={wheel}
      >
        {frame && <RailMarks mode={frame.mode} height={frame.height} model={frame.model} shapes={shapes} columns={frame.columns} active={activeIndex} />}
      </div>
      {/* A sibling, not a child: events from the portal bubble through React's tree, and the rail's own press must not hear them. */}
      {frame && hover !== null && nearby && <RailPopover mode={frame.mode} nearby={nearby} section={sectionLabelAt(frame.model, nearby.items[nearby.active].top)} measure={measure} pointerTop={hover} onChoose={go} onPointerEnter={stay} onPointerLeave={leave} />}
    </>
  );
}
