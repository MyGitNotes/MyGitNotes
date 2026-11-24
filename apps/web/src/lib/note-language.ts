/** Frontmatter is open-ended; only a nonempty string can name the language of a note. */
export function noteLanguageTag(metadata: { [key: string]: unknown; }): string | undefined {
  return typeof metadata.lang === 'string' ? metadata.lang.trim() || undefined : undefined;
}
