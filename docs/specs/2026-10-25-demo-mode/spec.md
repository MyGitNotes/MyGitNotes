# Demo mode (community)

A deployment can let visitors who are not signed in try the app on public content. They edit, commit and restore versions in their own browser; nothing they do reaches the server. This is the community part; an edition supplies the repository and the rules for who sees it (the Pro edition vendors its own).

## What a deployment supplies

- A `WorkspaceConfigSource` with `demo: true`. The session probe (`GET /api/auth/session`) then answers `demo: true`, which is how the web app learns the deployment offers a demo.
- For a visitor who is not signed in and sent the demo cookie, a member marked `demo: true` (`WorkspaceMember.demo`). `GET /api/workspace` copies the flag to `RepositoryStatus.demo` and keeps `write: false`.
- Nothing else changes server-side: every write route already refuses a request without a session (`signedIn`) or without `write` on its repository, so a demo request cannot change the repository, its manifest, its assets or its Agent documents, and `…/testing/memory-edition-source` can stand in for the edition's repository in tests.

## The demo cookie

`mygitnotes_demo` holds only a language (`en` or `zh-tw`), is written by the web app on a `/demo` page (`Path=/; Max-Age=86400; SameSite=Lax`, `Secure` on https) and carries no authority. `demoLanguage(request)` (`@mygitnotes/core/demo`) reads it and ignores anything else; the configuration source decides what the language selects. `demoNotebooks(config, language)` keeps, for each scenario (a notebook id without its `-en` or `-zh-tw` suffix), the notebook in the asked language, else its `-en` twin, else the first, and moves `default_notebook` to the kept twin.

## Web app

- `/demo` and `/demo/<scenario>` open the demo: the router's basename is `/demo`, so navigation, reloads and shared links stay there. `/:scenario` is resolved after the workspace loads to the notebook whose local id is the scenario or starts with `<scenario>-`; an unknown scenario opens the default notebook and the banner says so.
- `WorkspaceGate` writes the cookie before the session probe, then shows "The demo is not available" (no `demo` in the probe), "You are signed in" (a session exists), "The demo needs cookies" (no demo repository came back, with a retry), or the workspace with no sign-in screen. Outside the demo, a workspace answer that lists a `demo` repository is a session that ended in this tab and is reported as such.
- Changing the language in the demo rewrites the cookie and opens the same scenario again.
- A `DemoBanner` above the workspace says that edits and commits stay in this browser and are cleared 24 hours after the first change (with the time left once there is one), offers Reset demo and a call to action (`WebFeature.demoCallToAction`, default "Sign in to keep your own notes").

## What is local and what is not

`editable(repository)` is `write` or `demo`. Wherever an action ends in a working change or a commit it asks `editable`; everything the server would change stays on `write`.

| Local in the demo | Not available in the demo |
| --- | --- |
| Note content, title of a never-committed draft, status, tags, metadata; new notes; delete to trash; Kanban and list status changes | File moves, renames and new folders; asset upload, move and delete; the R2 panel |
| Focus layouts and other workspace documents, as document drafts | Bulk tag rename, merge and delete; bulk moves; folder manager; outline import |
| Working changes listed in Changes and committed; commit with a version name; restore from history | Manifest editing; Settings beyond Preferences (theme, language, editor); the agent panel; AI polish; publish rows; Gists |

