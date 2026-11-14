/**
 * Directives and MDX Layer 2 preprocessor for MyGitNotes.
 * Implements the standard container, leaf, and inline generic directives
 * matching the user's blog specifications and editorial design.
 */

import { en, type TranslationKey } from './i18n/en.js';
import { zhTW } from './i18n/zh-TW.js';
import { InfographicError, renderInfographic, renderInfographicError } from './infographics/render.js';
import { isInfographicKind } from './infographics/model.js';
import { isArgumentMapName } from './argument-maps/parse.js';
import { ArgumentMapError, renderArgumentMap, renderArgumentMapError } from './argument-maps/render.js';
import { isAnnotateName } from './annotations/parse.js';
import { AnnotateError, renderAnnotate, renderAnnotateError } from './annotations/render.js';
import { drawsNothingOutsideDeck, isSlideContainer, isSlideDirective, parseDirectiveLine, renderSlideDirective, type SlideRendering } from './slides/directives.js';
import { renderInlineIcons } from './icons/inline-icon.js';

/** The language a server renders a note in; the browser takes it from the page. */
export type NoteLanguage = 'en' | 'zh-TW';

export type DirectiveTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string;

export interface DirectiveTitle {
  label: string;
  isDefault: boolean;
  depth?: number;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function parseDirectiveAttributes(rawAttrs?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawAttrs) return result;

  const regex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s}]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawAttrs)) !== null) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    result[key] = val;
  }
  return result;
}

/** An opening container fence `:::name[label]{attrs}`, allowing `>` blockquote prefixes; `rawAttrs` is the text between its braces. */
export function parseDirectiveOpen(line: string): { fenceLength: number; name: string; label?: string; attrs: Record<string, string>; rawAttrs?: string; } | null {
  const match = /^(\s*(?:>\s*)*)(:{3,})([a-zA-Z0-9_-]+)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?\s*$/.exec(line);
  return match ? { fenceLength: match[2].length, name: match[3], label: match[4], attrs: parseDirectiveAttributes(match[5]), rawAttrs: match[5] } : null;
}

// The block-level tags whose line opens an HTML block that a blank line ends, and that may interrupt paragraph text (marked's list).
const BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
// marked's attribute: spaces before it and around its `=`, never a tab.
const ATTRIBUTE = String.raw` +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>\x60]+)?`;
const BLOCK_TAG = new RegExp(`^</?(?:${BLOCK_TAGS})(?: |/?>|$)`, 'i');
// A tag alone on its line: a name of letters, digits and dashes, as marked reads it.
const LONE_TAG = new RegExp(`^(?:<(?!script|pre|style|textarea)[a-zA-Z][a-zA-Z0-9-]*(?:${ATTRIBUTE})*? */?>|</(?!script|pre|style|textarea)[a-zA-Z][a-zA-Z0-9-]*\\s*>)[ \\t]*$`, 'i');
// The openers marked lets interrupt paragraph text, in lower case only: its paragraph rule, unlike its HTML rule, ignores no case.
const INTERRUPTING = new RegExp(`^(?:</?(?:${BLOCK_TAGS})(?: |/?>|$)|<(?:script|pre|style|textarea|!--))`);

/**
 * The HTML block a line opens, the seven kinds Markdown has, read from the line's text past its indentation: `end` finds the text that
 * closes it (null when a blank line does), `closed` says the opening line already holds that text, and `interrupts` says it may open
 * right under paragraph text. Null when the line opens none.
 */
function htmlBlock(text: string): { end: RegExp | null; closed: boolean; interrupts: boolean; } | null {
  const line = text.replace(/^ {0,3}/, '');
  if (!line.startsWith('<')) return null;
  const interrupts = INTERRUPTING.test(line);
  // `first` finds the closing text on the opening line past the opener, when it differs from `end`.
  const ending = (opener: RegExp, end: (match: RegExpExecArray) => RegExp, first?: RegExp) => {
    const match = opener.exec(line);
    return match ? { end: end(match), closed: (first ?? end(match)).test(line.slice(match[0].length)), interrupts } : null;
  };
  // A script, pre, style or textarea block ends at the closing tag of its own name, as marked reads it; `<!-->` and `<!--->` are whole
  // comments.
  return ending(/^<(script|pre|style|textarea)(?=[\s>]|$)/i, match => new RegExp(`</${match[1]}>`, 'i')) ?? ending(/^<!--/, () => /-->/, /^-?>|-->/) ?? ending(/^<\?/, () => /\?>/) ?? ending(/^<![a-zA-Z]/, () => />/) ?? ending(/^<!\[CDATA\[/, () => /\]\]>/) ?? (BLOCK_TAG.test(line) || LONE_TAG.test(line) ? { end: null, closed: false, interrupts } : null);
}

/**
 * Follows fenced code blocks down a text's lines: the returned function says, for each line in turn, whether it belongs to one (its
 * fences included). A directive written inside a code block is code, as it is to Markdown.
 */
