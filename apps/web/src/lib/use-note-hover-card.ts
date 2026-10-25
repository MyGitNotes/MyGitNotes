import { useCallback, useEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';

/** How long the pointer rests on a row, or keyboard focus stays on it, before its card opens. */
export const HOVER_CARD_OPEN_MS = 450;
/** The grace period between leaving a row and entering its card, so the gap between them does not close it. */
export const HOVER_CARD_CLOSE_MS = 180;

export interface HoverCardTarget {
  note: NoteListItem;
  /** The row the card belongs to; it takes focus back when the card closes. */
  row: HTMLElement;
  /** Where the row sits, which places the card at the row's height. */
  rowRect: DOMRect;
  /** The dock the row lives in, if any: the card opens beside it rather than over the list. */
  dockRect?: DOMRect;
}

const focusable = (card: HTMLElement) => Array.from(card.querySelectorAll<HTMLElement>('button:not(:disabled), [role="combobox"]:not(:disabled), [tabindex]:not([tabindex="-1"])'));

/**
 * One hover card shared by a list's rows. A row opens it after the pointer rests on it, or after keyboard focus rests on it
 * (Tab or the arrow keys, not a click); it moves to another row at once while it is open, stays while the pointer is on it or one of its
 * menus is open, and closes on Escape, on leaving, or when focus leaves both the row and the card.
 */
export function useNoteHoverCard() {
  const [target, setTarget] = useState<HoverCardTarget | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HoverCardTarget | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const overCard = useRef(false);
  const overRow = useRef(false);
  const menuOpen = useRef(false);
  /** A pointer press is landing focus on a row, which is a click and not keyboard navigation. */
  const pressing = useRef(false);

  const set = useCallback((next: HoverCardTarget | null) => {
    targetRef.current = next;
    setTarget(next);
  }, []);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const close = useCallback((returnFocus = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const closing = targetRef.current;
    overCard.current = false;
    overRow.current = false;
    menuOpen.current = false;
    set(null);
    if (returnFocus && closing?.row.isConnected) closing.row.focus();
  }, [set]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const place = (note: NoteListItem, row: HTMLElement): HoverCardTarget => ({ note, row, rowRect: row.getBoundingClientRect(), dockRect: row.closest('.browse-dock-panel')?.getBoundingClientRect() });
  const open = (note: NoteListItem, row: HTMLElement, delay: number) => {
    clearTimer();
    const show = () => {
      timer.current = undefined;
      if (row.isConnected) set(place(note, row));
    };
    // A card that is open follows the pointer from row to row without waiting again; one for another row does not outlast focus moving on.
    if (targetRef.current && !delay) show();
    else {
      if (targetRef.current && targetRef.current.row !== row) set(null);
      timer.current = setTimeout(show, delay);
    }
  };
  const scheduleClose = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (!overCard.current && !overRow.current && !menuOpen.current && !card.current?.contains(document.activeElement)) close();
    }, HOVER_CARD_CLOSE_MS);
  };

  // Escape closes the card wherever focus is, unless a menu inside the card is open (the menu takes that Escape).
  useEffect(() => {
    if (!target) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || menuOpen.current) return;
      const inside = card.current?.contains(document.activeElement) || target.row.contains(document.activeElement);
      close(Boolean(inside));
    };
    // In the capture phase: the status select stops its keys from bubbling out of its row.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [target, close]);

  /** Event handlers for the row of `note`. */
  const rowProps = (note: NoteListItem) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      overRow.current = true;
      open(note, event.currentTarget, targetRef.current ? 0 : HOVER_CARD_OPEN_MS);
    },
    onPointerLeave: () => {
      overRow.current = false;
      if (targetRef.current) scheduleClose();
      else clearTimer();
    },
    onPointerDown: () => {
      pressing.current = true;
      setTimeout(() => {
        pressing.current = false;
      }, 0);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      // Only focus that came from the keyboard; a click focuses its row too and should not pop a card up.
      if (event.target !== event.currentTarget || pressing.current) return;
      open(note, event.currentTarget, HOVER_CARD_OPEN_MS);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.relatedTarget instanceof Node && card.current?.contains(event.relatedTarget)) return;
      if (!overCard.current && !overRow.current) {
        if (targetRef.current) scheduleClose();
        else clearTimer();
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // From the row, the right arrow moves into its open card.
      if (event.target !== event.currentTarget || event.key !== 'ArrowRight' || targetRef.current?.row !== event.currentTarget || !card.current) return;
      const first = focusable(card.current)[0];
      if (!first) return;
      event.preventDefault();
      first.focus();
    },
  });

  /** Event handlers for the card itself. */
  const cardProps = {
    onPointerEnter: () => {
      overCard.current = true;
      clearTimer();
    },
    onPointerLeave: () => {
      overCard.current = false;
      scheduleClose();
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Tab' || !card.current) return;
      const controls = focusable(card.current);
      const at = controls.indexOf(document.activeElement as HTMLElement);
      // Tabbing past either end of the card gives focus back to its row; the arrow keys move on from there.
      if (event.shiftKey ? at <= 0 : at === controls.length - 1) {
        event.preventDefault();
        close(true);
      }
    },
  };

  /** A menu in the card (the status menu) is open: the card stays until it closes. */
  const holdOpen = (held: boolean) => {
    menuOpen.current = held;
    if (!held && !overCard.current && !overRow.current) scheduleClose();
  };

  return { target, card, rowProps, cardProps, close, holdOpen };
}
