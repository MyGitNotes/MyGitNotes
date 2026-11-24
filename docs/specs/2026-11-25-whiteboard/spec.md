Status: proposed
Proposed at: 2026-11-25
Design: the approved frames `03-whiteboard.png` and `04-whiteboard-card-open.png` of the 2026-11-24 board-and-graph proposal (看板與關聯圖重新設計).
Approved from: the owner's answers to that proposal's decision form, listed under [Owner decisions](#owner-decisions). The owner answered the [open questions](#open-questions) on 2026-11-25.

# Whiteboard (白板) replaces the graph (關聯圖)

A compilation gets a fourth arrangement beside the lane (河道) and the book (書本): the **whiteboard**. Cards sit where the person put them, sections group them, drawn arrows with optional labels connect them, and free text annotates the board. It replaces today's graph arrangement, and the top bar's 關聯圖 page becomes a 白板 page that lists the notebook's whiteboards. The force-directed graph page is removed; links written inside notes survive only as an aid on a board: dashed lines between cards, a filter in the note drawer, and 「＋N 相連」 to pull linked notes onto the board.

Words: in this spec *section* always means a board's 區塊, never the 節 of a book chapter; the *side panel* is the 白板筆記欄; *board link* never appears, because an *arrow* (箭頭) is drawn and a *note link* (筆記內連結) is written in a note. `docs/CONTEXT.md` has the glossary entries.

A board is a compilation, so it adds no file kind. A **section** (區塊) is a chapter (章, a `kind: heading` item): the same compilation read as a book shows its sections as chapters. Positions, section rectangles, arrows and text live in the compilation file; notes are never edited by arranging a board.

## Owner decisions

From the decision form of the 2026-11-24 proposal, verbatim choices:

1. **The graph page** — 「改成白板，自動連結圖退成輔助」: the top bar's 關聯圖 becomes 白板, listing the notebook's whiteboards; note-to-note links show only as dashed lines on a board (toggle 顯示筆記內連結) and through 「＋N 相連」; the force-graph page is removed.
2. **Where arrows live** — 「存在合輯檔，不動筆記」: drawn arrows and their labels are written to `*.compilation.yml` with the card positions.
3. **Phones** — 「手機只能看、不能排」: pan, zoom and tap to open; no dragging or drawing.

Given with the brief, and drawn in the approved frames: the whiteboard is a fourth arrangement of a compilation; a section is the compilation's chapter; a card always shows its title and first two lines, and zoomed out its title only, never an unlabeled dot; card text never scales below readability; the left 筆記庫 drawer has search and the chips 「不在這塊白板」 and 「連到選取的卡片」, and dropping a note on the board adds it to the compilation; a click on a card opens the note in a right side panel, editable in place, that lists 「在 N 塊白板上」 with a jump to each; free text on the board; the minimap stays; the tools are 選取、卡片、文字、區塊、箭頭.

## What a person sees

### The 白板 page

- The top bar's page switch reads 筆記、白板、檔案、設定. 白板 (route `/boards`) lists the current notebook's whiteboards as tiles: title, description, card and section counts, last edit. 「新增白板」 creates an empty custom compilation `arrangement: board` named 未命名白板 at the notebook root (the path rule of 新增合輯) and opens it. A read-only notebook has no 新增白板.
- Which compilations the list holds is [open question 2](#open-questions), answered: every compilation of the notebook whose `arrangement` is `board` or whose file carries a `board` section.
- Opening a tile shows the board full-window (`/boards?notebook=<key>&board=<repository path>`): the 筆記庫 drawer on the left (collapsible to a strip), the board, and the side panel on the right when a card is open. The header row holds the breadcrumb 「白板 / <title>」, the arrangement switch (書本・河道・白板), the tools, 「顯示筆記內連結」 and the zoom control (`− 85% +`). The board page always draws the board arrangement.
- Old addresses keep working: `/graph` and the Notes page's legacy `view=graph` redirect to `/boards?notebook=<key>` (replace); `/graph?lanes=<id>` opens that compilation's board when it is one, otherwise the compilation in zoom on the Notes page. The palette command 前往關聯圖 becomes 前往白板.

### The board

- **Cards.** Every content item is a card of one size (240 × 128 board units; one unit is one CSS pixel at 100%). A note card shows its status dot, title and the first two lines of its body (the excerpt a lane card reads); a heading-anchored item shows its note title and the heading. A folder item shows the folder title and its note count, an asset its thumbnail and name, a YouTube item its thumbnail and title; each opens as it opens in a lane. A path in no notebook shows as 找不到, as in a lane. A card of another notebook carries that notebook's mark (`NotebookMark`) in its corner.
- **Zoom keeps text readable.** The zoom runs from 25% to 200%; a board opens fitted to its content, clamped to 60%–100%, unless this device has a saved camera for it. While body text would render at 11 CSS px or more, cards show title and two lines; below that they show the title only, counter-scaled so it never renders under 12 CSS px, wrapped to at most three lines inside the card and ended with an ellipsis. Section titles never render under 13 CSS px; arrow labels hide once they would render under 10 CSS px. Free text scales with the board.
- **Sections (區塊).** A section is a titled rounded rectangle holding the cards of its chapter. Moving a section moves its cards. A card whose stored position lies outside its section's rectangle is still drawn where it is stored and the section is drawn grown to include it (the stored rectangle changes only when the person resizes). Sections do not nest.
- **Arrows (箭頭).** A solid curved line from one element to another (card, section or text), with an arrowhead at the target and an optional label on the line (「提出」「挑戰」「回應」「需要」 in the frames). Labels are free text; the label field suggests the labels already used on this board. Arrows route between the nearest sides of their ends; there are no bend points.
- **Text (文字).** Free text placed on the board, plain text with line breaks, in the board's text colour or one of the eight palette colours a status takes.
- **Links inside notes.** With 「顯示筆記內連結」 on (the default, kept per device), a dashed line joins two cards whose notes link to each other in either direction, one line per pair, drawn under the arrows. The links come from the note graph the server already builds (`/api/notes/graph`): Markdown and wiki links among the notes of one repository.
- **「＋N 相連」.** When one note card is selected, a badge on its corner counts the notes it links to or is linked from that are not on this board (same repository, not hidden). Pressing it lists them with check boxes; 「加入」 adds the checked ones as items of the card's chapter and places them in a column to the right of the card, clear of other cards. A dynamic board shows no badge (it cannot add items).
- **Minimap.** Bottom right on wider screens: the board's elements in outline and the viewport frame; a click or drag moves the viewport. The zoom control's ↺ fits the content.
- **Tools.** 選取 (default), 卡片, 文字, 區塊, 箭頭; the tool returns to 選取 after one use unless it was double-clicked. Editing needs a writable notebook and a screen wider than a phone.
  - 選取: click selects, Shift or Mod adds, a drag on empty board frames a box selection, a drag on a card or section moves the selection, Delete removes the selection from the board.
  - 卡片: a click on the board creates a note and places it there (see [Creating a note from the board](#creating-a-note-from-the-board)).
  - 文字: a click places a text box and starts typing; an empty text box disappears when left.
  - 區塊: dragging a rectangle creates a section titled 新區塊 with its title selected for typing; the cards whose centres lie inside join it.
  - 箭頭: drag from one element onto another; release over empty board cancels. The new arrow's label field opens; Enter or leaving it keeps the arrow with or without a label.
- **Undo.** Mod+Z and Mod+Shift+Z (Mod+Y) undo and redo the board's edits of this visit; each gesture is one step.
- Pan: drag empty board with the middle button, Space+drag, or two fingers on a trackpad; scrolling pans; Mod+wheel or pinch zooms around the pointer.

### Removing from a board

Delete on a selected card removes the item from the compilation (the note stays). On a section it asks 「刪除區塊？卡片會留在白板上。」: the heading item goes, and its items move ahead of the first heading, so they are no longer in any chapter (in the book each becomes a chapter of its own, as items before the first heading already do). On a text or arrow it removes that element. Every removal also removes the arrows that end on what was removed, in the same write.

### The 筆記庫 drawer

Only on the 白板 page and only for a writable board. It lists the notes of the board's notebook (a notebook menu at its top offers the other notebooks of the same repository), with the note search of the Notes page and two chips:

- 「不在這塊白板」: only notes that are not members of this board.
- 「連到選取的卡片」: only notes linked to or from the selected cards (the note graph again).

A row carries 「N 塊白板」 when the note is on other boards. Dragging a row onto the board adds the note to the compilation at the drop point, in the chapter of the section it lands in (none outside every section). Each row also has 「加到白板」 for keyboard and touch, which places the note at the viewport's centre, in the selected section if one is selected. A note already on the board is not added again; its row's action becomes 「在白板上找」, which centres and selects its card. A custom compilation at its item limit refuses the drop with the limit's message.

On a **dynamic** board the drawer is a finder only: rows cannot be dragged and have no 「加到白板」; its foot says 「這塊白板的卡片來自標籤 X／資料夾 Y，加入筆記請改標籤或搬到資料夾。」.

### The side panel

A click on a card (Enter on a focused card) opens the note in the side panel on the right of the board, which shows the note with the same hosted editor a Focus pane uses (`HostedNoteEditor`, frame `pane`): the same drafts, saving, live checkout and collab-first behaviour, editable in place. The panel's head has the note's path, 「開進 Focus」 (adds the note as a tab of the active pane of the notebook's current Focus and goes to the Notes page), 「全螢幕」 (zoom) and ✕. Under the title it lists 「在 N 塊白板上：<title>・<title>」; each title opens that board with the note's card centred and selected (`&card=<key>`). The panel is resizable by its divider (width kept per device); while it is open the drawer folds to its strip, as in frame 04. Opening a card pushes a history entry (`&note=<repository path>`); Back closes the panel. Switching cards saves the shown editor first, as switching Focus tabs does.

A card of another notebook opens in the panel as well; its 「開進 Focus」 is disabled (「只能開進這本筆記本的 Focus」), since a Focus belongs to one notebook. A folder, asset or YouTube card opens as in a lane, not in the panel.

### Boards elsewhere

- **In the Notes page.** A compilation opened in zoom or a Focus pane with the 白板 arrangement shows the same board (tools, editing, minimap), without the drawer. In zoom a card opens in the side panel inside the zoom; in a Focus pane a card opens in another pane, splitting a single pane (the Focus rule for compilation cards), and a card of another notebook opens in zoom.
- **The arrangement switch** everywhere offers 白板 where it offered 關聯圖. Switching arrangement keeps the board data in the file, as the lane size is kept while a compilation is a book, so switching back restores the board.
- **Book and lane** ignore positions, text and arrows; a section still reads as a chapter there, and reordering chapters or items in the book or lane does not move anything on the board.
- **Read-only** (no write access, a reader of a hosted repository, a demo visitor before the demo's own editing): the board draws, pans, zooms and opens cards; no tools, no drawer drags, no 「＋N 相連」.

### Phones

On a phone (`usePhone`, 767 px or less) a board is for looking: one finger pans, two fingers pinch-zoom, a tap on a card opens the note on the phone's note screen (reading first, as every note on a phone), Back returns to the board at the same camera. No tools, drawer, minimap, selection, dragging or drawing; the arrangement switch is not shown. The 白板 page's list works as on wider screens, without 新增白板.

### Keyboard and accessibility

- The board is a region labelled with the compilation's title. Cards are buttons in DOM order of the item list, inside one `role="group"` per section labelled with the section's title, so Tab and a screen reader follow the book order; free text follows, then arrows.
- A focused card announces its title, status, section and its arrows (「提出 → 依據關係的因果條件」) through `aria-describedby`. Enter opens it in the side panel; Space toggles its selection; arrow keys move the selection 8 units (Shift 40) and write once when the keys stop; Delete removes as above; Escape clears the selection, then leaves a tool.
- 「連到…」 on a selected element's context menu (also Mod+Shift+L) opens a picker of the board's elements: the keyboard way to draw an arrow. 「加到白板」 in the drawer is the keyboard way to drop a note. Section and text titles are edited with Enter or F2.
- The minimap is hidden from assistive technology; the zoom control and ↺ are its alternative. Focus rings show on every focusable element; touch targets are at least 44 px; reduced motion turns off the camera animation.
- Colour never carries meaning alone: an arrow's label is text, a dashed note link is also listed among the card's description (「筆記內連到：…」).

## File format

### Example

```yaml
version: 1
id: chapter-3
title: 第三章：德性與依據
arrangement: board
items:
  - id: h1
    kind: heading
    title: 一、問題
  - id: n1
    kind: note
    path: notes/thesis/第三章導論.md
  - id: n2
    kind: note
    path: notes/thesis/依據關係的因果條件.md
  - id: h2
    kind: heading
    title: 二、德性知識論
  - id: n3
    kind: note
    path: notes/thesis/德性與能力的區分.md
board:
  sections:
    - { item: h1, x: 0, y: 0, w: 288, h: 384 }
    - { item: h2, x: 336, y: 0, w: 560, h: 384 }
  cards:
    - { item: n1, x: 24, y: 56 }
    - { item: n2, x: 24, y: 216 }
    - { item: n3, x: 360, y: 56 }
  texts:
    - { id: t8k2m, x: 960, y: 240, w: 200, text: "口試前要定案：\n德性是否必要？", color: teal }
  arrows:
    - { id: a3f9q, from: { item: n1 }, to: { item: n2 }, label: 提出 }
    - { id: b7c1z, from: { item: n2 }, to: { item: n3 }, label: 需要 }
```

### Fields

`arrangement` takes `board`. `board` is optional; without it every card is auto-placed.

| Field | Shape | Rules |
| --- | --- | --- |
| `board.cards[]` | `{ item, x, y }` (custom) or `{ path, x, y }` (dynamic) | Top-left corner of the card in board units. Custom: `item` names a content item (not a heading), at most one entry per item. Dynamic: `path` names a member by repository path; an entry whose path is not a member now is kept and not drawn. |
| `board.sections[]` | `{ item, x, y, w, h }` (custom) or `{ folder, x, y }` (dynamic with `group: folder`) | Custom: `item` names a heading item, at most one entry per heading; `w` ≥ 288, `h` ≥ 176. Dynamic: `folder` names a folder chapter; its size is always derived from its cards, so only the position is stored. |
| `board.texts[]` | `{ id, x, y, w?, text, color? }` | `id` as an item id, unique among texts; `w` 80–1200 (default 240); `text` 1–2000 characters; `color` one of `green blue amber red purple teal pink gray`. |
| `board.arrows[]` | `{ id, from, to, label? }` | `id` unique among arrows. `from` and `to` are each `{ item: <id> }` (custom: a content or heading item), `{ path: <repository path> }` (dynamic: a member) or `{ text: <id> }`; `from` ≠ `to`. `label` 1–60 characters. |

- Coordinates are integers from −1,000,000 to 1,000,000; the app rounds before writing.
- Limits: 2,000 cards (a dynamic compilation's `manualOrder` cap), `COMPILATION_MAX_HEADINGS` sections, 300 texts, 600 arrows; the file keeps its 512 KiB cap.
- Text and arrow ids are eight random characters of `[a-z0-9]`, so a line stays short.
- `board` is valid on any arrangement and kept when the arrangement changes.

### Validation

`parseCompilation` checks `board` with the rest of the file and a violation makes the file invalid with the field named, as any schema error does today (the view shows 「無法讀取這個合輯檔案」 with the reason, and nothing is overwritten): a custom entry with `path` or `folder`, a dynamic entry with `item`, a `folder` section without `group: folder`, an `item` that names no item of the right kind, a duplicate, a `text` endpoint naming no text, an arrow from an element to itself, a value out of range. Path endpoints and dynamic card paths are not checked against membership, which changes as notes are tagged and moved.

### Writing

- `serializeCompilation` writes `board` after the known fields it writes today and before any external field, with each entry of `cards`, `sections`, `texts` and `arrows` as a one-line flow mapping (as in the example). Moving a card changes one line, adding an arrow adds one; items and other fields keep today's block style.
- `compilationFile(row)` is the one place a row becomes a file, and it drops, for a custom compilation, every card, section and arrow end that names an item the row no longer has (and every arrow with such an end). So every way the app removes an item (the board, the lane's remove, the arrange dialog, moving an item to another compilation) also removes its board data, and a hand-written dangling reference is an error rather than a silent repair.
- The listing metadata (`compilationFields`) gains `board: { cards, sections, texts, arrows }` counts when the file has a `board` section, beside `arrangement`.

### Auto-placement

An item or member without a stored position is placed when the board is drawn, deterministically from the compilation's order, and the position is not written until the person moves that card (opening a board never writes):

- In a section: left to right in rows of the section's inner width (24-unit gaps, below a 48-unit title band), after the section's stored cards; the section is drawn grown downward if they do not fit.
- Outside every section: in a column grid to the right of the board's content, top first.
- A section with no stored rectangle: in a row of sections below the content, sized to hold its cards.

### Reading older files

- `arrangement: graph` is read as `board`, as `stack` is read as `book`. The app never writes `graph` again.
- A `graph:` layout (`graph.nodes[]`, centre coordinates keyed by path) is read when the file has no `board`: each node's centre becomes the top-left corner of a card centred there, and the existing overlap resolver (`arrangeGraphLayout`, moved from `lib/graph-layout.ts` into the board's placement module) separates the cards. Nodes match cards by path (custom items by their path, dynamic members by theirs). The next write of the compilation writes `board` from what is shown and drops `graph`; if a file has both, `board` wins.
- No `migrate-workspace` step and no schema version bump: the change is local to compilation files, a read-time upgrade covers the old shape, and the old shape exists today only in the shipped examples (`examples/demo-workspace/notes/example/graph-playground.compilation.yml` and the two `concept-map.compilation.yml` of the demo scenarios), which slice 7 rewrites. None of the owner's own workspaces has a graph-arranged compilation (checked 2026-11-25: 90 compilation files, 6 graph-arranged, all of them those examples and scratch copies of them).

### Older readers

- **A Core without the board reader** (every release up to 0.40.x) refuses `arrangement: board` (`arrangement: Invalid enum value`), so such a compilation shows as invalid there; nothing is lost or overwritten. Its note and folder moves still rewrite `items`, `source` and `manualOrder`, but not the `board` paths of a dynamic board, which then point at the old path until a newer Core moves the note again. This is why [the rollout](#rollout) ships the reader first.
- **A Core with the reader but before the board UI** (slice 1) opens a board as its current graph lane and keeps the `board` section through its own edits, because `board` is a known field from slice 1 on.
- **Other tools** that read compilation files (a blog reading `items` and `translationKey`) see one more top-level key and the `arrangement` value `board`.

## Chapters, sections and order

- A custom compilation's sections are its heading items; creating, renaming and deleting a section creates, retitles and removes a heading item, so the book follows at once.
- Creating a section from a dragged rectangle inserts its heading at the end of `items` and moves the items whose cards' centres lie inside into that chapter, in their current relative order (`addToChapter` per item).
- Dropping a card into another section moves its item to the end of that chapter; dropping it outside every section moves it ahead of the first heading; moving it within its section changes only its position. Positions never reorder items within a chapter: the book's order inside a chapter is the list's, edited in the book or the arrange dialog.
- A compilation with no headings has no sections; its cards sit free on the board.

## Dynamic compilations

A dynamic compilation (`source: tag | folder`) is a board too; its members are the query's.

- Cards are keyed by path (`{ path, x, y }`), since members have no item ids.
- Without `group`, there are no sections. With `group: folder`, each folder chapter is a section whose title is the chapter's and whose size follows its cards; it can be moved, not resized, renamed or deleted, and a card dropped outside its folder's section returns to where it was, with 「動態白板的區塊由資料夾決定；要換區塊請搬移筆記。」. The 區塊 tool is disabled with that hint.
- 卡片 starts a note in the source's folder or with its tag (the `onCreateNote` a dynamic lane already offers); the new member is auto-placed once it appears.
- Arrows and text work as on a custom board; an arrow to a member that leaves the query is kept and not drawn, so a note that comes back (a tag restored, a status unhidden) gets its place and arrows back. The board's ⋯ menu offers 「清除 N 個不在白板上的位置與箭頭」 when there are any.
- The drawer cannot add (above), and 「＋N 相連」 is not offered.

## Items from other notebooks

A custom compilation may hold items from any notebook of its repository (unchanged). On a board all of them are cards (today's graph draws only the compilation's own notebook and says how many it hides; that notice goes): they carry their notebook's mark, open in the side panel, and their 「開進 Focus」 is disabled. A dynamic folder source in another notebook gives cards of that notebook in the same way.

## Creating a note from the board

The 卡片 tool on a custom board creates a note the way the New note action creates a blank one (`UNTITLED_STEM` at the notebook root, the notebook's initial status), adds it as an item at the click position in the section clicked (none outside), and opens it in the side panel with its title selected. In a repository whose new notes start as pending live notes (a live editor, collab-first included) the note would have no Git path until its first check-in, which the item could not follow, so 卡片 is disabled there with 「這個儲存庫的新筆記要簽回後才有路徑；先在筆記頁建立，再從筆記庫拖上白板。」.

## Moves, renames, deletions and copies

- **Moving or renaming a note or folder.** `relocateCompilation` (run by the file manager's move plans, the folder planner and live check-ins that move a note) also rewrites `board.cards[].path`, `board.sections[].folder` and every `{ path }` arrow end. Custom cards and arrows name item ids, so they need nothing: the item's own `path` is already rewritten.
- **Deleting a note.** A custom item stays and its card shows 找不到 (as in a lane) with its arrows; removing the card removes both. A dynamic member simply leaves the query (see above).
- **Copying a compilation** (`copyCompilation`) gives the items fresh ids; it maps every `item` reference in `board` through the same old-to-new ids, so the copy's board matches the original's. Text and arrow ids are kept.
- **Moving an item to another compilation** (`moveCompilationItem`, lane drag between compilations) removes its board data in the source through `compilationFile`; the target auto-places it.
- **A heading moved in the book or arrange dialog** keeps its section rectangle; the items that now fall in its chapter are drawn in it, the section growing to include them where they are.

## Saving and concurrent edits

- Board edits go through the compilation controller every compilation view uses (`useCompilation`/`useCompilations`): `change` keeps the row pending, the file is written after 350 ms of quiet, and pending edits are flushed before the view unmounts. A drag writes once on release; a keyboard nudge run writes once when the keys stop.
- **Local mode.** The file is written to the worktree, uncommitted, as today. A write from elsewhere (the Pi agent, MCP, an editor) while a board edit is pending is overwritten by that edit, the limit every compilation view has today.
- **Hosted (remote) mode.** Edits are browser drafts of the compilation file, committed from Changes like a note. When the file moved on the remote since the draft's base, today's commit merges the draft line by line (`mergeNote`, diff3); two people moving cards on adjacent lines conflict there (node-diff3 reports a conflict for changes on neighbouring lines; checked 2026-11-25). Slice 4 replaces the merge for compilation files with a merge by entry: base, draft and remote are parsed, and the fields, items (by id), board entries (cards by item or path, sections by item or folder, texts and arrows by id) and external fields are merged with `mergeValue`'s rule (one side changed it: that side; both changed it the same: that; both differently: conflict). The result is written in the normal order. A conflict blocks the draft as today; an invalid file on either side falls back to the line merge.
- **Live editing.** Compilation files are never checked out to a live editor (they keep the direct editor, `live-routes.ts`), so a board has no real-time co-presence: two people see each other's board edits after a commit and a refresh. Notes opened from a board in the side panel are live-edited as in a Focus pane.

## MCP and API

Compilations are exposed only as files: MCP `read_note` returns the YAML, `save_note` writes it, `list_notes` lists it with its metadata. Nothing new is added:

- The listing metadata carries `arrangement: board` and the `board` counts.
- `docs/agent/mcp/index.md` documents the `board` section (fields, one-line entries, ids, the validation above), so an agent can lay out or read a board by writing the YAML. An agent's save is checked by the same `parseCompilation` when the app reads it; an invalid board shows as an invalid file with the reason.
- No server route changes: the board reads `/api/notes/query` and `/api/notes/lookup` for its cards and `/api/notes/graph` for note links, all existing. The Pro edition needs only the community bump; its marketing site's mentions of 關聯圖 (`apps/site/src/i18n`) are a follow-up in the Pro repository.

## What is removed and what is reused

Removed once the 白板 page ships (slice 7):

- `apps/web/src/components/GraphPage.tsx`, `NotebookGraphPage.tsx`, `GraphFilters.tsx`, everything in `components/graph/` (canvas, cards, panels, lanes panel `GraphLanePanel`, save dialog, selection toolbar, gesture layer, controller, data, minimap, note sessions, lane selection, keys, CSS) and their tests; `GraphRoute` in `app/WorkspacePages.tsx`.
- `apps/web/src/lib/graph-colors.ts`, `graph-focus.ts`, `graph-focus-layout.ts`, `graph-initial-fit.ts`, `graph-initial-layout.ts`, `graph-motion.ts`, `graph-topology-layout.ts`, and from `graph-layout.ts` everything but `arrangeGraphLayout` (moved); their tests. The appearance setting stored under `GRAPH_APPEARANCE_KEY` is no longer read.
- Dependencies `react-force-graph-2d`, `graphology`, `graphology-communities-louvain` and `graphology-layout-forceatlas2` (only the graph imports them).
- `insertNoteLink` in `@mygitnotes/core/note-graph` and its tests (only the graph's link gesture used it; a board arrow writes no link).
- The `graph` workspace tab, keyboard scope and shortcut group, the `graph.*` strings, `command.nav.graph`; `graph-filters.css` rules that `BatchAddDialog` uses move to its own stylesheet.

Kept and reused: the note graph (`buildNoteGraph`, `extractNoteLinks`, `/api/notes/graph`) for dashed links, 「＋N 相連」 and 「連到選取的卡片」; `GraphLayoutSchema` for reading old files; the compilation controller, `compilationChapters`, `addToChapter`, `relocateCompilation`, `copyCompilation`; `CompilationHeader`'s arrangement switch; `useLaneNotes` for card excerpts; `useCompilationItemOpen` for folder, asset and YouTube cards; `HostedNoteEditor` for the side panel; `NotebookMark`; the Notes page's note search for the drawer; the legacy `view=graph` filter value and saved bookmark queries with `view: graph` (still read, redirected). `adoptGraphDrafts` is unrelated to the graph page (it adopts drafts of a retired editing store) and stays.

## Rollout

The reader ships before anything writes a board, as the Focus split tree did (its D11): slice 1 makes every deployment able to read and relocate a board while nothing writes one; slice 2, the first that writes `arrangement: board`, ships only after the owner confirms that every deployment opening the same repositories runs slice 1 ([open question 1](#open-questions), answered: wait). The demo and example files move to the board format in slice 7, after which the community demo shows boards.

## Build slices

Each slice is one change-set that ships alone, in this order. Each names its acceptance evidence; the board's pure logic (placement, geometry, edits, merge) lives in `@mygitnotes/core` or `apps/web/src/lib/board/` as plain functions with unit tests, and the components stay thin.

### 1. Core: the board format, read and relocated

- **Area:** `packages/core/src/compilation.ts` (split the board schema, its validation and its operations into `compilation-board.ts`), `compilation-yaml.ts` (one-line entries), `compilationFields`, `relocateCompilation`, `copyCompilation`, `compilationFile`; a `boardsContaining(note, rows, notes)` helper. Web: `CompilationView` value `board` rendered by the existing graph lane, `graph` unchanged; the switch still offers 關聯圖 and writes `graph`.
- **Acceptance:** core tests for: round trip of the example; one-line entries; every validation error naming its field; `graph` read as board with legacy `graph.nodes` placed without overlap and dropped on write; `board` kept through a lane or book edit; relocation of dynamic card paths, folder sections and `{ path }` ends; copy remapping item references; `compilationFile` pruning a removed item's card, section and arrows; listing counts; `boardsContaining` for custom and dynamic boards. Existing compilation tests unchanged.

### 2. The board, drawn (first writer)

- **Area:** `apps/web/src/components/board/` (canvas, camera, cards, sections, texts, arrows, note-link layer, minimap), `apps/web/src/lib/board/` (placement, semantic zoom, geometry); `CompilationView` and `CompilationHeader` (白板 replaces 關聯圖 and writes `arrangement: board`); `graph` read as `board` from here on.
- **Behaviour:** everything under [The board](#the-board) that does not edit: drawing, auto-placement, semantic zoom, pan and zoom, fit, minimap, 顯示筆記內連結, a card opening where the compilation's host opens notes (`onOpenNote`: zoom, or another Focus pane; the side panel comes in slice 5), read-only, phones, keyboard order and descriptions.
- **Acceptance:** placement and zoom-threshold unit tests; a render test of the example file (DOM order, section groups, labels, cards of another notebook marked, missing items); the legacy example file renders without overlapping cards; a phone render has no tools and opens a note on tap. **Depends on:** slice 1 running on every deployment, confirmed by the owner.

### 3. Editing the board

- **Area:** `apps/web/src/components/board/` tools and interactions; board edit operations as pure functions (move, section create/resize/rename/delete with chapter sync, text, arrow, remove, nudge) in `lib/board/edit.ts`; undo stack per visit.
- **Acceptance:** unit tests for each operation, including a section drawn over cards moving their items into its chapter, a card dropped across sections changing chapters, section deletion leaving its items before the first heading, removals pruning arrows, dynamic folder sections refusing a card; interaction tests for select, box select, drag, arrow drawing with label, Delete, undo/redo and keyboard nudges writing once; the book shows the new chapter order.

### 4. Merge by entry for compilation commits

- **Area:** `apps/web/src/lib/merge-note.ts` (a `mergeCompilation` beside `mergeNote`), `app/useWorkingNoteCommit.ts` (compilation files use it).
- **Acceptance:** tests: two drafts moving cards on adjacent lines merge; both moving one card conflict; one adding an arrow while the other renames the compilation merge; external fields kept; an invalid side falls back to the line merge. Local mode untouched.

### 5. The 白板 page and the side panel

- **Area:** `lib/routes.ts` (`/boards`, the `graph` tab becoming `boards`, redirects of `/graph`, `/graph?lanes=` and `view=graph`), `Header.tsx`, palette commands, `app/WorkspacePages.tsx` (a `BoardsRoute` with list and board), the side panel (hosted editor, 開進 Focus, 全螢幕, ✕, 「在 N 塊白板上」 with jump, `note=` and `card=` in the address), the zoom compilation view's panel.
- **Acceptance:** route tests for each redirect; list test (which compilations it holds, per open question 2's answer); side panel tests: opens and edits a note, saves before switching cards, Back closes, jump centres and selects the card, another notebook's card has 開進 Focus disabled; a Focus-pane board opens cards in another pane.

### 6. The 筆記庫 drawer and linked notes

- **Area:** the drawer (search, notebook menu, chips, 「N 塊白板」, drag and 「加到白板」), 「＋N 相連」, the 卡片 tool.
- **Acceptance:** tests: a drop adds the item in the section it lands in at that point; a note already on the board is found, not added; the item limit refuses; a dynamic board's drawer cannot add and says why; both chips filter correctly against the note graph; 「＋N 相連」 counts and adds the checked notes beside the card; 卡片 creates a placed note and opens it, and is disabled in a live repository.

### 7. Remove the graph, update data and docs

- **Area:** the removals listed above; `apps/web/package.json` and the lockfile; `examples/demo-workspace/notes/example/graph-playground.compilation.yml` and the demo scenarios' `concept-map.compilation.yml` (in `mygitnotes-demo-scenarios`) rewritten as boards with sections, text and labelled arrows; `README.md`, `README.zh-TW.md`, `docs/agent/product/index.md`, `docs/agent/architecture/index.md`, `docs/agent/mcp/index.md` where they describe the graph; `docs/CONTEXT.md` moves the board terms from the pending section into 工作區呈現 and the 頂列 entry reads 白板.
- **Acceptance:** no import of the removed modules or packages remains (`rg` over `apps` and `packages`); the web type check, lint and full test suite pass once; the demo opens the example boards.

## Open questions

The owner answered all three on 2026-11-25, each with the recommendation:

1. **Rollout gate**: wait. Slice 2 ships only after the owner confirms every deployment opening these repositories runs slice 1.
2. **What the 白板 page lists**: every compilation arranged as 白板 or holding board data; on the board page the board always draws, and choosing 書本 or 河道 there writes that arrangement and opens the compilation in zoom on the Notes page while it stays in the list.
3. **Card limit**: keep the custom compilation limit of 100 items for the first release.

## Out of scope

- Real-time co-presence on a board (cursors, live movement); compilation files stay outside the live editor.
- Card resizing, card colours, images or embeds as board elements other than items, freehand drawing, arrow bend points, nested sections, alignment guides and snapping beyond integer rounding.
- Arrows written into notes, backlinks from arrows, arrow types with fixed meanings.
- A whole-notebook link overview (the removed graph's 「全貌」); the note graph stays available to MCP and the API.
- Arranging on phones; touch box selection on tablets.
- Boards on Pro public pages, in print or export.
- MCP tools specific to boards.
