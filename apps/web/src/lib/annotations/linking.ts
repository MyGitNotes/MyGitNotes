/**
 * The page-level behaviour of annotation figures, installed once for the whole app: hover and focus on a marker or a list
 * item highlight its twin (same `ann-n-<id>` class in the same figure), and a click on a marker or a number scrolls to its
 * counterpart without letting the hash reach the router. The same HTML works without this: the `#` links jump and `:target`
 * highlights.
 */

/** Sent on a jump target before it scrolls; a PDF figure turns to the target's page. */
export const REVEAL_EVENT = 'annotation:reveal';

const NUMBER = /(?:^|\s)(ann-n-\d+)(?=\s|$)/;

function twinsOf(element: Element): { figure: Element; twins: Element[]; } | undefined {
  const figure = element.closest('.ann-figure');
  const marker = element.closest('.ann-marker, .ann-item');
  const match = marker && NUMBER.exec(marker.getAttribute('class') ?? '');
  if (!figure || !match) return undefined;
  return { figure, twins: [...figure.querySelectorAll(`.ann-marker.${match[1]}, .ann-item.${match[1]}`)] };
}

function clearLinks(figure: Element): void {
  for (const element of figure.querySelectorAll('.is-linked')) element.classList.remove('is-linked');
}

function link(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const found = twinsOf(target);
  if (!found) return;
  clearLinks(found.figure);
  for (const twin of found.twins) twin.classList.add('is-linked');
}

function unlink(target: EventTarget | null, next: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const figure = target.closest('.ann-figure');
  if (!figure || (next instanceof Element && figure.contains(next) && twinsOf(next))) return;
  clearLinks(figure);
}

function jump(event: MouseEvent): void {
  if (event.defaultPrevented || !(event.target instanceof Element)) return;
  const anchor = event.target.closest('a.ann-marker, a.ann-ref, a.ann-page-ref');
  const figure = anchor?.closest('.ann-figure');
  const href = anchor?.getAttribute('href') ?? '';
  if (!anchor || !figure || !href.startsWith('#')) return;
  event.preventDefault();
  const target = [...figure.querySelectorAll('[id]')].find(element => element.id === href.slice(1));
  if (!target) return;
  // A page viewer shows the target's page now, so the scroll below lands on something that is on screen.
  target.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
  const flash = target.closest('.ann-item') ?? target;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  flash.classList.remove('is-flash');
  // Restarting the animation needs a reflow between removing and adding the class.
  void (flash as HTMLElement).offsetWidth;
  flash.classList.add('is-flash');
  setTimeout(() => flash.classList.remove('is-flash'), 1000);
}

/** Installs the listeners on a document; returns the function that removes them. */
export function installAnnotationLinking(doc: Document = document): () => void {
  const over = (event: Event) => link(event.target);
  const out = (event: Event) => unlink(event.target, (event as PointerEvent | FocusEvent).relatedTarget);
  doc.addEventListener('pointerover', over);
  doc.addEventListener('focusin', over);
  doc.addEventListener('pointerout', out);
  doc.addEventListener('focusout', out);
  doc.addEventListener('click', jump);
  return () => {
    doc.removeEventListener('pointerover', over);
    doc.removeEventListener('focusin', over);
    doc.removeEventListener('pointerout', out);
    doc.removeEventListener('focusout', out);
    doc.removeEventListener('click', jump);
  };
}
