/**
 * Renders an `:::annotate` block to its figure HTML: the image with an SVG overlay of numbered markers, and a list of the
 * comments. The structure and class names are a contract with other renderers of the same HTML (the Pro public-page
 * stylesheet targets them), so keep them stable. Positions are percentage attributes of the overlay, never inline style,
 * because a public page forbids both inline style and data attributes. State is a class (`is-resolved`, `is-problem`).
 */

import { escapeHtml } from '../directives.js';
import type { TranslationKey } from '../i18n/en.js';
import type { AnnotateError } from './parse.js';
import { type AnnotationRow, parseAnnotate, type RowProblem } from './parse.js';

export { AnnotateError } from './parse.js';

export type AnnotateStrings = Record<TranslationKey, string>;

export interface AnnotateContext {
  /** Block Markdown of the note's own dialect to HTML; a comment is rendered with it. */
  renderMarkdown: (markdown: string) => string;
  /** The page language's strings (the app's `en` or `zhTW` table). */
  strings: AnnotateStrings;
}

/** Every figure's ids carry this number, so they stay unique in a page however often a note renders. */
let figureCount = 0;

const PIN_PATH = 'M0 0 C-4 -6 -12 -12 -12 -20 A12 12 0 1 1 12 -20 C12 -12 4 -6 0 0Z';
const TITLE_LENGTH = 80;

