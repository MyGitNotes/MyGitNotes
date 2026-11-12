/** Whether a note's frontmatter makes it a slide note (`type: slide`), whatever engine its `slideOptions` name for a blog. */
export function isSlideNote(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.type === 'slide';
}

/**
 * The structure contour-deck reads every slide note by, its headings mode: `---` starts a block, `##` a slide and `###` a page. A note's
 * `slideOptions.structure` is not read; a blog reads it, so a note meant for one says `structure: headings` there too.
 */
export const SLIDE_STRUCTURE = 'headings';
