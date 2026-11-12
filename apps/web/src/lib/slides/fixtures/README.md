# Slide fixtures

Decks the parity tests build twice, once with a blog's chain (`remarkDeck` and `rehypeDeck` under unified, with `structure: "headings"`) and once with the MyGitNotes renderer, and compare. Both were written for MyGitNotes in contour-deck 0.3.0's headings mode, which every slide note is read by.

- `headings.md`: a title slide, a `####` kicker block, a `::block` without a title, an empty `---` group, a block holding only an HTML comment, a comment before a `##`, a heading-less block whose first slide holds only a `:::summary` and text, `###` pages and headings inside a quote and a list.
- `kicker-builds.md`: `####` kicker blocks, `:::build` lists, tables and other blocks, `:::summary`, a `::block` with every attribute, `::slide`, a `***` break, the MyGitNotes directives inside slides (grid, info, icon, math, mermaid) and directives inside fenced and indented code.
