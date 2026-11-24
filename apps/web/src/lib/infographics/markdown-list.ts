import { Marked, type Token, type Tokens } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import { markedMath } from '../math.js';
import { fail } from './figure-html.js';
import { FIELD_SEPARATOR } from './model.js';

// The list structure is CommonMark. Use the note's CJK and math extensions so a
// separator inside emphasis, a link or KaTeX is not mistaken for a column break.
const markdown = new Marked(markedCjkFriendly(), markedMath);

export function listBlocks(body: string): Token[] {
  return markdown.lexer(body, { gfm: false }).filter(block => block.type !== 'space');
}

export function isList(token: Token | undefined): token is Tokens.List {
  return token?.type === 'list';
}

export function onlyList(body: string, directive: string): Tokens.List {
  const blocks = listBlocks(body);
  if (blocks.length !== 1 || !isList(blocks[0])) fail(`${directive} takes only one list`);
  return blocks[0];
}

/** A tight list's paragraphs are `text` tokens in Marked. */
export function paragraphInlines(token: Token | undefined): Token[] | undefined {
  return token?.type === 'text' || token?.type === 'paragraph' ? token.tokens : undefined;
}

export type ListField = readonly Token[];

export function listFields(inlines: readonly Token[]): ListField[] {
  const fields: Token[][] = [[]];
  for (const token of inlines) {
    if (token.type !== 'text' || !token.raw.includes(FIELD_SEPARATOR)) {
      fields[fields.length - 1].push(token);
      continue;
    }
    token.raw.split(FIELD_SEPARATOR).forEach((part, index) => {
      if (index) fields.push([]);
      if (part) fields[fields.length - 1].push({ type: 'text', raw: part, text: part });
    });
  }
  return fields;
}

export function fieldSource(field: ListField): string {
  return field.map(token => token.raw).join('').trim();
}

export function fieldPlain(field: ListField): string {
  return field.map(token => {
    if ('tokens' in token && token.tokens) return fieldPlain(token.tokens);
    if (token.type === 'mathInline') return String(token.tex);
    return 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
  }).join('');
}

export function fieldStrong(field: ListField): boolean {
  const meaningful = field.filter(token => token.type !== 'text' || token.raw.trim());
  return meaningful.length > 0 && meaningful.every(token => token.type === 'strong');
}
