import { type FocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Point, Rect } from '../../lib/board/geometry.js';
import { readBoardCamera, saveBoardCamera } from '../../lib/board/storage.js';
import { BOARD_ZOOM_MIN, type Camera, cameraAt, cameraCentre, fitCamera, type Size, steppedZoom, zoomAround } from '../../lib/board/zoom.js';

/** A press that moves farther than this, in CSS px, pans instead of clicking. */
const PAN_THRESHOLD = 4;
const SAVE_DELAY = 400;
/** The margin a fitted board keeps, and above it the room the floating controls take. */
const FIT_MARGIN = 32, FIT_TOP = 64;

export interface BoardCamera {
  viewport: React.RefObject<HTMLDivElement>;
  camera: Camera;
  size: Size;
  /** Whether the camera has been placed: fitted, or restored from this device. */
  ready: boolean;
  /** Whether the last move was the app's own (fit, zoom buttons, minimap), which may animate. */
  animated: boolean;
  zoomStep: (direction: 1 | -1) => void;
  fit: () => void;
  centreOn: (point: Point) => void;
  handlers: { onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void; onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void; onFocus: (event: FocusEvent<HTMLDivElement>) => void; onScroll: (event: React.UIEvent<HTMLDivElement>) => void; };
}

/**
 * The camera of one board: it opens fitted to the content (60%–100%) unless this device saved one for the board, and
 * it pans by a drag (any button but the right one, one finger on a phone), by scrolling or two trackpad fingers, and
 * zooms by Mod+wheel, a trackpad or two-finger pinch around the pointer, or the zoom control. The camera is saved
 * per device, as the board point at the viewport's centre, so another window size shows the same place.
 */
