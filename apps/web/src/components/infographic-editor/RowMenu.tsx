import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVertical } from 'lucide-react';

export interface RowMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}

interface Props {
  label: string;
  items: RowMenuItem[];
  /** Called after the menu closes, so focus can go back to the grid. */
  onDone: () => void;
}

/** The menu of one grid row: a button that opens a short list of row actions, closed by Esc, a choice or a click outside. */
export function RowMenu({ label, items, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setPlace(null);
    onDone();
  };

  // The menu opens under its button, right-aligned, or above it when the window ends first.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const anchor = button.current.getBoundingClientRect();
    const size = menu.current.getBoundingClientRect();
    const below = anchor.bottom + 4 + size.height <= window.innerHeight || anchor.top - 4 - size.height < 0;
    setPlace({ top: below ? anchor.bottom + 4 : anchor.top - 4 - size.height, left: Math.max(8, Math.min(anchor.right - size.width, window.innerWidth - size.width - 8)) });
  }, [open]);

  // Focus goes to the first action once the menu is placed and visible.
  useEffect(() => {
    if (open && place) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `close` only reads props that call back to the grid.
  }, [open]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const enabled = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (index: number) => enabled[(index + enabled.length) % enabled.length]?.focus();
    if (event.key === 'ArrowDown') focus(at + 1);
    else if (event.key === 'ArrowUp') focus(at - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(enabled.length - 1);
    else if (event.key === 'Escape' || event.key === 'Tab') close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      <button ref={button} type='button' className='ig-row-menu-button' aria-label={label} title={label} aria-haspopup='menu' aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
        <EllipsisVertical aria-hidden='true' />
      </button>
      {open && createPortal(
        <div ref={menu} role='menu' aria-label={label} className='ig-row-menu' style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: 'hidden' }} onKeyDown={onKeyDown}>
          {items.map(item => (
            <button
              key={item.id}
              type='button'
              role='menuitem'
              disabled={item.disabled}
              data-danger={item.danger || undefined}
              onClick={() => {
                setOpen(false);
                setPlace(null);
                item.run();
                onDone();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
