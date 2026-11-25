import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { BoardElementKey } from '../../lib/board/connections.js';
import { type BoardEdit, type BoardSelectionKey, moveSelection, resizeSection, splitKey } from '../../lib/board/edit.js';
import type { Point, Rect } from '../../lib/board/geometry.js';
import { elementAt, elementsInBox, onSectionTitle, spanRect } from '../../lib/board/hit.js';
import type { PlacedBoard } from '../../lib/board/placement.js';
import { screenToBoard } from '../../lib/board/zoom.js';
import type { BoardCamera } from './useBoardCamera.js';
import type { BoardTool } from './useBoardEditor.js';
import { boardKeyOf, toggled, typing } from './useBoardEditor.js';

/** A press that moves farther than this, in CSS px, drags instead of clicking. */
const DRAG_THRESHOLD = 4;

/** What a gesture under way draws over the board: a selection box, a section being drawn, an arrow being pulled. */
export interface BoardOverlay {
  box?: Rect;
  section?: Rect;
  arrow?: { from: Rect; to: Point; };
}
type Handlers = Pick<BoardCamera['handlers'], 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClickCapture' | 'onFocus' | 'onScroll'> & { onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void; };
export interface BoardGestures {
  overlay: BoardOverlay;
  handlers: Handlers;
}

interface Base {
  /** Where the press started, on the board and on screen. */
  start: Point;
  screen: Point;
  moved: boolean;
}
type Gesture = Base & { kind: 'move'; keys: BoardSelectionKey[]; collapse?: BoardSelectionKey; additive?: boolean; } | Base & { kind: 'box'; target?: BoardSelectionKey; additive: boolean; base: ReadonlySet<BoardSelectionKey>; } | Base & { kind: 'section'; } | Base & { kind: 'text'; target?: BoardSelectionKey; } | Base & { kind: 'arrow'; from: BoardElementKey; } | Base & { kind: 'resize'; key: string; frame: Rect; corner: Point; };

export interface PointerInput {
  row: CompilationRow;
  placed: PlacedBoard;
  editable: boolean;
  camera: BoardCamera;
  tool: BoardTool;
  selection: ReadonlySet<BoardSelectionKey>;
  setSelection: (selection: ReadonlySet<BoardSelectionKey>) => void;
  setPreview: (row: CompilationRow | undefined) => void;
  apply: (edit: BoardEdit) => boolean;
  /** Returns the tool to 選取 after one use, unless it was double-clicked. */
  used: () => void;
  newSection: (rect: Rect) => void;
  newText: (x: number, y: number) => void;
  newArrow: (from: BoardElementKey, to: BoardElementKey) => void;
  edit: (key: BoardSelectionKey) => void;
  flushNudge: () => boolean;
  /** Whether a field, dialog or picker is open: the board takes no new gesture until it closes. */
  busy: boolean;
}

/**
 * The pointer on an editable board. With 選取 a press on a card, text or section title selects it (Shift or Mod adds)
 * and a drag moves the selection; a press on empty board, or inside a section that is not selected, frames a box
 * selection; a selected section's corner resizes it. 文字 places text, 區塊 draws a section, 箭頭 pulls an arrow from
 * one element onto another. The middle button, Space held, and touch pan instead, through the camera, as every drag
 * does on a board that cannot be edited.
 */
