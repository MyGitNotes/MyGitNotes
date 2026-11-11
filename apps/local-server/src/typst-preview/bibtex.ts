import type { CitationEntry } from '@mygitnotes/core/citations';

/** What `and others` stands for in a citation; it fills the author list to three so the entry is cited as "Smith 等". */
const OTHERS = '等';
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const ACCENTS: Record<string, string> = { '"': '\u0308', "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303', '=': '\u0304', '.': '\u0307', c: '\u0327', v: '\u030C', u: '\u0306', H: '\u030B', k: '\u0328', r: '\u030A' };
const LETTERS: Record<string, string> = { ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ' };

/** Index just past the brace or parenthesis block opened at `open`, or -1 when it never closes. */
function blockEnd(text: string, open: number): number {
  const closer = text[open] === '(' ? ')' : '}';
  let depth = 0, quoted = false;
  for (let i = open + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') i += 1;
    else if (char === '{') depth += 1;
    else if (char === '}' && depth > 0) depth -= 1;
    else if (depth === 0 && char === '"') quoted = !quoted;
    else if (depth === 0 && !quoted && char === closer) return i + 1;
  }
  return -1;
}

/** The fields of an entry body (`key, name = value, …`), lower-cased names; a value keeps its inner braces. */
function readFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  let i = body.indexOf(',') + 1;
  if (i === 0) return fields;
  while (i < body.length) {
    const name = /\s*([^\s=,{}"#]+)\s*=\s*/y;
    name.lastIndex = i;
    const match = name.exec(body);
    if (!match) {
      // Not a field: move past the next comma at this level, or stop.
      const comma = body.indexOf(',', i);
      if (comma === -1) break;
      i = comma + 1;
      continue;
    }
    i = name.lastIndex;
    const parts: string[] = [];
    for (;;) {
      if (body[i] === '{') {
        const end = blockEnd(body, i);
        if (end === -1) return fields;
        parts.push(body.slice(i + 1, end - 1));
        i = end;
      } else if (body[i] === '"') {
        let end = i + 1, depth = 0;
        for (; end < body.length; end += 1) {
          if (body[end] === '\\') end += 1;
          else if (body[end] === '{') depth += 1;
          else if (body[end] === '}') depth -= 1;
          else if (body[end] === '"' && depth <= 0) break;
        }
        parts.push(body.slice(i + 1, end));
        i = end + 1;
      } else {
        // A number, or a @string name whose text is not looked up.
        const bare = /[^\s,#{}"]*/y;
        bare.lastIndex = i;
        const word = bare.exec(body)![0];
        if (/^\d+$/.test(word)) parts.push(word);
        i += word.length;
      }
      const more = /\s*#\s*/y;
      more.lastIndex = i;
      if (!more.test(body)) break;
      i = more.lastIndex;
    }
    if (!fields.has(match[1]!.toLowerCase())) fields.set(match[1]!.toLowerCase(), parts.join(''));
    const comma = /\s*,/y;
    comma.lastIndex = i;
    if (!comma.test(body)) break;
    i = comma.lastIndex;
  }
  return fields;
}

/** LaTeX in a field as plain text: common accents and letters, `--`, `~`, escapes, and no braces. */
export function plainText(value: string): string {
  return value.replace(/\\([cvuHkr])\s*\{(\p{L})\}|\\([cvuHkr])\s+(\p{L})|\{?\\(["'`^~=.])\s*\{?\\?(\p{L})\}?\}?/gu, (_all, a1, l1, a2, l2, a3, l3) => `${l1 ?? l2 ?? l3}${ACCENTS[a1 ?? a2 ?? a3]}`.normalize('NFC')).replace(/\\(ss|ae|AE|oe|OE|aa|AA|[oOlLij])(?![A-Za-z])\s*/g, (_all, name: string) => LETTERS[name]!).replace(/\\([&%$#_{}])/g, '$1').replace(/\\[A-Za-z]+\s*/g, '').replace(/---/g, '—').replace(/--/g, '–').replace(/~/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** Splits a name list on ` and ` outside braces. */
function splitNames(value: string): string[] {
  const names: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\') i += 1;
    else if (value[i] === '{') depth += 1;
    else if (value[i] === '}') depth -= 1;
    else if (depth === 0) {
      const and = /\s+and\s+/iy;
      and.lastIndex = i;
      if (and.test(value)) {
        names.push(value.slice(start, i));
        start = and.lastIndex;
        i = start - 1;
      }
    }
  }
  names.push(value.slice(start));
  return names.map(name => name.trim()).filter(Boolean);
}

/** The name a citation prints: the family name, or the whole name of a CJK or braced (corporate) author. */
function citedName(raw: string): string {
  if (/^\{[^{}]*\}$/.test(raw)) return plainText(raw);
  const name = plainText(raw);
  if (CJK.test(name)) return name.replace(/\s*,\s*/g, '');
  if (name.includes(',')) return name.split(',')[0]!.trim();
  const words = name.split(' ');
  // `Ludwig van Beethoven`: lower-case words before the last one belong to the family name.
  let first = words.length - 1;
  while (first > 1 && /^\p{Ll}/u.test(words[first - 1]!)) first -= 1;
  return words.slice(first).join(' ');
}

function authorsOf(fields: Map<string, string>): string[] {
  const names = splitNames(fields.get('author') || fields.get('editor') || '');
  const others = names.at(-1)?.toLowerCase() === 'others';
  const authors = (others ? names.slice(0, -1) : names).map(citedName).filter(Boolean);
  if (others) { while (authors.length < 3) authors.push(OTHERS); }
  return authors;
}

/** The entries of a BibTeX file, in file order: key, cited author names, year and title. `@string`, `@preamble` and `@comment` are skipped. */
export function parseBibliography(bib: string): CitationEntry[] {
  const entries: CitationEntry[] = [];
  const seen = new Set<string>();
  const start = /@\s*([A-Za-z]+)\s*([{(])/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(bib)) !== null) {
    const open = match.index + match[0].length - 1;
    const end = blockEnd(bib, open);
    if (end === -1) break;
    start.lastIndex = end;
    if (['string', 'preamble', 'comment'].includes(match[1]!.toLowerCase())) continue;
    const body = bib.slice(open + 1, end - 1);
    const key = body.slice(0, body.includes(',') ? body.indexOf(',') : body.length).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fields = readFields(body);
    const year = /\d{4}/.exec(fields.get('year') || fields.get('date') || '')?.[0] ?? '';
    entries.push({ key, authors: authorsOf(fields), year, title: plainText(fields.get('title') ?? '') });
  }
  return entries;
}
