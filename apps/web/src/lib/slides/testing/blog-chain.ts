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

/** `structure` is what the blog reads from the note's `slideOptions.structure`, given to both plugins. */
export function blogDeck(markdown: string, title?: string, structure?: string): DeckNode {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).use(remarkDeck, { structure: structure as never }).use(remarkRehype).use(rehypeDeck, { title, structure: structure as never });
  return processor.runSync(processor.parse(markdown)) as DeckNode;
}
