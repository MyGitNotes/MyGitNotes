import React, { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { Tooltip } from './Tooltip.js';

export interface NavTreeProps {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function NavTree({ children, className = '', 'aria-label': ariaLabel }: NavTreeProps) {
  return <nav className={`nav-tree ${className}`} aria-label={ariaLabel}>{children}</nav>;
}

export interface NavTreeRowProps {
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (e: React.MouseEvent) => void;
  expandAriaLabel?: string;
  icon?: ReactNode;
  title: string;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  actions?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
  disabled?: boolean;
  buttonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  /**
   * Names the row in a tooltip (`Tooltip`) instead of a native title: `label` defaults to the row's title, `detail` is
   * shown muted after it. Without it the row keeps the native title.
   */
  tooltip?: { label?: string; detail?: ReactNode; };
}

export function NavTreeRow({ hasChildren = false, isExpanded = false, onToggleExpand, expandAriaLabel, icon = <Folder size={15} />, title, selected = false, onSelect, actions, prefix, suffix, className = '', disabled = false, buttonProps, tooltip }: NavTreeRowProps) {
  const entry = (
    <button type='button' className='nav-tree-entry' aria-current={selected ? 'location' : undefined} aria-pressed={selected} disabled={disabled} onClick={onSelect} title={tooltip ? undefined : title} {...buttonProps}>
      {icon}
      <span className='nav-tree-title'>{title}</span>
      {suffix}
    </button>
  );
  return (
    <div className={`nav-tree-row ${selected ? 'is-selected' : ''} ${className}`}>
      {prefix}
      {hasChildren
        ? (
          <button
            type='button'
            className='nav-tree-chevron'
            disabled={disabled}
            aria-label={expandAriaLabel || (isExpanded ? 'Collapse' : 'Expand')}
            aria-expanded={isExpanded}
            onClick={e => {
              e.stopPropagation();
              onToggleExpand?.(e);
            }}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )
        : <span className='nav-tree-chevron-spacer' aria-hidden='true' />}
      {tooltip ? <Tooltip label={tooltip.label ?? title} detail={tooltip.detail} side='right'>{entry}</Tooltip> : entry}
      {actions}
    </div>
  );
}

export function NavTreeChildren({ children, className = '' }: { children: ReactNode; className?: string; }) {
  return <div className={`nav-tree-children ${className}`}>{children}</div>;
}
