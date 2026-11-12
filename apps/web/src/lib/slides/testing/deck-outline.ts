/** A deck (the HTML contract of contour-deck) read back as plain data, so two producers of one deck can be compared. Test-only. */
export interface DeckNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: DeckNode[];
}

export interface DeckOutline {
  title: unknown;
  blocks: { title: unknown; short: unknown; minutes: unknown; kind: unknown; slides: { id: unknown; title: unknown; /** Whether the title is a heading of the slide, not a snippet of its text. */ headed: boolean; pages: { steps: number; notes: number; }[]; }[]; }[];
}

const elements = (node: DeckNode): DeckNode[] => (node.children ?? []).filter(child => child.type === 'element');
const descendants = (node: DeckNode): DeckNode[] => (node.children ?? []).flatMap(child => [child, ...descendants(child)]);
const having = (node: DeckNode, property: string): DeckNode[] => descendants(node).filter(child => child.properties && property in child.properties);

/** The deck's blocks, slides and pages; throws when the nesting breaks the contract. */
export function deckOutline(root: DeckNode): DeckOutline {
  const decks = having(root, 'dataCtDeck');
  if (decks.length !== 1) throw new Error(`expected one deck, found ${decks.length}`);
  const only = (node: DeckNode, property: string) => {
    for (const child of elements(node)) if (!(property in (child.properties ?? {}))) throw new Error(`<${child.tagName}> where only ${property} may stand`);
  };
  only(decks[0], 'dataCtBlock');
  return {
    title: decks[0].properties?.dataTitle,
    blocks: elements(decks[0]).map(block => {
      only(block, 'dataCtSlide');
      const { dataTitle, dataShort, dataMinutes, dataKind } = block.properties ?? {};
      return {
        title: dataTitle,
        short: dataShort,
        minutes: dataMinutes === undefined ? undefined : String(dataMinutes),
        kind: dataKind,
        slides: elements(block).map(slide => {
          only(slide, 'dataCtPage');
          return { id: slide.properties?.id, title: slide.properties?.dataTitle, headed: descendants(slide).some(node => /^h[1-6]$/.test(node.tagName ?? '')), pages: elements(slide).map(page => ({ steps: having(page, 'dataCtStep').length, notes: elements(page).filter(child => 'dataCtNotes' in (child.properties ?? {})).length })) };
        }),
      };
    }),
  };
}

export function deckCounts(outline: DeckOutline): { blocks: number; slides: number; pages: number; steps: number; notes: number; } {
  const slides = outline.blocks.flatMap(block => block.slides), pages = slides.flatMap(slide => slide.pages);
  return { blocks: outline.blocks.length, slides: slides.length, pages: pages.length, steps: pages.reduce((sum, page) => sum + page.steps, 0), notes: pages.reduce((sum, page) => sum + page.notes, 0) };
}
