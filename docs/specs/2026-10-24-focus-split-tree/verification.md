# Focus split tree — verification

Design: [design.md](design.md); decisions: [decision.md](decision.md).
This records what ran for phases 2 to 5 on branch `core` (2026-10-24), after phase 1 (`baba69ef`, review fix `a7f1aa37`) was deployed.
Phase 6 (always write version 2) and D14 (live editing of one note in several panes) are not started.

## Gate

Pro production runs phase 1 (Pro 0.17.5, `b9bba6f`, deployed 2026-10-24), the D11 gate for the first commit that can write version 2.
The phase 2 commit message says so.

## Requirements

| Requirement | Evidence | Result |
|---|---|---|
| D0, D3: an edge drop splits, the centre and tab bar behave as before | `FocusPane.test.tsx`, `focus-drop.test.ts`; browser drops on each edge | pass |
| D0, D4: closing or moving out a pane's last tab removes the pane, pruning never does, the only pane stays | `focus-page.test.ts`, `use-note-focus.test.ts`; browser close | pass |
| D1: at most 8 panes and 4 nested levels, with messages | `focus-page.test.ts`, `focus-drop.test.ts`, `FocusPane.test.tsx` | pass |
| D2: sizes stay per device and survive structure changes | `focus-view.test.ts`; 2×2 browser check | pass |
| D5, D13: Layout menu and always-visible Split buttons replace the Division picker | `FocusPane.test.tsx`; browser menu and buttons | pass |
| D6: Split opens the shown note in a new active pane | `use-note-focus.test.ts`; browser buttons | pass |
| D7: palette commands, none with a default key | `useShortcutSurface.ts`; browser palette run of Split right and Next pane | pass |
| D8: no edge zones or Split below desktop | `FocusPane.test.tsx`; 900 px and 390 px browser checks | pass |
| D9: a note opened beside the only pane splits right on desktop | `use-note-focus.test.ts`; unit tests only, because no UI caller passes `beside` with a source | pass |
| D11: first version 2 write only after Pro runs phase 1 | Phase 2 commit message; browser write of `version: 2` | pass |
| D12: words | `en.ts`, `zh-TW.ts`, `docs/CONTEXT.md` | pass |
| Version 1 files still load and keep their sizes | Browser `grid-2x2` check | pass |

## Automated checks, after each phase

| Check | Outcome after phase 4 |
|---|---|
| `pnpm test` (core build, then vitest over every package) | 389 files, 3385 tests, all passing |
| `pnpm lint` | no errors |
| `npx tsc --noEmit -p apps/web`, `-p apps/local-server`, `-p packages/core` | clean |
| `pnpm exec dprint fmt <changed files>` | applied to the changed files only |

New tests, by the design's test plan:

- Core (`packages/core/tests/focus-page.test.ts`): `splitPane` on all four edges, beside a same-axis parent and wrapping in a cross-axis one; smallest unused ids; `pane-limit`, `depth-limit` and `tab-limit`; `moveTabToSplit` collapsing the source, keeping a source that still has tabs, the no-op for a pane's only tab, and freeing a pane before the limit check; `closeTab` collapsing a non-root pane, keeping the only pane and flattening a split left with one child; `closePane`; `mergePanes` order, dedupe and ids; `pruneFocus` never collapsing.
- View state (`apps/web/src/lib/focus-view.test.ts`): `splitRatios` and `collapseRatios` keep every split's sizes at 100, give a removed child's share to its neighbour, hand a collapsed split's share to its remaining child and flatten along the parent's axis; `retainPanes` drops state of removed panes.
- `apps/web/src/lib/focus-drop.test.ts`: `dropZone` at the 0.25 boundary and in the corners; `dropRefusal` at the pane and depth limits, and a move that empties its source passing at the limit while a copy does not.
- `apps/web/src/lib/use-note-focus.test.ts`: a split flushes every shown editor first and a refused flush leaves the layout unchanged; a drop shows the note in the new pane and makes it active; a moved tab collapses its emptied source; closing the last tab removes the pane and activates the most recent remaining pane; `splitShown`, `closeEmptyPane` and `mergeAll`; a note opened beside the only pane splits right on desktop (D9) and does not where the whole tree is not shown or for placement `here`.
- `apps/web/src/components/FocusPane.test.tsx`: an edge drop of a browse row and of a tab splits; Shift copies; the centre adds a tab; no edge zones for a pane's only tab, below desktop or in a read-only Focus; at the pane limit the edge falls back to the centre and the preview names the limit; the Split right and Split down buttons and Close pane.

