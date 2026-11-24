import { escapeHtml, fencedCodeLines, infographicEnd, parseDirectiveOpen } from '../directives.js';
import { attrOf, fail, highlightClass, type InlineRenderer, tag } from './figure-html.js';
import { fieldPlain, fieldSource, fieldStrong, isList, type ListField, listBlocks, listFields, paragraphInlines } from './markdown-list.js';

const BACK = '↺';
const MAX_BACKS = 2;

interface Stage {
  attrs: Record<string, string>;
  items: ListField[][];
}

/** Only direct `:::stage` children participate; each stage uses its first Markdown list. */
function readStages(body: string): Stage[] {
  const lines = body.split('\n');
  const stages: Stage[] = [];
  const inCode = fencedCodeLines();
  for (let i = 0; i < lines.length; i++) {
    if (inCode(lines[i]) || !/^ {0,3}:/.test(lines[i])) continue;
    const open = parseDirectiveOpen(lines[i]);
    if (!open) continue;
    const end = infographicEnd(lines, i, open.fenceLength);
    if (end === undefined) break;
    if (open.name === 'stage') {
      const list = listBlocks(lines.slice(i + 1, end).join('\n')).find(isList);
      stages.push({ attrs: open.attrs, items: list?.items.map(item => listFields(item.tokens.map(paragraphInlines).find(Boolean) ?? [])) ?? [] });
    }
    i = end;
  }
  return stages;
}

function stageItems(items: ListField[][], r: InlineRenderer): string {
  return tag('ul', { class: ['ig-stage-items', ...items.length > 4 ? ['is-many'] : []] }, items.map(fields => {
    const [label, detail] = fields;
    const children = [tag('span', { class: 'ig-stage-item-label' }, r.inline(fieldSource(label)))];
    if (detail && fieldSource(detail)) children.push(tag('span', { class: 'ig-stage-item-detail' }, r.inline(fieldSource(detail))));
    return tag('li', { class: ['ig-stage-item', ...highlightClass(fields.some(fieldStrong))] }, children);
  }));
}

function backMarkers(items: ListField[][], earlier: Set<string>, r: InlineRenderer): string {
  if (items.length > MAX_BACKS) fail(`a process stage takes at most ${MAX_BACKS} ↺ markers`);
  return tag('ul', { class: 'ig-stage-backs' }, items.map(fields => {
    const [marker, when] = fields;
    const target = fieldPlain(marker).replaceAll('*', '').trim().slice(BACK.length).trim();
    if (!target || fields.length > 2) fail('a process back marker takes ↺ 目標步驟｜條件');
    if (!earlier.has(target)) fail(`${BACK} ${target} must name an earlier stage`);
    const children = [tag('span', { class: 'ig-back-target' }, escapeHtml(target))];
    if (when && fieldSource(when)) children.push(tag('span', { class: 'ig-back-when' }, r.inline(fieldSource(when))));
    return tag('li', { class: 'ig-stage-back' }, children);
  }));
}

export function processFlow(body: string, r: InlineRenderer): string {
  const stages = readStages(body);
  if (!stages.length) fail('process needs :::stage children');
  const earlier = new Set<string>();
  return tag('ol', { class: 'ig-process' }, stages.map(({ attrs, items }, index) => {
    const title = attrOf(attrs, 'title');
    if (!title) fail('every process stage needs a title');
    const time = attrOf(attrs, 'time');
    const head = [tag('span', { class: 'ig-stage-title' }, escapeHtml(title))];
    if (time) head.unshift(tag('span', { class: 'ig-stage-time' }, escapeHtml(time)));
    const children = [tag('p', { class: 'ig-stage-head' }, head)];
    const regular: ListField[][] = [];
    const backs: ListField[][] = [];
    for (const item of items) (fieldPlain(item[0]).trimStart().startsWith(BACK) ? backs : regular).push(item);
    if (regular.length) children.push(stageItems(regular, r));
    if (backs.length) children.push(backMarkers(backs, earlier, r));
    earlier.add(title);
    return tag('li', { class: ['ig-stage', ...highlightClass(Object.hasOwn(attrs, 'highlight'))], style: `--ig-i:${index}` }, children);
  }));
}
