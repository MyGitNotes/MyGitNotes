Status: accepted (user confirmed every recommendation, 2026-10-24)

# Focus split tree replaces divisions

Design: [design.md](design.md); summary for review: [summary.html](summary.html).

## Outcome and actors

A workspace user arranges a Focus the way Obsidian arranges its workspace: as a split tree of panes nested to any shape within the limits.
Dragging a note from the browse region, or a tab from a pane, onto a pane's top, bottom, left or right edge splits that pane and opens the note in the new half.
Dropping on a pane's centre or its tab bar adds or moves a tab as today.
Closing a pane's last tab removes the pane, and its neighbours take the space.
Nobody picks an n×m division up front any more; a Focus starts as one pane (the default view since `003c067d`) and grows as notes are dropped beside each other.

## Scope

In scope:

- The Focus layout model in `packages/core/src/focus-page.ts`: a tree of split and pane nodes instead of `division` plus a flat `panes` array.
- Focus file `.github-notes-focus.yaml` version 2, reading version 1 by migration, and the behaviour of a deployment that still runs the version 1 reader.
- The scratch Focus and the per-device view state in `apps/web/src/lib/focus-view.ts`, keyed by pane id instead of pane index.
- Edge drop zones and their preview in `FocusPane`, collapse on close and on moving a pane's last tab out.
- Split and merge commands without drag (pane menu, command palette) for keyboard and touch users.
- The Focus controls' Division menu, the division palette commands, the Add to Focus pane picker and the switcher's layout icon.
- Narrow-screen display of a tree.

Out of scope:

- Spatial keyboard movement between panes (move to the pane on the left, right, above, below).
- Dragging a splitter to dock a pane elsewhere, floating or popped-out panes, pane tabs across Focus entries.
- Keeping an editor mounted while its pane is re-parented (it remounts after a flush, as a division change does today).
- MCP tools for Focus (none exist today; `packages/mcp-server` does not read the Focus file).

## Scenarios

1. A one-pane Focus shows note A; the user drags note B from the list onto the pane's right edge; the pane splits into A | B and B's pane becomes active.
2. The user drags B's tab onto the bottom edge of A's pane; A's pane splits into A over B; B's old pane had only that tab, so it closes and A's column takes the full width.
3. The user closes the last tab of the lower pane; the pane disappears and A fills the Focus again.
4. A keyboard user opens the pane menu and chooses Split right; the shown note opens again in a new pane to the right, which becomes active.
5. A named Focus saved as a 2×2 division opens unchanged after the upgrade, with this device's splitter sizes kept; until somebody makes a shape no division can express, the file stays version 1.
6. Pro still runs the version 1 reader while notes.wayneh.tw has shipped the tree; a person opening the same repository on Pro still sees and edits every Focus, because nothing was written as version 2 yet (see D11).
7. On a tablet, a three-pane tree shows as two panes split along its top-level axis; on a phone it shows as one pane holding every tab.

## Decisions

Every row is settled; D1–D12 were accepted as recommended.
`grounded` rows follow from the code; `confirmed` rows are the user's.

