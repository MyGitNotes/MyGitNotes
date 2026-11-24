import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { DOCK_SPLIT_MAX, DOCK_SPLIT_MIN } from '../lib/focus-view.js';
import { useTranslation } from '../lib/i18n/index.js';
import './kanban-focus-split.css';

const STORAGE_KEY = 'github-notes:kanban-board-share';
const DEFAULT_SHARE = 50;
const KEY_STEP = 5;
const clamp = (value: number) => Math.min(DOCK_SPLIT_MAX, Math.max(DOCK_SPLIT_MIN, Math.round(value)));

function readShare(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && Number.isFinite(Number(raw))) return clamp(Number(raw));
  } catch {
    // The splitter still works in a browser that blocks storage.
  }
  return DEFAULT_SHARE;
}

interface KanbanFocusSplitProps {
  board: boolean;
  split: boolean;
  focusId: string;
  list: ReactNode;
  focus: ReactNode;
}

/** Keeps the list and Focus at the same React positions in either presentation. Only the board makes a vertical split. */
export function KanbanFocusSplit({ board, split, focusId, list, focus }: KanbanFocusSplitProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(readShare);
  const [drag, setDrag] = useState<{ pointer: number; value: number; } | null>(null);
  if (!split && drag) setDrag(null);
  const shown = drag?.value ?? share;

  const save = (next: number) => {
    const value = clamp(next);
    setShare(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Keep the in-memory setting if storage is not available.
    }
  };
  const shareAt = (clientY: number) => {
    const rect = root.current?.getBoundingClientRect();
    return rect && rect.height > 0 ? clamp(100 * (clientY - rect.top) / rect.height) : shown;
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointer: event.pointerId, value: shown });
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (drag && event.pointerId === drag.pointer) setDrag({ ...drag, value: shareAt(event.clientY) });
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== drag?.pointer) return;
    setDrag(null);
  };
  const commit = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== drag?.pointer) return;
    cancel(event);
    save(shareAt(event.clientY));
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowUp' ? shown - KEY_STEP : event.key === 'ArrowDown' ? shown + KEY_STEP : event.key === 'Home' ? DOCK_SPLIT_MIN : event.key === 'End' ? DOCK_SPLIT_MAX : null;
    if (next === null) return;
    event.preventDefault();
    save(next);
  };

  return (
    <div ref={root} className='kanban-focus-split' data-board={board || undefined} data-split={split || undefined} data-dragging={drag !== null || undefined} style={split ? { '--kanban-board-share': `${shown}fr`, '--kanban-focus-share': `${100 - shown}fr` } as CSSProperties : undefined}>
      {list}
      {split && <div className='kanban-focus-divider' role='separator' tabIndex={0} aria-orientation='horizontal' aria-label={t('browse.resizeBoard')} aria-controls={focusId} aria-valuenow={shown} aria-valuemin={DOCK_SPLIT_MIN} aria-valuemax={DOCK_SPLIT_MAX} onPointerDown={start} onPointerMove={move} onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={keyDown} />}
      {focus}
    </div>
  );
}
