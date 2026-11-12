/**
 * A slide note as a contour-deck deck. The note's own renderer writes the HTML (marked, the MyGitNotes directives, DOMPurify), with the slide
 * directives as the marker elements `contour-deck/remark` would write; contour-deck's `rehypeDeck` then splits it into blocks, slides and pages.
 * No splitting rule lives here.
 */
import { rehypeDeck } from 'contour-deck/rehype';
import { fromDom } from 'hast-util-from-dom';
import { toDom } from 'hast-util-to-dom';
import { SlideDeckError } from './errors.js';

type HastNodes = ReturnType<typeof fromDom>;
/** The tree `rehypeDeck` leaves: the deck element, and after it what belongs to no slide. */
export interface DeckTree {
  type: 'root';
  children: HastNodes[];
}

/** The line a marker element carries from the note's text, for the failures `rehypeDeck` reports on one. */
function lineOf(place: unknown): number | undefined {
  const line = Number((place as { properties?: { dataLine?: unknown; }; } | undefined)?.properties?.dataLine);
  return Number.isInteger(line) && line > 0 ? line : undefined;
}

/** The deck of a slide note's sanitized HTML (`renderNote` with `slides: 'deck'`), as hast. Throws a {@link SlideDeckError} where contour-deck refuses it. */
export function readDeck(html: string, title?: string): DeckTree {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  // contour-deck reveals a table's rows one by one when the table is wrapped the way its blog wraps one.
  for (const scroller of body.querySelectorAll('.markdown-table-scroll')) scroller.classList.add('table-scroll');
  // The sanitizer drops an id that would shadow a property of the page (`title`, `body`, …); a deck must not open with another id in its place.
  for (const marker of body.querySelectorAll('[data-ct-mark="slide"]:not([id])')) throw new SlideDeckError('this ::slide id is a name the page reserves (such as "title" or "body"): choose another id', lineOf({ properties: { dataLine: marker.getAttribute('data-line') } }));
  // A note's line break is a `<br>` with no space beside it; contour-deck titles a slide without a heading by its text, where the two lines would run together.
  for (const lineBreak of body.querySelectorAll('br')) lineBreak.after('\n');
  const tree: DeckTree = { type: 'root', children: [...(fromDom(body) as { children: HastNodes[]; }).children] };
  rehypeDeck({ title })(tree, {
    data: {},
    fail(reason, place) {
      throw new SlideDeckError(reason, lineOf(place));
    },
  });
  return tree;
}

/** The deck element `createDeck` takes, built from a slide note's sanitized HTML. */
export function buildDeck(html: string, title?: string): HTMLElement {
  return toDom(readDeck(html, title).children[0]) as HTMLElement;
}