## Browser check

agent-browser (headless, session `focus-p2`) against a temp clone of `examples/demo-workspace` (`cp -R` to `/tmp`, `git init`, files staged by name), dev server through a monitor on ports 3187 and 5187.
After phase 3, with the phase 2 and 3 code:

- Desktop, 1440×900: dropping a browse card on the right edge of the only pane split it into two panes; dragging a tab to the bottom edge of the right pane split that pane and left the first pane's tabs; dragging the only tab of the lower pane to the top edge of the left pane moved it, removed the emptied pane and gave the right pane the full height again.
- Closing the last tab of a pane removed the pane and its neighbour took the space.
- The Split right and Split down buttons beside each tab bar opened the pane's shown note in a new pane to the right or below, and made it active.
- Layout menu: Split right, Split down and Merge all panes listed; Merge all panes folded four panes into one that kept the first pane's id and the shown note.
- A split Focus named from the Scratch was written to `.github-notes-focus.yaml` as `version: 2`, and loading it by URL after a reload showed the same panes.
- A version 1 `grid-2x2` named Focus loaded with its four panes. With legacy splitter sizes stored for this device (30/70, 20/80, 60/40) the panes measured 240 and 561 px high and 162/649 and 487/324 px wide, which are those percentages. The file stayed version 1 until Close pane removed its empty fourth pane, which wrote version 2.
- Tablet (900 px): the Focus showed two panes, no Split buttons, and a note dragged to a pane's right edge was added as a tab. Phone (390 px): one pane, no Split buttons, a tab dropped on the left edge stayed in its pane.
- Keyboard only: the palette's Split right acted on the active pane and Next pane moved to the new one.

Not run: the manual QA scripts `scripts/qa-note-focus.mjs`, `qa-compilation-cards.mjs` and `qa-graph-editing.mjs` (updated to string pane ids, `.focus-layout-thumbnail`, no `data-division` and the Layout menu; checked with `node --check` only). Compilation cards in a Focus pane pass placement `beside` again (user decision of 2026-10-24, see D9); the second browser pass covers it.

Cleanup: the monitor was stopped, the agent-browser session closed, the temp clone, helper files and the repository's `.mygitnotes-dev-ports.json` deleted, and ports 3187 and 5187 confirmed free.

## Deviations from the design

- `splitRatios` and `collapseRatios` take the stored `ratios` and the layouts before and after, not the whole entry, so the hook can chain a collapse and a split for a move.
- Closing a pane's last tab, moving it out and Merge all panes flush every shown editor first, because removing a pane can re-parent its neighbours.
- The id of a removed pane is free again, so a move that empties its source can give the new pane the same id; the hook decides "emptied" from the source pane in the layout before the move (not from whether the id still exists afterwards), drops the removed pane's view state, and computes ratios as collapse-then-split.
- Where a limit refuses an edge drop, the edge band behaves as the centre (a drop adds a tab) and the preview names the limit, rather than refusing the drop.
- The Layout menu's Split items are disabled, and the palette's Split commands unavailable, when the screen is below desktop (`focusCapacity` is not `all`) or the display is not the whole tree (D8), and the Split buttons beside the tab bar do not render there.
- `README.md` and `README.zh-TW.md` had no Focus description, so each gained one feature bullet; `docs/agent/architecture/index.md` does not name the Focus format and was left alone.
