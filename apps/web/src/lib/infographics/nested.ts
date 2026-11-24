import type { Tokens } from 'marked';
import { fail, highlightClass, type InlineRenderer, tag } from './figure-html.js';
import { fieldPlain, fieldSource, fieldStrong, type ListField, listFields, onlyList, paragraphInlines } from './markdown-list.js';

const MIN_RANGES = 2;
const MAX_RANGES = 5;

interface Range {
  name: ListField;
  note?: ListField;
}

function rangeOf(item: Tokens.ListItem): Range {
  const [paragraph, ...rest] = item.tokens.filter(token => token.type !== 'space');
  const inlines = paragraphInlines(paragraph);
  if (!inlines || rest.length) fail('nested takes a flat list written from outside in');
  const fields = listFields(inlines);
  if (fields.length > 2 || fields.some(field => !fieldPlain(field).trim())) fail('every nested item is 名稱｜說明 (說明 is optional)');
  const [name, note] = fields;
  return { name, note };
}

function ring(ranges: Range[], index: number, r: InlineRenderer): string {
  const { name, note } = ranges[index];
  const head = [tag('span', { class: 'ig-ring-name' }, r.inline(fieldSource(name)))];
  if (note) head.push(tag('span', { class: 'ig-ring-note' }, r.inline(fieldSource(note))));
  const children = [tag('p', { class: 'ig-ring-head' }, head)];
  if (index + 1 < ranges.length) children.push(ring(ranges, index + 1, r));
  return tag('ul', { class: 'ig-nest' }, tag('li', { class: ['ig-ring', ...highlightClass(fieldStrong(name))], style: `--ig-i:${index}` }, children));
}

export function nested(body: string, r: InlineRenderer): string {
  const { items } = onlyList(body, 'nested');
  if (items.length < MIN_RANGES || items.length > MAX_RANGES) fail(`nested takes ${MIN_RANGES} to ${MAX_RANGES} ranges`);
  return ring(items.map(rangeOf), 0, r);
}
