# Typst preview (local mode)

A local workspace shows the typeset PDF of a [thesis-toolkit](https://github.com/wayne930242/thesis-toolkit) project beside the Markdown note being written, and the live editor completes and displays that project's citations. Markdown stays the only source: the toolkit's template converts it to Typst when it compiles.

## What a person sees

- A note inside `<projectsDir>/<project>/` of a `thesis-toolkit.json` gets a **Typst preview** button in the editor toolbar (local workspaces, 768px and wider).
- The button opens a dock between the page and the assistant dock. It shows `project / target`, the pages of the compiled PDF, a Recompile button, and a target select when the project has several targets (the choice is remembered per project in this browser).
- The dock compiles when it opens, after each local save of a note in the project (the editor's 750 ms autosave is the debounce), and from Recompile, which covers edits made outside the app. On the journal skeleton the PDF follows the last keystroke by about 1.3 s.
- A new revision replaces the pages at the same page and the same fraction of the way down it.
- A failed compile keeps the last good pages, dimmed, under a banner with the first `error:` line and the log. The next good compile clears it.
- When the toolkit is missing or older than 0.1.6 the dock shows the command to run instead of pages.
- When the active note leaves the project, the dock keeps showing the last project.
- In a project note, `[@` completes keys of the project's bibliography by key, author or title word, and a citation reads as the default style prints it (`(Sosa 2007)`, `(Sosa 2007, 23)`, `Smith 及 Doe (2010)`) while the caret is on another line. A key the bibliography lacks keeps its source with a dotted underline. The file text never changes.
- Notes outside a project, and every note of a remote workspace, behave as before: no button, `[@x]` is plain text, `@` completes task tokens.

## Decisions

1. **thesis-toolkit is the only provider.** A project is recognized by the nearest `thesis-toolkit.json` at or above the note, inside the worktree, parsed with the toolkit's own schema (`root`, `projectsDir`, `bibliography`, no other key). No manifest or note names a command.
2. **The preview never writes into the worktree** (user decision, 2026-11-11). It compiles with `--output` into a temporary directory of the server; the toolkit's own `references.generated.bib` is the only file a compile touches.
3. **One-shot compiles, coalesced on the server.** A compile asked for while its project and target are compiling waits for one more run that starts afterwards, shared by every request made meanwhile; at most two runs are alive at once. `typst watch` is not used, since it does not regenerate the bibliography subset.
4. **A dock, not a Focus tab.** A preview is a per-device view; a new tab kind would change the committed Focus file. The dock's state lives in `localStorage` (`mygitnotes:typst-preview-dock`), and `--assistant-dock-width` is the sum of both docks' widths.
5. **The editor's citation grammar is a second copy of the template's** (`md-cites` in zh-journal's `lib.typ`), in `@mygitnotes/core/citations`, tested with the template's own cases. The display is an approximation of the default style; the PDF is the authority.
6. **Local mode only.** The routes exist only in `createLocalApp`, and the web app asks them nothing unless the workspace is local.

## Server API

All routes are under `/api/typst-preview`, take the note's `path` (and `notebookId`), and answer only a page on this machine or its owner through `pnpm dev:remote`.

| Route | Answer |
|---|---|
| `GET project` | `{ project: null }`, or `{ project: { name, directory, targets, defaultTarget, bibliographyRevision }, toolkit: { ok: true, version } \| { ok: false, code: 'missing' \| 'too-old' \| 'unsupported-platform', version? } }` |
| `GET bibliography` | `{ revision, entries: [{ key, authors, year, title }] }`; 404 when the note is in no project or the file is missing |
| `POST compile { path, notebookId, target }` | `{ ok, revision?, durationMs, log }` once the run ends; 400 for a target the project lacks, 404 outside a project, 409 with `code` when the toolkit cannot compile |
| `GET pdf?target&revision` | the last good PDF; 404 when none, 409 when `revision` is no longer current |

The security rules are in [Security & Guards](../../agent/security/index.md).

## Out of scope

Remote and hosted workspaces; editing `.typ` files; citations in the read-only renderer, public pages and print; mapping Typst errors to Markdown lines; a PDF text layer, zoom and search; phones.

## Known limits

- thesis-toolkit 0.1.6 runs `typst` with `spawnSync` and does not forward signals, so a compile stopped by the 60 s timeout or by the server ending can leave its `typst` process to finish on its own.
- Typst stamps each PDF, so two compiles of the same text give two revisions.
- The first compile downloads `@preview/cmarker`; offline it fails with Typst's network error in the log.
