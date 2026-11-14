/**
 * Plays a slide note with contour-deck. Everything here loads on the first Play: contour-deck's core, its stylesheet and its rehype
 * plugin, and the two hast utilities `buildDeck` uses. A note that is never played downloads none of it.
 */
import { createDeck, type Labels } from 'contour-deck';
import 'contour-deck/style.css';
import './deck.css';
import { hydratePdfFigures } from '../annotations/pdf-figure.js';
import type { I18nContextValue } from '../i18n/index.js';
import { hydrateMermaid } from '../mermaid.js';
import { hydrateQrCodes } from '../qrcode.js';
import { buildDeck } from './deck.js';
import { EmptyDeckError } from './errors.js';

/** contour-deck's interface text in English; its own defaults are Traditional Chinese. */
const ENGLISH_LABELS: Labels = { overview: 'Outline', notes: 'Notes', script: 'Script', threeD: '3D', prev: 'Previous step', next: 'Next step', exit: 'Leave the slides', remote: 'Remote', here: 'You are here', appendix: 'Written', rail: 'Position in the deck', noNotes: '(No notes for this page)', slides: count => count === 1 ? '1 slide' : `${count} slides`, pages: count => count === 1 ? '1 page' : `${count} pages`, minutes: count => `about ${count} min`, page: (index, count) => `Page ${index}/${count}`, steps: (shown, count) => `Step ${shown}/${count}`, thumb: (block, slide, title, pages) => `${block}, slide ${slide}: ${title}${pages > 1 ? `, ${pages} pages` : ''}` };

export interface OpenDeckOptions {
  /** The note's sanitized HTML, rendered with `slides: 'deck'`. */
  html: string;
  /** The deck's title, shown over the outline. */
  title?: string;
  /** `deck` opens on the outline, `notes` on the speaker notes as a scrolling script. */
  view: 'deck' | 'notes';
  language: I18nContextValue['language'];
  t: I18nContextValue['t'];
  /** The reader left: Esc on the outline, or the close button. */
  onExit: () => void;
}

/**
 * Builds the deck inside `host` and opens it over the window; the returned function closes it and takes it out again. Throws a
 * `SlideDeckError` where contour-deck refuses the note, and an `EmptyDeckError` for a note without a slide.
 */
export function openDeck(host: HTMLElement, { html, title, view, language, t, onExit }: OpenDeckOptions): () => void {
  const root = buildDeck(html, title);
  if (!root.querySelector('[data-ct-slide]')) throw new EmptyDeckError();
  // A page is drawn with the note's own styles, so a slide's content looks as it does in the preview; the shell around it stays contour-deck's.
  for (const page of root.querySelectorAll('[data-ct-page]')) page.classList.add('prose-custom');
  host.append(root);
  // The diagrams, QR codes and PDF figures are drawn on the deck's own elements, as a preview draws them on its.
  const stopMermaid = hydrateMermaid(root, { errorLabel: t('mermaid.error') });
  const stopPdfFigures = hydratePdfFigures(root, { t });
  const stopQrCodes = hydrateQrCodes(root);
  // The app has its own router: the deck neither reads nor writes the address.
  const deck = createDeck(root, { url: false, view, labels: language === 'en' ? ENGLISH_LABELS : undefined });
  deck.on('exit', onExit);
  return () => {
    stopMermaid();
    stopPdfFigures();
    stopQrCodes();
    deck.destroy();
    root.remove();
  };
}
