/**
 * The argument-map directive's syntax and its errors, ported from the blog's `remark-argument-maps.ts`
 * (wayne930242/knowledge-base, commit e9cbe4b7, `parseMap`): a root `::::argument-map` whose one list holds the main
 * conclusion, and `:::reason` / `:::objection` containers whose one list holds statement rows `- [ID] text｜source`.
 * The blog parses with remark; the app has no Markdown syntax tree for notes, so this reads the lines of the block
 * directly and applies the blog's rules to them. Everything the blog fails its build on throws {@link ArgumentMapError}.
 */

import { matchDirectiveClose, parseDirectiveOpen } from '../directives.js';
import { plainField, splitFields } from '../infographics/model.js';

export const ARGUMENT_MAP_DIRECTIVE = 'argument-map';
export const ARGUMENT_MAP_CHILD_DIRECTIVES = ['reason', 'objection'] as const;
export const ARGUMENT_MAP_VIEWS = ['map', 'standard'] as const;
export const ARGUMENT_STATUSES = ['accepted', 'rejected', 'open'] as const;

export type ArgumentMapView = typeof ARGUMENT_MAP_VIEWS[number];
export type ArgumentStatus = typeof ARGUMENT_STATUSES[number];
export type ArgumentRelation = 'support' | 'rebut' | 'undercut';

/** A whole-figure error the blog fails its build on; the caller shows it in the figure's place. */
export class ArgumentMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentMapError';
  }
}

