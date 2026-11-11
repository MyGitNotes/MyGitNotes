/**
 * Pandoc citations in Markdown, read the way thesis-toolkit's zh-journal template reads them (`md-cites`,
 * `_cite-pattern` and `_cite-item` in its `lib.typ`). This is a second copy of that grammar for the editor: the PDF
 * is the authority, and a form the template stops on is simply not a citation here.
 */

export type CitationKind = 'group' | 'year' | 'cmarker' | 'narrative';

export interface CitationItem {
  key: string;
  locator?: string;
}

/** One citation in a text: `[@a; @b, 23]` (group), `[-@a]` (year), cmarker's `[23][@a]`, or a bare `@a` / `@a [23]` (narrative). */
export interface Citation {
  from: number;
  to: number;
  kind: CitationKind;
  items: CitationItem[];
}

/** What the editor knows of a bibliography entry. `authors` holds family names, or the whole name of a CJK author. */
export interface CitationEntry {
  key: string;
  authors: string[];
  year: string;
  title: string;
}

export interface CitationLookup {
  get(key: string): CitationEntry | undefined;
}

/** A Pandoc citation key: starts with a letter, digit or `_`; `:./-` only inside, so `@sosa2007.` cites `sosa2007`. */
export const CITATION_KEY_SOURCE = '[\\p{L}\\p{N}_](?:[\\p{L}\\p{N}_:./-]*[\\p{L}\\p{N}_])?';

// Characters that make an `@` part of an email, URL or word instead of a citation.
const WORD_CHAR = 'A-Za-z0-9._\\\\@/:=?&%+-';
// The same alternatives, in the same order, as zh-journal's `_cite-pattern`:
// 1-2 cmarker's `[locator][@key]`; 3 a bracketed group; 4 brackets with text before the `@` (`[see @a]`, never a
// citation); 5-7 a bare `@key` with an optional `[locator]`, not inside an email or URL.
const CITE_SOURCE = `\\[([^\\[\\]]*)\\]\\[@(${CITATION_KEY_SOURCE})\\]` + `|\\[(\\s*-?@${CITATION_KEY_SOURCE}[^\\[\\]]*)\\]` + `|\\[([^\\[\\]@]*[^\\s\\[\\]@][^\\[\\]@]*@${CITATION_KEY_SOURCE}[^\\[\\]]*)\\]` + `|(^|[^${WORD_CHAR}\\[\\]])@(${CITATION_KEY_SOURCE})(?:\\s*\\[([^\\[\\]@^]*)\\])?`;
const CITE_ITEM = new RegExp(`^\\s*(-?)@(${CITATION_KEY_SOURCE})\\s*(?:,\\s*(.*?))?\\s*$`, 'u');
// As in Pandoc, the line after the opening `---` is not blank, so a note that opens with a thematic break keeps its text.
const FRONT_MATTER_CLOSE = '(?:---|\\.\\.\\.)[ \\t]*(?:\\r?\\n|$)';
const FRONT_MATTER = new RegExp(`^\\uFEFF?---[ \\t]*\\r?\\n(?:${FRONT_MATTER_CLOSE}|[^\\r\\n]*\\S[^\\r\\n]*\\r?\\n(?:[\\s\\S]*?\\r?\\n)??${FRONT_MATTER_CLOSE})`);
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED = /^( {4}|\t)/;
const LIST_ITEM = /^ {0,3}([-*+]|\d+[.)])(\s|$)/;
const INLINE_TOKEN = /<!--|-->|`+/g;

/** A locator as the template passes it on: trimmed, none when blank, and refused (it stops the compile) when it holds `-->`. */
function readLocator(text: string | undefined): { locator?: string; } | undefined {
  const locator = text?.trim();
  if (!locator) return {};
  return locator.includes('-->') ? undefined : { locator };
}

function groupItems(group: string): { year: boolean; items: CitationItem[]; } | undefined {
  const items: CitationItem[] = [];
  let year = false;
  for (const part of group.split(';')) {
    const match = CITE_ITEM.exec(part);
    const locator = match && readLocator(match[3]);
    if (!match || !locator) return undefined;
    if (match[1]) year = true;
    items.push({ key: match[2]!, ...locator });
  }
  // `-@key` prints the year alone and must be the only item.
  if (year && items.length > 1) return undefined;
  return { year, items };
}

/** The citations of `piece`, a stretch of one line outside code spans and comments (`_cites-in-text`). */
function citationsInPiece(piece: string, offset: number, out: Citation[]): void {
  for (const match of piece.matchAll(new RegExp(CITE_SOURCE, 'gu'))) {
    const from = offset + match.index, end = match.index + match[0].length;
    // A `(` or `[` right after `]` makes the brackets a link's text.
    const after = piece[end] ?? '';
    const link = after === '(' || after === '[';
    if (match[2] !== undefined) {
      const locator = readLocator(match[1]);
      if (locator) out.push({ from, to: offset + end, kind: 'cmarker', items: [{ key: match[2], ...locator }] });
    } else if (match[3] !== undefined) {
      // `[@a]: url` at the start of a line is a link reference definition.
      if (link || (after === ':' && piece.slice(0, match.index).trim() === '')) continue;
      const read = groupItems(match[3]);
      if (read) out.push({ from, to: offset + end, kind: read.year ? 'year' : 'group', items: read.items });
    } else if (match[6] !== undefined) {
      const start = from + match[5]!.length, keyEnd = start + 1 + match[6].length;
      // `@a [text](url)`: the brackets belong to the link, so the citation takes no locator.
      if (match[7] === undefined || link) out.push({ from: start, to: keyEnd, kind: 'narrative', items: [{ key: match[6] }] });
      else {
        const locator = readLocator(match[7]);
        if (locator) out.push({ from: start, to: offset + end, kind: 'narrative', items: [{ key: match[6], ...locator }] });
      }
    }
  }
}

/** Reads one text line, skipping code spans and HTML comments (`_cites-in-line`); answers whether a comment is still open at its end. */
function citationsInLine(line: string, offset: number, inComment: boolean, out: Citation[]): boolean {
  const tokens = [...line.matchAll(INLINE_TOKEN)];
  let cursor = 0, code: string | undefined;
  tokens.forEach((token, index) => {
    const text = token[0], end = token.index + text.length;
    if (inComment) {
      if (text === '-->') {
        inComment = false;
        cursor = end;
      }
    } else if (code !== undefined) {
      if (text === code) {
        code = undefined;
        cursor = end;
      }
    } else if (text === '<!--') {
      citationsInPiece(line.slice(cursor, token.index), offset + cursor, out);
      cursor = token.index;
      inComment = true;
    } else if (text.startsWith('`') && tokens.slice(index + 1).some(later => later[0] === text)) {
      // A backtick run opens a code span only when a run of the same length closes it.
      citationsInPiece(line.slice(cursor, token.index), offset + cursor, out);
      cursor = token.index;
      code = text;
    }
  });
  if (!inComment) citationsInPiece(line.slice(cursor), offset + cursor, out);
  return inComment;
}

