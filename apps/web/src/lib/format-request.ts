import type { MarkdownFormat } from './markdown-format.js';

/**
 * How a command outside the editor (the palette) and an editor's own key talk to the Markdown editor that wraps the focused text. Both are
 * events on the focused element that bubble to the editor's wrapper, so a page with several editors reaches the right one and the command
 * itself is registered once.
 */
const REQUEST = 'mygitnotes:format-request';
const REFUSED = 'mygitnotes:format-refused';

/** Asks the Markdown editor around `target` to apply `format`; false when no editor there took it. */
export function requestFormat(target: Element, format: MarkdownFormat): boolean {
  const event = new CustomEvent<MarkdownFormat>(REQUEST, { bubbles: true, cancelable: true, detail: format });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** What an editor reports when a format could not be applied. */
export type FormatRefusal = 'qrcode-text';

export function reportRefusal(target: Element, refusal: FormatRefusal): void {
  target.dispatchEvent(new CustomEvent<FormatRefusal>(REFUSED, { bubbles: true, detail: refusal }));
}

/** Listens, on the editor's wrapper, for format requests and refusals; the returned function stops it. */
export function listenForFormats(wrapper: HTMLElement, handlers: { request: (format: MarkdownFormat) => boolean; refused: (refusal: FormatRefusal) => void; }): () => void {
  const onRequest = (event: Event) => {
    if (handlers.request((event as CustomEvent<MarkdownFormat>).detail)) event.preventDefault();
  };
  const onRefused = (event: Event) => handlers.refused((event as CustomEvent<FormatRefusal>).detail);
  wrapper.addEventListener(REQUEST, onRequest);
  wrapper.addEventListener(REFUSED, onRefused);
  return () => {
    wrapper.removeEventListener(REQUEST, onRequest);
    wrapper.removeEventListener(REFUSED, onRefused);
  };
}
