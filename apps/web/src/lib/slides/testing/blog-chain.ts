/**
 * The chain a blog builds a contour-deck deck with (unified, remark-directive, `remarkDeck`, `rehypeDeck`): the reference the tests hold the
 * MyGitNotes chain to. Test-only: its packages are devDependencies.
 */
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { rehypeDeck } from 'contour-deck/rehype';
import { remarkDeck } from 'contour-deck/remark';
import type { DeckNode } from './deck-outline.js';

/** The deck a blog builds from a note whose frontmatter says `slideOptions.structure: headings`, the structure given to both plugins. */
export function blogDeck(markdown: string, title?: string): DeckNode {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).use(remarkDeck, { structure: 'headings' }).use(remarkRehype).use(rehypeDeck, { title, structure: 'headings' });
  return processor.runSync(processor.parse(markdown)) as DeckNode;
}
