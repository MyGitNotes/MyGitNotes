import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react';
import type { LineColumn, RailLandmarks } from '../../lib/overview-rail/landmarks.js';
import { type Box, layoutRail, nearbyHeadings, RAIL_HIT_WIDTH, RAIL_SCROLLBAR_GAP, RAIL_WIDTH, type RailModel, railScrolls, type RailWidthMode, railWidthMode, sectionLabelAt } from '../../lib/overview-rail/layout.js';
import { RAIL_SPACE, RAIL_SPACE_PROPERTY, type RailAdapter } from './adapter.js';
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
  /** The ground the rail hides unwrapped text behind, for an adapter that `covers`; it reaches over the gap to the scrollbar, the pixel the gap ends in included. */
  ground?: string;
}

interface RailPointer {
  /** The pointer's height on the rail. */
  top: number;
  dragging: boolean;
}

const NO_MATCHES: readonly LineColumn[] = [];
const NO_LANDMARKS: RailLandmarks = { headings: [], breaks: [], endLabel: null };
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

/**
 * The overview rail beside an editor's native scrollbar: the note's headings, page breaks, find matches, caret and visible range at
 * their place in the scroll. It never scrolls by itself while hovered or dragged: pointing previews nearby headings, and a click or a
 * release goes to one. The native scrollbar on its right keeps scrolling as before. It draws nothing while the note fits its view.
 */
export function OverviewRail({ adapter, matches = NO_MATCHES, revision }: OverviewRailProps) {
  const root = useRef<HTMLDivElement>(null);
  const [landmarks, setLandmarks] = useState<RailLandmarks>(NO_LANDMARKS);
  const [frame, setFrame] = useState<RailFrame | null>(null);
  const [pointer, setPointer] = useState<RailPointer | null>(null);
  const pointerState = useRef<RailPointer | null>(null);
  const linger = useRef<ReturnType<typeof setTimeout>>();
  const showPointer = (next: RailPointer | null) => {
    pointerState.current = next;
    setPointer(next);
  };

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
    let request = 0, spaced: HTMLElement | null = null;
    const measure = () => {
      request = 0;
      const scroller = adapter.scroller(), element = root.current, parent = element?.offsetParent;
      if (!scroller || !element || !(parent instanceof HTMLElement)) return setFrame(null);
      const mode = railWidthMode(scroller.clientWidth);
      if (spaced !== scroller) {
        spaced = scroller;
        scroller.style.setProperty(RAIL_SPACE_PROPERTY, RAIL_SPACE);
        adapter.remeasure();
      }
      const geometry = { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, scrollTop: scroller.scrollTop, railHeight: scroller.clientHeight };
      if (!railScrolls(geometry)) return setFrame(null);
      const cursor = adapter.cursor();
      const places = [...landmarks.headings.map(heading => ({ line: heading.line, column: 0 })), ...landmarks.breaks.map(item => ({ line: item.line, column: 0 })), ...matches, ...cursor ? [cursor] : []];
      const tops = adapter.tops(places);
      const headingCount = landmarks.headings.length, breakCount = landmarks.breaks.length;
      const model = layoutRail({ ...geometry, headings: landmarks.headings.map((heading, index) => ({ ...heading, y: tops[index] })), breaks: landmarks.breaks.map((item, index) => ({ y: tops[headingCount + index], label: item.label })), endLabel: landmarks.endLabel, matches: tops.slice(headingCount + breakCount, headingCount + breakCount + matches.length), cursor: cursor ? tops[tops.length - 1] : null });
      const scrollerBox = scroller.getBoundingClientRect(), parentBox = parent.getBoundingClientRect();
      const left = scrollerBox.left + scroller.clientLeft + scroller.clientWidth - RAIL_SCROLLBAR_GAP - RAIL_HIT_WIDTH[mode] - parentBox.left - parent.clientLeft + parent.scrollLeft;
      const top = scrollerBox.top + scroller.clientTop - parentBox.top - parent.clientTop + parent.scrollTop;
      const next = { mode, left, top, height: scroller.clientHeight, model, ground: adapter.covers ? groundOf(scroller) : undefined };
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

  // The room asked of the text goes with the rail.
  useEffect(() => () => {
    const scroller = adapter.scroller();
    scroller?.style.removeProperty(RAIL_SPACE_PROPERTY);
    adapter.remeasure();
  }, [adapter]);

  // Escape cancels a drag, or closes the popover, before the note's panel hears it.
  const open = pointer !== null;
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      showPointer(null);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open]);
  useEffect(() => () => clearTimeout(linger.current), []);

  const heightAt = (event: ReactPointerEvent) => event.clientY - event.currentTarget.getBoundingClientRect().top;
  const stay = () => clearTimeout(linger.current);
  const leave = () => {
    clearTimeout(linger.current);
    linger.current = setTimeout(() => {
      if (!pointerState.current?.dragging) showPointer(null);
    }, LINGER_MS);
  };
  const go = (line: number) => {
    showPointer(null);
    adapter.jumpTo(line);
  };
  const targetLine = (top: number) => {
    const near = frame && nearbyHeadings(frame.model.headings, top);
    return near ? near.items[near.active].line : null;
  };
  const press = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stay();
    event.currentTarget.setPointerCapture(event.pointerId);
    showPointer({ top: heightAt(event), dragging: true });
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    stay();
    const dragging = Boolean(pointerState.current?.dragging);
    if (dragging || event.buttons === 0) showPointer({ top: heightAt(event), dragging });
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = pointerState.current;
    if (!current?.dragging) return;
    const line = targetLine(heightAt(event));
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (line === null) showPointer(null);
    else go(line);
  };
  // A capture lost without a release (the window lost focus, Escape) moves nothing.
  const lose = () => {
    if (pointerState.current?.dragging) showPointer(null);
  };
  const wheel = (event: ReactWheelEvent) => {
    const scroller = adapter.scroller();
    if (!scroller || event.altKey || event.ctrlKey) return;
    scroller.scrollTop += event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1);
  };

  const nearby = frame && pointer ? nearbyHeadings(frame.model.headings, pointer.top) : null;
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
  const rail = nearby && railBox(), column = nearby && columnBox();
  return (
    <>
      <div
        ref={root}
        className='overview-rail'
        data-overview-rail={frame?.mode}
        data-dragging={pointer?.dragging || undefined}
        // Out of sight but laid out while there is nothing to show, so its offset parent can still be read.
        style={frame ? { left: frame.left, top: frame.top, width: RAIL_HIT_WIDTH[frame.mode], height: frame.height, ...frame.ground && { background: frame.ground, boxShadow: `${RAIL_SCROLLBAR_GAP + 1}px 0 0 ${frame.ground}` } } : { visibility: 'hidden', pointerEvents: 'none', width: 0, height: 0 }}
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={release}
        onPointerLeave={leave}
        onLostPointerCapture={lose}
        onMouseDown={event => event.preventDefault()}
        onWheel={wheel}
      >
        {frame && <RailMarks mode={frame.mode} height={frame.height} model={frame.model} active={activeIndex} dragging={Boolean(pointer?.dragging)} />}
      </div>
      {/* A sibling, not a child: events from the portal bubble through React's tree, and the rail's own press must not hear them. */}
      {frame && pointer && nearby && rail && column && <RailPopover mode={frame.mode} nearby={nearby} section={sectionLabelAt(frame.model, nearby.items[nearby.active].top)} dragging={pointer.dragging} rail={rail} column={column} pointerY={rail.top + pointer.top} onChoose={go} onPointerEnter={stay} onPointerLeave={leave} />}
    </>
  );
}
