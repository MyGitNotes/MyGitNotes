import type { BookChapter } from './book-chapters.js';
import { isEditableTarget } from './keyboard/context.js';
import { matchesCommand } from './keyboard/keymap.js';

/** A horizontal drag of at least this many pixels turns the page. */
export const SWIPE_DISTANCE = 60;
/** The drag must be this much wider than it is tall, so a scroll that drifts sideways does not turn the page. */
const SWIPE_RATIO = 1.5;
/** A slower drag is a reader moving a finger over the text, not a swipe. */
const SWIPE_DURATION = 1000;

export type PageStep = 'previous' | 'next';

/** The index of the chapter named `id`; when it has left the book, the same position (or the last page) rather than a jump to the start. */
export function resolvePage(chapters: readonly BookChapter[], id: string | null, fallback = 0): number {
  if (!chapters.length) return 0;
  const found = id === null ? -1 : chapters.findIndex(chapter => chapter.id === id);
  return found >= 0 ? found : Math.min(Math.max(fallback, 0), chapters.length - 1);
}

/** The chapter that owns a contents anchor: a chapter's own, or one of a folder's note sections. */
export function chapterOfAnchor(chapters: readonly BookChapter[], anchor: string): BookChapter | undefined {
  return chapters.find(chapter => chapter.anchor === anchor) ?? chapters.find(chapter => anchor.startsWith(`${chapter.anchor}/`));
}

/** The page a horizontal drag asks for: dragging left reads on, dragging right goes back; `null` for anything that is not a swipe. */
export function swipeStep(dx: number, dy: number, milliseconds: number): PageStep | null {
  if (milliseconds > SWIPE_DURATION || Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return null;
  return dx < 0 ? 'next' : 'previous';
}

/** Widgets that use the arrow keys themselves. */
const ARROW_WIDGETS = '[role="tablist"],[role="tab"],[role="radiogroup"],[role="radio"],[role="slider"],[role="toolbar"],[role="menu"],[role="menubar"],[role="listbox"],[role="tree"],[role="treegrid"],[role="grid"],[role="spinbutton"],video,audio,iframe,summary';
/** The book's own body and frame: whether they could scroll sideways is not a reason to keep the arrows from the page. */
const BOOK_FRAME = '.compilation-book,.compilation-book-view';

/** Whether `target` or something around it, up to the book, scrolls sideways: a wide table or code block, which a key or a drag belongs to. */
export function insideSidewaysScroll(target: Element): boolean {
  for (let element: Element | null = target; element && !element.matches(BOOK_FRAME); element = element.parentElement) {
    if (element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return true;
  }
  return false;
}

/**
 * The page a key press asks for, or `null` when the key is not for paging: ← and → alone, and not while focus
 * is in an editor, input or widget that moves with the arrow keys, nor in the middle of an IME composition.
 */
export function pagingKey(event: KeyboardEvent): PageStep | null {
  if (event.defaultPrevented || event.isComposing) return null;
  let step: PageStep;
  if (matchesCommand(event, 'book.previousPage')) step = 'previous';
  else if (matchesCommand(event, 'book.nextPage')) step = 'next';
  else return null;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || isEditableTarget(target) || target.closest(`${ARROW_WIDGETS},[data-key-scope]`) || insideSidewaysScroll(target)) return null;
  return step;
}

/** Whether a touch that began on `target` may turn the page: not inside an editor, a scrollable-sideways block or a control that drags. */
export function swipeStartsHere(target: EventTarget | null): boolean {
  return target instanceof Element && !isEditableTarget(target) && !target.closest('[data-editing],iframe,input,[role="slider"]') && !insideSidewaysScroll(target);
}

/** Whether the reader has text selected, which a swipe must not interrupt. */
export function hasSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}