export function useBoardPointer(input: PointerInput): BoardGestures {
  const { row, placed, editable, camera, tool, selection, setSelection, setPreview, apply, used, newSection, newText, newArrow, edit, flushNudge, busy } = input;
  const [overlay, setOverlay] = useState<BoardOverlay>({});
  const gesture = useRef<Gesture | undefined>(undefined);
  const suppressClick = useRef(false);
  const space = useRef(false);

  // Space held pans with a left drag, as in other whiteboards; typing a space in a field is the field's.
  useEffect(() => {
    if (!editable) return;
    const down = (event: KeyboardEvent) => {
      if (event.key === ' ' && !typing(event.target)) space.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === ' ') space.current = false;
    };
    const reset = () => space.current = false;
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, [editable]);

  const local = (event: { clientX: number; clientY: number; }): Point => {
    const box = camera.viewport.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const toBoard = (screen: Point) => screenToBoard(camera.camera, screen);
  const end = () => {
    gesture.current = undefined;
    setOverlay({});
    setPreview(undefined);
  };
  const rectOf = (key: BoardElementKey): Rect | undefined => {
    const { kind, id } = splitKey(key);
    return kind === 'card' ? placed.cards.find(card => card.key === id)?.rect : kind === 'section' ? placed.sections.find(section => section.key === id)?.rect : placed.texts.find(text => text.id === id)?.rect;
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = event.target as Element;
    if (element.closest('[data-board-control], .board-minimap, .board-editor')) return;
    if (busy) return;
    flushNudge();
    // A press on the board takes the keyboard, so Delete, the arrow keys and Mod+Z reach it.
    if (!(document.activeElement instanceof Element && camera.viewport.current?.contains(document.activeElement))) camera.viewport.current?.focus({ preventScroll: true });
    const screen = local(event), start = toBoard(screen);
    const base = { start, screen, moved: false };
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const resize = element.closest('[data-board-resize]')?.getAttribute('data-board-resize');
    const section = element.closest('[data-board-section]')?.getAttribute('data-board-section');
    const hit = boardKeyOf(element) ?? (section ? `section:${section}` as const : undefined);
    if (tool === 'text') return void (gesture.current = { ...base, kind: 'text', ...(hit?.startsWith('text:') ? { target: hit } : {}) });
    if (tool === 'section') return void (gesture.current = { ...base, kind: 'section' });
    if (tool === 'arrow') {
      if (hit && !hit.startsWith('arrow:')) gesture.current = { ...base, kind: 'arrow', from: hit as BoardElementKey };
      return;
    }
    if (resize) {
      const placedSection = placed.sections.find(candidate => candidate.key === resize);
      if (placedSection) gesture.current = { ...base, kind: 'resize', key: resize, frame: placedSection.frame, corner: { x: placedSection.rect.x + placedSection.rect.w, y: placedSection.rect.y + placedSection.rect.h } };
      return;
    }
    if (hit?.startsWith('arrow:')) {
      setSelection(additive ? toggled(selection, hit) : new Set([hit]));
      return;
    }
    // A section is grabbed by its title, or anywhere once selected; elsewhere inside it a drag frames a box.
    const grabbed = hit && (!hit.startsWith('section:') || selection.has(hit) || onSectionTitle(placed, splitKey(hit).id, start) || Boolean(element.closest('.board-section-title')));
    if (!hit || !grabbed) {
      gesture.current = { ...base, kind: 'box', ...(hit ? { target: hit } : {}), additive, base: additive ? selection : new Set() };
      return;
    }
    if (additive) {
      // Shift or Mod adds to the selection, or takes the element out; the press opens nothing.
      const next = toggled(selection, hit);
      setSelection(next);
      gesture.current = { ...base, kind: 'move', keys: next.has(hit) ? [...next] : [], additive: true };
      return;
    }
    if (!selection.has(hit)) {
      setSelection(new Set([hit]));
      gesture.current = { ...base, kind: 'move', keys: [hit] };
    } else gesture.current = { ...base, kind: 'move', keys: [...selection], collapse: hit };
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current!;
    const screen = local(event), point = toBoard(screen);
    if (!current.moved) {
      if (Math.hypot(screen.x - current.screen.x, screen.y - current.screen.y) <= DRAG_THRESHOLD) return;
      current.moved = true;
      camera.viewport.current?.setPointerCapture?.(event.pointerId);
    }
    const dx = point.x - current.start.x, dy = point.y - current.start.y;
    switch (current.kind) {
      case 'move':
        setPreview(moveSelection(row, placed, current.keys, dx, dy, { preview: true }).row);
        break;
      case 'box': {
        const box = spanRect(current.start, point);
        setOverlay({ box });
        setSelection(new Set([...current.base, ...elementsInBox(placed, box)]));
        break;
      }
      case 'section':
        setOverlay({ section: spanRect(current.start, point) });
        break;
      case 'arrow': {
        const from = rectOf(current.from);
        if (from) setOverlay({ arrow: { from, to: point } });
        break;
      }
      case 'resize':
        setPreview(resizeSection(row, current.key, { ...current.frame, w: current.corner.x + dx - current.frame.x, h: current.corner.y + dy - current.frame.y }).row);
        break;
      case 'text':
        break;
    }
  };

  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current!;
    const point = toBoard(local(event));
    const dx = point.x - current.start.x, dy = point.y - current.start.y;
    end();
    // A drag is not a click on what it started on, and no tool's press opens a card.
    if (current.moved || current.kind !== 'move' || current.additive) {
      suppressClick.current = true;
      // Released where no click follows, the next click is the person's own.
      setTimeout(() => suppressClick.current = false, 0);
    }
    switch (current.kind) {
      case 'move':
        if (current.moved) apply(moveSelection(row, placed, current.keys, dx, dy));
        else if (current.collapse) setSelection(new Set([current.collapse]));
        break;
      case 'box':
        if (current.moved) break;
        // A click: on a section it selects the section, on empty board it clears the selection.
        if (current.target) setSelection(current.additive ? toggled(selection, current.target) : new Set([current.target]));
        else if (!current.additive) setSelection(new Set());
        break;
      case 'section':
        newSection(current.moved ? spanRect(current.start, point) : { x: point.x, y: point.y, w: 0, h: 0 });
        used();
        break;
      case 'text':
        if (current.target) edit(current.target);
        else newText(point.x, point.y);
        used();
        break;
      case 'arrow': {
        // Released over empty board, or back on its start, the arrow is not drawn.
        const target = elementAt(placed, point);
        if (current.moved && target && target !== current.from) newArrow(current.from, target);
        used();
        break;
      }
      case 'resize':
        if (current.moved) apply(resizeSection(row, current.key, { ...current.frame, w: current.corner.x + dx - current.frame.x, h: current.corner.y + dy - current.frame.y }));
        break;
    }
  };

  if (!editable) return { overlay, handlers: { ...camera.handlers, onDoubleClick: () => {} } };
  const pans = (event: ReactPointerEvent<HTMLDivElement>) => event.button === 1 || space.current || event.pointerType === 'touch';
  return {
    overlay,
    handlers: {
      onPointerDown: event => {
        if (pans(event)) return camera.handlers.onPointerDown(event);
        if (event.button === 0) down(event);
      },
      onPointerMove: event => gesture.current ? move(event) : camera.handlers.onPointerMove(event),
      onPointerUp: event => gesture.current ? up(event) : camera.handlers.onPointerUp(event),
      onPointerCancel: event => {
        if (!gesture.current) return camera.handlers.onPointerCancel(event);
        end();
      },
      onClickCapture: event => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        camera.handlers.onClickCapture(event);
      },
      onDoubleClick: event => {
        const key = boardKeyOf(event.target);
        if (tool === 'select' && key && !key.startsWith('card:')) edit(key);
      },
      onFocus: camera.handlers.onFocus,
      onScroll: camera.handlers.onScroll,
    },
  };
}
