Status: approved
Approved at: 2026-11-12
Approved from: the owner's answers to the decision form of the draft (2026-11-12), listed under Decisions.
Amended at: 2026-11-13, by the owner's decision 13: every slide note is read by its headings.

# Slide notes (contour-deck)

A note whose frontmatter has `type: slide` is a slide deck written in Markdown. The preview draws its slide directives the way [contour-deck](https://github.com/wayne930242/contour-deck) reads them, and the note plays as a contour-deck deck over the window: an outline of blocks, slides that reveal step by step, and the speaker notes. The note is read by its headings, as contour-deck 0.3.0's headings mode reads it: the outline of the deck is the outline of the Markdown. The same note built by a blog with `contour-deck/remark` and `contour-deck/rehype` given `structure: "headings"` splits into the same blocks, slides and pages.

## What a person sees

### In the preview of a slide note

The live editor, and every place a note is shown read-only (a note another pane edits, a compilation card, a Book section):

| Markdown | Drawn as |
| --- | --- |
| `---` (any thematic break at the top level) | The divider between blocks, labelled with the block that ends there: `Block 2` (`區塊 2`). In the live editor the end of the note carries the last block's number. |
| `##` (at the top level) | The heading, labelled in the live editor with the slide it starts: `Slide 3` (`投影片 3`). |
| `###` (at the top level) | The heading, labelled in the live editor with the page it starts within its slide: `Page 3.2` (`頁 3.2`). |
| `:::build` … `:::` | Its content as written, each step with a small number in the margin: every list item, every body row of a table, and any other block as a whole. |
| `:::summary` … `:::` | A box labelled `Notes` (`講稿`). |
| `::block{title="三、主要問題" minutes=5}` | A title bar with the block's label, its title and its minutes. Every attribute is optional: a block is titled by its first `#` or `####` heading unless `::block` names a title. |
| `::slide{#dilemma}` | Nothing in a read-only view. The live editor keeps its source as a quiet line, so the writer can reach it. |
| `::vertical` | An error box with contour-deck's message: start the next page with a `###` heading. The deck refuses the note. |
| A directive contour-deck refuses | An error box with contour-deck's message and the directive's source: a wrong form (`::summary`, `:::vertical`, `:slide` alone on a line), an attribute it does not know, an empty `::block` title, a `::slide` without an id, `minutes` that are no positive number. The rest of the note renders. |

The labels follow the language of the app. A directive inside a code block, fenced or indented, is code and draws nothing.

The numbering follows contour-deck 0.3.0's headings mode. A `---` always starts a block, a `##` a slide and a `###` a further page of the slide. Content before a block's first `##` is the block's first slide (a title slide or a divider), unless it is nothing but a `####` kicker and notes, which open the first `##` slide. A `###` right under its `##`, with nothing between them but notes, heads the slide's first page with it. A heading inside a quote, a list or a container is content. A `---` with nothing above it ends nothing and carries no label.

The note's `slideOptions.structure` is not read. A note that names `slides`, an empty value, a value contour-deck does not know, or nothing at all plays by its headings, and nothing reports the field. A blog does read it, and reads a note without it by its separators, so a note meant for a blog says `slideOptions.structure: headings`.

### Starting a slide note

The New note menu (新增筆記) offers **Slides** (`投影片`) after the notebook's own templates. It creates a note with `type: slide` and `slideOptions: { engine: contour, structure: headings }` (a blog needs both to play it as the app does) and a few lines that show the structure, in the language of the app: the note's title as a `#` heading, a `---` block with a `####` kicker title, a `##` slide with a `:::build` list and a `:::summary` box of notes, and a second `##` slide with a `###` second page. Its heading names the note, as a blank note's does.

In the live editor a `:::summary` or `:::build` block of a slide note has no format select and no title field, only Edit content, since it has no other format to change to. The source of a line returns while the caret is on it.

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
6. *Superseded by decision 13.* **The separators stay as contour-deck 0.2.2 reads them.** A heading-based structure (`---` a block, `##` a slide, `###` a page) is an opt-in feature of contour-deck 0.3.0 and a follow-up here, behind `slideOptions.structure: headings`.

The owner's answer of 2026-11-12 to Q7, how the heading-based structure is offered: "B. 標題式：--- 區塊、## 投影片、### 頁（可選模式，先改 contour-deck）".

12. *Superseded by decision 13 as to the opt-in.* **The heading-based structure is an opt-in mode, written in contour-deck first.** contour-deck 0.3.0 reads it (`structure: "headings"` for `remarkDeck` and `rehypeDeck`); a note asks for it with `slideOptions.structure: headings`, and the note's structure goes to `remarkDeck`, where each directive is validated, and to `rehypeDeck`, which builds the deck. The default stays the separators of decision 6.

Decisions taken while building it:

7. **contour-deck validates its own directives.** Each slide directive is handed to `remarkDeck` as the node remark-directive would have parsed (`containerDirective`, `leafDirective` or `textDirective`, with its attributes). What comes back is the marker element, or the message of the refusal, which the error box and the refusal screen show unchanged. `contour-deck/remark` is therefore part of the note renderer (about 2 KB); the core, the stylesheet, the rehype plugin and the hast utilities load on Play.
8. **A deck is never built from a note contour-deck would refuse.** The deck rendering throws where the preview draws an error box.
9. **The labels are a reading of the same rules, held to contour-deck by tests.** `HeadingStructureReader` (`apps/web/src/lib/slides/structure.ts`) is the one place that numbers blocks, slides and pages, and `buildSteps` names a build's steps, for the editor and for the rendered preview. The tests build every fixture deck with a blog's chain and compare.
10. **A directive inside a code block is code**, in every note, whether the block is fenced or indented. Before, the directive pass rewrote it and the code block showed HTML. A fence opened on a list item ends with the item, as Markdown ends it.
11. **A slide id the sanitizer drops refuses the deck.** DOMPurify removes an `id` that would shadow a property of the page (`title`, `body`); a deck that opened with another id in its place would differ from the blog's, so Play names the line instead.

The owner's decision of 2026-11-13, verbatim: "不用支援舊的切法，一律都用新切法" (no support for the old split; always use the new one).

13. **Every slide note is read by its headings.** The separators of decision 6 are gone: `remarkDeck` and `rehypeDeck` are always given `structure: "headings"`, `slideOptions.structure` is not read, and nothing reports a note that still names `slides`. The code that numbered slides by their separators (`SlideStructureReader`), its labels and its fixtures were removed; what that reading was is kept under [Superseded](#superseded-the-separators-before-0141).

The owner's decision of 2026-11-13 on templates, verbatim: "新增筆記選單加兩個投影片範本" (add two slide templates to the New note menu).

14. **One built-in template, Slides.** With one structure left, the two templates asked for are one. It is built into the app, not a file of the workspace, so every notebook offers it; see [Starting a slide note](#starting-a-slide-note).

## How the tests hold it

- `deck-parity.test.ts`: two decks written here (`fixtures/headings.md`: a title slide, a `####` kicker block, a `::block` without a title, an empty `---` group, `###` pages, headings inside a quote and a list; `fixtures/kicker-builds.md`: `:::build` lists and tables, `:::summary`, a `::block` with every attribute, `::slide`, a `***` break, the MyGitNotes directives inside slides, directives inside code) are built by a blog's chain (unified, remark-parse, remark-gfm, remark-directive, `remarkDeck`, remark-rehype, `rehypeDeck`, both given `structure: "headings"`) and by the MyGitNotes chain. The counts of blocks, slides, pages, steps and notes, the block titles, labels, minutes and kinds, the slide ids, the slide titles that come from a heading, and the steps and notes of every page must be equal.
- `structure.test.ts` and `slide-structure.test.ts`: the labels of the preview and of the editor give the blocks and the pages per slide `rehypeDeck` builds, on the same decks, and the preview marks as many steps.
- `slide-preview.test.ts`: every directive in a slide note and in another note, each error box (`::vertical` among them), and the refusals of the deck with their lines.
- `builtin-templates.test.ts`: the Slides template, in both languages, is built by the blog's chain and by the MyGitNotes chain as two blocks of three slides, the last of two pages; `useCreateNote.test.tsx` creates a note from it without asking the workspace.
- `SlideDeck.test.tsx`: Play and Notes for slide notes only, the refusal screen, and a note whose `slideOptions.structure` names nothing, `slides`, an empty value or an unknown value, which the editor and the deck read by its headings.

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
- The editor's labels read the headings from the Markdown, the deck from the rendered HTML. A heading written as raw HTML (`<h2>`) is seen only by the deck.
- A `::block{id="…"}` loses its id to the sanitizer without a word; only a `::slide` id that is dropped refuses the deck.
- Attribute values are read as written: a character reference (`kind="x&quot;y"`) stays literal where remark-directive decodes it, and a `}` inside a quoted value keeps the line from being read as a directive.
- A `:::` line inside a code fence inside a container is code here; remark-directive closes the container there, so a blog splits such a note differently.
- Raw HTML in a note can write contour-deck's markers itself (`data-ct-act`, `data-ct-go`, `data-ct-mark`, `data-ct-notes`), which the deck then reads: the author's own note can trigger deck actions or skip directive checks, with no script and nothing gained across users. Hardening, left for later: stamp the markers the renderer writes with a per-render token, and have the deck drop any `data-ct-*` without it.
- A slide without a heading is titled by the first 40 characters of its text. Where MyGitNotes draws a figure (an infographic, an argument map) that text is the figure's, so such a title can differ from the blog's.
- Figures drawn by the note's own styles (infographics, argument maps, handouts, stat cards) keep their document sizes in a slide; headings, lists, tables, code, grid cells and callouts follow the size of the stage.

## Superseded: the separators, before 0.14.1

From 0.14.0 to 0.14.1 a slide note was read by its separators unless its frontmatter said `slideOptions.structure: headings`, the default of contour-deck 0.2.2: a `---` started a slide, labelled `Slide 3` with the slide that ended there; a `::vertical` started a further page of the slide, drawn as a lighter, dashed divider labelled `Page 3.1`, unless the page after it carried `::block` or `::slide`, followed a `::block` that stood alone between two separators, or had a second-level heading that differed from the slide's own, in which case it started a slide; a `::block` needed a `title`; and a structure contour-deck did not know refused the note. Decision 13 removed this reading.