export function useBoardCamera({ board, bounds, loaded }: { /** The board's key on this device: notebook and path. */ board: string; bounds?: Rect; /** Whether every card is known, so the first fit sees the whole board. */ loaded: boolean; }): BoardCamera {
  const viewport = useRef<HTMLDivElement>(null!);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [state, setState] = useState<{ camera: Camera; animated: boolean; } | null>(null);
  const latest = useRef({ camera: state?.camera, size, bounds });
  useLayoutEffect(() => {
    latest.current = { camera: state?.camera, size, bounds };
  });
  const move = useCallback((next: (camera: Camera) => Camera, animated = false) => setState(current => current && { camera: next(current.camera), animated }), []);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setSize(current => current.width === element.clientWidth && current.height === element.clientHeight ? current : { width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The first camera, once the viewport has a size and the cards are known. A board switching in place starts over.
  const [placedFor, setPlacedFor] = useState<string>();
  useLayoutEffect(() => {
    if (placedFor === board || !loaded || size.width <= 0 || size.height <= 0) return;
    const saved = readBoardCamera(board);
    /* eslint-disable react/set-state-in-effect -- The first camera needs the measured viewport, known only after layout. */
    setState({ camera: saved ? cameraAt(saved, saved.zoom, size) : fitCamera(bounds, size, undefined, FIT_MARGIN, FIT_TOP), animated: false });
    setPlacedFor(board);
    /* eslint-enable react/set-state-in-effect */
  }, [board, bounds, loaded, size, placedFor]);

  // Saved shortly after the camera stops moving.
  useEffect(() => {
    if (!state || placedFor !== board || size.width <= 0) return;
    const timer = setTimeout(() => saveBoardCamera(board, { ...cameraCentre(state.camera, size), zoom: state.camera.zoom }), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [state, board, size, placedFor]);

  // Wheel and trackpad: React's wheel listener is passive, and the page must not scroll or zoom instead.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const box = element.getBoundingClientRect();
        const delta = Math.max(-50, Math.min(50, event.deltaY * unit));
        move(camera => zoomAround(camera, { x: event.clientX - box.left, y: event.clientY - box.top }, camera.zoom * Math.exp(-delta * .01)));
        return;
      }
      const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit, dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit;
      move(camera => ({ ...camera, x: camera.x - dx, y: camera.y - dy }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [move]);

  // Pointers down on the board: one pans once it moves past the threshold, two pinch.
  const pointers = useRef(new Map<number, Point>());
  const panning = useRef(false);
  const suppressClick = useRef(false);
  const local = (event: { clientX: number; clientY: number; }): Point => {
    const box = viewport.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const start = useRef<Point>({ x: 0, y: 0 });
  const handlers: BoardCamera['handlers'] = {
    onPointerDown: event => {
      if (event.button === 2 || (event.target as Element).closest('.board-minimap, [data-board-control]')) return;
      // The middle button would start the browser's autoscroll.
      if (event.button === 1) event.preventDefault();
      pointers.current.set(event.pointerId, local(event));
      if (pointers.current.size === 1) {
        start.current = local(event);
        panning.current = false;
      }
    },
    onPointerMove: event => {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;
      const point = local(event);
      if (pointers.current.size >= 2) {
        const [other] = [...pointers.current].filter(([id]) => id !== event.pointerId).map(([, value]) => value);
        const before = Math.hypot(previous.x - other.x, previous.y - other.y), after = Math.hypot(point.x - other.x, point.y - other.y);
        const middleBefore = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 }, middle = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
        panning.current = true;
        move(camera => {
          const zoomed = before > 0 ? zoomAround(camera, middleBefore, camera.zoom * after / before) : camera;
          return { ...zoomed, x: zoomed.x + middle.x - middleBefore.x, y: zoomed.y + middle.y - middleBefore.y };
        });
      } else {
        if (!panning.current && Math.hypot(point.x - start.current.x, point.y - start.current.y) > PAN_THRESHOLD) {
          panning.current = true;
          viewport.current?.setPointerCapture?.(event.pointerId);
        }
        if (panning.current) move(camera => ({ ...camera, x: camera.x + point.x - previous.x, y: camera.y + point.y - previous.y }));
      }
      pointers.current.set(event.pointerId, point);
    },
    onPointerUp: event => {
      pointers.current.delete(event.pointerId);
      // A drag that panned is not a click on what it started on.
      if (panning.current && !pointers.current.size) {
        suppressClick.current = true;
        panning.current = false;
        setTimeout(() => suppressClick.current = false, 0);
      }
    },
    onPointerCancel: event => {
      pointers.current.delete(event.pointerId);
      if (!pointers.current.size) panning.current = false;
    },
    onClickCapture: event => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    // Tab moves through the cards in book order; the camera follows the focused card into view.
    onFocus: event => {
      const element = viewport.current, target = event.target as HTMLElement;
      if (!element || target === element) return;
      // Undo the browser's own scroll into view first, so the card is measured where the camera draws it.
      element.scrollTop = 0;
      element.scrollLeft = 0;
      const box = element.getBoundingClientRect(), card = target.getBoundingClientRect(), margin = 24;
      const dx = card.left < box.left + margin ? box.left + margin - card.left : card.right > box.right - margin ? Math.max(box.left + margin - card.left, box.right - margin - card.right) : 0;
      const dy = card.top < box.top + margin ? box.top + margin - card.top : card.bottom > box.bottom - margin ? Math.max(box.top + margin - card.top, box.bottom - margin - card.bottom) : 0;
      if (dx || dy) move(camera => ({ ...camera, x: camera.x + dx, y: camera.y + dy }), true);
    },
    // The board never scrolls: a focused card the browser scrolled into view is shown by the camera instead.
    onScroll: event => {
      event.currentTarget.scrollTop = 0;
      event.currentTarget.scrollLeft = 0;
    },
  };

  const zoomStep = (direction: 1 | -1) => move(camera => zoomAround(camera, { x: size.width / 2, y: size.height / 2 }, steppedZoom(camera.zoom, direction)), true);
  // The zoom control's ↺ shows the whole content, down to the smallest zoom.
  const fit = () => move(() => fitCamera(latest.current.bounds, latest.current.size, { min: BOARD_ZOOM_MIN, max: 1 }, FIT_MARGIN, FIT_TOP), true);
  const centreOn = (point: Point) => move(camera => cameraAt(point, camera.zoom, latest.current.size), false);
  return { viewport, camera: state?.camera ?? { x: 0, y: 0, zoom: 1 }, size, ready: Boolean(state), animated: state?.animated ?? false, zoomStep, fit, centreOn, handlers };
}
