import type { Tokens } from 'marked';
import { fail, highlightClass, type InlineRenderer, tag } from './figure-html.js';
import { fieldPlain, fieldSource, fieldStrong, isList, type ListField, listFields, onlyList, paragraphInlines } from './markdown-list.js';

const MAX_QUESTIONS = 5;
const LOOP = '↺';

interface Question {
  body: ListField;
  step?: ListField;
}

interface Branch {
  label: ListField;
  content: ListField;
  next?: { question: Question; list: Tokens.List; };
}

function itemParts(item: Tokens.ListItem): { fields: ListField[]; list?: Tokens.List; } {
  const [paragraph, list, ...rest] = item.tokens.filter(token => token.type !== 'space');
  const inlines = paragraphInlines(paragraph);
  if (!inlines || (list && !isList(list)) || rest.length) fail('a decision item takes only one line and an optional list under it');
  const fields = listFields(inlines);
  if (fields.some(field => !fieldPlain(field).trim())) fail('a decision item has an empty field');
  return { fields, list: isList(list) ? list : undefined };
}

function rejectLoop(field: ListField | undefined, allowedAtStart = false): void {
  const text = field && fieldPlain(field).trim();
  if (text && text.indexOf(LOOP, allowedAtStart && text.startsWith(LOOP) ? LOOP.length : 0) >= 0) fail(`${LOOP} only starts a conclusion in a decision`);
}

function branchOf(item: Tokens.ListItem): Branch {
  const { fields, list } = itemParts(item);
  if (fields.length < 2) fail('every decision branch needs 分支標籤｜內容');
  if (fields.length > 3) fail('a decision branch has at most 分支標籤｜內容｜做法');
  const [label, content, step] = fields;
  rejectLoop(label);
  rejectLoop(content, !list);
  rejectLoop(step);
  if (!list && step) fail('a decision conclusion takes 分支標籤｜結論; 做法 only comes before a next question');
  return { label, content, next: list && { question: { body: content, step }, list } };
}

function conclusion(content: ListField, r: InlineRenderer): string {
  const loop = fieldPlain(content).trimStart().startsWith(LOOP);
  // Drop a token that holds only the marker (e.g. **↺**), so no empty Markdown
  // delimiters show up after it. Keep inline formatting around the rest.
  const source = loop ? fieldSource(content.filter(token => fieldPlain([token]).trim() !== LOOP)).replace(/↺\s*/, '').trimStart() : fieldSource(content);
  return tag('span', { class: ['ig-branch-result', ...highlightClass(fieldStrong(content)), ...loop ? ['is-loop'] : []] }, [loop ? tag('span', { class: 'ig-loop-mark' }, LOOP) : '', r.inline(source)]);
}

function questionCard({ body, step }: Question, index: number, r: InlineRenderer): string {
  const text = tag('p', { class: 'ig-question-text' }, [tag('span', { class: 'ig-question-num' }, String(index + 1)), tag('span', { class: 'ig-question-body' }, r.inline(fieldSource(body)))]);
  return tag('div', { class: 'ig-question', style: `--ig-i:${index}` }, [step ? tag('p', { class: 'ig-question-step' }, r.inline(fieldSource(step))) : '', text]);
}

function questionNodes(question: Question, list: Tokens.List | undefined, index: number, r: InlineRenderer): string[] {
  if (index >= MAX_QUESTIONS) fail(`a decision takes at most ${MAX_QUESTIONS} questions`);
  const items = list?.items ?? [];
  if (items.length < 2 || items.length > 3) fail('every decision question needs 2 or 3 branches');
  const branches = items.map(branchOf);
  const [leading, extra] = branches.filter(branch => branch.next);
  if (extra) fail('only one branch per question can lead to a next question; split the decision into two graphics');

  const label = (field: ListField) => tag('span', { class: 'ig-branch-label' }, r.inline(fieldSource(field)));
  const rows = branches.filter(branch => !branch.next).map(branch => tag('li', { class: 'ig-branch' }, [label(branch.label), conclusion(branch.content, r)]));
  if (leading?.next) rows.push(tag('li', { class: 'ig-branch is-next' }, [label(leading.label), ...questionNodes(leading.next.question, leading.next.list, index + 1, r)]));
  return [questionCard(question, index, r), tag('ul', { class: 'ig-branches' }, rows)];
}

export function decision(body: string, r: InlineRenderer): string {
  const { items } = onlyList(body, 'a decision');
  if (items.length !== 1) fail('a decision needs exactly one root question');
  const { fields, list } = itemParts(items[0]);
  if (fields.length > 2) fail('a decision root question takes 問題｜做法');
  const [question, step] = fields;
  rejectLoop(question);
  rejectLoop(step);
  return tag('div', { class: 'ig-decision-tree' }, questionNodes({ body: question, step }, list, 0, r));
}