export function fencedCodeLines(): (line: string) => boolean {
  // `column` is the content column of the list item a fence opened on, past any quote markers; the item, and the fence, end at a line
  // indented less. Columns count a tab to the next multiple of four, as Markdown does. `depth` is the number of quotes the fence opened
  // in; a line with fewer quote markers ends them, and the fence with them, and any further marker on a line inside is code.
  let open: { mark: string; length: number; column: number; depth: number; } | null = null;
  // An HTML block the lines are in: `end` finds its closing text on a line, or is null when a blank line ends it. Its lines are HTML, so
  // a fence line in one opens no code block; `column` and `depth` end it with its list item or quote, as for a fence.
  // `sealed` says its last line was blank or looked like a fence, a heading or a break: a list item's HTML block, as its paragraphs,
  // takes a less indented line of text that follows a line of its own, unless that line was such a one (marked's list reading).
  let html: { end: RegExp | null; column: number; depth: number; sealed: boolean; } | null = null;
  // The column `text` ends at when it starts at column `from`.
  const width = (text: string, from = 0) => {
    let column = from;
    for (const char of text) column = char === '\t' ? column - (column % 4) + 4 : column + 1;
    return column;
  };
  // Up to `most` quote markers at the line's start: how many, where the text past them starts, and the columns they take. A marker takes
  // one column of the space or tab after it; the rest of a tab's columns, counted on the whole line, indent the text.
  const quotes = (line: string, most: number) => {
    // `end` is the column `at` stands at, kept along with it, so a line of many markers is read once.
    let depth = 0, at = 0, columns = 0, end = 0;
    for (let marker; depth < most && (marker = /^ {0,3}>/.exec(line.slice(at, at + 4))); depth++) {
      end = width(marker[0], end);
      at += marker[0].length;
      columns = end;
      if (line[at] === ' ' || line[at] === '\t') {
        end = width(line[at], end);
        at++;
        columns++;
      }
    }
    return { depth, at, columns };
  };
  let items: { depth: number; columns: number[]; } = { depth: 0, columns: [] };
  // Whether the line before was paragraph text, which a list may interrupt only with an item that has content and, if ordered, number 1.
  let paragraph = false;
  // The columns from past the quote markers to `end`.
  const indent = (line: string, quote: { at: number; columns: number; }, end: number) => width(line.slice(0, end)) - quote.columns;
  return text => {
    // A note saved with CRLF line endings keeps a carriage return on each line; Markdown reads it as the line's end.
    const line = text.endsWith('\r') ? text.slice(0, -1) : text;
    if (open) {
      const quote = quotes(line, open.depth), inner = line.slice(quote.at);
      const margin = indent(line, quote, quote.at + /^[ \t]*/.exec(inner)![0].length);
      if (quote.depth < open.depth) open = null;
      else if (open.column > 0 && inner.trim() && margin < open.column) open = null;
      else {
        // A closing fence is indented less than four columns past the content, and holds nothing else.
        const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(inner);
        if (close && margin < open.column + 4 && close[1][0] === open.mark && close[1].length >= open.length) open = null;
        paragraph = false;
        return true;
      }
    }
    if (html) {
      const quote = quotes(line, html.depth), inner = line.slice(quote.at);
      const margin = indent(line, quote, quote.at + /^[ \t]*/.exec(inner)![0].length);
      const outdented = html.column > 0 && inner.trim() && margin < html.column;
      // A less indented line that starts a block of its own ends the list item, as it would end the item's paragraph.
      const starter = /^ {0,3}(?:`{3,}|~{3,}|#{1,6}(?:[ \t]|$)|<[a-zA-Z/!?]|(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|([-*_])[ \t]*(?:\1[ \t]*){2,}$)/;
      if (quote.depth < html.depth || (outdented && (html.sealed || starter.test(inner)))) html = null;
      else {
        html.sealed = !inner.trim() || /^[ \t]*(?:`{3,}|~{3,}|#{1,6}(?:[ \t]|$)|([-*_])[ \t]*(?:\1[ \t]*){2,}$)/.test(inner);
        // In a list item a line of text after the block's last line stays in the item, as after a paragraph (marked's list reading).
        paragraph = html.column > 0 && !html.sealed;
        if (html.end ? html.end.test(inner) : !inner.trim()) html = null;
        return false;
      }
    }
    const quote = quotes(line, Infinity), quoted = line.slice(quote.at);
    const margin = indent(line, quote, quote.at + /^[ \t]*/.exec(quoted)![0].length);
    // The content columns of the list items the line is in, innermost last; a line indented less than an item's content ends the item.
    if (quote.depth !== items.depth) items = { depth: quote.depth, columns: [] };
    const item = /^[ \t]*(?:[-*+]|(\d{1,9})[.)])( {1,4}(?=\S)|[ \t]+|$)/.exec(quoted);
    // Whether a list was open before this line: a later item of an open list starts an item under its sibling's text.
    const listed = items.columns.length > 0;
    // A thematic break or a setext underline ends a paragraph and is no paragraph text itself.
    const rule = /^ {0,3}(?:([-*_])[ \t]*(?:\1[ \t]*){2,}|=+[ \t]*)$/.test(quoted);
    // A line of plain text right under paragraph text continues that paragraph lazily, in its item, wherever it is indented; a break, an
    // HTML line, a fence and a heading interrupt it.
    const lazy = paragraph && !item && !rule && !/^ {0,3}<[a-zA-Z/!?]/.test(quoted) && !/^[ \t]*(?:`{3,}|~{3,}|#{1,6}(?:[ \t]|$))/.test(quoted);
    if (quoted.trim() && !lazy) { while (items.columns.length && margin < items.columns[items.columns.length - 1]) items.columns.pop(); }
    const content = items.columns[items.columns.length - 1] ?? 0;
    const starts = item && !(paragraph && !listed && ((item[1] !== undefined && Number(item[1]) !== 1) || !quoted.slice(item[0].length).trim()));
    const underParagraph = paragraph;
    // Indented code under no paragraph, a heading and a blank line are no paragraph text.
    paragraph = Boolean(quoted.trim()) && !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(quoted) && !rule && (paragraph || margin - content < 4);
    if (item && starts) items.columns.push(item[2].length > 4 || !item[2] ? indent(line, quote, quote.at + item[0].length - item[2].length) + 1 : indent(line, quote, quote.at + item[0].length));
    // An HTML block opens on a line, or on a list item's marker line, indented less than four columns past the content; under paragraph
    // text only the kinds Markdown lets interrupt a paragraph open one, and only unindented, as marked reads them.
    const prefix = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/.exec(quoted)![0], onItem = /[-*+.)]/.test(prefix);
    const block = (onItem ? starts : margin - content < 4) ? htmlBlock(quoted.slice(prefix.length)) : null;
    if (block && (onItem || !underParagraph || (block.interrupts && margin === content))) {
      const column = onItem ? indent(line, quote, quote.at + prefix.length) : content;
      if (!block.closed) html = { end: block.end, column, depth: quote.depth, sealed: false };
      paragraph = column > 0;
      return false;
    }
    // A fence may open on a list item's marker line (`- ```js`); its content and closing fence are then indented under the item.
    const fence = /^[ \t]*((?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*)(`{3,}|~{3,})(.*)$/.exec(quoted);
    // A fence is indented at most three columns past the content of the list item it is in; one indented further is indented code, or
    // paragraph text. A backtick fence's info string holds no backtick; such a line is inline code.
    if (fence && (fence[1] || margin - content < 4) && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      const column = fence[1] ? indent(line, quote, quote.at + quoted.indexOf(fence[2])) : content;
      open = { mark: fence[2][0], length: fence[2].length, column, depth: quote.depth };
      paragraph = false;
    }
    return open !== null;
  };
}

/**
 * Follows indented code blocks down a text's lines, as {@link fencedCodeLines} follows fenced ones: `line` says, for each line outside a
 * fenced block in turn, whether it is indented code, and `interrupt` is told of anything else that stands between two lines (a fenced
 * block). A line is code when it is indented four columns past the content of the list items it is in, and follows a blank line or
 * another line of the block: an indented line right under a paragraph continues the paragraph, and the paragraphs of a list item are
 * indented without being code.
 */
export function indentedCodeLines(): { line: (line: string) => boolean; interrupt: () => void; } {
  // The content columns of the list items the lines are in, outermost first.
  const lists: number[] = [];
  let afterBlank = true, inBlock = false;
  return {
    line(line) {
      const text = line.replace(/^(?: {0,3}> ?)+/, '');
      if (!text.trim()) {
        afterBlank = true;
        return false;
      }
      let indent = 0, start = 0;
      for (; start < text.length && (text[start] === ' ' || text[start] === '\t'); start++) indent = text[start] === '\t' ? indent - (indent % 4) + 4 : indent + 1;
      if (indent >= (lists.at(-1) ?? 0) + 4 && (afterBlank || inBlock)) {
        afterBlank = false;
        inBlock = true;
        return true;
      }
      const marker = /^(?:[-*+]|\d{1,9}[.)])(?: +|\t|$)/.exec(text.slice(start));
      // A line that is no list item and follows no blank line continues the paragraph above it, wherever it is indented.
      if (marker || afterBlank) { while (lists.length > 0 && lists[lists.length - 1] > indent) lists.pop(); }
      // An item's content starts after its marker and the spaces behind it; five or more spaces are one space and an indented code block.
      if (marker) lists.push(indent + (/^\S+ {1,4}\S/.test(marker.input) ? marker[0].length : marker[0].trimEnd().length + 1));
      afterBlank = false;
      inBlock = false;
      return false;
    },
    interrupt() {
      afterBlank = false;
      inBlock = false;
    },
  };
}

/**
 * Whether `line` closes a container opened with `fenceLength` colons: a bare fence (`:::`, `> :::`)
 * or text followed by a trailing fence, whose text is returned as `trailing`.
 */
export function matchDirectiveClose(line: string, fenceLength: number): { trailing?: string; } | null {
  const pureClose = /^(\s*(?:>\s*)*)(:{3,})\s*$/.exec(line);
  if (pureClose && pureClose[2].length === fenceLength) return {};
  const inlineClose = /^(.*?)(?<!:)(:{3,})\s*$/.exec(line);
  if (!inlineClose || inlineClose[2].length !== fenceLength) return null;
  return inlineClose[1].trim() ? { trailing: inlineClose[1].trimEnd() } : {};
}

export function parseDirectiveTitle(attrs: Record<string, string>, label: string | undefined, defaultTitle: string): DirectiveTitle {
  const rawTitle = (attrs.title || label || '').trim();
  if (!rawTitle) {
    return { label: defaultTitle, isDefault: true };
  }

  const headingMatch = /^(#{1,6})\s+(.+)$/.exec(rawTitle);
  if (headingMatch) {
    return { depth: headingMatch[1].length, isDefault: false, label: headingMatch[2].trim() };
  }

  return { label: rawTitle, isDefault: false };
}

export const HANDOUT_VARIANTS: Record<string, string> = { report: '文件', newspaper: '剪報', letter: '信件', journal: '日誌', note: '紙條', scripture: '經文' };

const HANDOUT_VARIANT_KEYS: Record<string, TranslationKey> = { report: 'directive.editor.variant.report', newspaper: 'directive.editor.variant.newspaper', letter: 'directive.editor.variant.letter', journal: 'directive.editor.variant.journal', note: 'directive.editor.variant.note', scripture: 'directive.editor.variant.scripture' };

/** HANDOUT_VARIANTS labels for the document-style editor control, in the given locale; without one, the Chinese labels. The rendered handout takes its label from the note's language instead. */
export function localizedHandoutVariants(t?: DirectiveTranslate): Record<string, string> {
  if (!t) return HANDOUT_VARIANTS;
  const result: Record<string, string> = {};
  for (const [variant, key] of Object.entries(HANDOUT_VARIANT_KEYS)) result[variant] = t(key);
  return result;
}

const COC_CHARACTERISTICS = ['str', 'con', 'siz', 'dex', 'int', 'app', 'pow', 'edu', 'san', 'hp'] as const;

const COC_DERIVED = ['db', 'build', 'move'] as const;

/** The abbreviation a stat block prints beside a stat's name: its key, upper-cased, except the move rate's. */
const cocCode = (key: string): string => key === 'move' ? 'MOV' : key.toUpperCase();

/** A string of the table with its `{name}` placeholders filled in. */
export function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
}

/**
 * Strips ESM import lines from MDX content (e.g. `import X from "@/components/..."`).
 */
export function stripMdxImports(content: string): string {
  return content.replace(/^[ \t]*import\s+.*?(?:from\s+['"][^'"]+['"]|['"][^'"]+['"]);?[ \t]*$/gm, '');
}

/**
 * Transforms JSX / MDX custom components into rendered HTML representations.
 */
export function transformMdxComponents(content: string, language?: NoteLanguage): string {
  const strings = stringsFor(language);
  // 1. YouTubeEmbed components
  let result = content.replace(/<(?:YouTubeEmbed|YouTube)\s+([^>]*?)(?:\/>|>\s*<\/(?:YouTubeEmbed|YouTube)>)/g, (_, attrString: string) => {
    const attrs = parseDirectiveAttributes(attrString);
    const videoId = attrs.id || attrs.videoId || '';
    const url = attrs.url || '';
    let targetId = videoId;
    if (!targetId && url) {
      const idMatch = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/ ]{11})/i.exec(url);
      if (idMatch) targetId = idMatch[1];
    }
    if (!targetId) return '';
    const start = attrs.start || '0';
    const sourceUrl = url || `https://www.youtube.com/watch?v=${encodeURIComponent(targetId)}${Number(start) ? `&t=${encodeURIComponent(start)}s` : ''}`;
    return `<div class="note-youtube-embed" data-video-id="${escapeHtml(targetId)}" data-start="${escapeHtml(start)}" data-youtube-source-url="${escapeHtml(sourceUrl)}"></div>`;
  });

  // 2. ProtectedContent
  result = result.replace(/<ProtectedContent\b([^>]*)>([\s\S]*?)<\/ProtectedContent>/g, (_, attrString: string, body: string) => {
    const attrs = parseDirectiveAttributes(attrString);
    const title = attrs.title || strings['directive.protected.title'];
    return `<div class="mdx-protected-content" data-type="protected-content"><div class="mdx-protected-header">🔒 ${escapeHtml(title)}</div><div class="mdx-protected-body">${body.trim()}</div></div>`;
  });

  // 3. Card components
  result = result.replace(/<Card\b([^>]*)>([\s\S]*?)<\/Card>/g, (_, attrString: string, body: string) => {
    const attrs = parseDirectiveAttributes(attrString);
    const title = attrs.title || attrs.heading || '';
    const href = attrs.href || attrs.link || '';
    return `<div class="mdx-card"><div class="mdx-card-header">${title ? `<strong class="mdx-card-title">${escapeHtml(title)}</strong>` : ''}${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="mdx-card-link">↗</a>` : ''}</div><div class="mdx-card-body">${body.trim()}</div></div>`;
  });

  // 4. Tag / Badge components
  result = result.replace(/<(?:Tag|Badge)\b([^>]*)>([\s\S]*?)<\/(?:Tag|Badge)>/g, (_, _attrString: string, body: string) => {
    return `<span class="mdx-badge">${body.trim()}</span>`;
  });

  // 5. Generic self-closing custom components <MyComponent prop="val" />
  result = result.replace(/<([A-Z][a-zA-Z0-9_-]*)\s*([^>]*?)\/>/g, (_, name: string, attrString: string) => {
    const attrs = parseDirectiveAttributes(attrString);
    const attrSummary = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).slice(0, 3).join(' ');
    return `<span class="mdx-component-tag" data-component-name="${escapeHtml(name)}"><span class="mdx-component-icon" aria-hidden="true">⚛</span><span class="mdx-component-name">${escapeHtml(name)}</span>${attrSummary ? `<span class="mdx-component-attrs">${escapeHtml(attrSummary)}</span>` : ''}</span>`;
  });

  return result;
}

/**
 * A QR code of an address, as the blog writes `:qrcode{url size}`: the link to the address stays in the HTML and each surface draws the code
 * over it (`hydrateQrCodes`); a string that is no address has no link. `label` is the string when `url` is not given. Without an address there is nothing to encode, so only the name shows.
 */
export function renderQrCode(attrs: Record<string, string>, label: string | undefined, tag: 'span' | 'div'): string {
  const url = attrs.url || label || '';
  const size = attrs.size || '128';
  const blockClass = tag === 'div' ? ' qrcode-block' : '';
  // Only an address a browser can open is a link; any other string (Wi-Fi settings, plain text) is encoded and shown as it is, so it is no link to a note that is not there.
  const link = !url ? 'QR Code' : /^(?:https?|ftp|mailto|tel):/i.test(url) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="qrcode-link"><span class="qrcode-link-text">🔗 ${escapeHtml(url)}</span></a>` : `<span class="qrcode-link-text">${escapeHtml(url)}</span>`;
  return `<${tag} class="qrcode-container${blockClass}" data-qrcode="${escapeHtml(url)}" data-size="${escapeHtml(size)}">${link}</${tag}>`;
}

/** A line that is a `::qrcode{url="…" size="…"}` leaf directive on its own, or `::qrcode[url]`. */
export const QRCODE_LEAF = /^ {0,3}::qrcode(?:\[([^\]]*)\])?(?:\{([^}]*)\})?\s*$/;

