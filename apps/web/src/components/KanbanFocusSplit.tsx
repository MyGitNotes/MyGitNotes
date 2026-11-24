import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { DOCK_SPLIT_MAX, DOCK_SPLIT_MIN } from '../lib/focus-view.js';
import { useTranslation } from '../lib/i18n/index.js';
import { clampBoardShare, useKanbanPrefs } from '../lib/kanban-prefs.js';
import './kanban-focus-split.css';

const KEY_STEP = 5;

interface KanbanFocusSplitProps {
  board: boolean;
  split: boolean;
  focusId: string;
  list: ReactNode;
  focus: ReactNode;
}

/**
 * Keeps the list and Focus at the same React positions in either presentation. Only the board makes a split: the board on the left at full
 * height and the Focus beside it, the divider between them dragged or moved with the arrow keys; the board's share is kept for this device.
 */
export function KanbanFocusSplit({ board, split, focusId, list, focus }: KanbanFocusSplitProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [{ boardShare: share }, updatePrefs] = useKanbanPrefs();
  const [drag, setDrag] = useState<{ pointer: number; value: number; } | null>(null);
  if (!split && drag) setDrag(null);
  const shown = drag?.value ?? share;

  const save = (next: number) => updatePrefs({ boardShare: clampBoardShare(next) });
  const shareAt = (clientX: number) => {
    const rect = root.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? clampBoardShare(100 * (clientX - rect.left) / rect.width) : shown;
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointer: event.pointerId, value: shown });
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (drag && event.pointerId === drag.pointer) setDrag({ ...drag, value: shareAt(event.clientX) });
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== drag?.pointer) return;
    setDrag(null);
  };
  const commit = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== drag?.pointer) return;
    cancel(event);
    save(shareAt(event.clientX));
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? shown - KEY_STEP : event.key === 'ArrowRight' ? shown + KEY_STEP : event.key === 'Home' ? DOCK_SPLIT_MIN : event.key === 'End' ? DOCK_SPLIT_MAX : null;
    if (next === null) return;
    event.preventDefault();
    save(next);
  };

  return <div ref={root} className='kanban-focus-split' data-board={board || undefined} data-split={split || undefined} data-dragging={drag !== null || undefined} style={split ? { '--kanban-board-share': `${shown}fr`, '--kanban-focus-share': `${100 - shown}fr` } as CSSProperties : undefined}>{list}{split && <div className='kanban-focus-divider' role='separator' tabIndex={0} aria-orientation='vertical' aria-label={t('browse.resizeBoard')} aria-controls={focusId} aria-valuenow={shown} aria-valuemin={DOCK_SPLIT_MIN} aria-valuemax={DOCK_SPLIT_MAX} onPointerDown={start} onPointerMove={move} onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={keyDown} />}{focus}</div>;
}
