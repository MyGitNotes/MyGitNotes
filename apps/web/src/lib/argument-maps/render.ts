/**
 * Renders an argument-map block to the figure HTML of the blog's `remark-argument-maps` plugin
 * (wayne930242/knowledge-base, commit e9cbe4b7, `renderMap`): the same element tree and `am-*` classes, an indented
 * collapsible tree and a numbered standard form behind CSS-only radio tabs, with the blog's zh-TW wording. The blog's
 * CSS is not used; the app styles the figure from its theme tokens (`directives/argument-maps.css`).
 */

import { escapeHtml } from '../directives.js';
import { type Argument, type ArgumentMap, ArgumentMapError, type ArgumentMapView, type ArgumentRelation, type ArgumentStatus, parseArgumentMap, type Statement } from './parse.js';

export { ArgumentMapError } from './parse.js';

export interface ArgumentMapContext {
  /** Inline Markdown of the note's own dialect to HTML (emphasis, links, code, math), without a wrapping paragraph. */
  renderInline: (markdown: string) => string;
}

const RELATION_TEXT = { support: '支持', rebut: '反駁', undercut: '削弱' } satisfies Record<ArgumentRelation, string>;
const STATUS_TEXT = { accepted: '✓ 接受', rejected: '✗ 不接受', open: '? 未定' } satisfies Record<ArgumentStatus, string>;

// ---------------------------------------------------------------------------
// HTML builders

type AttrValue = string | string[] | boolean | undefined;

/** `<name attrs>children</name>`; an empty class list, `false` and `undefined` leave the attribute out, `true` writes it bare. */
function tag(name: string, className: string | string[] | null, children: string | string[] = '', attrs: Record<string, AttrValue> = {}): string {
  const classes = className === null ? [] : [className].flat();
  const all: Record<string, AttrValue> = classes.length ? { class: classes, ...attrs } : attrs;
  const parts = Object.entries(all).flatMap(([key, value]) => {
    if (value === undefined || value === false) return [];
    if (value === true) return [key];
    return [`${key}="${escapeHtml(Array.isArray(value) ? value.join(' ') : value)}"`];
  });
  const open = `<${name}${parts.length ? ` ${parts.join(' ')}` : ''}>`;
  if (name === 'input') return open;
  return `${open}${Array.isArray(children) ? children.join('') : children}</${name}>`;
}

const text = (value: string): string => escapeHtml(value);

/** Every figure's radio group and ids carry this number, so they stay unique in a page however often a note renders. */
let figureCount = 0;

// ---------------------------------------------------------------------------
// Shared pieces

interface Renderer {
  map: ArgumentMap;
  /** A row's fields: inline Markdown of the note's dialect, in which a note may also write inline HTML. */
  inline: (markdown: string | undefined) => string;
  /** An attribute's value: as the blog reads it, emphasis and links but no HTML. */
  attribute: (markdown: string | undefined) => string;
}

const idChip = (id: string | undefined): string[] => id ? [tag('span', 'am-id', text(id))] : [];
const implicitTag = (statement: Statement): string[] => statement.implicit ? [tag('span', 'am-tag', text('隱含前提'))] : [];
const statusTag = (argument: Argument): string[] => argument.status ? [tag('span', ['am-status', `am-status-${argument.status}`], text(STATUS_TEXT[argument.status]))] : [];

/** What an undercut attacks, as written in the relation line. */
const targetText = (argument: Argument): string => argument.relation === 'undercut' ? `${argument.to} 的推論` : argument.to;

// ---------------------------------------------------------------------------
// Map view (indented, collapsible tree)

function card(r: Renderer, statement: Statement, extra: string[] = []): string {
  return tag('div', ['am-st', ...statement.implicit ? ['am-implicit'] : [], ...statement.key ? ['am-key'] : [], ...extra], [...idChip(statement.id), ...implicitTag(statement), tag('span', 'am-text', r.inline(statement.content)), ...statement.source ? [tag('span', 'am-src', r.inline(statement.source))] : []]);
}

/** Arguments that follow `argument`: those on its rows, then those on it. */
function followers(map: ArgumentMap, argument: Argument): Argument[] {
  return [...argument.rows.flatMap(row => map.targeting(row.id)), ...map.targeting(argument.id)];
}

function statementCount(map: ArgumentMap, argument: Argument): number {
  return argument.rows.length + followers(map, argument).reduce((sum, next) => sum + statementCount(map, next), 0);
}

function outlineArgument(r: Renderer, argument: Argument): string {
  const next = followers(r.map, argument);
  const summary = tag('summary', 'am-rel', [tag('span', 'am-badge', text(RELATION_TEXT[argument.relation])), tag('span', 'am-target', text(targetText(argument))), ...argument.label ? [tag('span', 'am-label', r.attribute(argument.label))] : [], ...argument.id ? [tag('span', 'am-argid', text(argument.id))] : [], ...statusTag(argument), tag('span', 'am-count', text(`已收合 ${statementCount(r.map, argument)} 條命題`))]);
  const body = [summary, tag('div', 'am-box', argument.rows.map(row => card(r, row))), ...next.length ? [tag('ul', 'am-kids', next.map(child => outlineArgument(r, child)))] : []];
  return tag('li', ['am-arg', `am-${argument.relation}`], tag('details', 'am-details', body, { open: true }));
}

