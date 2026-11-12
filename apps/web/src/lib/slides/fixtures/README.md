# Slide fixtures

Decks the parity tests build twice, once with a blog's chain (`remarkDeck` and `rehypeDeck` under unified) and once with the MyGitNotes renderer, and compare.

- `kicker-deck.md`, `slide-templates-demo.md` and `you-dont-have-to-lead-climb-alone.md` are the fixture decks of [contour-deck](https://github.com/wayne930242/contour-deck) 0.2.2 (`tests/fixtures/`), unchanged. Copyright 洪偉, MPL-2.0.
- `kicker-builds.md` and `blocks.md` were written for MyGitNotes: `####` kicker blocks, `:::build` lists and tables, `::vertical` stacks, `:::summary`, `::block`, `::slide` and the MyGitNotes directives inside slides.
- `headings.md` was written for MyGitNotes too: a deck in contour-deck 0.3.0's headings mode (`slideOptions.structure: headings`), with a title slide, a `####` kicker block, a `::block` without a title, an empty `---` group, `###` pages and headings inside a quote and a list.
