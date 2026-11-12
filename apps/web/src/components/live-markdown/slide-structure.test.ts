// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { type DecorationSet, EditorView, type WidgetType } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { findDirectiveBlocks } from '../../lib/directive-editing.js';
import { en, type TranslationKey } from '../../lib/i18n/en.js';
import { blogDeck } from '../../lib/slides/testing/blog-chain.js';
import { deckOutline } from '../../lib/slides/testing/deck-outline.js';
import { FIXTURE_DECKS } from '../../lib/slides/testing/fixtures.js';
import { LiveMarkdownDirective } from '../LiveMarkdownDirective.js';
import { tableUIState } from '../LiveMarkdownTable.js';
import { chipEditState } from './chip-editing.js';
import { cjkEmphasis } from './cjk-emphasis.js';
import { liveDecorations } from './decorations.js';
import { editorSlideStructure, slideNote } from './slide-structure.js';
import { SlideDirectiveChip, SlideDirectiveLine } from './slide-widgets.js';
import { PageBreak, PageFooter } from './widgets.js';

const t = (key: TranslationKey, params?: Record<string, string | number>) => Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key] ?? key);
const decorations = StateField.define<DecorationSet>({ create: state => liveDecorations(state, true, 'slides/deck.md', 'link', 'table', 'Page', 'owner', t as never), update: (_value, tr) => liveDecorations(tr.state, true, 'slides/deck.md', 'link', 'table', 'Page', 'owner', t as never), provide: field => EditorView.decorations.from(field) });

const views: EditorView[] = [];
afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

/** The live editor on `doc`, as a slide note or any other; the cursor starts on the first line unless given. */
function editor(doc: string, slides: boolean, cursor = 0) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }), chipEditState, tableUIState, slideNote.of(slides), decorations] }) });
  views.push(view);
  // The first parse runs on a time budget; finish it and let the decorations recompute, as the editor does once its parser catches up.
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  return view;
}

/** The widgets the editor draws, in document order, each with the line it starts on. */
function widgets(view: EditorView): { line: number; widget: WidgetType; }[] {
  const found: { line: number; widget: WidgetType; }[] = [];
  view.state.field(decorations).between(0, view.state.doc.length, (from, _to, value) => {
    if (value.spec.widget) found.push({ line: view.state.doc.lineAt(from).number, widget: value.spec.widget as WidgetType });
  });
  return found;
}

/** A slide note: a title slide, a `---`, a `::block` and a `::slide` before the slide they name, a `:::build`, a `###` page and a directive in the wrong form. */
const DECK = '# Title\n\n---\n\n::block{title="One" minutes=5}\n\n::slide{#first}\n\n## A\n\n:::build\n- a\n- b\n:::\n\n### Second\n\nsecond page\n\n## B\n\n::summary\n';

/** The label each heading line carries, by line number. */
function headingLabels(view: EditorView): [number, string][] {
  const found: [number, string][] = [];
  view.state.field(decorations).between(0, view.state.doc.length, (from, _to, value) => {
    const label = (value.spec.attributes as Record<string, string> | undefined)?.['data-slide-label'];
    if (label) found.push([view.state.doc.lineAt(from).number, label]);
  });
  return found;
}

