import type { DraggedNote } from './note-drag.js';

/**
 * A touch screen has no native drag that coexists with the long press that selects notes, so a lifted note follows
 * the finger here and talks to the note drop target under it (`NoteDropTarget`, marked `data-note-drop`) through
 * these DOM events: `TOUCH_NOTE_OVER` with `detail` true or false as the finger enters or leaves it, then
 * `TOUCH_NOTE_DROP` with the note as `detail` on release.
 */
export const TOUCH_NOTE_OVER = 'mygitnotes:touch-note-over';
export const TOUCH_NOTE_DROP = 'mygitnotes:touch-note-drop';

/** The note drop target under a point, if any. */
export function noteDropTargetAt(x: number, y: number): Element | null {
  return document.elementFromPoint?.(x, y)?.closest('[data-note-drop]') ?? null;
}

/** A note being dragged by touch: `move` follows the finger, `drop` hands the note to the target under it, `cancel` drops nothing. */
export interface TouchNoteDrag {
  move: (x: number, y: number) => void;
  drop: () => void;
  cancel: () => void;
}

/** Starts dragging `note` from the point (`x`, `y`), showing a chip with its title under the finger. */
export function startTouchNoteDrag(note: DraggedNote, title: string, x: number, y: number): TouchNoteDrag {
  const ghost = document.createElement('div');
  ghost.className = 'note-touch-ghost';
  ghost.textContent = title;
  document.body.append(ghost);
  let over: Element | null = null;
  const leave = () => {
    over?.dispatchEvent(new CustomEvent(TOUCH_NOTE_OVER, { detail: false }));
  };
  const move = (nextX: number, nextY: number) => {
    ghost.style.transform = `translate(${nextX}px, ${nextY}px)`;
    const next = noteDropTargetAt(nextX, nextY);
    if (next === over) return;
    leave();
    over = next;
    over?.dispatchEvent(new CustomEvent(TOUCH_NOTE_OVER, { detail: true }));
  };
  move(x, y);
  return {
    move,
    drop: () => {
      leave();
      over?.dispatchEvent(new CustomEvent<DraggedNote>(TOUCH_NOTE_DROP, { detail: note }));
      ghost.remove();
    },
    cancel: () => {
      leave();
      ghost.remove();
    },
  };
}
