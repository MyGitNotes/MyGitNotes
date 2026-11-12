/** Whether a note's frontmatter makes it a slide note (`type: slide`), whatever engine its `slideOptions` name for a blog. */
export function isSlideNote(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.type === 'slide';
}
