import { forwardRef, type KeyboardEvent, useImperativeHandle, useRef, useState } from 'react';
import { iconKey, lucideIcon } from '../lib/icons/lucide-registry.js';
import { LucideGlyph } from './LucideGlyph.js';
import { Tooltip } from './Tooltip.js';

export interface IconGridHandle {
  /** Puts the focus on the grid's active icon. */
  focusActive: () => void;
  /** The icon the grid's focus is on, or rests on; undefined for an empty grid. */
  activeName: () => string | undefined;
}

export interface IconGridProps {
  /** The Lucide names to show, in order. */
  names: readonly string[];
  /** Names the grid for assistive technology. */
  label: string;
  onPick: (name: string) => void;
  /** The icon chosen now, in any spelling, whose option alone is selected; '' where none is chosen. Left out, the active option is the selected one. */
  selected?: string;
  /** Up from the first row: the search box above takes the focus back. */
  onLeaveUp?: () => void;
  /** Shows each icon's name under it. */
  showNames?: boolean;
  className?: string;
}

/**
 * A grid of Lucide icons, one tab stop: the arrow keys, Home and End move through it, Enter or Space (a button's
 * click) picks. The option holding the focus is the active one; with `selected` the chosen icon is marked too.
 */
export const IconGrid = forwardRef<IconGridHandle, IconGridProps>(function IconGrid({ names, label, onPick, selected, onLeaveUp, showNames = true, className = '' }, ref) {
  const [focused, setFocused] = useState(0);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedKey = selected === undefined ? undefined : iconKey(selected);
  const active = Math.min(focused, Math.max(names.length - 1, 0));

  const focusOption = (index: number) => {
    const next = Math.max(0, Math.min(index, names.length - 1));
    setFocused(next);
    options.current[next]?.focus();
  };
  useImperativeHandle(ref, () => ({ focusActive: () => focusOption(active), activeName: () => names[active] }));

  /** How many icons share a row, read from where the browser laid the grid out. */
  const columns = () => {
    const top = options.current[0]?.offsetTop;
    const first = options.current.findIndex((option, index) => index > 0 && option?.offsetTop !== top);
    return first === -1 ? Math.max(names.length, 1) : first;
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The option holding the focus, which is where a key moves from.
    const held = options.current.indexOf(document.activeElement as HTMLButtonElement);
    const from = held === -1 ? active : held;
    const row = columns();
    if (event.key === 'Home') focusOption(0);
    else if (event.key === 'End') focusOption(names.length - 1);
    else if (event.key === 'ArrowRight') focusOption(from + 1);
    else if (event.key === 'ArrowLeft') focusOption(from - 1);
    else if (event.key === 'ArrowDown') focusOption(from + row);
    else if (event.key === 'ArrowUp') {
      if (from < row) onLeaveUp?.();
      else focusOption(from - row);
    } else return;
    event.preventDefault();
  };

  if (names.length === 0) return null;
  return (
    <div className={`icon-picker-grid ${className}`} role='listbox' aria-label={label} onKeyDown={onKey}>
      {names.map((name, index) => {
        return (
          <Tooltip key={name} label={name} side='top'>
            <button
              ref={element => {
                options.current[index] = element;
              }}
              type='button'
              role='option'
              aria-selected={selectedKey === undefined ? index === active : iconKey(name) === selectedKey}
              aria-label={showNames ? undefined : name}
              tabIndex={index === active ? 0 : -1}
              data-active={index === active || undefined}
              onFocus={() => setFocused(index)}
              onClick={() => onPick(name)}
            >
              <LucideGlyph icon={lucideIcon(name)} />
              {showNames && <span>{name}</span>}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
});
