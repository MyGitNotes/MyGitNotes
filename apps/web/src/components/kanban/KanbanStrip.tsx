import type React from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import { Tooltip } from '../Tooltip.js';

interface KanbanStripProps {
  /** The column's status ('' for the notes with none). */
  id: string;
  title: string;
  /** The status dot's class. */
  dot: string;
  total: number;
  /** A note being dragged over the strip, which it takes the strip's status on drop. */
  over: boolean;
  drop: { onDragOver: (event: React.DragEvent<HTMLElement>) => void; onDragLeave: (event: React.DragEvent<HTMLElement>) => void; onDrop: (event: React.DragEvent<HTMLElement>) => void; };
  onExpand: () => void;
}

/** A folded column: its dot, its name written down the strip and its count. A note still drops onto it; a click opens the column again. */
export function KanbanStrip({ id, title, dot, total, over, drop, onExpand }: KanbanStripProps) {
  const { t } = useTranslation();
  const label = t('kanban.expandColumn', { title });
  return (
    <div data-status-column={id} data-strip='' data-over={over || undefined} className='kanban-strip' onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop}>
      <Tooltip label={label}>
        <button type='button' className='kanban-strip-button' aria-label={label} aria-expanded='false' onClick={onExpand}>
          <span className={`status-dot ${dot}`} aria-hidden='true' />
          <span className='kanban-strip-title'>{title}</span>
          <span className='kanban-strip-count'>{total}</span>
        </button>
      </Tooltip>
    </div>
  );
}