Actions the demo does not offer are hidden, not shown disabled (the app's pattern for a repository that cannot change files). The Info tab does not call a demo repository read-only (`readOnlyReason`). A demo page whose workspace answer holds no demo repository (the browser signed in elsewhere) shows the signed-in notice instead of the person's own repositories, and `commitGroup` refuses any non-demo repository there, so "Commit in this browser" and a remote commit never meet.

## Local commits

A commit made in the demo is recorded in `localStorage` under `gh_notes_local_commits:<draft scope>` (`local-commits.ts`):

- one entry per commit with a 40-hex id (SHA-1 over the parent, date, message and changes), its parent (the server head, then the previous local commit), the stored text of each changed note (what the server's `commitNotes` would write, via `serializeNoteFile`) or its deletion with the server's note it replaced, the changed workspace-document pages, and the version it recorded (numbered after the repository's versions);
- at most 200 commits and 1 MB (UTF-8 bytes) per scope; a commit past either is refused before anything is written ("This demo keeps at most 200 commits (1 MB) in your browser. Reset the demo to keep going.").

`useWorkingNoteCommit` takes this path for a `demo` repository (`commitLocally`) and posts nothing.

Reads see the commits in two places only. The query overlay is `composeCommitted(committed, workingChanges)` in `setNoteQueryScope`: a committed note overlays server answers like a draft whose base is the server's note, so counts subtract it; a working change over it keeps its text and takes the same server base. Direct reads (`readNote`, `useNoteLookup().committed`, `findCommittedNote`, a workspace document's page) take the committed note.

History (`history-api.ts`): page 1 of a note's history lists its local commits above the repository's, marked "In this browser", with their versions (`HistoryPage.localCommits`); a local commit id or blob is read from the browser, anything else from the server; a local commit that did not change the file shows the repository head's text. The version panel offers "Commit as a new version" when `writable || localCommits`; marking, editing and deleting a version of a repository commit stay `writable`. Compare and restore work on the point texts and need nothing else.

## 24 hours

A demo repository keeps its browser data under its own namespace (`storageId`: `demo:<repository id>`), in the draft scope, the document drafts, the Focus views and the history stash alike. A signed-in person's repository that has the demo's id or notebook alias therefore never shares, shows or loses those keys, and the sweep matches only the demo's namespace, never a notebook alias.

`demo-storage.ts` keeps `gh_notes_demo:<draft scope>` = `{ firstWrite, base, repository, alias }` (`repository` is the namespaced storage id; `alias` names the repository's notebooks by key), written by the first persisted demo write the visitor made: working changes, editor drafts, document drafts, the history stash, a layout change of the (current) Focus and a local commit. Merely opening a notebook does not start the clock.

Focus view state the visitor did not choose (the Focus last shown, the active pane, pane sizes, the dock) is kept too, but is not a change. A scope with no clock gets `gh_notes_demo_view:<draft scope>` (same shape, written by the first such write) instead, and its Focus views are swept 24 hours after it; when a change starts the clock the view record is dropped and the clock rules the views. So no key of a demo scope outlives 24 hours, and the banner's "24 hours after your first change" stays true: view state is only ever cleared earlier than that, never later.

A Focus view is kept only once the workspace says which repository serves its notebook; until then it is neither read nor written, so no `github-notes:focus-view::<notebook key>` key (no repository in its name) is made. A scope's sweep also removes such a key left by version 0.11.0 when its notebook key starts with the scope's alias (any such key when the record predates `alias`).

- `expireDemoData()` runs at every app boot, on any route, before anything renders, and before each demo write; a scope whose record is 24 hours old loses every key it made (working changes, editor drafts and their conflict keys, document drafts, Focus views, stashed texts, local commits, the record). A write that finds its scope expired clears it, reloads the page and writes nothing (`demoExpired`/`noteDemoWrite` answer false, `appendLocalCommit` throws `DemoExpiredError`); every writer asks before it reads what it would write over, so expired data never comes back and the clock does not restart.
- When a deploy moves the demo repository's head, the workspace load finds the record's `base` differs and clears the scope; the banner says the demo was updated.
- Reset demo clears the scope at once. Demo scopes are not recorded as opened scopes for the offline screen.
- A browser runs no code while the site is closed, so data stays on disk until the next visit to the app after the 24 hours, and is removed then.

## Where it is tested

`packages/core/src/demo.test.ts`; `apps/local-server/tests/demo-member.test.ts`; in `apps/web/src`: `lib/demo.test.ts`, `lib/demo-storage.test.ts`, `lib/local-commits.test.ts`, `lib/draft-overlay.compose.test.ts`, `lib/history-api.demo.test.ts`, `lib/use-workspace-sync.demo.test.tsx`, `app/useWorkingNoteCommit.demo.test.tsx`, `app/useDemoScenario.test.tsx`, `components/WorkspaceSetup.demo.test.tsx`, `components/DemoBanner.test.tsx` and a demo case in `components/NoteHistoryPanel.test.tsx`.