function outline(r: Renderer): string {
  const top = r.map.targeting(r.map.root.id);
  return tag('div', 'am-outline', [card(r, r.map.root, ['am-root']), ...top.length ? [tag('ul', 'am-kids', top.map(argument => outlineArgument(r, argument)))] : []]);
}

// ---------------------------------------------------------------------------
// Standard form (numbered premise-conclusion blocks)

function standard(r: Renderer): string {
  const { map } = r;
  const numbers = new Map<Statement, number>();
  const number = (statement: Statement): number => {
    if (!numbers.has(statement)) numbers.set(statement, numbers.size + 1);
    return numbers.get(statement) as number;
  };
  const numberNode = (statement: Statement) => tag('span', 'am-sf-n', text(`(${number(statement)})`));

  const blocks: string[] = [];
  const block = (argument: Argument) => {
    const { relation } = argument;
    const target = map.statements.get(argument.to);
    const targetArgument = map.argumentsById.get(argument.to);

    // Premises are numbered before the head reads them back.
    const premises = argument.rows.map(row => tag('li', 'am-sf-row', [numberNode(row), ...implicitTag(row), tag('span', 'am-text', r.inline(row.content)), ...row.source ? [tag('span', 'am-src', r.inline(row.source))] : []]));

    let head: string;
    if (relation === 'undercut') {
      const attacked = targetArgument as Argument;
      const aim = map.statements.get(attacked.to);
      head = `削弱 ${attacked.id} 的推論：${attacked.rows.map(row => `(${number(row)})`).join('')} ⟹ ${aim ? `(${number(aim)})` : `削弱 ${attacked.to}`}`;
    } else if (relation === 'rebut') head = `反駁 (${number(target as Statement)})`;
    else head = argument.id ?? '論證';

    const children = [tag('p', 'am-sf-head', [text(head), ...argument.label ? [tag('span', 'am-label', r.attribute(argument.label))] : [], ...statusTag(argument)]), tag('ol', 'am-sf-rows', premises)];
    if (relation === 'support') children.push(tag('div', 'am-sf-rule', tag('span', 'am-sr', text('因此'))), tag('p', 'am-sf-conclusion', [numberNode(target as Statement), tag('span', 'am-text', r.inline((target as Statement).content))]));
    blocks.push(tag('section', ['am-sf-block', `am-${relation}`], children));

    for (const row of argument.rows) map.targeting(row.id).forEach(block);
    map.targeting(argument.id).forEach(block);
  };

  const main = tag('section', 'am-sf-block', [tag('p', 'am-sf-head', text('主結論')), tag('p', 'am-sf-conclusion', [numberNode(map.root), tag('span', 'am-text', r.inline(map.root.content)), ...map.root.source ? [tag('span', 'am-src', r.inline(map.root.source))] : []])]);
  map.targeting(map.root.id).forEach(block);
  return tag('div', 'am-standard', [main, ...blocks]);
}

// ---------------------------------------------------------------------------
// Figure frame with CSS-only view tabs

const VIEWS: { view: ArgumentMapView; label: string; body: (r: Renderer) => string; }[] = [{ view: 'map', label: '論證圖', body: outline }, { view: 'standard', label: '標準形式', body: standard }];

/**
 * The figure for `source`, one argument-map block from its opening fence through its closing fence, as a single line of
 * HTML. Throws {@link ArgumentMapError} for what the blog fails its build on.
 */
export function renderArgumentMap(source: string, context: ArgumentMapContext): string {
  const map = parseArgumentMap(source);
  const id = `am-${++figureCount}`;
  const inline = (markdown: string | undefined) => markdown?.trim() ? context.renderInline(markdown) : '';
  const r: Renderer = { map, inline, attribute: markdown => inline(markdown?.replaceAll('<', '&lt;')) };

  const caption = [...map.title ? [tag('p', 'am-title', r.attribute(map.title))] : [], ...map.subtitle ? [tag('p', 'am-subtitle', r.attribute(map.subtitle))] : []];
  const notes = [...map.note ? [tag('p', null, [text('說明：'), r.attribute(map.note)])] : [], ...map.source ? [tag('p', null, [text('出處：'), r.attribute(map.source)])] : []];

  return tag('figure', 'am-figure', [...caption.length ? [tag('figcaption', 'am-caption', caption)] : [], ...VIEWS.map(({ view }) => tag('input', ['am-input', `am-input-${view}`], '', { type: 'radio', name: `${id}-view`, id: `${id}-${view}`, checked: view === map.view })), tag('div', 'am-tabs', VIEWS.map(({ view, label }) => tag('label', ['am-tab', `am-tab-${view}`], text(label), { for: `${id}-${view}` }))), ...VIEWS.map(({ view, body }) => tag('div', ['am-panel', `am-panel-${view}`], body(r))), ...notes.length ? [tag('div', 'am-notes', notes)] : []], { id });
}

/**
 * The inline box that stands in for a figure that cannot render. The source goes in a `<pre>` with its line breaks as
 * character references, so the box stays one HTML block when the note's Markdown runs over it.
 */
export function renderArgumentMapError(error: ArgumentMapError, source: string, heading: string): string {
  const escaped = escapeHtml(source.replace(/\n+$/, '')).replaceAll('\n', '&#10;');
  return tag('div', 'am-error', [tag('p', 'am-error-title', text(heading)), tag('p', 'am-error-message', text(error.message)), `<pre class="am-error-source">${escaped}</pre>`], { role: 'alert' });
}
