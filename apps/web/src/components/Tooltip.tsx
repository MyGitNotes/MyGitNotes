import './tooltip.css';
import { cloneElement, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode, type Ref, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeTooltip, type TooltipPlacement, type TooltipSide } from '../lib/tooltip-position.js';

/** How long the pointer rests on a trigger before its tooltip shows. */
export const TOOLTIP_DELAY_MS = 350;
/** After a tooltip closes, another trigger reached within this time shows its own at once, so moving along a row of buttons reads them off. */
const WARM_MS = 400;

let lastClosedAt = -Infinity;
/** Whether a tooltip closed a moment ago, so the next one skips the delay. */
const warm = () => Date.now() - lastClosedAt < WARM_MS;
const markClosed = () => {
  lastClosedAt = Date.now();
};

/** Hands `node` to the trigger's own ref as well as the tooltip's. */
function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref && typeof ref === 'object') (ref as { current: HTMLElement | null; }).current = node;
}
/** Whether the last input was a key, so a focus came from the keyboard (`:focus-visible`) rather than a press. */
let keyboardInput = false;
let modalityTracked = false;
function trackModality() {
  if (modalityTracked || typeof document === 'undefined') return;
  modalityTracked = true;
  document.addEventListener('keydown', () => keyboardInput = true, true);
  document.addEventListener('pointerdown', () => keyboardInput = false, true);
  document.addEventListener('mousedown', () => keyboardInput = false, true);
}

type TriggerProps = { ref?: Ref<HTMLElement>; 'aria-describedby'?: string; onPointerEnter?: (event: PointerEvent<HTMLElement>) => void; onPointerLeave?: (event: PointerEvent<HTMLElement>) => void; onPointerDown?: (event: PointerEvent<HTMLElement>) => void; onFocus?: (event: FocusEvent<HTMLElement>) => void; onBlur?: (event: FocusEvent<HTMLElement>) => void; onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void; };

export interface TooltipProps {
  /** What the trigger is or does, on one line. */
  label: ReactNode;
  /** Muted after the label: a count, or the keys that do the same. */
  detail?: ReactNode;
  /** The side of the trigger it prefers; it flips where that side has no room. */
  side?: TooltipSide;
  /** The trigger: one element that takes a ref and the pointer, focus and key handlers (a button, a link, a Radix trigger). */
  children: ReactElement;
}

/**
 * A compact tooltip (T1): one line, the theme's text colour as its background and its background as the ink, with an
 * arrow toward the trigger. It shows after a short rest of a mouse or pen (never for a touch), or at once on keyboard
 * focus; leaving, pressing, blur and Escape hide it. While shown it describes the trigger (`aria-describedby`), which
 * keeps its own accessible name; the trigger carries no `title`.
 */
export function Tooltip({ label, detail, side = 'bottom', children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  /** Where the bubble mounts: inside a modal dialog only the dialog's top layer shows, so there; else the body. */
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const child = children as ReactElement<TriggerProps> & { ref?: Ref<HTMLElement>; };
  const childRef = child.ref;
  trackModality();

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const show = () => {
    cancel();
    setContainer(trigger.current?.closest('dialog') ?? document.body);
    setOpen(true);
  };
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    setOpen(current => {
      if (current) markClosed();
      return false;
    });
    setPlacement(null);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Shown, it follows nothing: a scroll or a resize hides it rather than leave it pointing elsewhere; so does Escape anywhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && hide();
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !bubble.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const size = bubble.current.getBoundingClientRect();
    setPlacement(placeTooltip(rect, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight }, side));
  }, [open, side, label, detail]);

  const setTrigger = useCallback((node: HTMLElement | null) => {
    trigger.current = node;
    assignRef(childRef, node);
  }, [childRef]);

  const own = child.props;
  const describedBy = [own['aria-describedby'], open ? id : undefined].filter(Boolean).join(' ') || undefined;
  const triggerProps: TriggerProps = {
    ref: setTrigger,
    'aria-describedby': describedBy,
    onPointerEnter: event => {
      own.onPointerEnter?.(event);
      if (event.pointerType === 'touch') return;
      if (warm()) show();
      else {
        cancel();
        timer.current = setTimeout(show, TOOLTIP_DELAY_MS);
      }
    },
    onPointerLeave: event => {
      own.onPointerLeave?.(event);
      hide();
    },
    onPointerDown: event => {
      own.onPointerDown?.(event);
      hide();
    },
    onFocus: event => {
      own.onFocus?.(event);
      if (keyboardInput) show();
    },
    onBlur: event => {
      own.onBlur?.(event);
      hide();
    },
    onKeyDown: event => {
      own.onKeyDown?.(event);
      if (event.key === 'Escape') hide();
    },
  };

  const style: CSSProperties = placement ? { left: placement.left, top: placement.top, ['--tooltip-arrow' as string]: `${placement.arrow}px` } : { left: 0, top: 0, visibility: 'hidden' };
  return (
    <>
      {/* eslint-disable-next-line react/refs -- The handlers read the trigger's ref when they run, never during render. */}
      {cloneElement(child, triggerProps)}
      {open && container && createPortal(
        <div ref={bubble} id={id} role='tooltip' className='tooltip' data-side={placement?.side ?? side} style={style}>
          <span className='tooltip-label'>{label}</span>
          {detail !== undefined && detail !== null && detail !== '' && <span className='tooltip-detail'>{detail}</span>}
        </div>,
        container,
      )}
    </>
  );
}