function label(strings: AnnotateStrings, key: string, params: Record<string, string | number> = {}): string {
  const template = strings[`imageAnnotation.render.${key}` as TranslationKey];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

/** A coordinate as the SVG presentation attribute carries it. */
const pct = (value: number | undefined): string => `${Number((value ?? 0).toFixed(2))}%`;

interface Item {
  row: AnnotationRow;
  index: number;
  /** The key in DOM ids: the annotation number when it identifies the row, else the row's position. */
  key: string;
  /** The number on the marker; `?` when the row has none. */
  label: string;
  /** `ann-n-<id>` is only written for an id that names exactly one row. */
  numbered: boolean;
}

function itemsOf(rows: readonly AnnotationRow[]): Item[] {
  const claimed = new Set<number>();
  return rows.map((row, index) => {
    const unique = row.id !== undefined && !claimed.has(row.id);
    if (row.id !== undefined) claimed.add(row.id);
    return { row, index, key: unique ? String(row.id) : `r${index}`, label: row.id === undefined ? '?' : String(row.id), numbered: unique };
  });
}

function itemClasses(item: Item, extra: string[] = []): string {
  const { row } = item;
  return ['ann-' + (row.kind ?? 'row'), ...item.numbered ? [`ann-n-${row.id}`] : [], ...row.resolved ? ['is-resolved'] : [], ...row.problems.length ? ['is-problem'] : [], ...extra].filter(name => name !== 'ann-row').join(' ');
}

function snippet(comment: string): string {
  const flat = comment.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_LENGTH ? `${flat.slice(0, TITLE_LENGTH)}…` : flat;
}

function markerHtml(figure: string, item: Item, strings: AnnotateStrings): string {
  const { row } = item;
  const state = label(strings, row.resolved ? 'stateResolved' : 'stateOpen');
  const kind = label(strings, row.kind === 'region' ? 'kindRegion' : 'kindPin');
  const name = `${item.label}, ${kind.toLowerCase()}, ${state}`;
  const tip = snippet(row.comment);
  const head = `<a href="#${figure}-${item.key}" id="${figure}-${item.key}-m" class="ann-marker ${itemClasses(item)}" aria-label="${escapeHtml(name)}"><title>${escapeHtml(tip ? `${item.label} · ${tip}` : item.label)}</title>`;
  if (row.kind === 'region') {
    return `${head}<rect x="${pct(row.x)}" y="${pct(row.y)}" width="${pct(row.w)}" height="${pct(row.h)}" rx="3"/><svg class="ann-badge" x="${pct(row.x)}" y="${pct(row.y)}" overflow="visible"><circle r="11"/><text text-anchor="middle" dominant-baseline="central">${escapeHtml(item.label)}</text></svg></a>`;
  }
  return `${head}<svg x="${pct(row.x)}" y="${pct(row.y)}" overflow="visible"><path d="${PIN_PATH}"/><text y="-20" text-anchor="middle" dominant-baseline="central">${escapeHtml(item.label)}</text></svg></a>`;
}

function problemText(strings: AnnotateStrings, problem: RowProblem): string {
  return label(strings, `problem.${problem.code}`, { detail: problem.detail ?? '' });
}

function listItemHtml(figure: string, item: Item, context: AnnotateContext): string {
  const { row } = item;
  const { strings } = context;
  const ref = row.hasGeometry ? `<a class="ann-ref" href="#${figure}-${item.key}-m">${escapeHtml(item.label)}</a>` : `<span class="ann-ref">${escapeHtml(item.label)}</span>`;
  const kind = row.kind ? `<span class="ann-kind">${escapeHtml(label(strings, row.kind === 'region' ? 'kindRegion' : 'kindPin'))}</span>` : '';
  const state = row.resolved ? `<span class="ann-state">${escapeHtml(label(strings, 'resolvedMark'))}</span>` : '';
  const by = row.by ? `<span class="ann-by">${escapeHtml(row.by)}</span>` : '';
  const comment = row.comment ? `<div class="ann-comment">${context.renderMarkdown(row.comment).replace(/\n/g, '&#10;')}</div>` : `<div class="ann-comment ann-empty">${escapeHtml(label(strings, 'noComment'))}</div>`;
  const problems = row.problems.map(problem => `<span class="ann-problem">${escapeHtml(problemText(strings, problem))}</span>`).join('');
  return `<li id="${figure}-${item.key}" class="ann-item ${itemClasses(item)}">${ref}${kind}${state}${by}${problems}${comment}</li>`;
}

/** The figure for an annotate block's source. Throws {@link AnnotateError} for a block error. */
export function renderAnnotate(source: string, context: AnnotateContext): string {
  const { strings } = context;
  const parsed = parseAnnotate(source);
  const figure = `ann-${++figureCount}`;
  const items = itemsOf(parsed.rows);
  const open = items.filter(item => !item.row.resolved);
  const resolved = items.filter(item => item.row.resolved);
  const drawn = items.filter(item => item.row.hasGeometry);
  const markers = [...drawn.filter(item => item.row.kind === 'region'), ...drawn.filter(item => item.row.kind === 'pin')].map(item => markerHtml(figure, item, strings)).join('');
  const name = parsed.title ?? (parsed.media.alt || parsed.media.src);

  const caption = `<figcaption class="ann-caption">${parsed.title ? `<span class="ann-title">${escapeHtml(parsed.title)}</span>` : ''}<span class="ann-counts">${escapeHtml(label(strings, 'counts', { open: open.length, resolved: resolved.length }))}</span> <a class="ann-open" href="${escapeHtml(parsed.media.src)}">${escapeHtml(label(strings, 'open'))}</a></figcaption>`;
  const image = `<img src="${escapeHtml(parsed.media.src)}" alt="${escapeHtml(parsed.media.alt)}"${parsed.media.title ? ` title="${escapeHtml(parsed.media.title)}"` : ''}>`;
  const overlay = `<svg class="ann-overlay" aria-label="${escapeHtml(label(strings, 'overlay', { name: parsed.media.alt || name }))}">${markers}</svg>`;
  const openList = open.length ? `<ol class="ann-list" aria-label="${escapeHtml(label(strings, 'listOpen'))}">${open.map(item => listItemHtml(figure, item, context)).join('')}</ol>` : '';
  const resolvedList = resolved.length ? `<details class="ann-resolved"><summary>${escapeHtml(label(strings, 'resolvedSummary', { count: resolved.length }))}</summary><ol class="ann-list" aria-label="${escapeHtml(label(strings, 'listResolved'))}">${resolved.map(item => listItemHtml(figure, item, context)).join('')}</ol></details>` : '';

  return `<figure class="ann-figure" data-type="annotate" id="${figure}" aria-label="${escapeHtml(name)}">${caption}<div class="ann-body"><div class="ann-stage">${image}${overlay}</div><div class="ann-side">${openList}${resolvedList}</div></div></figure>`;
}

/** The box shown in a block's place when its syntax is rejected. */
export function renderAnnotateError(error: AnnotateError, source: string, heading: string): string {
  const escaped = escapeHtml(source.replace(/\n+$/, '')).replaceAll('\n', '&#10;');
  return `<div class="ann-error" role="alert"><p class="ann-error-title">${escapeHtml(heading)}</p><p class="ann-error-message">${escapeHtml(error.message)}</p><pre class="ann-error-source">${escaped}</pre></div>`;
}
