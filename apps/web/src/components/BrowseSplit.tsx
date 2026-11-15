import { type KeyboardEvent, type PointerEvent, type ReactNode, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { DOCK_SPLIT_MAX, DOCK_SPLIT_MIN } from '../lib/focus-view.js';
import './browse-split.css';

const KEY_STEP = 5;

const clampSplit = (value: number) => Math.min(DOCK_SPLIT_MAX, Math.max(DOCK_SPLIT_MIN, Math.round(value)));

export interface BrowseSplitProps {
  /** The heading of the top part, which also names it as a region. */
  label: string;
  /** Beside the heading, such as "Clear all". */
  actions?: ReactNode;
  /** The folders (and filters) above the divider. */
  top: ReactNode;
  /** The line over the list: where the list is and how many notes it holds. Folded, the top part leaves only this line. */
  path: ReactNode;
  /** The share of the column, in percent, the top part takes. */
  size: number;
  /** Called once a drag settles, and on each arrow key, Home or End. */
  onSizeChange: (size: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The list. */
  children: ReactNode;
}

/**
 * The browse dock's column beside a Focus, split in two: the folders and filters above, the list below, with a divider between them that a
 * pointer drags and the arrow keys, Home and End move. The top part folds to the path line and back; folded, it stays mounted (hidden), so
 * its tree keeps which folders were open.
 */
export function BrowseSplit({ label, actions, top, path, size, onSizeChange, collapsed, onCollapsedChange, children }: BrowseSplitProps): JSX.Element {
  const { t } = useTranslation();
  const topId = useId();
  const root = useRef<HTMLDivElement>(null);
  /** The size while a drag is under way; the stored one otherwise. */
  const [dragSize, setDragSize] = useState<number | null>(null);
  const shown = dragSize ?? clampSplit(size);

  const sizeAt = (clientY: number) => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return shown;
    return clampSplit(((clientY - rect.top) / rect.height) * 100);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragSize(shown);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragSize !== null) setDragSize(sizeAt(event.clientY));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragSize === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const next = sizeAt(event.clientY);
    setDragSize(null);
    onSizeChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowUp' ? shown - KEY_STEP : event.key === 'ArrowDown' ? shown + KEY_STEP : event.key === 'Home' ? DOCK_SPLIT_MIN : event.key === 'End' ? DOCK_SPLIT_MAX : null;
    if (next === null) return;
    event.preventDefault();
    onSizeChange(clampSplit(next));
  };

  const toggleLabel = t(collapsed ? 'browseSplit.expand' : 'browseSplit.collapse');
  const toggle = <button type='button' className='ui-icon-button browse-split-toggle' aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed} aria-controls={topId} onClick={() => onCollapsedChange(!collapsed)}>{collapsed ? <ChevronRight size={15} aria-hidden='true' /> : <ChevronDown size={15} aria-hidden='true' />}</button>;

  return (
    <div ref={root} className='browse-split' data-collapsed={collapsed || undefined} data-dragging={dragSize !== null || undefined}>
      <section id={topId} aria-label={label} className='browse-split-top' hidden={collapsed} style={{ flexBasis: `${shown}%` }}>
        <header className='browse-split-header'>
          <h2 className='browse-split-heading'>{label}</h2>
          {actions}
          {!collapsed && toggle}
        </header>
        <div className='browse-split-top-body'>{top}</div>
      </section>
      {!collapsed && <div role='separator' tabIndex={0} aria-orientation='horizontal' aria-label={t('browseSplit.resize')} aria-controls={topId} aria-valuenow={shown} aria-valuemin={DOCK_SPLIT_MIN} aria-valuemax={DOCK_SPLIT_MAX} className='browse-split-divider' onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown} />}
      <div className='browse-split-path'>
        {collapsed && toggle}
        <div className='browse-split-path-content'>{path}</div>
      </div>
      <div className='workspace-scroll browse-split-list'>{children}</div>
    </div>
  );
}
