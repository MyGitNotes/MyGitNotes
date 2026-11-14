/**
 * "Turn into QR code": the edit that makes a string, usually an address, a `:qrcode{url="…"}` (in a line of text) or a `::qrcode{url="…"}`
 * (a line of its own), the directives `qrcode.ts` draws. Shared by the live and source editors through `formatMarkdown`.
 */
import type { FormatResult, TextEdit } from './markdown-format.js';

/** The text cannot be written inside a directive's attribute, which has no escape: it holds a quote of each kind, or a `}`. */
export class QrCodeValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrCodeValueError';
  }
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_URL = /(?:https?|ftp):\/\/[^\s<>"'`]+/gi;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
const AUTOLINK = /<((?:https?|ftp|mailto):[^\s<>]+)>/gi;

/** `text` as the string a QR code carries: whitespace runs, line breaks among them, become one space and the ends are trimmed. */
export function qrCodeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The attribute `url=…` for `text`, written so that remark-directive and MyGitNotes' own attribute readers give back the same string. Neither
 * reads an escape, so an address has its `"` and `}` percent-encoded (the same address), and other text takes the quote it does not hold;
 * text that holds a quote of each kind, or a `}`, cannot be written and is refused.
 */
export function qrCodeAttribute(text: string): string {
  const value = qrCodeText(text);
  if (SCHEME.test(value)) return `url="${value.replace(/"/g, '%22').replace(/}/g, '%7D')}"`;
  if (value.includes('}')) throw new QrCodeValueError('a directive cannot carry a } in its text');
  if (!value.includes('"')) return `url="${value}"`;
  if (!value.includes("'")) return `url='${value}'`;
  throw new QrCodeValueError('a directive cannot carry both " and \' in its text');
}

export const qrCodeDirective = (text: string, block: boolean): string => `${block ? '::' : ':'}qrcode{${qrCodeAttribute(text)}}`;

/** An address `line` holds around the offset `at`: `kind` is `link` for a Markdown link or an autolink, which stays, and `bare` for an address in the text. */
interface UrlTarget {
  kind: 'link' | 'bare';
  url: string;
  from: number;
  to: number;
}

/** Trailing punctuation a sentence puts after an address is no part of it; a `)` or `]` closing nothing in it goes too. */
function trimUrl(url: string): string {
  let result = url;
  for (;;) {
    const last = result.at(-1)!;
    const unbalanced = (last === ')' && (result.match(/\(/g)?.length ?? 0) < (result.match(/\)/g)?.length ?? 0)) || (last === ']' && (result.match(/\[/g)?.length ?? 0) < (result.match(/\]/g)?.length ?? 0));
    if (/[.,;:!?]/.test(last) || unbalanced || last === '}') result = result.slice(0, -1);
    else return result;
  }
}

function urlAt(line: string, at: number): UrlTarget | undefined {
  for (const pattern of [MARKDOWN_LINK, AUTOLINK]) {
    for (const match of line.matchAll(pattern)) {
      const from = match.index, to = from + match[0].length;
      if (at < from || at > to) continue;
      const raw = match[1].replace(/^<|>$/g, '').trim();
      if (raw) return { kind: 'link', url: raw, from, to };
    }
  }
  for (const match of line.matchAll(BARE_URL)) {
    const url = trimUrl(match[0]), from = match.index, to = from + url.length;
    if (at >= from && at <= to) return { kind: 'bare', url, from, to };
  }
  return undefined;
}

/** The whole of `text` as one link or one address, when it is nothing else. */
function wholeUrl(text: string): UrlTarget | undefined {
  const target = urlAt(text, 0);
  return target && target.from === 0 && target.to === text.length ? target : undefined;
}

const lineStartOf = (doc: string, pos: number) => pos === 0 ? 0 : doc.lastIndexOf('\n', pos - 1) + 1;
const lineEndOf = (doc: string, pos: number) => {
  const end = doc.indexOf('\n', pos);
  return end === -1 ? doc.length : end;
};

/** The edit that puts `directive` as a block of its own under the line that ends at `lineEnd`, a blank line on either side. */
function blockAfter(doc: string, lineEnd: number, directive: string): { change: TextEdit; start: number; } {
  const nextStart = lineEnd + 1;
  const nextText = nextStart > doc.length ? '' : doc.slice(nextStart, lineEndOf(doc, nextStart));
  return { change: { from: lineEnd, to: lineEnd, insert: `\n\n${directive}${nextText.trim() ? '\n' : ''}` }, start: lineEnd + 2 };
}

const SNIPPET = '::qrcode{url=""}';
const SNIPPET_CARET = '::qrcode{url="'.length;

/**
 * Turns the selection (or, without one, the address under the caret) into a QR code. A selection inside a line becomes `:qrcode{…}`; one that
 * is a whole line, or lines, becomes a `::qrcode{…}` line. A caret on an address uses it: a bare address is replaced (by a block when it is the
 * whole line), and a Markdown link or autolink stays, the code standing under its line. Anywhere else a `::qrcode{url=""}` snippet is written
 * with the caret between its quotes. Throws a {@link QrCodeValueError} for a string the directive cannot carry.
 */
export function turnIntoQrCode(doc: string, from: number, to: number): FormatResult {
  let start = Math.min(from, to), end = Math.max(from, to);
  // Whitespace around the selection, line breaks of a selected line among it, is no part of the string.
  while (start < end && /\s/.test(doc[start])) start++;
  while (end > start && /\s/.test(doc[end - 1])) end--;
  const unchanged = { anchor: from, head: to };

  if (start === end) return atCaret(doc, Math.min(from, to), unchanged);

  const selected = doc.slice(start, end);
  const link = wholeUrl(selected);
  if (link?.kind === 'link') {
    const { change } = blockAfter(doc, lineEndOf(doc, end), qrCodeDirective(link.url, true));
    return { changes: [change], ...unchanged };
  }
  const lineFrom = lineStartOf(doc, start), lineTo = lineEndOf(doc, end);
  const block = !doc.slice(lineFrom, start).trim() && !doc.slice(end, lineTo).trim();
  const directive = qrCodeDirective(selected, block);
  const [replaceFrom, replaceTo] = block ? [lineFrom, lineTo] : [start, end];
  const caret = replaceFrom + directive.length;
  return { changes: [{ from: replaceFrom, to: replaceTo, insert: directive }], anchor: caret, head: caret };
}

function atCaret(doc: string, pos: number, unchanged: { anchor: number; head: number; }): FormatResult {
  const lineFrom = lineStartOf(doc, pos), lineTo = lineEndOf(doc, pos);
  const line = doc.slice(lineFrom, lineTo);
  const target = urlAt(line, pos - lineFrom);
  if (target?.kind === 'link') {
    const { change } = blockAfter(doc, lineTo, qrCodeDirective(target.url, true));
    return { changes: [change], ...unchanged };
  }
  if (target) {
    const from = lineFrom + target.from, to = lineFrom + target.to;
    const block = !line.slice(0, target.from).trim() && !line.slice(target.to).trim();
    const directive = qrCodeDirective(target.url, block);
    const [replaceFrom, replaceTo] = block ? [lineFrom, lineTo] : [from, to];
    const caret = replaceFrom + directive.length;
    return { changes: [{ from: replaceFrom, to: replaceTo, insert: directive }], anchor: caret, head: caret };
  }
  // A blank line becomes the snippet; a leaf directive needs no blank line around it, as it ends the paragraph above and starts a new one below.
  if (!line.trim()) {
    const caret = lineFrom + SNIPPET_CARET;
    return { changes: [{ from: lineFrom, to: lineTo, insert: SNIPPET }], anchor: caret, head: caret };
  }
  const { change, start } = blockAfter(doc, lineTo, SNIPPET);
  const caret = start + SNIPPET_CARET;
  return { changes: [change], anchor: caret, head: caret };
}
