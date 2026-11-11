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

// The same alternatives, in the same order, as zh-journal's `_cite-pattern`:
// 1-2 cmarker's `[locator][@key]`; 3 a bracketed group and the character after it (not a link's `(`);
// 4-6 a bare `@key` with an optional `[locator]` that is not itself a link, not inside an email or URL.
const CITE_SOURCE = `\\[([^\\[\\]]*)\\]\\[@(${CITATION_KEY_SOURCE})\\]` + `|\\[(\\s*-?@${CITATION_KEY_SOURCE}[^\\[\\]]*)\\](?:[^(]|$)` + `|(^|[^A-Za-z0-9._\\\\@/:=?&%+\\[-])@(${CITATION_KEY_SOURCE})(?:(\\s*)\\[([^\\[\\]@^]+)\\](?![(\\[]))?`;
const CITE_ITEM = new RegExp(`^\\s*(-?)@(${CITATION_KEY_SOURCE})\\s*(?:,\\s*(.*?))?\\s*$`, 'u');
const FENCE = /^\s{0,3}(```|~~~)/;
const LINK_DEFINITION = /^\s{0,3}\[[^\]]*\]:/;
const FRONT_MATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const BLANK = '\uFFFF';

function blank(text: string): string {
  return text.replace(/[^\n]/g, BLANK);
}

function groupItems(group: string): { year: boolean; items: CitationItem[]; } | undefined {
  const items: CitationItem[] = [];
  let year = false;
  for (const part of group.split(';')) {
    const match = CITE_ITEM.exec(part);
    if (!match) return undefined;
    if (match[1]) year = true;
    items.push(match[3] ? { key: match[2]!, locator: match[3] } : { key: match[2]! });
  }
  // `-@key` prints the year alone and must be the only item.
  if (year && items.length > 1) return undefined;
  return { year, items };
}

/** Whether `index` lies inside square brackets opened earlier in `piece`: `[see @a]`, which the template refuses. */
function insideBrackets(piece: string, index: number): boolean {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (piece[i] === '[') depth += 1;
    else if (piece[i] === ']' && depth > 0) depth -= 1;
  }
  return depth > 0;
}

function citationsInPiece(piece: string, offset: number, out: Citation[]): void {
  for (const match of piece.matchAll(new RegExp(CITE_SOURCE, 'gu'))) {
    const start = offset + match.index;
    if (match[2] !== undefined) {
      const locator = match[1]!.trim();
      out.push({ from: start, to: start + match[0].length, kind: 'cmarker', items: [locator ? { key: match[2], locator } : { key: match[2] }] });
    } else if (match[3] !== undefined) {
      const read = groupItems(match[3]);
      if (read) out.push({ from: start, to: start + match[3].length + 2, kind: read.year ? 'year' : 'group', items: read.items });
    } else if (match[5] !== undefined) {
      const from = match.index + match[4]!.length;
      if (insideBrackets(piece, from)) continue;
      const locator = match[7]?.trim();
      out.push({ from: offset + from, to: start + match[0].length, kind: 'narrative', items: [locator ? { key: match[5], locator } : { key: match[5] }] });
    }
  }
}

/** Every citation in `text`, in order. Front matter, fenced code, code spans, HTML comments and link definitions are skipped. */
export function findCitations(text: string): Citation[] {
  const out: Citation[] = [];
  const frontMatter = FRONT_MATTER.exec(text)?.[0].length ?? 0;
  const source = blank(text.slice(0, frontMatter)) + text.slice(frontMatter).replace(COMMENT, blank);
  let fenced = false;
  let lineStart = 0;
  for (const line of source.split('\n')) {
    const start = lineStart;
    lineStart += line.length + 1;
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || LINK_DEFINITION.test(line)) continue;
    // Even pieces lie outside inline code spans.
    let offset = start;
    line.split('`').forEach((piece, index) => {
      if (index % 2 === 0) citationsInPiece(piece, offset, out);
      offset += piece.length + 1;
    });
  }
  return out;
}

function authorLabel(entry: CitationEntry): string {
  const [first, second] = entry.authors;
  if (first === undefined) return entry.title || entry.key;
  if (entry.authors.length === 1) return first;
  return entry.authors.length === 2 ? `${first} 及 ${second}` : `${first} 等`;
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
