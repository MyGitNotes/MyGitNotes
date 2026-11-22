import { ViewPlugin } from '@codemirror/view';

/**
 * Whether a press landed on a scrollbar of its target: below the box a horizontal scroller shows its content in, or beside
 * the one a vertical scroller does. The note's own scrollbars take room in the layout, so the bar lies outside the client box.
 */
export function isScrollbarPress(event: MouseEvent): boolean {
  const element = event.target;
  if (!(element instanceof HTMLElement)) return false;
  const box = element.getBoundingClientRect();
  const x = event.clientX - box.left - element.clientLeft;
  const y = event.clientY - box.top - element.clientTop;
  const horizontal = element.scrollWidth > element.clientWidth && y >= element.clientHeight;
  const vertical = element.scrollHeight > element.clientHeight && x >= element.clientWidth;
  return horizontal || vertical;
}

/**
 * A press on the scrollbar of a scroller inside a drawn block (a wide table, a mermaid diagram, a code block in a directive) drags the
 * scrollbar and nothing else: neither the block's own press handler nor the editor's selection sees it, since either would move the
 * cursor into the block and swap the drawing for its source. The capture listener on the editor runs before both; the browser's
 * scrollbar drag is the default action, which stopping the event's propagation leaves alone.
 */
export const scrollbarPressGuard = ViewPlugin.define(view => {
  const press = (event: MouseEvent) => {
    if (event.target instanceof Node && view.contentDOM.contains(event.target) && event.target !== view.contentDOM && isScrollbarPress(event)) event.stopPropagation();
  };
  view.dom.addEventListener('mousedown', press, true);
  return { destroy: () => view.dom.removeEventListener('mousedown', press, true) };
});
