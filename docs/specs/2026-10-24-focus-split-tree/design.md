# Focus split tree — design

Decisions: [decision.md](decision.md); summary for review: [summary.html](summary.html).
Branch `core`, base `762aa65b` (unpushed at the time of writing; another session owns it).
Every `D` number below refers to a row of decision.md; where a row is still open, this design follows its recommendation and names the place that changes if the answer differs.

## Approach

The Focus layout becomes one recursive value: a node is either a pane (`{ kind: 'pane', id, tabs }`) or a split (`{ kind: 'split', id, orientation, children }`).
`FocusArea` already renders a division as exactly such a tree (`type Split = number | { orientation, children }` and the `SPLITS` table in `FocusArea.tsx`), so the renderer keeps its shape and stops looking the tree up by division name.
Panes are addressed by id instead of by index everywhere a pane is named: core operations, the hook `useNoteFocus`, the device view state, `data-focus-pane`, the tab drag payload and the Add to Focus picker.
Pane order, wherever order matters (pane numbers in labels, next/previous pane, the narrow-screen fold, Merge all panes, the picker's arrow keys), is the depth-first order of leaves, which for every migrated division equals its old pane order.

The file moves to version 2.
Reading migrates version 1 deterministically (G2); writing emits version 1 while every Focus in the page is still a division shape (D11), so a deployment that only knows version 1 keeps working until someone builds a shape it cannot read.

Rejected alternatives:

- **Tree whose leaves index a flat `panes` array** (`{ split, panes }`, the `FocusArea` `Split` type stored as is): keeps the index-based API, but a collapse renumbers every later pane, which shifts each device's view arrays and ratio keys; ids avoid the renumbering entirely.
- **Keeping divisions and adding more presets**: contradicts D0.
- **An optional `tree` field on version 1**: version 1 is `.strict()`, so an older reader rejects the unknown key exactly as it rejects `version: 2`; it buys nothing and leaves two sources of truth.

## Precedent

- `dedupePanes` running as a zod `transform` before `checkFocusLayout` is the model for normalising the tree on every parse.
- `readFocusPage` already rewrites a legacy shape (dropping `lane` tabs) before `FocusPageSchema.parse`; the version 1 migration joins it there.
- `StudyWorkspaceSchema` restores fields of version 1 files on read (`study.ts:52`); the document registry's `read` / `fileSchema` split ("Accepts every stored version without migrating it") already allows several stored versions.
- `readFocusView` / `readEntry` are tolerant readers that drop what does not validate; legacy entries convert there and in `entryView`.

## Data model (core, `focus-page.ts`)

```ts
export const FOCUS_MAX_PANES = 8;   // D1
export const FOCUS_MAX_DEPTH = 4;   // D1: nested split levels; a lone pane is depth 0
export const FOCUS_MAX_TABS = 100;  // unchanged, layout-wide

export type FocusOrientation = 'horizontal' | 'vertical'; // horizontal: children left to right
export interface FocusPaneNode { kind: 'pane'; id: string; tabs: FocusTab[]; }
export interface FocusSplitNode { kind: 'split'; id: string; orientation: FocusOrientation; children: FocusNode[]; }
export type FocusNode = FocusPaneNode | FocusSplitNode;
export interface FocusLayout { root: FocusNode; }
// Focus = { id, notebookId, name } & FocusLayout; FocusPage = { version: 2, focuses: Focus[] } in memory and on the wire
```

Zod: `FocusNodeSchema = z.lazy(() => z.discriminatedUnion('kind', [pane, split]))`, each `.strict()`, node `id` the existing `id` regex (`[a-zA-Z0-9_-]{1,64}`), `children` `.min(2)`.
`FocusLayoutSchema = z.object({ root }).strict().transform(normalizeFocus).superRefine(checkFocusLayout)`, and `FocusSchema` the same with the Focus fields.

`normalizeFocus` (pure, same reference when nothing changes):

1. A split with one child is replaced by that child.
2. A split child with its parent's orientation is flattened into the parent at its position (Obsidian keeps no same-axis nesting; it also keeps splitter sizes meaningful).
3. Within each pane, a later duplicate tab key is dropped (today's `dedupePanes`).

`checkFocusLayout`: node ids unique across the layout (panes and splits share one namespace), at most `FOCUS_MAX_PANES` panes, depth at most `FOCUS_MAX_DEPTH`, total tabs at most `FOCUS_MAX_TABS`.
Before zod sees a value, `readFocusPage` walks it iteratively and rejects nesting deeper than `FOCUS_MAX_DEPTH + 1` levels, so a hostile deeply nested YAML fails with a clear error instead of exhausting the stack in `z.lazy`.

New ids: `nextFocusId(layout, prefix)` returns `p<n>` for panes or `s<n>` for splits with the smallest unused `n`; readable in YAML, deterministic, unique within the layout.
Two devices splitting the same named Focus concurrently may pick the same id; the document revision already turns the second save into a 409 and a reload.

### File format version 2

```yaml
version: 2
focuses:
  - id: weekly
    notebookId: a
    name: 週報
    root:
      kind: split
      id: major-left
      orientation: horizontal
      children:
        - kind: pane
          id: p1
          tabs: [{ kind: note, path: notes/a/guide.md }]
        - kind: split
          id: major-left-1
          orientation: vertical
          children:
            - { kind: pane, id: p2, tabs: [{ kind: note, path: notes/a/reading.compilation.yml }] }
            - { kind: pane, id: p3, tabs: [] }
```

`FocusPageSchema` is version 2 only (the in-memory and API shape).
`FocusFileSchema` (the registry's `fileSchema`, used by `validateWorkspaceDocument`) accepts version 1 or version 2 as stored, each with the local-id rule it has today.

### Reading version 1

`legacyFocusTree(division, panes)` mirrors today's `SPLITS` table:

| Division | Tree (leaf numbers are v1 pane indices) | Split ids |
|---|---|---|
| `single` | `p1` | none |
| `columns-2`, `rows-2`, `columns-3` | split(p1, p2[, p3]) | root = division name |
| `major-left`, `major-top` | split(p1, split(p2, p3)) | root = division, nested = `<division>-1` |
| `grid-2x2` | vertical(horizontal(p1, p2), horizontal(p3, p4)) | root = `grid-2x2`, rows `grid-2x2-0`, `grid-2x2-1` |

The rule is: pane index `i` becomes `p<i+1>`, the root split takes the division's name, and child split `j` of split `X` becomes `X-j`.
That equals today's ratio group ids (`FocusArea` names groups `<division>` and `<id>.<index>`) with `.` replaced by `-`, which is what lets a device keep its splitter sizes (see view state).
The table and `FOCUS_DIVISIONS` stay in core as `LEGACY_DIVISIONS`, used only by the migration and the version 1 writer.
Empty panes of a migrated division are kept (D4).

### Writing (D11)

`WorkspaceDocument` gains an optional `write?(value: T): unknown` returning the value to store, the inverse of `read`; `serializeWorkspaceDocument(value)` becomes `serializeWorkspaceDocument(document, value)` calling it when present.
Callers that store a document go through it: `apps/local-server/src/workspace-document.ts` (PUT), `remote-source.ts` (document drafts in a commit), `relocateWorkspaceDocuments`, `screen-migration.ts`; `bookmark-relocation.ts` passes `BOOKMARKS_DOCUMENT` and is otherwise unchanged.
This is an additive change to an exported contract; Pro defines no documents of its own (G4).

`FOCUS_DOCUMENT.write(page)`: when every Focus equals `legacyFocusTree` of some division, ids included (`legacyDivisionOf(layout)` returns that division), the page is stored as version 1 `{ division, panes }`; otherwise the whole page is stored as version 2.
Round trip: a version 1 file read and written back unchanged is byte-identical apart from YAML formatting the app already applies.
A tree that returns to a division shape with other ids (split, then close) stays version 2; that is correct, only less compatible.
The cleanup phase deletes `write` for Focus and with it `legacyDivisionOf`.

### A newer file in an older deployment

- A deployment before phase 1 answers `GET /api/focus-page` with 422 "Invalid Focus YAML. Fix the file before saving." for that repository; the Focus switcher shows the load error and Reload; nothing is overwritten, since a failed read yields no revision to save against.
- Worse, `relocateWorkspaceDocuments` throws 422 on every note or folder move in that repository, and a remote commit that carries a Focus draft cannot happen. This is what D11's phasing prevents.
- From phase 1 on, a `version` higher than 2 gets its own message ("This Focus file was saved by a newer MyGitNotes; update this deployment"), on load and on a move, instead of the generic invalid-YAML one; it still fails, since silently skipping relocation would leave stale paths.
- The scratch Focus is per origin in `localStorage`; notes.wayneh.tw and Pro never share it. Rolling one origin back to a pre-phase-1 build drops that device's scratch layout to empty (`readFocusView` falls back), named Focus entries are unaffected.

### Operations

All take and return `FocusLayout`-shaped values (`<T extends FocusLayout>` as today), throw `FocusError`, and finish with `normalizeFocus`.
`FocusError` codes gain `'pane-limit'` and `'depth-limit'`; `focus-error-message.ts` and both i18n files get messages.

| Function | Behaviour |
|---|---|
| `focusPanes(layout)` | Panes in depth-first order; `focusPaneIndex(layout, id)`, `findFocusPane(layout, id)` |
| `findFocusTab`, `findFocusTabInPane`, `focusTabCount` | As today, pane by id |
| `placeTab`, `placeTabs` | As today, pane by id (`invalid-pane` for an unknown id) |
| `closeTab(layout, pane, key)` | Removes the tab; when the pane becomes empty and is not the root, removes the pane (D0) |
| `moveTab(layout, from, to, key, index?)` | As today; an emptied source pane collapses as in `closeTab` |
| `splitPane(layout, pane, edge, tab)` | `edge`: `left`/`right`/`top`/`bottom`. With the parent split on the edge's axis, inserts a new pane beside the target; otherwise wraps the target in a new split. Returns `{ layout, pane: newId }`. Checks panes, depth and tab budget |
| `moveTabToSplit(layout, from, key, target, edge)` | `splitPane` with the tab, then removes it from `from` and collapses `from` if emptied; a no-op when `from === target` and it is that pane's only tab |
| `closePane(layout, pane)` | Removes a pane and its tabs (used for empty panes, D4); the root pane becomes an empty pane instead |
| `mergePanes(layout)` | One pane with every tab in pane order, duplicates dropped; keeps the first pane's id (D5, the old fold to `single`) |
| `pruneFocus(layout, exists)` | Drops missing tabs, never collapses (D4) |
| `relocateFocusPaths`, `ownFocusPage`, `foreignFocusTab` | Walk the tree's tabs; behaviour unchanged |
| `displayFocus(layout, capacity)` | Narrow-screen display (below); replaces `displayPanes` |

Removed: `FocusDivision` from the public surface, `focusPaneCount`, `changeDivision`, `displayPanes`, `DISPLAY_2`, `dedupePanes` (folded into `normalizeFocus`).
`emptyFocusLayout()` is `{ root: { kind: 'pane', id: 'p1', tabs: [] } }`, which `legacyDivisionOf` reads as `single`.

`screen-migration.ts` keeps rewriting `lane` tabs on the raw version 1 structure (lane tabs only ever existed in version 1 files) and then parses with `readFocusPage` and stores with `serializeWorkspaceDocument(FOCUS_DOCUMENT, …)`, so it still writes version 1.

## Display on narrow screens (D8)

`usePaneCapacity()` returns `1 | 2 | 'all'` (desktop above 1100 px `'all'`, tablet 2, phone at 767 px or less 1).
`displayFocus(layout, capacity)` returns `{ root: DisplayNode; panes: { panes: string[] }[] }`, where a display leaf stands for one or more stored panes:

- `'all'`: the stored tree, one stored pane per display leaf.
- `1`: one leaf holding every pane in pane order (as today).
- `2`: a lone pane shows as is; otherwise a synthetic split `display-2` on the root's orientation whose first leaf holds the panes under the root's first child and whose second leaf holds every other pane.

`displayedPanes(entry, layout, capacity)` in `focus-view.ts` keeps its role (and `groupShown`), now with pane ids.

## Device view state (`focus-view.ts`)

```ts
interface FocusEntryView {
  activePane: string;
  shown: Record<string, string | null>;     // pane id → shown tab key
  recent: string[];                          // pane ids, most recent first
  history: Record<string, string[]>;
  ratios: Record<string, Record<string, number>>; // split id → child id → percent
  hideToolbar: Record<string, boolean>;
}
```

- `entryView` normalises against the layout as today: unknown pane ids dropped, every pane present in `recent`, `activePane` an existing pane (else the first).
- A legacy entry (arrays, from before this change) is kept raw by `readEntry` and converted in `entryView`: array index `i` maps to the `i`-th pane of the layout, ratio key `k` maps to `k` with `.` replaced by `-`, and the array's positions to that split's child ids. A key that matches no split is dropped.
- `FocusViewState.current` (the scratch layout) is read with `readFocusLayout`, which accepts the version 1 `{ division, panes }` shape and the tree, so a device's scratch Focus survives the upgrade.
- Sizes keep their meaning across structure changes: `splitRatios(entry, layout, before, after)` gives a new sibling half of its target's share (the new split of a wrapped pane starts at 50/50), `collapseRatios` gives a removed child's share to its neighbour (the previous one, else the next). A split whose stored sizes do not cover exactly its children falls back to equal sizes.
- `sideTarget(entry, source, panes)` takes the pane order; with one pane it returns `undefined`, which `openNote` reads as "split right" on desktop (D9) and as the source pane elsewhere.

D2 alternative: if sizes move into the file, `ratios` leaves `FocusEntryView` and becomes an optional `sizes: number[]` on split nodes (version 2 only, which also makes every resized Focus version 2).

## Web

### `useNoteFocus`

- Every `pane: number` becomes `pane: string`: `openNote(path, source?, placement)`, `place`, `moveTab`, `show`, `activate`, `close`, `addBatch`, `setHideToolbar`.
- `setDivision` is removed. New: `split(target, pane, edge, tab, sourcePane?, copy?)` for a drop (`splitPane` for a browse row or a Shift copy, `moveTabToSplit` for a tab move), `splitShown(pane, orientation)` for Split right/down (D6), `closePane(pane)` for an empty pane, `mergeAll()`.
- Structural changes flush first: a wrapped pane re-parents under a new `Group` and React remounts it, so like `setDivision` today the hook flushes every shown editor (`flushEditors(noteKeys(notebookId, Object.values(entry.shown)))`) before `mutate`. Inserting a sibling into an existing split keeps the other panes mounted, since panels are keyed by node id.
- After `mutate`, `setEntry` shows the moved or opened tab in the new pane, makes it active, and applies `splitRatios` / `collapseRatios`; a collapse that removes the active pane activates the most recent remaining pane.

### `FocusArea`

Renders `displayFocus(...).root` recursively: a split is a `Group` with `id` = split id and `orientation`, each child a `Panel` with `id` = child node id, `defaultLayout` = `entry.ratios[splitId]` when it covers the children; `onLayoutChanged` with `isUserInteraction` writes `setRatios(splitId, layout)`.
`SPLITS` and `data-division` go; `data-panes` carries the pane count for styling.

### `FocusPane`: drop zones (D3)

- The pane body (`.focus-pane-body`), not the whole section, takes drags for zones; the tab bar keeps `slotAt` and the insertion line, and the bar never splits.
- `dropZone(rect, x, y)` (pure, in `lib/focus-drop.ts`) returns `'center' | 'left' | 'right' | 'top' | 'bottom'`: with `dx`, `dy` the pointer's position as fractions of the body, the nearest edge wins when its distance is under 0.25, else centre.
- An overlay (`.focus-drop-preview`, `pointer-events: none`) shades the half the new pane takes, or the whole body for the centre; `data-drop-zone` on the section drives it.
- Edge zones are off (only centre) when the display is not `'all'`, when `splitPane` would exceed a limit (the overlay shows the limit message), when the Focus is not editable, or when the drag is this pane's only tab.
- The tab drag payload becomes `{ tab, pane: string }`; `droppedTab` checks `typeof pane === 'string'`.
- `data-focus-pane` carries the pane id; `openLink` in `useFocusNoteNavigation.ts` reads it as a string; labels keep "Pane N" from `focusPaneIndex + 1`.
- Pane actions gain a Split menu (Split right, Split down; D6) and, on an empty pane that is not the root, a Close pane button (D4).

### Controls, picker, keyboard

- `FocusControls`: `DivisionPicker` becomes `LayoutMenu` (D5): Split right, Split down, Merge all panes; disabled when not editable, the split items also at the limits or with no tab shown.
- `FocusDivision.tsx` becomes `FocusLayoutIcon.tsx`: `LayoutIcon` (the switcher's per-Focus icon, nested flex boxes drawn from the tree) and `LayoutThumbnail` (the Add to Focus picker, D10), its `radiogroup` arrow keys cycling in pane order as `DivisionThumbnail` does now.
- `focus.css`: the `.focus-division[data-division=…]` grid templates give way to flex rules for the icon and thumbnail.
- `useShortcutSurface.ts` (D7): drop the `FOCUS_DIVISIONS` commands; add `focus-split-right`, `focus-split-down`, `focus-merge-panes`, `focus-close-pane`; `cycleFocusPane` and `cycleFocusTab` work on `focusDisplay.panes` in pane order with ids.
- `keymap.ts`: scope `focus-division` and entry `focusDivision.move` are renamed `focus-pane-picker` / `focusPanePicker.move`, same keys.
- i18n (`en.ts`, `zh-TW.ts`): remove `focus.division*`, `focus.divisionCommand`, `shortcuts.describe.focusDivision`, `shortcuts.scope.focus-division`; add the D12 words, the drop hints and the two limit messages.
- `BatchAddDialog`, `batch-add.ts`, `focus-search.ts`: pane id in place of index.

## Server and MCP (G3)

- `apps/local-server`: no route changes. `GET /api/focus-page` answers the version 2 shape; `PUT` validates it with `FocusPageSchema` and stores through `FOCUS_DOCUMENT.write`.
- A browser tab still running the previous bundle after a deploy sends a version 1 page to `PUT` and gets 400 "Invalid Focus configuration."; its document draft in `localStorage` is read through `document.read` and so migrates on the next load. This is the same stale-tab behaviour as any schema change.
- `packages/mcp-server`, `scripts/lib/workspace-conversion.mjs`, `source-conversion.ts`: unchanged.
- Pro: submodule bump; nothing outside `core` names Focus symbols (G4).

## Test plan

Core (`packages/core/tests/focus-page.test.ts`, `workspace-documents.test.ts`, `screen-migration.test.ts`, `note-shell.test.ts`):

- Each of the seven divisions migrates to the table's tree and ids; reading twice gives equal JSON (G2); a page mixing an invalid Focus fails as today.
- `write` stores version 1 for division shapes and version 2 otherwise; version 1 → read → write is unchanged; one non-division Focus makes the page version 2.
- Schema: duplicate node ids, one-child splits (normalised), same-axis nesting (flattened), 9 panes, depth 5, 101 tabs, an unknown `version`, and a 10 000-level nested input (rejected without a stack overflow).
- `splitPane` on all four edges, inside a same-axis parent (sibling insert) and a cross-axis parent (wrap); limit errors; `moveTabToSplit` collapsing the source; the no-op case; `closeTab` collapsing a non-root pane and keeping the root; `closePane`; `mergePanes` order and dedupe; `pruneFocus` never collapsing.
- `relocateFocusPaths` and `ownFocusPage` over a version 2 tree; `relocateWorkspaceDocuments` keeps a version 1 file version 1.
- `displayFocus` for capacities 1, 2 and `'all'`, including the 2×2 tablet case.

Web (`focus-view.test.ts`, `use-note-focus.test.ts`, `FocusPane.test.tsx`, `batch-add.test.ts`, `focus-search.test.ts`, `workspace-document-races.test.tsx`, `useWorkingNoteCommit.test.tsx`):

- Legacy view entries and ratio keys convert to ids; a legacy scratch `current` survives; unknown ids are dropped.
- `splitRatios` / `collapseRatios` sums stay 100.
- `dropZone` geometry at the 0.25 boundaries and corners.
- `FocusPane`: an edge drop of a browse row splits and shows the note; a tab drop to an edge moves it and collapses the emptied source; Shift copies; centre and tab-bar drops behave as today; edge zones absent at the limit, on tablets and for the only tab.
- `useNoteFocus`: editors flushed before a split; a refused flush leaves the layout unchanged; `openNote(…, 'beside')` with one pane splits right on desktop (D9).

Local server (`apps/local-server/tests/focus-page.test.ts`, `agent-resources.test.ts`, `gitlab-http.test.ts`, `workspace-members.test.ts`, `notebook-repositories.test.ts`): fixtures move to the tree; a stored version 1 file answers the tree; a division-shaped PUT writes version 1 to disk and to the remote tree, a split PUT writes version 2; a note move rewrites paths inside a version 2 file.

Browser (agent-browser on a clone, after phase 2 and phase 3): desktop drag to each edge, collapse, Merge all panes, a migrated 2×2 named Focus keeping its sizes; tablet (768–1100 px) and phone (≤767 px) widths; keyboard-only Split right and next pane; `verification.md` records the run.

## Phases (each commit builds, passes `pnpm test`, and ships alone)

1. **`feat(core)`: Focus layouts become a split tree, read from version 1 and still written as version 1.**
   Core model, schemas, migration, `write`, the newer-version message, tree-aware operations, `displayFocus`; the web switches to pane ids and renders the tree, and the division picker and commands keep working through a temporary `applyDivision(layout, division)` (the old `changeDivision` fold, building `legacyFocusTree`). No visible change except the tablet display of 2×2 and three-pane Focus (D8). Deploy to notes.wayneh.tw and Pro before phase 2 (D11).
2. **`feat(web)`: Dropping on a pane's edge splits it, and closing a pane's last tab removes the pane.**
   Drop zones, preview, `split`, collapse in `closeTab` / `moveTab`, ratio carry-over, limits. First commit able to write version 2. Gate: the user confirms Pro runs phase 1.
3. **`feat(web)`: Split right, Split down and Merge all panes replace the division menu.**
   `LayoutMenu`, pane Split menu, empty-pane Close pane, palette commands, `LayoutIcon` / `LayoutThumbnail`, keymap scope rename, i18n; remove `applyDivision`, `FocusDivision.tsx` and the division strings.
4. **`feat(web)`: A note opened beside the only pane splits the Focus to the right.** (D9; skipped if the user declines.)
5. **`docs`: Focus split tree.** `README.md` Focus text, `docs/CONTEXT.md` 用語 (D12), `docs/agent/product/index.md` Focus 配置所有權 (division → tree), `docs/agent/architecture/index.md` where it names the Focus format; this spec's `verification.md`.
6. **`refactor(core)`: The Focus file is always written as version 2.** Removes `FOCUS_DOCUMENT.write` and `legacyDivisionOf`; reading version 1 stays. Only when the user says both deployments are past phase 1 (D11).

## Risks

- **Older deployment meets a version 2 file** (note moves 422 in that repository). Mitigation: D11 phasing and the version 1 writer; the phase 2 gate is the user's confirmation, recorded in the commit message.
- **Spurious 409 from non-deterministic migration.** Mitigation: ids derived only from the division; a test reads twice and compares JSON.
- **Editors remount on a split**, losing undo history and scroll in the wrapped pane. Mitigation: flush first (as divisions do today); sibling inserts keep panes mounted; keeping editors mounted across re-parenting is out of scope.
- **Ratio drift** after many splits and collapses. Mitigation: per-split sizes keyed by child id, carry-over functions, equal-size fallback.
- **Phase 1 is large** (model plus every pane-index call site). Mitigation: no behaviour change besides D8, so the existing web and server tests, with fixtures moved to ids, are its anchor; it can be split into a core commit with temporary index adapters if review needs smaller pieces.
- **Deep or hostile YAML.** Mitigation: the iterative depth check before zod, plus the existing 512 KiB limit.