| Question | Answer | Basis | Status |
|---|---|---|---|
| **D0** Layout model | Full split tree like Obsidian: arbitrary nesting, edge drop splits, closing the last tab collapses the pane, no up-front n×m choice | user, 2026-10-24: 「完整分割樹，像 Obsidian」 | confirmed |
| **D1** Limits | Recommend at most 8 panes and 4 nested split levels per Focus (a split inside a split inside a split inside a split); the 100-tab budget stays layout-wide (`FOCUS_MAX_TABS`). At the limit, edge drop zones and Split commands are disabled with a hint; the centre still adds a tab. Basis for 8: four panes were the most any division had, and `react-resizable-panels` keeps each panel at least 10% of its group (`FocusArea.tsx`). | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D2** Where splitter sizes live | Recommend per device, as today (`FocusEntryView.ratios`), now keyed by split id and child id; the file holds structure and tabs only. Storing sizes in the file would make every splitter drag a pending Git change of a named Focus, and a laptop and a large monitor want different sizes. Alternative: sizes in the file, so a named Focus looks the same on every device. | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D3** Drop zones | Recommend: the outer quarter of the pane body on each side is that edge's zone (corners go to the nearer edge), the rest is the centre; the tab bar keeps its insertion-line behaviour and never splits. A preview overlay shades the half the new pane will take. Tab drag to an edge moves the tab (Shift copies), as a tab-bar drag between panes does today; a browse-row drag always adds. A pane's own only tab shows no edge zones on that pane (the drop would change nothing). | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D4** Empty panes | Recommend: never removed automatically except by closing or moving out the last tab. An empty pane (a migrated division's unused pane, or one whose notes were deleted) shows its empty message with a Close pane button; the root pane is never closed. Pruning missing notes (`pruneFocus`) never collapses, so a pane does not vanish while notes are still loading. | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D5** What the Division menu becomes | Recommend: the division picker beside the Focus switcher becomes a Layout menu with Split right, Split down (for the active pane) and Merge all panes (the old fold to Single: every tab into one pane, in pane order, duplicates dropped). The seven division presets go; no up-front n×m choice remains. Alternative: keep the presets as "rebuild as…" shortcuts. | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D6** What Split right/down opens | Recommend: the new pane opens a second tab of the note the active pane shows (Obsidian's behaviour; a note may already sit in several panes), and becomes active; on an empty active pane the commands are disabled. Alternative: the new pane starts empty. | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D7** Palette commands | Recommend: remove the seven `focus-division-<division>` commands; add Split pane right, Split pane down, Merge all panes and Close empty pane, all acting on the active pane, none with a default key (the division commands had none either). Next/previous pane keep cycling, now in tree order (left to right, top to bottom, depth first). | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D8** Narrow screens | Recommend: desktop shows the whole tree; a tablet (capacity 2) shows the root split's first child as one displayed pane and the rest as the other, along the root's axis; a phone shows one pane with every tab, as today. Edge zones and Split commands work only where the whole tree is shown (desktop); narrower screens still drop onto the centre and the tab bar. This changes one case: a 2×2 Focus on a tablet shows its two rows instead of pane 1 beside panes 2–4. | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D9** Opening "beside" with one pane | Recommend: on desktop, a compilation card or anything else that opens beside (`OpenPlacement` `beside`) splits the only pane to the right instead of adding a tab behind the compilation; with two or more panes it keeps using the most recently used other pane (`sideTarget`). `[[link]]` clicks keep opening here. | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D10** Add to Focus pane picker | Recommend: `DivisionThumbnail` becomes a thumbnail drawn from the tree, one radio button per pane in tree order, arrow keys cycling as today; no "new split" choice in the dialog. | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D11** Rollout across deployments | Recommend: phase 1 ships the version 2 reader to both notes.wayneh.tw and Pro while still writing version 1 for every Focus a division can express (the UI cannot make any other shape yet). Phase 2, the first commit that can create other shapes, ships only after the user confirms Pro runs phase 1. Afterwards the version 1 writer stays until the user says both deployments are past phase 1, then a cleanup commit removes it. Without this, a version 2 file makes an older deployment answer 422 for that repository's Focus and refuse every note or folder move there (`relocateWorkspaceDocuments`: "Fix the file before moving content"). | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D12** Words | Recommend: retire 劃分 / Division; the act is 分割 / Split (向右分割 Split right, 向下分割 Split down, 合併所有窗格 Merge all panes, 關閉窗格 Close pane); the arrangement as a whole is the Focus's 窗格配置 / pane layout when it must be named (版型 already means card size). `docs/CONTEXT.md` 用語 is updated in the docs phase. | user, 2026-10-24: 「全部照建議」 (recommendation accepted) | confirmed |
| **D13** Split buttons | Split right and Split down are icon buttons beside each pane's tab bar, always visible on desktop (not only inside a menu); they open the pane's shown note in a new pane (D6). The Layout menu keeps its items as well. | user, 2026-10-24: 「按鈕直接放 tab 列」 | confirmed |
| **D14** Same note in several panes | Every pane showing the same note is a live editor of one shared document, as in Obsidian: typing in one shows at once in the others, each keeping its own caret, selection and scroll; one draft and one save per note. Replaces today's single owner plus `NotePreview` with click-to-claim (`NoteEditorHost.tsx` `claimEditor`). Zoom borrowing must keep working. Designed in detail as its own phase after phase 3. | user, 2026-10-24: 「兩格都能即時編輯同步」 | confirmed (design pending) |
| **G1** Pane identity | Panes and splits get ids unique within their Focus, stored in the file; view state (active pane, shown tab, history, hidden toolbar, sizes) is keyed by them, so a split elsewhere never shifts it. A tab may still sit in several panes. | `focus-view.ts` arrays indexed by pane, `placeTab` | grounded |
| **G2** Migration determinism | Reading a version 1 Focus always yields the same tree and ids (`p1`…`p4`, split ids from the division), because the remote commit compares the file's current value with the draft's base by JSON (`remote-source.ts` documents loop) and a random id would turn every commit into a 409. | `remote-source.ts:537` | grounded |
| **G3** Server and MCP | The local server serves the Focus file only through the generic workspace document router; the MCP server has no Focus code; source conversion counts entries schema-free. Only the document contract and fixtures change. | `apps/local-server/src/app.ts:141`, `source-conversion.ts:121` | grounded |
| **G4** Pro | Pro has no Focus code outside the core submodule; it needs a submodule bump only. | `git grep` in `~/projects/MyGitNotes-Pro` outside `core` | grounded |

Core rules readiness: `rules/typescript.md`, `rules/ui-design.md`, `rules/markdown.md`, `docs/CONTEXT.md` glossary (劃分, 窗格; the tab entry already disagrees with code, since a note may sit in several panes).
