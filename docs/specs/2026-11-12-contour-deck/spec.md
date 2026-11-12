Status: approved
Approved at: 2026-11-12
Approved from: the owner's answers to the decision form of the draft (2026-11-12), listed under Decisions.

# Slide notes (contour-deck)

A note whose frontmatter has `type: slide` is a slide deck written in Markdown. The preview draws its slide directives the way [contour-deck](https://github.com/wayne930242/contour-deck) reads them, and the note plays as a contour-deck deck over the window: an outline of blocks, slides that reveal step by step, and the speaker notes. The same note built by a blog with `contour-deck/remark` and `contour-deck/rehype` splits into the same blocks, slides and pages.

## What a person sees

### In the preview of a slide note

The live editor, and every place a note is shown read-only (a note another pane edits, a compilation card, a Book section):

| Markdown | Drawn as |
| --- | --- |
| `---` (any thematic break at the top level) | The divider between slides, labelled with the slide that ends there: `Slide 3` (`投影片 3`), where another note says `Page 3`. In the live editor the end of the note carries the last slide's number. |
| `::vertical` | A lighter, dashed divider labelled with what ends there: `Page 3.1` (`頁 3.1`) when the next page belongs to the same slide, `Slide 3` when the page after it starts a slide of its own. |
| `:::build` … `:::` | Its content as written, each step with a small number in the margin: every list item, every body row of a table, and any other block as a whole. |
| `:::summary` … `:::` | A box labelled `Notes` (`講稿`). |
| `::block{title="三、主要問題" minutes=5}` | A title bar with the block's title and its minutes. |
| `::slide{#dilemma}` | Nothing in a read-only view. The live editor keeps its source as a quiet line, so the writer can reach it. |
| A directive contour-deck refuses | An error box with contour-deck's message and the directive's source: a wrong form (`::summary`, `:::vertical`, `:slide` alone on a line), an attribute it does not know, a `::block` without a `title`, a `::slide` without an id, `minutes` that are no positive number. The rest of the note renders. |

The labels follow the language of the app. A directive inside a fenced code block is code and draws nothing.

The numbering follows contour-deck 0.2.2. A `---` always starts a slide. What follows a `::vertical` is a further page of the slide, unless it starts a slide: it carries `::block` or `::slide`, follows a `::block` that stood alone between two separators, or has a second-level heading that differs from the slide's own. A separator with nothing above it ends nothing and carries no label.

In the live editor a `:::summary` or `:::build` block of a slide note has no format select and no title field, only Edit content, since it has no other format to change to. The source of a line returns while the caret is on it.

### In a slide note read by its headings

A slide note whose frontmatter has `slideOptions.structure: headings` is read by contour-deck's headings mode (contour-deck 0.3.0): the outline of the deck is the outline of the Markdown.

| Markdown | Drawn as |
| --- | --- |
| `---` (at the top level) | The divider between blocks, labelled with the block that ends there: `Block 2` (`區塊 2`). In the live editor the end of the note carries the last block's number. |
| `##` (at the top level) | The heading, labelled in the live editor with the slide it starts. Content before a block's first `##` is the block's first slide (a title slide or a divider). |
| `###` (at the top level) | The heading, labelled in the live editor with the page it starts within its slide. |
| `::vertical` | An error box with contour-deck's message: start the next page with a `###` heading. The deck refuses the note. |
| `::block{…}` | The block's title bar. Every attribute is optional: a block is titled by its first `#` or `####` heading unless `::block` names a title. |

A block, a slide and a page are what contour-deck's `rehypeDeck` builds from the same note with `structure: "headings"`. A heading inside a quote, a list or a container is content. A `structure` contour-deck does not know (`heading`) is refused with its message, so a typo does not fall back to the separators silently. `:::build`, `:::summary` and `::slide` read as in any slide note. A note without `slideOptions.structure`, or with `structure: slides`, reads as before.

### In any other note

Today's rendering stays: `---` is a page (`Page 1`), `::vertical` a gradient rule, `:::summary` a plain box, and a slide directive in the wrong form is not reported. Three things change, so that slide Markdown pasted into an ordinary note no longer shows as a generic box or as raw text: `:::build` shows its content as written (no `BUILD` box, no step numbers), and `::block` and `::slide` show nothing. In the live editor those two lines read as quiet chips of their source.

### Playing a deck

- The note's toolbar has **Play** (`播放`) and **Notes** (`講稿`) for every `type: slide` note, whatever `slideOptions.engine` names. On a phone they are the first two rows of the note's "⋯" sheet.
- Play opens the deck over the whole window, on the outline: one tile per block, one thumbnail per slide. Enter opens a slide; Space reveals the next step, then moves on; ↑ ↓ move by page, ← → by slide; N shows the notes panel; Esc returns to the outline, and Esc on the outline, or ✕, returns to the note with the focus on the button that opened the deck.
- Notes opens the speaker notes as a scrolling script, the view meant for a phone.
- A slide's content is drawn as the preview draws it (callouts, grids, icons, math, infographics, argument maps), and mermaid diagrams and PDF figures are drawn on the deck's own elements. The deck uses the app's palette, light or dark, and its interface text follows the app's language.
- The deck plays the note as it is in the editor when Play is pressed, saved or not.
- A note contour-deck refuses does not play: a screen says **These slides cannot be played**, with contour-deck's message and the line as the editor numbers it, and a button back to the note. A note without content says it has no slides yet.
- The address bar does not change. A link in a slide that opens another page of the app closes the deck.
- Nothing of the deck is downloaded until the first Play.

## Decisions

The owner's answers of 2026-11-12:

1. **The MyGitNotes renderer writes the slides, contour-deck splits them.** The note's own pipeline (marked, the MyGitNotes directives, DOMPurify) renders the HTML, with the slide directives as the marker elements `contour-deck/remark` writes. The sanitized DOM becomes hast (`hast-util-from-dom`), contour-deck's `rehypeDeck` builds the deck, the result becomes DOM again (`hast-util-to-dom`), and `createDeck` opens it. No splitting rule is written here. A second remark pipeline was rejected: the MyGitNotes directives would not draw in it and the deck would differ from the preview.
2. **Every `type: slide` note plays**, also one whose `slideOptions.engine` is `reveal` on the blog.
3. **The new preview is for slide notes only.** Other notes keep their rendering, except for `build`, `block` and `slide` as described above.
4. **The first version is the deck, the notes panel and the notes view.** No phone remote and no presenter window: `createDeck` gets no `remote` option, and `url: false`, since the app has its own router.
5. **Pro's public pages are a separate task.** The preview markup uses classes only, with no inline style and no data attribute but `data-type` and `data-label`, so a page under a stricter sanitizer can style the same markup.
6. **The separators stay as contour-deck 0.2.2 reads them.** A heading-based structure (`---` a block, `##` a slide, `###` a page) is an opt-in feature of contour-deck 0.3.0 and a follow-up here, behind `slideOptions.structure: headings`.

The owner's answer of 2026-11-12 to Q7, how the heading-based structure is offered: "B. 標題式：--- 區塊、## 投影片、### 頁（可選模式，先改 contour-deck）".

12. **The heading-based structure is an opt-in mode, written in contour-deck first.** contour-deck 0.3.0 reads it (`structure: "headings"` for `remarkDeck` and `rehypeDeck`); a note asks for it with `slideOptions.structure: headings`, and the note's structure goes to `remarkDeck`, where each directive is validated, and to `rehypeDeck`, which builds the deck. The default stays the separators of decision 6.

Decisions taken while building it:

7. **contour-deck validates its own directives.** Each slide directive is handed to `remarkDeck` as the node remark-directive would have parsed (`containerDirective`, `leafDirective` or `textDirective`, with its attributes). What comes back is the marker element, or the message of the refusal, which the error box and the refusal screen show unchanged. `contour-deck/remark` is therefore part of the note renderer (about 2 KB); the core, the stylesheet, the rehype plugin and the hast utilities load on Play.
8. **A deck is never built from a note contour-deck would refuse.** The deck rendering throws where the preview draws an error box.
9. **The labels are a reading of the same rules, held to contour-deck by tests.** `SlideStructureReader` (`apps/web/src/lib/slides/structure.ts`) is the one place that numbers slides and pages and names a build's steps, for the editor and for the rendered preview. The tests build every fixture deck with a blog's chain and compare.
10. **A directive inside a code block is code**, in every note, whether the block is fenced or indented. Before, the directive pass rewrote it and the code block showed HTML. A fence opened on a list item ends with the item, as Markdown ends it.
11. **A slide id the sanitizer drops refuses the deck.** DOMPurify removes an `id` that would shadow a property of the page (`title`, `body`); a deck that opened with another id in its place would differ from the blog's, so Play names the line instead.

## How the tests hold it

- `deck-parity.test.ts`: contour-deck's three fixture decks and two written here (`####` kicker blocks, `:::build` lists and tables, `::vertical` stacks, `:::summary`, `::block`, `::slide`, directives inside code) are built by a blog's chain (unified, remark-parse, remark-gfm, remark-directive, `remarkDeck`, remark-rehype, `rehypeDeck`) and by the MyGitNotes chain. The counts of blocks, slides, pages, steps and notes, the block titles, labels, minutes and kinds, the slide ids, the slide titles that come from a heading, and the steps and notes of every page must be equal.
- `structure.test.ts` and `slide-structure.test.ts`: the labels of the preview and of the editor give the pages per slide `rehypeDeck` builds, on the same decks, and the preview marks as many steps.
- `slide-preview.test.ts`: every directive in a slide note and in another note, each error box, and the refusals of the deck with their lines.
- Headings mode: `deck-parity.test.ts` builds `fixtures/headings.md` with the blog chain given `structure: "headings"` and with the MyGitNotes chain, with the same counts, block titles and slide titles; `structure.test.ts` and `slide-structure.test.ts` hold the block, slide and page labels to that deck, and `slide-preview.test.ts` the `::vertical` error box and refusal.
- `SlideDeck.test.tsx`: Play and Notes for slide notes only, and the refusal screen.

When contour-deck is upgraded, these run first.

## Out of scope

- contour-deck's phone remote, presenter window, laser pointer and drawing.
- Deep links to a slide (`?view=deck&at=…`).
- Pro's public pages: their styles for the new markup, and playing there.
- A toolbar entry that inserts slide directives.
- The Study view, which shows a note one `---` page at a time and keeps the general rendering.

## Known limits

- A slide directive written in the middle of a line of text (`see :slide here`) fails a blog build with remark-directive; here only a directive that stands alone on its line is read, so such a note plays.
- An unclosed `:::summary` or `:::build` runs to the end of its container on a blog; here it stays as written, like any unclosed block.
- The editor's labels read second-level headings from the Markdown, the deck from the rendered HTML. A heading written as raw HTML (`<h2>`) is seen only by the deck. The editor also compares a heading's source, not its text, so `## *A* \`b\`` and `## A b` are two slides to its labels and one slide of two pages to the deck.
- A `::block{id="…"}` loses its id to the sanitizer without a word; only a `::slide` id that is dropped refuses the deck.
- Attribute values are read as written: a character reference (`kind="x&quot;y"`) stays literal where remark-directive decodes it, and a `}` inside a quoted value keeps the line from being read as a directive.
- A `:::` line inside a code fence inside a container is code here; remark-directive closes the container there, so a blog splits such a note differently.
- An indented `::vertical` under a list item is a page break here; on a blog it is nested in the item and breaks nothing.
- Raw HTML in a note can write contour-deck's markers itself (`data-ct-act`, `data-ct-go`, `data-ct-mark`, `data-ct-notes`), which the deck then reads: the author's own note can trigger deck actions or skip directive checks, with no script and nothing gained across users. Hardening, left for later: stamp the markers the renderer writes with a per-render token, and have the deck drop any `data-ct-*` without it.
- A slide without a heading is titled by the first 40 characters of its text. Where MyGitNotes draws a figure (an infographic, an argument map) that text is the figure's, so such a title can differ from the blog's.
- Figures drawn by the note's own styles (infographics, argument maps, handouts, stat cards) keep their document sizes in a slide; headings, lists, tables, code, grid cells and callouts follow the size of the stage.
