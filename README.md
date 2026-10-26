# MyGitNotes

A local-first workspace for Markdown notes, outlines, compilations, flashcards, and knowledge graphs, with a Pi agent beside your notes in local mode. Your content stays in Git; run the interface locally or deploy with Docker, Docker Compose, or Vercel.

[English](README.md) · [繁體中文](README.zh-TW.md)

[Live Demo](https://my-gh-core.vercel.app) · [Flashcard Demo](https://my-gh-core.vercel.app/notes/study?notebook=learning&path=notes%2Flearning%2F%E5%AD%B8%E7%BF%92-%E4%B8%80%E6%AC%A1%E4%B8%80%E5%BC%B5%E5%8D%A1%E7%89%87.compilation.yml) · [Example Workspace](https://github.com/wayne930242/MyGitNotes/tree/main)

![MyGitNotes architecture](docs/assets/mygitnotes-architecture-en.png)

## Why combine both sides

Local-first tools keep files on your device; cloud-document tools give you a browser and multi-device experience. MyGitNotes points both ways of working at the same Markdown and Git workspace. There is no second cloud copy to export, import, or reconcile.

## How it works

Markdown is the content source, Git records and publishes changes, and the repository owner controls credentials and access. A local checkout, Docker container, or Vercel deployment provides the interface and MCP endpoint; remote mode reads and writes the selected GitHub or GitLab repository.

One repository uses two branches in separate worktrees:

- **core** contains product source, packages, tests, scripts, and documentation.
- **main** contains workspace configuration, notebooks, assets, and workspace Agent settings.

## Quick start

Requires Node.js 22+, pnpm 12+, and Git 2.42+. Local mode needs no OAuth account.

~~~bash
git clone --branch core --single-branch https://github.com/wayne930242/MyGitNotes.git mygitnotes
cd mygitnotes
pnpm install
pnpm build                 # builds the packages the bootstrap script needs
pnpm bootstrap-workspace   # creates the main worktree in ./workspace (ignored by Git), writes MYGITNOTES_LOCAL_PATH to .env, and sets up the upstream remote
pnpm dev
~~~

Bootstrap renames the MyGitNotes remote from `origin` to `upstream` (or adds `upstream` when `origin` is already your repository), so `origin` can be your own repository while `pnpm update-core` keeps fetching Core from `upstream`. To keep your notes in your repository, create an empty one and push both branches:

~~~bash
git remote add origin <your-repository-url>
git push -u origin core main
~~~

Open http://localhost:5173; the new workspace appears in the Notes view.

Already have a workspace? Instead of bootstrap, run from the Core checkout:

~~~bash
pnpm link-workspace "/absolute/path/to/workspace"
pnpm dev
~~~

`link-workspace` validates the existing manifest and schema, then saves `MYGITNOTES_SOURCE=local` and the absolute `MYGITNOTES_LOCAL_PATH` in Core's `.env`, preserving unrelated settings.
It does not change notes or Git remotes, create worktrees, or migrate the workspace.
For an older schema, run `pnpm migrate-workspace --workspace "/absolute/path/to/workspace"` explicitly before linking; for a newer schema, update Core first.
An existing nonempty `REPO_ROOT` in `.env` follows the linked workspace too; an absent or empty value stays unchanged.
Shell environment settings still override `.env`.
`pnpm dev:remote` shares the same local workspace through Tailscale; it does not select a GitHub/GitLab source.
Both dev commands show `link-workspace` guidance if the workspace is missing.

## Deploy

The [deployment guide](docs/deploy.md) covers each path step by step:

- [Vercel through GitHub Actions sparse checkout](docs/deploy.md#vercel-through-github-actions-sparse-checkout-default) (default), or through the Vercel Git integration
- [Docker Compose](docs/deploy.md#docker-compose-with-a-remote-repository) or [plain Docker](docs/deploy.md#plain-docker-with-a-remote-repository) with a remote repository, optionally [behind a reverse proxy](docs/deploy.md#public-access-behind-a-reverse-proxy)
- [A local checkout inside a container](docs/deploy.md#local-checkout-inside-a-container)
- [GitLab as the note source](docs/deploy.md#gitlab-source-overlay)
- [GitHub Enterprise as the note source](docs/deploy.md#github-enterprise-source-overlay)
- [Private R2 assets](docs/deploy.md#optional-private-r2-assets)
- [The agent panel through Pi on your own computer](docs/pi-bridge.md) (`npx mygitnotes-pi-bridge`)

## Update

Run `pnpm update-core` from a clean `core` checkout; it fast-forwards `core` from `upstream/core`. Then `pnpm install && pnpm dev`. Hosted GitHub deployments that name their product repository (`MYGITNOTES_PRODUCT_REPOSITORY`) update from Settings. See [Core updates](docs/deploy.md#core-updates) and [Update and migrate](docs/deploy.md#update-and-migrate).

## Features

- Notes use ordinary Markdown with optional YAML frontmatter; Git preserves history and records explicit commits.
- Browse notes flat (every note under the selected folder, the default), by folder (one level with its subfolders), or on a Kanban board; the notes show as a table where the page has room and as cards where it is narrow (below 720px, such as beside the agent panel; a phone lists two-line rows instead, see Focus below); the dock beside a Focus lists two-line rows instead (see Focus below). The toolbar's sort menu (an icon showing the current order) orders the list; its Group by folder button splits a list spanning subfolders into one group per folder, in the sidebar's folder order, with the sort applied within each group (off by default); clicking a folder's heading collapses its notes. The Notes page shows one notebook, picked in the header, and the sidebar selects one folder at a time; search full text, manage folders and files, and explore a knowledge graph, whose filters still take several folders and can span every notebook.
- A notebook's statuses in `.mygitnotes.yaml` can carry a display name per UI language: `statuses: [{ name: working, color: blue, label: { en: In progress, zh-TW: 進行中 } }]`, or a plain `label: 進行中`. `name` is still what a note's `status:` stores; the status select, Kanban columns, filters and the graph legend show the label for the current language and fall back to `name`. The default statuses (`inbox`, `working`, `done`, `archived`) show translated names in Traditional Chinese unless the manifest gives a label; English shows the stored name as written. Labels from several notebooks merge per language, the first notebook giving a language winning it.
- In the sidebar, drag a folder to reorder it among its siblings or drop it into another folder (with a mouse at once, on touch after a long press), and drop a note from the note list or its cards on a folder or its notebook to move it there (on touch, long-press the note, then drag; letting go without moving selects it); its Move button picks a folder too. A move stops only when the notes it moves hold drafts, and names them; a single moved note takes its own draft along.
- A Focus arranges notes the way an editor arranges files: panes in a split tree, each holding tabs. Drag a note or a tab onto the edge of a pane, or use the Split right and Split down buttons beside its tab bar (a pane narrower than 560px folds them, Add matching and Hide toolbar into one Pane actions menu, so its tabs keep room for a title), to open it in a new pane; closing a pane's last tab removes the pane, and Merge all panes folds everything back into one. A Focus holds up to 8 panes nested up to 4 splits deep, splits only on screens wide enough to show them all, and is saved in `.github-notes-focus.yaml`. The Notes page always shows a Focus: the one you used last, else the Default Focus. The Default Focus cannot be closed, only cleared (Clear in its menu empties every pane into one, at once); a named Focus can be closed or cleared (Clear asks first), and closing or deleting it shows the Default. While the shown Focus has no open note, the notes list fills the page in full, as plain browsing lists them, with the browse region's dock and its collapsed state kept as they were; opening a note from it fills the Focus again. The button at the left end of the Notes toolbar collapses the browse region, the notebook sidebar and the header together, so the Focus gets the whole window, and brings them back with a short animation (none with reduced motion); the Command palette's Collapse/Expand browse panel and header does the same, and Files, Graph, Settings and zoom always show the header. A device starts with them shown and remembers the choice. The browse region keeps its width, and its collapsed state is kept in this browser. Beside a Focus the browse region is a narrow dock (240px by default, 200px at least) that lists each note as a status dot and a title of up to two lines, every row the same height; the dot is a button that opens the status menu (it is inert in a read-only notebook), and the note the active pane shows is marked. Resting the pointer on a row, or focusing it with the keyboard (arrow keys move between rows, the right arrow moves into the card), opens a card beside the dock with the note's status, all its tags, created and updated dates, folder, the opening of its text, and Open in zoom, Move and Delete; Escape or leaving closes it. In the same state the notebook sidebar folds to an icon rail (Notebooks, Status and Tags; Git changes live in the right rail's Changes panel), and each icon opens its section as a flyout beside it, which closes after a notebook, folder or status is picked (tags stay open for several picks), on Escape or on a click outside it; the filters in force show as removable chips above the list, with a "+ Filter" chip that opens a section and "Clear all". Below 1101px the sidebar stays a drawer and the chips open it; a full-width list keeps the expanded sidebar. On a phone (below 768px) the Notes page is two screens, a list and a note, and never both. The list screen has one 44px bar (the sidebar drawer, the notebook switcher and the search), the filters in force as chips with a Filter chip that opens a bottom sheet (view, order, hidden notes, then status and tags), the same two-line rows with their status dots, and the bottom navigation, whose centre + is the only way to add a note. A note opens on its own screen under one 44px bar: back to the list, the title, the status dot, an edit/read button and ⋯. The bar slides away as the text scrolls down and returns on scrolling up; ⋯ opens a bottom sheet with the status, the tags, the right rail's eight tools (each opens as a full-height sheet), and rename, move, add to outline, export, copy and delete (which asks for a second tap). Escape, a tap beside a sheet or a swipe down closes it. The header, the pane tab bar, the word count and the tool rail are not shown on the Notes page, only the bottom navigation.
- A note's top bars: the actions first, then a note row. The actions are the view — one button switches live preview and source (its icon is the mode in use, in a graph card too; in zoom and in a Focus pane the leader `Mod+Shift+E` then `M` does the same, beside `F` for find and `/` for the outline), the line numbers toggle and the formatting toolbar toggle — and a `⋯` menu with Add to outline, Move note, and the export and copy items. A Focus pane puts them in its tab bar, ahead of its split, batch-add, zoom and hide buttons; zoom adds refresh and the document panel and assistant toggles. The note row holds the title (click it to edit in place; Enter or leaving the field renames the note — title and file name together, the new file name shown while you type — and Escape cancels), the status, the tag chips (remove with ×, add with autocomplete, a `+N` that lists every tag when the row is narrow) and a `{ }` button that opens the full frontmatter, where the Title field renames the same way. A pane's hide-toolbar button hides the note row; in zoom the back button, note row and actions share one row. In a Focus pane narrower than 720px the document card drops its frame and margin; a phone has no note row: the note screen's title bar and its ⋯ sheet carry the actions. On a phone the text has no card frame and no line numbers, whatever this device chose for larger screens, and a long word, link or line of code wraps inside the page.
- Settings → Editor turns on Vim keys for this browser in live preview and the file source editor, with Vim's status line below the text; a note's source mode stays a plain text box. `:w` does what the note's Commit does (Save in a note saved by hand), `:q` closes a zoomed note, and `:wq` or `:x` commits, then closes only if the commit succeeded. In normal mode Escape still closes the note's panel. The shortcut help (`Mod+/`) then lists the Vim keys as their own group, which filtering for `vim` shows whole.
- [Compilations](#compilations) organize notebook content and replace the old Screen lanes; Markdown pages can also become flashcards.
- Local mode offers a [Pi agent](#pi-agent-local-mode) in a dock beside the page, and [`pnpm dev:remote`](#use-it-from-other-devices-pnpm-devremote) opens the workspace from your other devices.
- Run a notebook as a small project with plain text. A task line takes `@name` owners (`@小林` works), one Obsidian Tasks priority emoji (`🔺` highest, `⏫` high, `🔼` medium, `🔽` low, `⏬` lowest) and the existing `🛫` start and `📅` due dates; a note whose frontmatter has `milestone: 2026-11-06` is a milestone. The Todo tool shows owners and priority on each task, filters by person (or Unassigned) and by priority, and can sort by priority; its Gantt tints bars by priority and draws each milestone as a diamond with the note's title (a past milestone whose note has no open task no longer stretches the date range back to its day, whatever People or Priority filter is on), and the Calendar marks milestones on their day. Nothing is stored outside the note, so toggling a task keeps every token.
- Choose from **nine palette families**, each with light and dark variants. **Flexoki** is the default; choices are saved in the browser.
- A deployment can offer a **demo** at `/demo/<scenario>`, which opens that notebook's `index.md` (its guide) when it has one, to visitors who are not signed in: they edit, commit with version names and restore in their own browser, with commits shown in the version history beside the repository's own, and everything is cleared 24 hours after their first change. A community deployment supplies the demo repository through its configuration source (`WorkspaceConfigSource.demo`, see [demo mode](docs/specs/2026-10-25-demo-mode/spec.md)).
- An image in a note can carry review comments: an `:::annotate` block holds the image and one row per annotation, a numbered pin or a framed region with a Markdown comment and an optional resolved flag, and the live editor adds them by clicking or dragging on the image (each edit one undoable change to the note's text). Notes, books, print and public pages show them as markers over the image beside a list, with resolved comments folded away; see [image annotations](docs/specs/2026-10-25-image-annotations/spec.md).
- Connect local agents through stdio or remote agents through Streamable HTTP MCP with named read-only or write grants.
- The Files page manages notebook folders, notes, text files, and attachments: 3 MiB uploads, 5 MiB reads and changes, up to 200 changed files per operation.

## Compilations

A compilation is a `<name>.compilation.yml` file in a notebook, tracked and synced by Git like a note.
Its members are picked by hand (notes, folders, attachments or YouTube videos) or gathered dynamically by tag or folder.
Dynamic compilations sort by updated time, created time, title or status, or by your own order.
They display as a card row (thumbnail, small, medium), a book with a contents list, or a graph.
Click a card or a book section to edit its note in place; its title opens the note in zoom.
A book reads as one continuous scroll or one chapter at a time (Paged, with Previous/Next, ← and →, and swipes on a touch screen); the choice is kept in this browser, not in the file.
In a narrow pane or on a phone, the cards stack top to bottom.
A compilation also keeps study settings for reading and reviewing its members; see the [study and flashcard guide](docs/agent/study.md).

The old Screen lanes are now compilations.
Running `pnpm migrate-workspace` on a schema 2 workspace turns each lane into a compilation and points Focus lane tabs at the new files.

## Outline notes

Use **New → New outline** to create a named `*.outline.md` note, or **Add to outline** from a note or compilation to insert its link into an existing or new outline.
A notebook can contain multiple outlines; find them under **Outlines** and edit them in the normal live/raw note editor.
Items can contain text, multiple optional Markdown links, annotations and children.
Enter adds a sibling, Shift+Enter adds an annotation, and Tab/Shift+Tab indent or promote a subtree.
The live editor also supports same-document drag handles and one-step undo; toolbar indentation works without a hardware keyboard, and Escape then Tab leaves the editor.
Deleting an item does not delete linked content.
HTTP(S) links open explicitly with opener isolation, without preview fetching.

Outlines use normal note saves and Changes: local saves write the worktree; remote saves stage browser drafts until you commit.
Managed moves update relative links together with the moved files, scoped to their repository.
Read-only and recovery behavior follows the normal editor.

### Legacy bookmark recovery and import

**New → Import legacy bookmarks** offers exact saved-source export and a read-only preview, including on read-only repositories.
Choose the repository, notebook, new title/path and entry IDs explicitly.
Note, compilation and safe web links can become outline items; old groups become text parents.
Positions, queries and folders remain in the original source with their IDs, labels and reasons shown.
Converting only the representable subset requires **partial import** acknowledgement.
Apply creates a new file only: a local worktree file or one remote commit, as the preview states.
Cancel writes nothing, and uncertain results require inspecting the original destination rather than automatic retry.

The original `.mygitnotes-bookmarks.yaml` is retained and protected; legacy editing and resolver endpoints are retired.
A workspace notice exposes pending browser envelopes from every configured repository, including unavailable repositories and malformed drafts.
Export preserves the exact envelope and its original base/revision; discard requires repository-specific confirmation and refuses a changed draft.
Legacy drafts never autosave, merge into saved source or enter normal Changes.
They remain a file-move blocker until explicitly discarded.

## Pi agent (local mode)

With [Pi](https://github.com/earendil-works/pi) installed, local mode adds the assistant dock: a column below the header, between the page (a Focus, the Files page, a graph or Settings) and the right panel, so the order is Focus, Agent, document panel, right rail. A zoomed note or compilation has no right panel, so the dock is at the window's right edge beside it.
The agent button in the header and the one at the end of the zoom editor's actions open and close it; they are hidden when `pi` (or the command in `MYGITNOTES_PI_COMMAND`) is not found, and the header then offers the Agents page button in their place.
While the dock is offered, the Agents page opens from the dock's header.
`Cmd+'` on macOS (``Ctrl+` `` elsewhere) from outside the dock opens it, focuses the message box and starts Pi if none runs; from the message box it returns to the editor the agent names, or closes the dock when no note is open.

- The dock is 380px wide by default. Drag its left edge, or focus the edge and press the arrow keys, to resize it between 320px and half the window; Expand switches to half the window, at most 760px.
  Whether it is open and how wide persist in the browser, separately from the right panel, and a zoomed note or compilation ends at the dock's left edge, so the two sit side by side.
  Below 768px the dock is a full-screen sheet with a close button.
- `pi --mode rpc` starts in the background when the workspace loads; after a page reload or a `pnpm dev` restart, the dock resumes the same conversation.
- Pi runs in an agent workspace: a folder with its own core instructions (`AGENTS.md`) and skills (`.agents/skills/`), set up on the Agents page.
  It starts at the repository root; click the workspace name in the header to switch, which ends the current conversation.
- MCP servers are configured in Pi itself (`pi mcp add`, or `/mcp` in the chat), never in the repository.
- Each message can name the open file. The context chip above the message box shows the target (`file:line`, the path, or *No file*) and opens a menu: **Line** adds the caret line or selection, **Path only** adds just the path, and **None** adds nothing.
  Paths are relative to the folder Pi runs in.
- Images are offered only while the session's model declares image input (a text-only model, such as MyGitNotes Pro's built-in one, shows no paperclip and takes no paste or drop). Attach them with the paperclip beside the model select, by pasting one into the message box, or by dropping files on it.
  Thumbnails with a remove button wait above the box and go with the next message, including one that steers a running reply; Send also works with an image and no text.
  Pi's RPC takes PNG, JPEG, GIF and WebP in a prompt's `images` field, so those are the types accepted, at most 5 images of 5 MB each and 10 MB together; another file is refused with a message naming it.
  Pasting text that comes with an image of it pastes the text. A shell run (`!command`) or built-in (`/new`) takes no images and leaves them waiting.
  Pi's RPC mode has no other attachment type (`@file` arguments are a terminal feature it rejects), so other files are not uploaded; Pi reads files in the workspace itself.
  Images already attached stay if you switch to a model that cannot read them, but sending is refused with a message until you remove them. Messages held while Pi starts are checked against the 16 MB a WebSocket frame may carry before they are sent, and a set that is too large is refused rather than lost.
- What you type in the message box is saved in the browser as you type, one draft per agent workspace, and comes back after a reload, after the dock is closed and opened again, and after switching away from a workspace and back.
  It is removed only when the message is sent (or you empty the box yourself), never when a send is refused or the dock closes; a full or blocked browser storage just means the draft is not kept. A message held while Pi starts keeps its stored draft until it is written to the socket. Signing out removes every saved draft.
  Attached images are not saved, since a few of them would fill the browser's storage quota; they wait only while the dock stays open, and a reload asks you to attach them again.
- Switch the model and thinking level from the selects in the message box's bottom row.
  Replies render as Markdown, links to notes open in the app, and questions Pi's extensions ask appear as cards in the conversation.
  Consecutive tool calls fold into one row (*Ran 2 tools: bash, read*) that opens onto the calls; it stays open while a tool runs or after one failed.
- When Pi changes a file on disk, the open editor updates at once.
  Unsaved edits are merged first; if they cannot be merged, the editor blocks and keeps your draft.
- Pi decides from `~/.pi/agent/trust.json` whether to load project settings.
  Buttons in the message box's top row, beside the context chip, open its trust decision, MCP servers and extension status.

Pi runs as your local user and can run any command, so the agent accepts only local connections; through `pnpm dev:remote` it admits only the Tailscale login that owns this machine.
See the [security model](docs/agent/security/index.md).

## Use it from other devices (`pnpm dev:remote`)

`pnpm dev:remote` runs `pnpm dev` and shares it over HTTPS with Tailscale Serve, so a tablet or phone on the same tailnet can open it from another room.
It shares the same local workspace; it does not select a GitHub/GitLab source.
Other tailnet members can open the notes, while the Pi agent stays with the machine's owner; on a phone the dock takes the full screen.
If it does not connect, see [Remote access with Tailscale](#remote-access-with-tailscale) below.

## Documentation

- [Deployment guide](docs/deploy.md)
- [Agent and developer documentation](docs/agent/index.md)
- [Architecture](docs/agent/architecture/index.md)
- [MCP interface and security model](docs/agent/mcp/index.md)
- [Demo workspace](examples/demo-workspace/README.md)
- [Study and flashcard guide](docs/agent/study.md)

## License

The community edition is licensed under [AGPL-3.0](LICENSE). Contributions need the [Contributor License Agreement](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).

## Startup troubleshooting

### Workspace and pnpm

If startup reports a missing workspace, use `pnpm link-workspace "/absolute/path/to/workspace"` for existing notes.
Use `pnpm bootstrap-workspace` only when creating a workspace; it is not a repair command for an existing one.
A pnpm warning about its native executable, followed by successful fallback to the JavaScript CLI, is nonfatal.
If startup exits, check the subsequent error rather than treating that warning as the cause.

### Remote access with Tailscale

- **Same tailnet:** the server and browsing device must join the same tailnet.
  WSL and Windows may run separate Tailscale clients signed into different accounts or tailnets; check both.
- **DNS / `DNS_PROBE_FINISHED_NXDOMAIN`:** enable **Use Tailscale DNS settings** on the browsing device.
  Browser Secure DNS may bypass the system resolver; check the browser's resolver settings (`chrome://settings/security` in Chrome) so the tailnet hostname uses Tailscale DNS.
  Do not disable browser security globally.
- **Browser permission:** if a trusted site's browser prompt requests local-network access, choose **Allow local access**.
  If previously denied, review that site's local-network permission.
  This permission is separate from DNS resolution: granting it does not fix NXDOMAIN, and it is not Tailscale's exit-node LAN-access setting.
- **Serve activation / `node not found`:** ensure the browser's Tailscale admin console is signed into the server's tailnet.
  Check browser local-network permission only if prompted or blocked; it is not a proven universal cause of this message.
  In the correct tailnet, open [DNS settings](https://login.tailscale.com/admin/dns) → **HTTPS Certificates**, following the [official HTTPS instructions][tailscale-https].
- **`Access denied: serve config denied` on Linux/WSL:** an administrator can run the following once on the server to grant the current user local Tailscale management:

  ~~~bash
  sudo tailscale set --operator="$USER"
  ~~~

  This grants Tailscale management privileges to that user; do not run the entire `pnpm dev` or `pnpm dev:remote` command with sudo.
- **Lifecycle:** `dev:remote` runs Serve in the foreground; keep the command running while using the remote page.
  After changing tailnets, stop and rerun `pnpm dev:remote`, then open the newly printed URL rather than an old bookmark.

[tailscale-https]: https://tailscale.com/kb/1153/enabling-https
