/**
 * The slide directives of contour-deck (`:::summary`, `:::build`, `::vertical`, `::block`, `::slide`) in a note.
 *
 * What a directive means, and which form and attributes it takes, is contour-deck's to say: each one is handed to its `remarkDeck` as the
 * node remark-directive would have parsed, and what comes back is the marker element `rehypeDeck` reads, or the message it refuses the
 * directive with. This module only writes that answer as HTML: the marker itself for a deck, and what a reader sees for a preview.
 */
import { remarkDeck } from 'contour-deck/remark';
import type { TranslationKey } from '../i18n/en.js';
import { SlideDeckError } from './errors.js';

/**
 * How a `type: slide` note's slide directives are written: `preview` as a reader sees them (labelled notes, numbered steps, page dividers,
 * an error box for a directive contour-deck refuses), `deck` as the markers `rehypeDeck` builds a deck from, where such a directive throws.
 */
export type SlideRendering = 'preview' | 'deck';

/** The three ways remark-directive reads a directive: `:::name` … `:::`, `::name` on a line of its own, and `:name` in text. */
export type SlideDirectiveForm = 'container' | 'leaf' | 'text';

const CONTAINERS: ReadonlySet<string> = new Set(['summary', 'build']);
const LEAVES: ReadonlySet<string> = new Set(['vertical', 'block', 'slide']);

/** Whether contour-deck reads a directive of this name. */
export function isSlideDirective(name: string): boolean {
  return CONTAINERS.has(name) || LEAVES.has(name);
}

/** Whether the slide directive of this name holds content (`:::summary`, `:::build`). */
export function isSlideContainer(name: string): boolean {
  return CONTAINERS.has(name);
}

/** A line that is a leaf directive (`::name[label]{attrs}`) or, with one colon, a text directive standing alone. */
export function parseDirectiveLine(line: string): { form: 'leaf' | 'text'; name: string; rawAttrs?: string; } | null {
  const match = /^ {0,3}(::?)([A-Za-z][\w-]*)(?:\[[^\]]*\])?(?:\{([^}]*)\})?\s*$/.exec(line);
  return match ? { form: match[1].length === 2 ? 'leaf' : 'text', name: match[2], rawAttrs: match[3] } : null;
}

/** The attributes of a directive as remark-directive reads them: `#id`, `.class`, `key`, `key=value` and quoted values. */
export function parseSlideAttributes(raw: string | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!raw) return attributes;
  const pattern = /#([^\s#.{}"'=]+)|\.([^\s#.{}"'=]+)|([A-Za-z_:][\w:.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`{}]+)))?/g;
  for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
    if (match[1] !== undefined) attributes.id = match[1];
    else if (match[2] !== undefined) attributes.class = attributes.class ? `${attributes.class} ${match[2]}` : match[2];
    else attributes[match[3]] = match[4] ?? match[5] ?? match[6] ?? '';
  }
  return attributes;
}

/** The marker element contour-deck writes for a slide directive: its tag and its hast properties (`dataCtMark`, `dataTitle`, `id`, …). */
interface SlideMarker {
  tag: string;
  properties: Record<string, unknown>;
}

interface DirectiveNode {
  type: string;
  name: string;
  attributes: Record<string, string>;
  children: DirectiveNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; };
}

/**
 * What contour-deck makes of one slide directive in a note of this `structure` (`slideOptions.structure`; none is its default); throws a
 * {@link SlideDeckError} with the message it refuses the directive with, or the structure.
 */
