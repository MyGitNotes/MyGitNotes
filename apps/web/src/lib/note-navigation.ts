import { headingSlug } from './workspace-links.js';
export interface TextMatch {
  from: number;
  to: number;
}

export interface OutlineHeading {
  depth: number;
  label: string;
  line: number;
  from: number;
}

export function findOutlineIndexForLine(outline: OutlineHeading[], line: number): number {
  if (outline.length === 0) return 0;
  let active = 0;
  for (let index = 0; index < outline.length; index += 1) {
    if (outline[index].line > line) break;
    active = index;
  }
  return active;
}

export function findTextMatches(content: string, query: string): TextMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const haystack = content.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  for (let from = 0; from <= haystack.length - normalizedNeedle.length;) {
    const match = haystack.indexOf(normalizedNeedle, from);
    if (match < 0) break;
    matches.push({ from: match, to: match + normalizedNeedle.length });
    from = match + normalizedNeedle.length;
  }
  return matches;
}

function headingLabel(source: string) {
  return source.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_~]/g, '').replace(/<[^>]+>/g, '').replace(/\\([\\`*{}[\]()#+.!_>-])/g, '$1').trim();
}

export function parseMarkdownOutline(content: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const lines = content.split('\n');
  let offset = 0;
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      offset += line.length + (index < lines.length - 1 ? 1 : 0);
      continue;
    }

    if (!fence) {
      const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (atx) {
        const label = headingLabel(atx[2]);
        if (label) headings.push({ depth: atx[1].length, label, line: index + 1, from: offset });
      } else if (index + 1 < lines.length && line.trim()) {
        const setext = lines[index + 1].match(/^\s{0,3}(=+|-+)\s*$/);
        if (setext) {
          const label = headingLabel(line.trim());
          if (label) headings.push({ depth: setext[1][0] === '=' ? 1 : 2, label, line: index + 1, from: offset });
        }
      }
    }

    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  }
  return headings;
}

export interface OutlineSelectionResult {
  heading: OutlineHeading;
  line: number;
  shouldClosePanel: boolean;
  focusEditor: boolean;
}

export function chooseOutlineHeading(outline: OutlineHeading[], index: number, options: { closeAfter?: boolean; focusEditor?: boolean; } = {}): OutlineSelectionResult | null {
  const heading = outline[index];
  if (!heading) return null;
  return { heading, line: heading.line, shouldClosePanel: options.closeAfter ?? false, focusEditor: options.focusEditor ?? false };
}

export interface NoteSection {
  /** The heading's label as the note has it now. */
  heading: string;
  depth: number;
  /** The Markdown from below the heading line to the next heading of the same or a higher level, or the end, without surrounding blank lines. */
  body: string;
}

/**
 * The section of `content` a heading anchor names: the first heading whose slug matches the anchor's, as a `#heading`
 * link matches, so the heading text and its slug both work. Deeper sub-headings stay in the section; headings in fenced
 * code never match. `null` when no heading matches.
 */
export function noteSection(content: string, anchor: string): NoteSection | null {
  const slug = headingSlug(anchor);
  const outline = parseMarkdownOutline(content);
  const index = outline.findIndex(heading => headingSlug(heading.label) === slug);
  if (index < 0) return null;
  const heading = outline[index];
  const next = outline.slice(index + 1).find(candidate => candidate.depth <= heading.depth);
  const lines = content.split('\n');
  // An ATX heading is one line; a setext heading is its text line and the underline below it.
  const setext = /^\s{0,3}(=+|-+)\s*$/.test(lines[heading.line] ?? '') && !/^\s{0,3}#{1,6}(\s|$)/.test(lines[heading.line - 1]);
  const start = lines.slice(0, heading.line + (setext ? 1 : 0)).reduce((offset, line) => offset + line.length + 1, 0);
  return { heading: heading.label, depth: heading.depth, body: content.slice(Math.min(start, content.length), next ? next.from : content.length).trim() };
}