describe('the live editor on a type: slide note', () => {
  const HEADED = '# Title\n\n---\n\n#### Kicker\n\n## A\n\n### First\n\ntext\n\n### Second\n\n:::summary\n## not a heading\n:::\n\n::vertical\n\nSetext\n------\n\n- ## in a list\n\n---\n';

  it('labels each --- with the block that ends there, each ## with the slide and each ### with the page it heads', () => {
    const view = editor(HEADED, true);
    const drawn = widgets(view);
    expect(drawn.filter(({ widget }) => widget instanceof PageBreak).map(({ line, widget }) => [line, (widget as PageBreak).label])).toEqual([[3, 'Block 1'], [26, 'Block 2']]);
    // The kicker opens the first ## slide; the first ### heads its first page; a Setext ## starts a slide; a heading in a block or a list is content.
    expect(headingLabels(view)).toEqual([[7, 'Slide 2'], [9, 'Page 2.1'], [13, 'Page 2.2'], [21, 'Slide 3']]);
    // Nothing follows the last ---, so no block ends with the note.
    expect(drawn.filter(({ widget }) => widget instanceof PageFooter).map(({ widget }) => (widget as PageFooter).label)).toEqual(['']);
  });

  it('labels the end of the note with the last block', () => {
    const drawn = widgets(editor(DECK, true));
    expect(drawn.filter(({ widget }) => widget instanceof PageBreak).map(({ line, widget }) => [line, (widget as PageBreak).label])).toEqual([[3, 'Block 1']]);
    expect(drawn.filter(({ widget }) => widget instanceof PageFooter).map(({ widget }) => (widget as PageFooter).label)).toEqual(['Block 2']);
  });

  it('starts a block at every thematic break, not only at ---', () => {
    const drawn = widgets(editor('## one\n\n***\n\n## two\n\n___\n\n## three', true));
    expect(drawn.filter(({ widget }) => widget instanceof PageBreak).map(({ widget }) => (widget as PageBreak).label)).toEqual(['Block 1', 'Block 2']);
  });

  it('draws ::vertical as the error contour-deck reports, not as a page divider', () => {
    const view = editor(HEADED, true);
    const line = widgets(view).find(({ widget }) => widget instanceof SlideDirectiveLine)!;
    expect(line.line).toBe(19);
    expect(line.widget.toDOM(view).querySelector('.slide-error .ig-error-message')?.textContent).toBe('::vertical has no meaning with structure: "headings": start the next page with a ### heading');
  });

  it('draws a ::block as its title bar, an error box for a directive in the wrong form, and a ::slide as a quiet line of its source', () => {
    const view = editor(DECK, true);
    const lines = widgets(view).filter(({ widget }) => widget instanceof SlideDirectiveLine).map(({ line, widget }) => ({ line, dom: widget.toDOM(view) }));
    expect(lines.map(({ line }) => line)).toEqual([5, 7, 22]);
    expect(lines[0].dom.querySelector('.slide-block-name')?.textContent).toBe('One');
    expect(lines[1].dom.classList.contains('live-md-slide-quiet')).toBe(true);
    expect(lines[1].dom.textContent).toBe('::slide{#first}');
    expect(lines[2].dom.querySelector('.slide-error .ig-error-message')?.textContent).toBe('summary is a container directive: write :::summary … :::');
  });

  it('draws :::vertical, :::block and :::slide as the error contour-deck reports, and reads the blocks after them', () => {
    const doc = '## A\n\n:::vertical\n\n## A\n\n:::summary\nnotes\n:::\n\n:::block{title="B"}\n\n:::slide\n\n:::build\n- a\n- b\n:::\n';
    const view = editor(doc, true);
    const drawn = widgets(view);
    const lines = drawn.filter(({ widget }) => widget instanceof SlideDirectiveLine);
    expect(lines.map(({ line }) => line)).toEqual([3, 11, 13]);
    for (const { widget } of lines) expect(widget.toDOM(view).querySelector('.slide-error .ig-error-message')).not.toBeNull();
    expect(drawn.filter(({ widget }) => widget instanceof LiveMarkdownDirective).map(({ line }) => line)).toEqual([7, 15]);
  });

  it('reads no slide directive in an indented code block', () => {
    const view = editor('## A\n\ntext\n\n    :::vertical\n\n    ::summary\n', true);
    expect(widgets(view).filter(({ widget }) => widget instanceof SlideDirectiveLine)).toEqual([]);
  });

  it('shows the source of a slide directive line while the cursor is on it', () => {
    const view = editor(DECK, true, DECK.indexOf('::slide'));
    expect(widgets(view).filter(({ widget }) => widget instanceof SlideDirectiveLine).map(({ line }) => line)).toEqual([5, 22]);
  });

  it('draws a build as the preview does, with its steps marked, and offers it no other format or title', () => {
    const view = editor(DECK, true);
    const build = widgets(view).find(({ widget }) => widget instanceof LiveMarkdownDirective)!.widget.toDOM(view);
    expect(build.querySelectorAll('.slide-build-step')).toHaveLength(2);
    expect(build.querySelector('.live-directive-type-select, .live-directive-title-input')).toBeNull();
    expect(build.querySelector('.live-directive-edit-btn')).not.toBeNull();
  });

  it.each(FIXTURE_DECKS)('%s reads the blocks, slides and pages contour-deck builds', (_name, body, title) => {
    const view = editor(body, true);
    const read = editorSlideStructure(view.state, findDirectiveBlocks(body, true));
    const deck = deckOutline(blogDeck(body, title));
    expect(read.pages).toEqual(deck.blocks.flatMap(block => block.slides.map(slide => slide.pages.length)));
    expect([...read.blocks.values(), read.end].filter(block => block !== undefined)).toEqual(deck.blocks.map((_block, index) => index + 1));
  });
});

/** An ordinary note holding slide directives. */
const NOTE = '# Title\n\n---\n\n::block{title="One" minutes=5}\n\n::slide{#first}\n\n## A\n\n:::build\n- a\n- b\n:::\n\n::vertical\n\n## B\n';

describe('the live editor on a note that is no deck', () => {
  it('numbers pages at --- as before, labels no heading and leaves ::vertical as its source', () => {
    const view = editor(NOTE, false);
    const drawn = widgets(view);
    expect(drawn.filter(({ widget }) => widget instanceof PageBreak).map(({ widget }) => (widget as PageBreak).label)).toEqual(['Page 1']);
    expect(drawn.filter(({ widget }) => widget instanceof PageFooter).map(({ widget }) => (widget as PageFooter).label)).toEqual(['Page 2']);
    expect(drawn.some(({ widget }) => widget instanceof SlideDirectiveLine)).toBe(false);
    expect(headingLabels(view)).toEqual([]);
  });

  it('draws ::block and ::slide, which show nothing there, as quiet chips of their source', () => {
    const view = editor(NOTE, false);
    expect(widgets(view).filter(({ widget }) => widget instanceof SlideDirectiveChip).map(({ line, widget }) => [line, widget.toDOM(view).textContent])).toEqual([[5, '::block{title="One" minutes=5}'], [7, '::slide{#first}']]);
  });

  it("draws a build as its content and keeps the block toolbar, with the block's own type selected", () => {
    const view = editor(NOTE, false);
    const build = widgets(view).find(({ widget }) => widget instanceof LiveMarkdownDirective)!.widget.toDOM(view);
    expect(build.querySelector('.slide-build-step, .generic-directive')).toBeNull();
    expect([...build.querySelectorAll('.slide-build li')].map(item => item.textContent)).toEqual(['a', 'b']);
    expect(build.querySelector<HTMLSelectElement>('.live-directive-type-select')?.value).toBe('build');
  });
});
