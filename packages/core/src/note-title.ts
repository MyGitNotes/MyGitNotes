/**
 * A note's H1: `#`, white space, and text on the same line; an empty `#` line is no title and does not run on into the
 * next line. The text is group 1, without the white space around it; the match ends before the line's `\n`, a CRLF's
 * `\r` included.
 */
export const NOTE_H1 = /^#[^\S\r\n]+(?=[^\r\n]*\S)([^\r\n]*?)[^\S\r\n]*\r?$/m;

/** The kind suffix a renamed note keeps: `.outline.md`, `.compilation.yml`, or its plain extension. */
export function noteSuffix(path: string): string {
  return path.match(/(\.outline\.md|\.compilation\.yml|\.[^./]+)$/)?.[1] ?? '';
}

/** The file name stem for `title`: letters and digits of any script, dashes between words; empty when it has none. */
export function noteStem(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/, '');
}

/** The path of the note at `path` once renamed to `title`, in the same folder and with the same suffix. */
export function renamedPath(path: string, title: string): string {
  return `${path.slice(0, path.lastIndexOf('/') + 1)}${noteStem(title)}${noteSuffix(path)}`;
}

/**
 * The content and metadata of a note retitled `title`. A frontmatter title is rewritten where the note has one (an
 * outline always keeps its title there), and so is a first H1 that repeats the `previous` title, as a template's
 * note does. Without a frontmatter title the first H1 names the note, so it is the one rewritten; a note with
 * neither gains a frontmatter title.
 */
export function retitle(content: string, metadata: Record<string, unknown>, title: string, outline: boolean, previous?: string): { content: string; metadata: Record<string, unknown>; } {
  const heading = content.match(NOTE_H1);
  if (outline || !heading) return { content, metadata: { ...metadata, title } };
  const rewritten = content.replace(NOTE_H1, line => `# ${title}${line.endsWith('\r') ? '\r' : ''}`);
  if (typeof metadata.title !== 'string') return { content: rewritten, metadata };
  return { content: heading[1].trim() === previous ? rewritten : content, metadata: { ...metadata, title } };
}
