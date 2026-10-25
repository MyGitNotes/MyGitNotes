export const NOTE_EXCERPT_LIMIT = 240;

/**
 * The opening of a note's body as plain text, for a card that shows what the note is about: the first lines with Markdown marks, images
 * and code fences taken out (and a first heading that only repeats the `title`), joined on one line and bounded to `limit` characters
 * (ending in an ellipsis when cut).
 */
export function noteExcerpt(content: string, title = '', limit = NOTE_EXCERPT_LIMIT): string {
  const lines: string[] = [];
  let fenced = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    const text = line.replace(/^(#{1,6}|>+|[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]+/g, '').trim();
    if (!text || (!lines.length && title && text === title.trim())) continue;
    lines.push(text);
    if (lines.join(' ').length > limit) break;
  }
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