export function isArgumentMapName(name: string): boolean {
  return name === ARGUMENT_MAP_DIRECTIVE;
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/;
/** A leading `[id]`; a `[text](url)` link or `[text][ref]` reference is not one. */
const LEADING_ID = /^\[([A-Za-z][A-Za-z0-9-]*)\](?![([])\s*/;
/** A task marker: GFM reads `- [x] text` and `- [ ] text` as a checkbox item, which the blog rejects. */
const TASK_MARKER = /^\[[ xX]\](?:\s|$)/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
/** A line that cannot continue a paragraph: it starts a heading, quote or code fence. */
const INTERRUPTS = /^ {0,3}(?:#{1,6}(?:\s|$)|>|`{3,}|~{3,})/;

export interface Statement {
  /** The id the author wrote; only statements with one can be a `to` target. */
  id?: string;
  /** Inline Markdown. */
  content: string;
  /** Inline Markdown. */
  source?: string;
  implicit: boolean;
  key: boolean;
}

export interface Argument {
  kind: typeof ARGUMENT_MAP_CHILD_DIRECTIVES[number];
  id?: string;
  to: string;
  label?: string;
  status?: ArgumentStatus;
  rows: Statement[];
  relation: ArgumentRelation;
}

export interface ArgumentMap {
  title?: string;
  subtitle?: string;
  note?: string;
  source?: string;
  view: ArgumentMapView;
  root: Statement;
  args: Argument[];
  /** Arguments grouped by the id they target, in source order. */
  targeting(id: string | undefined): Argument[];
  /** Statement ids and argument ids share one namespace. */
  statements: Map<string, Statement>;
  argumentsById: Map<string, Argument>;
}

function fail(message: string): never {
  throw new ArgumentMapError(message);
}

// ---------------------------------------------------------------------------
// Lists

interface ListRead {
  /** Separate lists, each a list of items whose lines are joined into one line of text. */
  lists: string[][];
  /** Something other than a list (a paragraph, a heading, a quote, a code fence) was found. */
  other: boolean;
}

/** `- item` lines as the blog's Markdown reads them: item lines continue a paragraph; anything else beside the list is "other". */
function readLists(lines: readonly string[], owner: string): ListRead {
  const lists: string[][] = [];
  const markers: string[] = [];
  let other = false;
  let item: { index: number; indent: number; } | undefined;
  let previousBlank = true;
  for (const line of lines) {
    if (!line.trim()) {
      previousBlank = true;
      continue;
    }
    const match = LIST_ITEM.exec(line);
    const indent = /^ */.exec(line)![0].length;
    if (match && !(item && indent >= item.indent + 2)) {
      // A different bullet character or number delimiter starts a new list, as in CommonMark.
      const marker = /^\d/.test(match[2]) ? match[2].slice(-1) : match[2];
      if (!item || markers[markers.length - 1] !== marker) {
        lists.push([]);
        markers.push(marker);
      }
      lists[lists.length - 1].push((match[3] ?? '').trim());
      item = { index: lists[lists.length - 1].length - 1, indent };
    } else if (item && match) {
      fail(`${owner}: every row is a single line of text`);
    } else if (item && !previousBlank && !INTERRUPTS.test(line)) {
      // A lazy continuation: the blog's paragraph keeps these lines, so the row reads them as one line.
      const items = lists[lists.length - 1];
      items[item.index] = `${items[item.index]} ${line.trim()}`.trim();
    } else if (item && previousBlank && indent >= 2) {
      fail(`${owner}: every row is a single line of text`);
    } else {
      other = true;
      item = undefined;
    }
    previousBlank = false;
  }
  return { lists, other };
}

/** The single list a container holds, as its items. */
function listItems(lines: readonly string[], owner: string): string[] {
  const { lists, other } = readLists(lines, owner);
  if (other || lists.length > 1) fail(`${owner} may hold only one list of statements, nothing else`);
  return lists[0] ?? [];
}

// ---------------------------------------------------------------------------
// Rows

const STRONG = /^(?:\*\*|__)(?=\S)((?:(?!\*\*|__)[\s\S])*?\S)(?:\*\*|__)$/;
const EMPHASIS = /^([*_])(?![\s*_])((?:(?!\1)[\s\S])*?\S)\1$/;

/** `- [ID] text｜source`; text wholly in `_…_` is implicit, in `**…**` is key. */
function parseRow(text: string, owner: string): Statement {
  if (TASK_MARKER.test(text)) fail(`${owner}: a row id cannot be a lone "x" or "X" (GFM reads "- [x]" as a task item)`);
  const fields = splitFields(text);
  if (fields.length > 2) fail(`${owner}: a row has at most two fields (text｜source), found ${fields.length}`);

  let content = fields[0];
  let id: string | undefined;
  const leading = LEADING_ID.exec(content);
  if (leading) {
    id = leading[1];
    content = content.slice(leading[0].length).trim();
  }

  let implicit = false;
  let key = false;
  const strong = STRONG.exec(content);
  const emphasis = strong ? null : EMPHASIS.exec(content);
  if (strong) {
    key = true;
    content = strong[1];
  } else if (emphasis) {
    implicit = true;
    content = emphasis[2];
  }
  if (!plainField(content).trim()) fail(`${owner}: a row needs text`);

  return { id, content, source: fields[1]?.trim() ? fields[1] : undefined, implicit, key };
}

// ---------------------------------------------------------------------------
// Block

function attr(attrs: Record<string, string>, key: string): string | undefined {
  const value = attrs[key]?.trim();
  return value ? value : undefined;
}

interface Container {
  name: string;
  attrs: Record<string, string>;
  lines: string[];
}

/** The lines inside the block (between its fences) split into the lines of its own list and its child containers. */
function readBlock(source: string): { attrs: Record<string, string>; loose: string[]; containers: Container[]; } {
  const lines = source.replace(/\n+$/, '').split('\n');
  const open = parseDirectiveOpen(lines[0] ?? '');
  if (!open || !isArgumentMapName(open.name)) fail('not an argument-map block');
  const closing = lines.length > 1 ? matchDirectiveClose(lines[lines.length - 1], open.fenceLength) : null;
  if (!closing) fail('the argument-map is not closed');
  const body = lines.slice(1, -1);
  if (closing.trailing) body.push(closing.trailing);

  const loose: string[] = [];
  const containers: Container[] = [];
  for (let i = 0; i < body.length; i++) {
    const childOpen = parseDirectiveOpen(body[i]);
    if (!childOpen) {
      loose.push(body[i]);
      continue;
    }
    if (!(ARGUMENT_MAP_CHILD_DIRECTIVES as readonly string[]).includes(childOpen.name)) {
      fail(`unknown container ":::${childOpen.name}" inside argument-map (use reason or objection)`);
    }
    // The container ends at the first fence that closes it; containers nested in it are tracked so that their fences do not end it early.
    const fences = [childOpen.fenceLength];
    const inner: string[] = [];
    let closed = false;
    for (i++; i < body.length; i++) {
      const nested = parseDirectiveOpen(body[i]);
      if (nested) {
        fences.push(nested.fenceLength);
        inner.push(body[i]);
        continue;
      }
      const end = matchDirectiveClose(body[i], fences[fences.length - 1]);
      if (end) {
        fences.pop();
        if (end.trailing) inner.push(end.trailing);
        else if (fences.length) inner.push(body[i]);
        if (!fences.length) {
          closed = true;
          break;
        }
        continue;
      }
      inner.push(body[i]);
    }
    if (!closed) fail(`:::${childOpen.name} is not closed`);
    containers.push({ name: childOpen.name, attrs: childOpen.attrs, lines: inner });
  }
  return { attrs: open.attrs, loose, containers };
}

/** Parses one argument-map block, from its opening fence through its closing fence. Throws {@link ArgumentMapError}. */
export function parseArgumentMap(source: string): ArgumentMap {
  const { attrs, loose, containers } = readBlock(source);
  const view = (attr(attrs, 'view') ?? 'map') as ArgumentMapView;
  if (!(ARGUMENT_MAP_VIEWS as readonly string[]).includes(view)) fail(`unknown view "${view}" (use map or standard)`);

  // The main conclusion: the one list outside the child containers.
  const rootItems = listItems(loose, 'the argument-map');
  if (rootItems.length === 0) fail('no main conclusion: add one list item before the containers');
  if (rootItems.length > 1) fail(`exactly one main conclusion, found ${rootItems.length}`);
  const root = parseRow(rootItems[0], 'the main conclusion');

  const statements = new Map<string, Statement>();
  const argumentsById = new Map<string, Argument>();
  const claimed = new Set<string>();
  const claim = (id: string | undefined) => {
    if (id === undefined) return;
    if (claimed.has(id)) fail(`duplicate id "${id}" (statement and argument ids share one namespace)`);
    claimed.add(id);
  };
  if (root.id) {
    claim(root.id);
    statements.set(root.id, root);
  }

  const args: Argument[] = [];
  for (const container of containers) {
    const kind = container.name as Argument['kind'];
    const id = attr(container.attrs, 'id');
    const owner = `:::${kind}${id ? `{id="${id}"}` : ''}`;
    if (id !== undefined && !ID_PATTERN.test(id)) fail(`${owner}: id "${id}" must match [A-Za-z][A-Za-z0-9-]*`);
    const to = attr(container.attrs, 'to');
    if (to === undefined) fail(`${owner} needs a to attribute`);
    const status = attr(container.attrs, 'status') as ArgumentStatus | undefined;
    if (status && !(ARGUMENT_STATUSES as readonly string[]).includes(status)) fail(`${owner}: unknown status "${status}" (use accepted, rejected or open)`);

    const items = listItems(container.lines, owner);
    if (items.length === 0) fail(`${owner} has no statement rows`);
    claim(id);
    const rows = items.map(item => {
      const row = parseRow(item, owner);
      claim(row.id);
      if (row.id) statements.set(row.id, row);
      return row;
    });
    const argument: Argument = { kind, id, to, label: attr(container.attrs, 'label'), status, rows, relation: 'support' };
    if (id) argumentsById.set(id, argument);
    args.push(argument);
  }

  // Resolve targets, then fix each argument's relation from what it targets.
  const owners = new Map<Statement, Argument>();
  for (const argument of args) for (const row of argument.rows) owners.set(row, argument);
  for (const argument of args) {
    const targetsArgument = argumentsById.has(argument.to);
    if (!targetsArgument && !statements.has(argument.to)) fail(`:::${argument.kind} targets unknown id "${argument.to}"`);
    if (argument.kind === 'reason' && targetsArgument) fail(`:::reason cannot target the argument "${argument.to}"; use :::objection to undercut it`);
    argument.relation = argument.kind === 'reason' ? 'support' : targetsArgument ? 'undercut' : 'rebut';
  }

  // Every argument has exactly one target, so an argument that cannot reach the main conclusion is on a cycle: it
  // targets itself, or one of its own rows.
  const parentOf = (argument: Argument): Argument | undefined => argumentsById.get(argument.to) ?? owners.get(statements.get(argument.to) as Statement);
  for (const argument of args) {
    const seen: Argument[] = [];
    for (let at: Argument | undefined = argument; at; at = parentOf(at)) {
      if (seen.includes(at)) {
        const loop = [...seen.slice(seen.indexOf(at)), at].map(a => a.id ?? `:::${a.kind} to="${a.to}"`).join(' → ');
        fail(`an argument is not connected to the main conclusion; its targets form a cycle (${loop})`);
      }
      seen.push(at);
    }
  }

  const byTarget = new Map<string, Argument[]>();
  for (const argument of args) byTarget.set(argument.to, [...byTarget.get(argument.to) ?? [], argument]);

  return { title: attr(attrs, 'title'), subtitle: attr(attrs, 'subtitle'), note: attr(attrs, 'note'), source: attr(attrs, 'source'), view, root, args, targeting: id => id === undefined ? [] : byTarget.get(id) ?? [], statements, argumentsById };
}