/** Whether each Markdown line is text; fenced code, indented code and blank lines are not (`_line-kinds`). */
function textLines(lines: string[]): boolean[] {
  let fence: RegExp | undefined, previous: 'fence' | 'code' | 'blank' | 'text' = 'blank', inList = false;
  return lines.map(line => {
    let kind: typeof previous;
    const open = FENCE_OPEN.exec(line);
    if (fence) {
      if (fence.test(line)) fence = undefined;
      kind = 'fence';
    } else if (open) {
      fence = new RegExp(`^ {0,3}${open[1]![0]}{${open[1]!.length},}\\s*$`);
      kind = 'fence';
    } else if (line.trim() === '') kind = 'blank';
    else if (INDENTED.test(line) && (previous === 'code' || (previous === 'blank' && !inList))) kind = 'code';
    else {
      if (!INDENTED.test(line)) inList = LIST_ITEM.test(line);
      kind = 'text';
    }
    previous = kind;
    return kind === 'text';
  });
}

/** Every citation in `text`, in order. Front matter, fenced and indented code, code spans, HTML comments and links are skipped. */
export function findCitations(text: string): Citation[] {
  const out: Citation[] = [];
  let offset = FRONT_MATTER.exec(text)?.[0].length ?? 0;
  const lines = text.slice(offset).split('\n');
  const isText = textLines(lines);
  let inComment = false;
  lines.forEach((line, index) => {
    if (isText[index] || inComment) inComment = citationsInLine(line, offset, inComment, out);
    offset += line.length + 1;
  });
  return out;
}

function authorLabel(entry: CitationEntry): string {
  const [first, second] = entry.authors;
  if (first === undefined) return entry.title || entry.key;
  if (entry.authors.length === 1) return first;
  return entry.authors.length === 2 ? `${first} 及 ${second}` : `${first} 等`;
}

/** An entry as a one-item citation prints it, without the parentheses: `Sosa 2007`. */
export function citationEntryLabel(entry: CitationEntry): string {
  return `${authorLabel(entry)} ${yearLabel(entry, undefined)}`;
}

function yearLabel(entry: CitationEntry, locator: string | undefined): string {
  return `${entry.year || 'n.d.'}${locator ? `, ${locator}` : ''}`;
}

/**
 * The citation as the default style (Chicago author-date, zh-TW) prints it: `(Sosa 2007, 23)`, `(Smith 及 Doe 2010)`,
 * `(Smith 等 2011)`, `(2007)` for `[-@a]`, `Sosa (2007)` for a bare `@a`. `undefined` when a key is not in `lookup`.
 * An approximation: a project may set its own style, and the PDF shows what it really prints.
 */
export function formatCitation(citation: Citation, lookup: CitationLookup): string | undefined {
  const parts: { entry: CitationEntry; locator?: string; }[] = [];
  for (const item of citation.items) {
    const entry = lookup.get(item.key);
    if (!entry) return undefined;
    parts.push({ entry, locator: item.locator });
  }
  if (citation.kind === 'narrative') return parts.map(({ entry, locator }) => `${authorLabel(entry)} (${yearLabel(entry, locator)})`).join('; ');
  if (citation.kind === 'year') return `(${parts.map(({ entry, locator }) => yearLabel(entry, locator)).join('; ')})`;
  return `(${parts.map(({ entry, locator }) => `${authorLabel(entry)} ${yearLabel(entry, locator)}`).join('; ')})`;
}