function slideMarker(name: string, form: SlideDirectiveForm, attributes: Record<string, string>, structure: string | undefined): SlideMarker {
  const node: DirectiveNode = { type: `${form}Directive`, name, attributes, children: [] };
  // Which structures there are is contour-deck's to say, so the value is not narrowed here.
  remarkDeck({ structure: structure as never })({ type: 'root', children: [node] }, {
    data: {},
    fail(reason) {
      throw new SlideDeckError(reason);
    },
  });
  return { tag: node.data?.hName ?? 'div', properties: node.data?.hProperties ?? {} };
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A marker's properties as HTML attributes: `dataCtMark` is `data-ct-mark`, and `true` an attribute without a value. */
function markerAttributes(properties: Record<string, unknown>): string {
  return Object.entries(properties).map(([name, value]) => {
    const attribute = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    return value === true ? ` ${attribute}` : ` ${attribute}="${escapeHtml(String(value))}"`;
  }).join('');
}

/** Where one slide directive is being written. */
export interface SlideDirectiveContext {
  rendering: SlideRendering;
  strings: Record<TranslationKey, string>;
  /** The 1-based line of the note's text the directive opens on. */
  line: number;
  /** The note's `slideOptions.structure`, which decides what contour-deck takes: `::vertical` is refused in a note read by its headings. */
  structure?: string;
}

/** The directive as its source reads, for an error box; its line breaks are character references, so the box stays one HTML block. */
function errorBox(message: string, source: string, strings: Record<TranslationKey, string>): string {
  return `<div class="ig-error slide-error" role="alert"><p class="ig-error-title">${escapeHtml(strings['slides.directiveError'])}</p><p class="ig-error-message">${escapeHtml(message)}</p><pre class="ig-error-source">${escapeHtml(source).replaceAll('\n', '&#10;')}</pre></div>`;
}

/**
 * The HTML of a slide directive: `body` is the rendered content of a container, absent for a leaf. In a preview a directive contour-deck
 * refuses is an error box showing `source`; in a deck it throws, so a deck is never built from a note it would split wrongly.
 */
export function renderSlideDirective(name: string, form: SlideDirectiveForm, rawAttrs: string | undefined, source: string, { rendering, strings, line, structure }: SlideDirectiveContext, body?: string): string {
  let marker: SlideMarker;
  try {
    marker = slideMarker(name, form, parseSlideAttributes(rawAttrs), structure);
  } catch (error) {
    if (!(error instanceof SlideDeckError)) throw error;
    if (rendering === 'deck') throw new SlideDeckError(error.message, line);
    return errorBox(error.message, source, strings);
  }
  if (rendering === 'deck') {
    const attributes = `${markerAttributes(marker.properties)}${body === undefined ? ` data-line="${line}"` : ''}`;
    return marker.tag === 'hr' ? `<hr${attributes}>` : `<${marker.tag}${attributes}>${body ?? ''}</${marker.tag}>`;
  }
  if (name === 'summary') return `<aside class="slide-notes" data-type="summary" aria-label="${escapeHtml(strings['slides.notesLabel'])}"><p class="slide-notes-label">${escapeHtml(strings['slides.notesLabel'])}</p><div class="slide-notes-body directive-content">${body ?? ''}</div></aside>`;
  if (name === 'build') return `<div class="slide-build" data-type="build">${body ?? ''}</div>`;
  if (name === 'vertical') return '<hr class="slide-page-break" data-type="vertical">';
  if (name === 'block') {
    const { dataTitle, dataMinutes } = marker.properties;
    const minutes = dataMinutes === undefined ? '' : `<span class="slide-block-minutes">${escapeHtml(strings['slides.blockMinutes'].replace('{count}', String(dataMinutes)))}</span>`;
    // A note read by its headings titles a block by its heading, and a `::block` there may name only the minutes or the label.
    const title = dataTitle === undefined ? '' : `<span class="slide-block-name">${escapeHtml(String(dataTitle))}</span>`;
    return `<div class="slide-block-title" data-type="block"><span class="slide-block-label">${escapeHtml(strings['slides.blockLabel'])}</span>${title}${minutes}</div>`;
  }
  // `::slide{#id}` names the slide and shows nothing.
  return '<div class="slide-anchor" data-type="slide"></div>';
}
