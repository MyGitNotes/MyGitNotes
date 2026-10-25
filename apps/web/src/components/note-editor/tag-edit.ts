/** The tags a note's frontmatter lists, as strings. */
export const noteTags = (metadata: Record<string, unknown>): string[] => Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];

/** A typed tag without the commas its separator key leaves at the ends. */
export const cleanTag = (raw: string) => raw.trim().replace(/^,+|,+$/g, '');

/** `metadata` with the typed tag added; the same object when it is empty or already listed. */
export function withTag(metadata: Record<string, unknown>, raw: string): Record<string, unknown> {
  const tag = cleanTag(raw);
  const tags = noteTags(metadata);
  return !tag || tags.includes(tag) ? metadata : { ...metadata, tags: [...tags, tag] };
}

/** `metadata` without `tag`. */
export const withoutTag = (metadata: Record<string, unknown>, tag: string): Record<string, unknown> => ({ ...metadata, tags: noteTags(metadata).filter(other => other !== tag) });

/** The notebook's tags the note lacks that contain what is typed, for the autocomplete. */
export function suggestTags(available: readonly string[], current: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  return available.filter(tag => !current.includes(tag) && (!needle || tag.toLowerCase().includes(needle)));
}
