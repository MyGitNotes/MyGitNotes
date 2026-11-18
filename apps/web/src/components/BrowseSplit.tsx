import { type KeyboardEvent, type PointerEvent, type ReactNode, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { DOCK_SPLIT_MAX, DOCK_SPLIT_MIN } from '../lib/focus-view.js';
import './browse-split.css';

const KEY_STEP = 5;

const clampSplit = (value: number) => Math.min(DOCK_SPLIT_MAX, Math.max(DOCK_SPLIT_MIN, Math.round(value)));

export interface BrowseSplitProps {
  /** The heading of the folders part, which also names it as a region. */
  label: string;
  /** Beside the heading, such as "Clear all". */
  actions?: ReactNode;
  /** At the column's top, over the list they act on: the search, the sort and the display toggles. */
  tools?: ReactNode;
  /** The folders (and filters) below the divider. */
  filters: ReactNode;
  /** The line over the list: where the list is and how many notes it holds. */
  path: ReactNode;
  /** At the path line's end, clear of the search above it: the toggle that collapses the dock itself. */
  dockToggle?: ReactNode;
  /** The share of the column, in percent, the folders part takes. */
  size: number;
  /** Called once a drag settles, and on each arrow key, Home or End. */
  onSizeChange: (size: number) => void;
  /** Folded, the folders part leaves only its heading at the column's foot and the list takes the room. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The list. */
  children: ReactNode;
}

/**
 * The browse dock's column beside a Focus: the list's tools at the top, then the path line and the list, and below a divider the folders
 * and filters, which a pointer drags and the arrow keys, Home and End move. The folders part folds to its heading and back; folded, it
 * stays mounted (hidden), so its tree keeps which folders were open.
 */
export function BrowseSplit({ label, actions, tools, filters, path, dockToggle, size, onSizeChange, collapsed, onCollapsedChange, children }: BrowseSplitProps): JSX.Element {
  const { t } = useTranslation();
  const bodyId = useId();
  const root = useRef<HTMLDivElement>(null);
  /** The size while a drag is under way; the stored one otherwise. */
  const [dragSize, setDragSize] = useState<number | null>(null);
  const shown = dragSize ?? clampSplit(size);

  // The folders part sits below the divider, so its share is what lies between the pointer and the column's foot.
  const sizeAt = (clientY: number) => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return shown;
    return clampSplit(((rect.bottom - clientY) / rect.height) * 100);
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
  // The arrows move the divider: up gives the folders more room. Home and End give them their least and most, as a splitter's value runs.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowUp' ? shown + KEY_STEP : event.key === 'ArrowDown' ? shown - KEY_STEP : event.key === 'Home' ? DOCK_SPLIT_MIN : event.key === 'End' ? DOCK_SPLIT_MAX : null;
    if (next === null) return;
    event.preventDefault();
    onSizeChange(clampSplit(next));
  };

  const toggleLabel = t(collapsed ? 'browseSplit.expand' : 'browseSplit.collapse');

  return (
    <div ref={root} className='browse-split' data-collapsed={collapsed || undefined} data-dragging={dragSize !== null || undefined}>
      {tools && <div className='browse-split-tools'>{tools}</div>}
      <div className='browse-split-path'>
        <div className='browse-split-path-content'>{path}</div>
        {dockToggle}
      </div>
      <div className='workspace-scroll browse-split-list'>{children}</div>
      {!collapsed && <div role='separator' tabIndex={0} aria-orientation='horizontal' aria-label={t('browseSplit.resize')} aria-controls={bodyId} aria-valuenow={shown} aria-valuemin={DOCK_SPLIT_MIN} aria-valuemax={DOCK_SPLIT_MAX} className='browse-split-divider' onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown} />}
      <section aria-label={label} className='browse-split-filters' style={collapsed ? undefined : { flexBasis: `${shown}%` }}>
        <header className='browse-split-header'>
          <h2 className='browse-split-heading'>{label}</h2>
          {actions}
          <button type='button' className='ui-icon-button browse-split-toggle' aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => onCollapsedChange(!collapsed)}>{collapsed ? <ChevronUp size={15} aria-hidden='true' /> : <ChevronDown size={15} aria-hidden='true' />}</button>
        </header>
        <div id={bodyId} className='browse-split-filters-body' hidden={collapsed}>{filters}</div>
      </section>
    </div>
  );
}