/**
 * Transforms inline directives like `:icon{name="Heart" size="16"}` and `:qrcode{url="..."}`.
 */
export function transformInlineDirectives(line: string): string {
  // :icon{name="Heart" size="16"} or :icon[Heart]{size="16"}, drawn as the real Lucide icon
  let result = renderInlineIcons(line);

  // :qrcode{url="https://..." size="128"}
  result = result.replace(/:qrcode(?:\[([^\]]*)\])?(?:\{([^}]*)\})?/g, (_, label: string, attrStr: string) => renderQrCode(parseDirectiveAttributes(attrStr), label, 'span'));

  return result;
}

/**
 * Renders a single container directive into semantic HTML.
 */
export function renderContainerDirective(name: string, label: string | undefined, attrs: Record<string, string>, bodyMarkdown: string, renderMarkdown: (md: string) => string, strings: Record<TranslationKey, string> = pageStrings()): string {
  const normName = name.toLowerCase();

  if (normName === 'info') {
    const title = parseDirectiveTitle(attrs, label, strings['directive.info.defaultTitle']);
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const titleClass = title.isDefault ? 'directive-title-default' : 'directive-title-custom';
    return `<div class="custom-directive info-directive" data-type="info" aria-label="${escapeHtml(title.label)}"><p class="directive-title ${titleClass}">${escapeHtml(title.label)}</p><div class="directive-body directive-content">${bodyHtml}</div></div>`;
  }

  if (normName === 'sidebar') {
    const title = parseDirectiveTitle(attrs, label, strings['directive.sidebar.defaultTitle']);
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const titleClass = title.isDefault ? 'directive-title-default' : 'directive-title-custom';
    return `<div class="custom-directive sidebar-directive" data-type="sidebar" aria-label="${escapeHtml(title.label)}"><p class="directive-title ${titleClass}">${escapeHtml(title.label)}</p><div class="directive-body directive-content">${bodyHtml}</div></div>`;
  }

  if (normName === 'optional') {
    const title = parseDirectiveTitle(attrs, label, strings['directive.optional.defaultTitle']);
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const titleClass = title.isDefault ? 'directive-title-default' : 'directive-title-custom';
    return `<details class="custom-directive optional-directive" data-type="optional" aria-label="${escapeHtml(title.label)}"><summary class="optional-summary ${titleClass}">${escapeHtml(title.label)}</summary><div class="directive-body directive-content">${bodyHtml}</div></details>`;
  }

  if (normName === 'comment') {
    const title = parseDirectiveTitle(attrs, label, strings['directive.comment.defaultTitle']);
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const titleClass = title.isDefault ? 'directive-title-default' : 'directive-title-custom';
    return `<aside class="comment-directive" data-type="comment" aria-label="${escapeHtml(title.label)}"><p class="comment-title ${titleClass}">${escapeHtml(title.label)}</p><div class="directive-body directive-content">${bodyHtml}</div></aside>`;
  }

  // Outside a slide note a build has nothing to reveal step by step: its content reads as written.
  if (normName === 'build') return `<div class="slide-build" data-type="build">${renderMarkdown(bodyMarkdown)}</div>`;

  if (normName === 'summary') {
    const slide = attrs.slide ?? '0';
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-summary" data-type="summary" data-slide-index="${escapeHtml(slide)}">${bodyHtml}</div>`;
  }

  if (normName === 'grid') {
    const cols = attrs.cols || '2';
    const rows = attrs.rows;
    const gap = attrs.gap || '1rem';
    let style = `display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${gap};`;
    if (rows) style += `grid-template-rows:repeat(${rows},minmax(0,1fr));`;
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-grid grid-cols-${escapeHtml(cols)}" data-cols="${escapeHtml(cols)}" style="${escapeHtml(style)}">${bodyHtml}</div>`;
  }

  if (normName === 'cell') {
    const colSpan = attrs.span || attrs.col || '1';
    const rowSpan = attrs.row || '1';
    let style = '';
    if (colSpan !== '1') style += `grid-column:span ${colSpan};`;
    if (rowSpan !== '1') style += `grid-row:span ${rowSpan};`;
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-cell" data-col-span="${escapeHtml(colSpan)}" style="${escapeHtml(style)}">${bodyHtml}</div>`;
  }

  if (normName === 'flow') {
    const direction = attrs.direction || 'horizontal';
    const arrow = attrs.arrow || '→';
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-flow flow-${escapeHtml(direction)}" data-direction="${escapeHtml(direction)}" data-arrow="${escapeHtml(arrow)}">${bodyHtml}</div>`;
  }

  if (normName === 'step') {
    const icon = attrs.icon || '';
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="slide-step" data-icon="${escapeHtml(icon)}">${bodyHtml}</div>`;
  }

  if (normName === 'coc-stat') {
    const nameVal = attrs.name || label || strings['directive.cocStat.defaultName'];
    const roleVal = attrs.role || '';
    const bodyHtml = renderMarkdown(bodyMarkdown);

    const cell = (key: (typeof COC_CHARACTERISTICS | typeof COC_DERIVED)[number]) => {
      const val = attrs[key]?.trim();
      if (!val) return '';
      const statLabel = escapeHtml(strings[`directive.cocStat.stat.${key}`]);
      return `<div class="coc-stat-cell" data-stat="${key}"><span class="coc-stat-label"><span class="coc-stat-label-name">${statLabel}</span><abbr class="coc-stat-code" title="${statLabel}">${cocCode(key)}</abbr></span><strong class="coc-stat-value">${escapeHtml(val)}</strong></div>`;
    };
    const charCells = COC_CHARACTERISTICS.map(cell).join('');
    const derivedCells = COC_DERIVED.map(cell).join('');

    return `<section class="coc-stat-block" data-type="coc-stat" aria-label="${escapeHtml(fill(strings['directive.cocStat.ariaLabel'], { name: nameVal }))}"><header class="coc-stat-header"><p class="coc-stat-kicker">${escapeHtml(strings['directive.cocStat.kicker'])}</p><h3 class="coc-stat-name">${escapeHtml(nameVal)}</h3>${roleVal ? `<p class="coc-stat-role">${escapeHtml(roleVal)}</p>` : ''}</header>${charCells ? `<div class="coc-stat-characteristics" role="group" aria-label="${escapeHtml(strings['directive.cocStat.characteristics'])}">${charCells}</div>` : ''}${derivedCells ? `<div class="coc-stat-derived" role="group" aria-label="${escapeHtml(strings['directive.cocStat.derived'])}">${derivedCells}</div>` : ''}${bodyHtml ? `<div class="coc-stat-body directive-content">${bodyHtml}</div>` : ''}</section>`;
  }

  if (normName === 'handout') {
    const id = attrs.id || 'DOC-01';
    const title = attrs.title || label || strings['directive.handout.title'];
    const variant = attrs.variant || 'report';
    const keeper = attrs.keeper || '';
    const variantLabel = strings[Object.hasOwn(HANDOUT_VARIANT_KEYS, variant) ? HANDOUT_VARIANT_KEYS[variant] : HANDOUT_VARIANT_KEYS.report];
    const bodyHtml = renderMarkdown(bodyMarkdown);

    const keeperNote = keeper ? `<aside class="handout-keeper-note"><p class="handout-keeper-kicker">${escapeHtml(strings['directive.handout.keeperLabel'])}</p><p class="handout-keeper-text">${escapeHtml(keeper)}</p></aside>` : '';

    return `<section class="handout-block handout-variant-${escapeHtml(variant)}" id="${escapeHtml(id)}" data-type="handout" data-variant="${escapeHtml(variant)}" aria-label="${escapeHtml(fill(strings['directive.handout.ariaLabel'], { id, title }))}">${keeperNote}<article class="handout-document"><header class="handout-document-header"><div class="handout-reference"><span class="handout-code">${escapeHtml(id)}</span><span class="handout-variant-label">${escapeHtml(variantLabel)}</span></div><h4 class="handout-title">${escapeHtml(title)}</h4></header><div class="handout-body directive-content">${bodyHtml}</div></article></section>`;
  }

  if (normName === 'parallel-quote') {
    const cite = attrs.cite || '';
    const author = attrs.author || '';
    const source = attrs.source || '';
    const bodyHtml = renderMarkdown(bodyMarkdown);

    const attribution = cite || author || source ? `<footer class="parallel-quote-attribution">${author ? `<span data-label="AUTHOR">${escapeHtml(author)}</span>` : ''}${source ? `<cite class="parallel-quote-source" data-label="SOURCE">${escapeHtml(source)}</cite>` : ''}${cite ? `<span class="parallel-quote-bibliography" data-label="CITATION">${escapeHtml(cite)}</span>` : ''}</footer>` : '';

    return `<blockquote class="parallel-quote">${bodyHtml}${attribution}</blockquote>`;
  }

  if (normName === 'original') {
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<details class="parallel-quote-disclosure" open><summary class="parallel-quote-toggle" aria-label="${escapeHtml(strings['directive.parallelQuote.toggle'])}" data-collapse-label="${escapeHtml(strings['directive.parallelQuote.collapse'])}" data-expand-label="${escapeHtml(strings['directive.parallelQuote.expand'])}"></summary><div class="parallel-quote-text parallel-quote-original" data-label="${escapeHtml(strings['directive.parallelQuote.originalLabel'])}">${bodyHtml}</div></details>`;
  }

  if (normName === 'translation') {
    const bodyHtml = renderMarkdown(bodyMarkdown);
    return `<div class="parallel-quote-text parallel-quote-translation" data-label="${escapeHtml(strings['directive.parallelQuote.translationLabel'])}">${bodyHtml}</div>`;
  }

  if (['github-repo', 'x-post', 'reddit-post', 'embed-card'].includes(normName)) {
    const url = attrs.url || '';
    const cardTitle = attrs.title || label || url;
    const bodyHtml = renderMarkdown(bodyMarkdown);
    const badges: Record<string, string> = { 'github-repo': 'GitHub', 'x-post': 'X (Twitter)', 'reddit-post': 'Reddit', 'embed-card': 'Embed' };
    const badge = badges[normName] || normName;
    return `<article class="embedded-card embedded-card-${normName}" data-card-type="${normName}"><header class="embedded-card-header"><span class="embedded-card-badge">${escapeHtml(badge)}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="embedded-card-link"><span class="embedded-card-title">${escapeHtml(cardTitle)}</span> ↗</a>` : `<span class="embedded-card-title">${escapeHtml(cardTitle)}</span>`}</header>${bodyHtml ? `<div class="embedded-card-body directive-content">${bodyHtml}</div>` : ''}</article>`;
  }

  // Fallback generic container directive
  const title = parseDirectiveTitle(attrs, label, normName.toUpperCase());
  const bodyHtml = renderMarkdown(bodyMarkdown);
  return `<div class="custom-directive generic-directive" data-type="${escapeHtml(normName)}"><p class="directive-title directive-title-custom">${escapeHtml(title.label)}</p><div class="directive-body directive-content">${bodyHtml}</div></div>`;
}

interface DirectiveStackItem {
  fenceLength: number;
  name: string;
  label?: string;
  attrs: Record<string, string>;
  rawAttrs?: string;
  lines: string[];
  /** The index of the opening fence among the lines being read. */
  index: number;
}

/** How the slide directives of a `type: slide` note are written, and where the text being read sits in the note. */
export interface SlideDirectiveOptions {
  rendering: SlideRendering;
  /** The 1-based line of the note that the line at `index` of the text being read is on. */
  lineOf: (index: number) => number;
}

/** The line where the figure block (an infographic or an argument map) opened at `start` closes, tracking the containers nested in it; undefined when it never does. */
function infographicEnd(lines: readonly string[], start: number, fenceLength: number): number | undefined {
  const fences = [fenceLength];
  for (let j = start + 1; j < lines.length; j++) {
    const nested = parseDirectiveOpen(lines[j]);
    if (nested) {
      fences.push(nested.fenceLength);
      continue;
    }
    if (matchDirectiveClose(lines[j], fences[fences.length - 1])) {
      fences.pop();
      if (!fences.length) return j;
    }
  }
  return undefined;
}

/** The page's UI language (the app sets `<html lang>`); a server renders English. */
function pageStrings(): Record<TranslationKey, string> {
  const language = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return language === 'zh-TW' ? zhTW : en;
}

/** The strings of a language a caller names; without one, the page's. */
export function stringsFor(language: NoteLanguage | undefined): Record<TranslationKey, string> {
  if (language === undefined) return pageStrings();
  return language === 'zh-TW' ? zhTW : en;
}

/**
 * The figure for a figure directive block's lines, or the error box in its place. `draw` throws what the figure's syntax
 * rejects; any failure, not only a reported one, stays inside the figure's place so the rest of the note still renders.
 */
function renderFigureBlock(blockLines: readonly string[], draw: (source: string) => string, errorBox: (error: Error, source: string) => string): string {
  // A block inside a blockquote carries the quote's markers on every line.
  const quote = /^\s*(?:>\s?)+/.exec(blockLines[0])?.[0] ?? '';
  const source = (quote ? blockLines.map(line => line.replace(/^\s*(?:>\s?)+/, '')) : blockLines).join('\n');
  // The figure is one line of HTML; inside a quote it and the blank lines around it keep the quote's markers.
  const place = (html: string) => quote ? `${quote.trimEnd()}\n${quote}${html}\n${quote.trimEnd()}` : `\n${html}\n`;
  try {
    return place(draw(source));
  } catch (error) {
    return place(errorBox(error instanceof Error ? error : new Error(String(error)), source));
  }
}

/** The figure for an infographic block's lines, or the error box in its place. */
function renderInfographicBlock(blockLines: readonly string[], renderInline: (md: string) => string, strings: Record<TranslationKey, string>, language: NoteLanguage | undefined): string {
  return renderFigureBlock(blockLines, source => renderInfographic(source, { renderInline, language }), (error, source) => renderInfographicError(error instanceof InfographicError ? error : new InfographicError(error.message), source, strings['infographic.render.error']));
}

/** The figure for an annotate block's lines, or the error box in its place. */
function renderAnnotateBlock(blockLines: readonly string[], renderMarkdown: (md: string) => string, strings: Record<TranslationKey, string>): string {
  return renderFigureBlock(blockLines, source => renderAnnotate(source, { renderMarkdown, strings }), (error, source) => renderAnnotateError(error instanceof AnnotateError ? error : new AnnotateError(error.message), source, strings['imageAnnotation.render.error']));
}

/** The figure for an argument-map block's lines, or the error box in its place. */
function renderArgumentMapBlock(blockLines: readonly string[], renderInline: (md: string) => string, strings: Record<TranslationKey, string>, language: NoteLanguage | undefined): string {
  return renderFigureBlock(blockLines, source => renderArgumentMap(source, { renderInline, language }), (error, source) => renderArgumentMapError(error instanceof ArgumentMapError ? error : new ArgumentMapError(error.message), source, strings['argumentMap.render.error']));
}

/**
 * Main parser that scans for container directives, leaf directives, inline directives,
 * and recursively converts them to HTML before main markdown processing.
 */
export function transformDirectives(content: string, renderMarkdown: (md: string) => string, renderInline: (md: string) => string = md => renderMarkdown(md).trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1'), language?: NoteLanguage, balance: (html: string) => string = html => html, slides?: SlideDirectiveOptions): string {
  const strings = stringsFor(language);
  const lines = content.split('\n');
  const output: string[] = [];
  const stack: DirectiveStackItem[] = [];
  const inCode = fencedCodeLines();
  const indentedCode = indentedCodeLines();
  /** A slide directive on the line at `index`, written for the note's slide rendering; `body` is a container's rendered content. */
  const slideDirective = (options: SlideDirectiveOptions, name: string, form: 'container' | 'leaf' | 'text', rawAttrs: string | undefined, source: string, index: number, body?: string) => renderSlideDirective(name, form, rawAttrs, source, { rendering: options.rendering, strings, line: options.lineOf(index) }, body);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A code block keeps its lines as written, whatever they look like.
    if (inCode(line)) {
      indentedCode.interrupt();
      if (stack.length > 0) stack[stack.length - 1].lines.push(line);
      else output.push(line);
      continue;
    }
    // An indented code block keeps its lines as written, `:icon{…}` and directives alike; the lines of a container are judged when its
    // content is transformed.
    const literal = stack.length === 0 ? indentedCode.line(line) : (indentedCode.interrupt(), false);
    if (literal) {
      output.push(line);
      continue;
    }

    const open = parseDirectiveOpen(line);
    if (open && (isInfographicKind(open.name) || isArgumentMapName(open.name) || isAnnotateName(open.name))) {
      const end = infographicEnd(lines, i, open.fenceLength);
      if (end !== undefined) {
        const block = lines.slice(i, end + 1);
        const figure = isAnnotateName(open.name) ? renderAnnotateBlock(block, md => balance(renderMarkdown(md)), strings) : isArgumentMapName(open.name) ? renderArgumentMapBlock(block, renderInline, strings, language) : renderInfographicBlock(block, renderInline, strings, language);
        // Blank lines keep the figure's HTML block apart from the Markdown around it.
        if (stack.length > 0) stack[stack.length - 1].lines.push(figure);
        else output.push(figure);
        i = end;
        continue;
      }
    }
    // `:::vertical`, `:::block` and `:::slide` hold no content: in a slide note the line is the error contour-deck reports, and no block opens.
    if (open && slides && isSlideDirective(open.name) && !isSlideContainer(open.name)) {
      const refused = `\n${slideDirective(slides, open.name, 'container', open.rawAttrs, line.trim(), i)}\n`;
      if (stack.length > 0) stack[stack.length - 1].lines.push(refused);
      else output.push(refused);
      continue;
    }
    if (open) {
      stack.push({ ...open, lines: [], index: i });
      continue;
    }

    if (stack.length > 0) {
      const close = matchDirectiveClose(line, stack[stack.length - 1].fenceLength);
      if (close) {
        if (close.trailing) stack[stack.length - 1].lines.push(close.trailing);
        const item = stack.pop()!;
        const innerBody = item.lines.join('\n');
        // Recursively transform directives within this container; what they report is on the container's opening line.
        const within = slides && { rendering: slides.rendering, lineOf: () => slides.lineOf(item.index) };
        const transformedInner = transformDirectives(innerBody, renderMarkdown, renderInline, language, balance, within);
        // A label (`:::summary[…]`) is the container's first paragraph, as remark-directive reads it.
        const renderedHtml = slides && isSlideContainer(item.name) ? slideDirective(slides, item.name, 'container', item.rawAttrs, lines.slice(item.index, i + 1).join('\n'), item.index, renderMarkdown(item.label ? `${item.label}\n\n${transformedInner}` : transformedInner)) : renderContainerDirective(item.name, item.label, item.attrs, transformedInner, renderMarkdown, strings);

        if (stack.length > 0) {
          stack[stack.length - 1].lines.push(renderedHtml);
        } else {
          output.push(renderedHtml);
        }
        continue;
      }
    }

    // The slide directives that stand on a line of their own; a note that is no deck shows nothing for `::block` and `::slide`.
    const leaf = stack.length === 0 ? parseDirectiveLine(line) : null;
    if (leaf && isSlideDirective(leaf.name)) {
      if (slides) {
        // Blank lines keep the element apart from the Markdown around it.
        output.push(`\n${slideDirective(slides, leaf.name, leaf.form, leaf.rawAttrs, line.trim(), i)}\n`);
        continue;
      }
      if (drawsNothingOutsideDeck(leaf.name, leaf.form)) continue;
    }

    // Leaf directive: ::qrcode{url="…" size="…"}, a code on a line of its own
    const qrcode = stack.length === 0 ? QRCODE_LEAF.exec(line) : null;
    if (qrcode) {
      // Blank lines keep the element apart from the Markdown around it.
      output.push(`\n${renderQrCode(parseDirectiveAttributes(qrcode[2]), qrcode[1], 'div')}\n`);
      continue;
    }

    // Leaf directive: ::vertical
    if (stack.length === 0 && /^::vertical\s*$/.test(line)) {
      output.push('<hr class="vertical-slide-break" data-vertical="true" />');
      continue;
    }

    // Accumulate inside current container or output
    if (stack.length > 0) {
      stack[stack.length - 1].lines.push(line);
    } else {
      // Process inline directives in line
      output.push(transformInlineDirectives(line));
    }
  }

  // Handle any unclosed containers gracefully
  while (stack.length > 0) {
    const unclosed = stack.shift()!;
    output.push(`${':'.repeat(unclosed.fenceLength)}${unclosed.name}`);
    output.push(...unclosed.lines);
  }

  return output.join('\n');
}
