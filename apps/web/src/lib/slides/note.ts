/** Whether a note's frontmatter makes it a slide note (`type: slide`), whatever engine its `slideOptions` name for a blog. */
export function isSlideNote(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.type === 'slide';
}

/** The structure a slide note has when its frontmatter names none: `---` starts a slide and `::vertical` a page. */
export const DEFAULT_SLIDE_STRUCTURE = 'slides';

/** contour-deck's headings mode: `---` starts a block, `##` a slide and `###` a page. */
export const HEADINGS_SLIDE_STRUCTURE = 'headings';

/**
 * The structure a slide note's frontmatter asks for (`slideOptions.structure`), as text: `slides` when it names none, and undefined for a
 * note that is no slide note. Which names there are is contour-deck's to say; a value it does not know is handed on as written, so the
 * note is refused with contour-deck's own message instead of being read by the default silently.
 */
export function slideStructureOf(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!isSlideNote(metadata)) return undefined;
  const options = metadata?.slideOptions;
  const structure = options && typeof options === 'object' ? (options as Record<string, unknown>).structure : undefined;
  if (structure === undefined || structure === null) return DEFAULT_SLIDE_STRUCTURE;
  return typeof structure === 'string' ? structure : JSON.stringify(structure);
}

/** Whether a slide note of this structure is read by its headings. */
export function readsByHeadings(structure: string | undefined): boolean {
  return structure === HEADINGS_SLIDE_STRUCTURE;
}
