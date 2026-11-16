# Model Context Protocol (MCP) Server

The `@mygitnotes/mcp-server` package provides an MCP interface for external agents to safely inspect and manipulate a MyGitNotes workspace.

## Transport

Default transport is **stdio** for local agent integration (e.g. Claude Desktop, Codex, Antigravity, or custom agent orchestrators).

## Exposed Tools

1. `get_workspace_config`: Returns parsed `.mygitnotes.yaml` (or legacy `.github-notes.yaml`) workspace manifest. A notebook's `statuses` entries are returned as written: a bare name or `{ name, color, label }`, so a client must read `entry.name` when an entry is an object. `label` is display-only (a string or a map of UI language to string); agents must write `name` to a note's `status:`, never a label.
2. `list_notebooks`: Lists all configured notebooks and their root directories.
3. `list_notes`: Lists note summaries within a notebook, paged by `offset` and `limit` (default 100), returning `total` and `nextOffset`. Each entry carries frontmatter, a file path and a bounded `description` in place of the Markdown body.
4. `read_note`: Reads a note file and parses its frontmatter and raw Markdown body (supports `metadataOnly: true` to return metadata without the markdown body).
5. `save_note`: Atomically creates or updates a note file with path traversal and branch checks, and commits to Git. A compilation (`*.compilation.yml`) is saved as its YAML like any note; its items are repository-relative paths in any notebook of the same repository, and a folder source must lie in one of them. A custom compilation's `items` may hold `{ id, kind: heading, title }` entries, each starting a chapter of the items after it up to the next heading. A note item may carry `anchor: <heading text>` and then shows only that heading's section, matched like a `#heading` link. A dynamic compilation may set `group: folder` for one chapter per folder. If `content` is omitted, updates frontmatter metadata only. On an existing note, frontmatter keys left out of `metadata` keep their values, so a save without `metadata` keeps the frontmatter. The commit is marked as an agent edit (see below). Returns the note `path`. With `template` (a template id of the note's notebook) it creates a note from that template instead; see Note templates below.
6. `delete_note`: Removes a note file, together with its version file, and creates a corresponding deletion commit. Paths that are not notes, such as version files under `.mygitnotes/versions`, are refused.
7. `read_agent_resource`: Reads an agent instruction or doc file safely; lists available agent resources (`AGENTS.md`, `docs/agent/**`) if `path` is omitted.
8. `list_assets`: Lists a notebook's assets. With private R2 storage configured the bucket objects are listed alongside the repository files, and every entry names its `storage` and the `reference` a note links it by.
9. `add_asset`: Stores an asset file (with optional subfolder directory) and returns the reference a note links it by. With private R2 storage configured the file is uploaded to `<notebookId>/<directory>/<filename>` in the bucket (below the key prefix of the asset storage's scope when an edition supplies one) and the response carries `storage: "r2"`, the object `key` and an `r2:<object-key>` `reference`; otherwise it is written into the notebook asset directory, committed, and returned as a notebook-relative path.
10. `delete_asset`: Removes an asset. A repository path is deleted with a Git commit; an `r2:<object-key>` reference deletes that bucket object, refused while a note still links it unless `force` is true.
11. `get_git_status`: Returns branch name, clean/dirty state, and recent commit history for each available repository; unavailable repositories are reported.
12. `git_commit`: Creates an atomic commit in the repository selected by `notebookId` (optional only in a single-repository workspace). Files cannot span repositories.
13. `update_core`: Performs the guarded Core update workflow, or inspects available updates if `checkOnly: true`.
14. `list_folders`: Returns notebook-relative folder paths and `_dir.yml` display metadata, or inspects a specific folder if `path` is provided.
15. `mkdir`: Creates a notebook folder or updates display metadata (`title`, `order`, `description`, and custom fields) in `_dir.yml` (supports `overwrite: true`), creating an atomic Git commit.
16. `search_notes`: Searches note files using plain text or regular expressions (regex). Hosted sources rank results; see below.
17. `replace_notes`: Searches and replaces plain text or regular expressions across note files and creates an atomic Git commit.
18. `get_statuses`: Returns configured, observed, and available valid note statuses for a notebook or workspace to ensure accurate status tagging. Statuses are names only (colours and labels are dropped), and these names are what an agent writes to `status:`; a notebook with an empty or missing `statuses` list reports the default statuses as its configured ones.
19. `list_templates`: Lists the note templates of a notebook (`notebookId`), or of every notebook, each with the placeholders it exposes and its last use, the most recently used first; `query` narrows the list, `limit` cuts it, and `templateId` returns one template with its file text; see Note templates below.
20. `download_assets`: "Download with images" for one note (`path`): reads the private R2 objects the note references into the checkout's R2 cache and returns, per object, its `key`, `reference`, the cached `file` path, `size` and whether this call `downloaded` it, plus `missing` (`key`, `reason`) for the ones it could not get. Nothing is written into the repository. An object already cached is not read again unless `refresh` is true, and an object over 64 MiB is left out and named in `missing`; see Private R2 downloads below.

> [!NOTE]
> Backward Compatibility: Redundant endpoints (`get_note_metadata`, `update_note_metadata`, `get_folder_metadata`, `update_folder_metadata`, `list_agent_resources`, `check_core_update`) remain supported via tool dispatch aliases for backward compatibility with existing callers.

## Note templates

A notebook's templates are the Markdown files directly in `<notebook root>/.templates/` (the id is the file name without `.md`) and the ones its manifest registers under `notebooks[].templates`, the manifest's first; on an id clash the manifest entry wins. A template's frontmatter may carry a `template:` block (`name`, `description`, a `path` pattern relative to the notebook root, and `placeholders` with a description and an optional `default`), which never reaches a created note; every other frontmatter key is copied. A note created from a template carries `template: <template id>` instead: in a template file `template:` is the block, in a note it is this id string, and nothing treats the note differently for it. A placeholder is written `{{name}}` in the frontmatter values or the body; `title`, `date` (`YYYY-MM-DD`) and `time` (`HH:mm`) are built in and read the server's clock in the deployment's `MYGITNOTES_TIMEZONE` (UTC when unset) unless a value names them.

- `list_templates { notebookId?, query?, templateId?, limit? }` returns `templates`, `total` (the matches before the limit) and `truncated`. Per template: `notebookId`, `id`, `name`, `description`, `source` (`file` or `manifest`), `file` (the template file's path), the `path` pattern if any, `lastUsed` (an ISO date or `null`), and `placeholders` (`name`, `description`, `default`, `declared`; the built-in ones carry `builtin: true`). The app's own built-in templates (Slides) are text of the web app and are not listed.
  - `query` matches its words against `id`, `name` and `description`, whatever the case; every word must match.
  - Order: the most recently used first, then the never-used by name. `lastUsed` is the newest `created` (else `updated`) date among the notebook's notes whose frontmatter says `template: <id>`, read from the notes index (`templateLastUse`), never from a note body.
  - `limit` defaults to 20 and is at most 100. A listing of several repositories applies one order and one limit across them (`mergeTemplateLists`).
  - `templateId` with `notebookId` returns that one template with its file text as `content`, which is how an agent reads a template; a `templateId` without a `notebookId` is refused.
- `save_note` with `template` and `values` creates a note: `notebookId` names the notebook (a `path` alone names the notebook that holds it), and `path` may be left out when the template declares a `path` pattern, which is filled from `values`, the built-ins and the declared defaults, each value made safe as a file name. A value fills its placeholder, then the declared default; a placeholder with neither stays as literal `{{name}}` text and is listed in the result's `unfilled`. `content`, `metadata`, `tags`, `status` and `title` given by the caller win over the template's; without a `title` the note is titled by its file name. The call is refused when a value names no placeholder of the template (the message lists the placeholders), when the path pattern has a placeholder without a value, or when a note already exists at the path. The created note carries `template: <id>`, whatever `metadata` the caller gave.
- `render_template { notebookId, templateId, title, values? }` is a legacy hosted tool (`legacyRemoteTools`): `tools/list` no longer offers it, and a client that already calls it is still answered with `metadata`, `content` and `unfilled`. `list_templates` with `templateId` shows a template and `save_note` creates from it.
- The rule for an agent is the product's, not a notebook's: `TEMPLATE_GUIDANCE` (`packages/mcp-server/src/template-guidance.ts`) is part of the `list_templates` and `save_note` descriptions and of the `instructions` both servers answer `initialize` with (stdio `createMCPServer`, hosted `/mcp`). It says to call `list_templates` with a query for the kind of note before creating one, to ask the user whether to use a template that fits, and then to create with `save_note`'s `template` and `values`, filling every declared placeholder it can; a notebook's `AGENTS.md` may say otherwise. The web chat agent's `mygitnotes_list_templates` and `mygitnotes_write_note` say the same.
- The parsed template list is cached by content, never by time, so an edit is seen at once. A worktree keeps each parsed template file in memory while its size, change times and inode are unchanged (`readTemplates` in `packages/core/src/templates.ts`, as `scanNotebookFiles` keeps notes; a file changed within the last two seconds is never kept). A remote source stores the list in the remote cache under a key made of the `.templates` tree SHA and the blob SHAs of the manifest's template files (`RemoteSource.notebookTemplates`), so a commit that leaves the templates alone reads none of them; `lastUsed` is kept with the notes index's derived results (`catalog().memo('template-use')`).
- The hosted `read`, `write`, `append`, `edit` and `rm` accept a template file by its exact path (`<notebook root>/.templates/<name>.md`), so an agent can read and maintain templates; listings, globs and searches never show them, and no other dot folder is reachable.

## Private R2 downloads

`download_assets { path }` is the one tool for taking a note's `r2:` objects out of the bucket, and it only ever reaches keys the note at `path` references (`r2ReferenceKeys`), the check `/r2-assets` makes.

- Hosted `/mcp` (`remoteTools`, also offered to a read-only grant) cannot write the caller's disk, so it answers `{ path, assets, total, nextOffset }`: per object `key`, `reference`, a presigned GET `url`, `expiresIn` (300 seconds, as the `/r2-assets` redirect) and `contentType`. The note is read with the grant's own permission (`reader.note`, so a path that is not a configured note is refused), keys outside the call's asset scope (`AssetStorage`, `inAssetScope`) are left out, and one call answers at most 50 URLs (default 20; `offset` and `limit` page the rest). The caller GETs a URL with no credential. Without a bucket for the call it answers `R2 storage is not configured.`
- The local stdio server writes the objects into the checkout's cache (`r2CacheRoot(productRoot)`: `MYGITNOTES_R2_CACHE_DIR`, else `.cache/r2-assets` in the Core checkout, outside every repository) and answers `{ path, cache, assets, missing }`. The path must be a note of the workspace (`assertNoteResource`, then `classifyResource`), as for `/r2-assets`. Objects come from the call's bucket (`ToolAssets.scope`, the environment's by default), or without one from the hosted deployment `MYGITNOTES_R2_REMOTE_URL` names, asked through its `download_assets` with the agent token `MYGITNOTES_R2_REMOTE_TOKEN` (`hostedR2SourceFromEnv`); a storage that has no bucket for the call is never replaced by the environment's bucket keys.
- The same module (`packages/core/src/r2-local.ts`: `r2Cache`, `bucketR2Source`, `hostedR2Source`, `downloadNoteR2Objects`) backs `pnpm r2-download` and the local server's `/r2-assets` route, which answers a cached object from disk and reads a missing one once (`createLocalR2AssetHandler`). The web app's "Download with images (.zip)" builds its archive in the browser from `/r2-assets` (`apps/web/src/lib/note-archive.ts`).

## Source selection and hosted access

The stdio command is `packages/mcp-server/src/main.ts` (bin `github-notes-mcp`, `pnpm --filter @mygitnotes/mcp-server start [repository]`); the package entry `index.ts` only exports, so an edition that imports or bundles `@mygitnotes/mcp-server` starts no server on its own stdin and stdout. The stdio entry resolves `mygitnotes.server.yaml` (or legacy `github-notes.server.yaml`) from its repository argument.
A local source uses the filesystem tools above; a GitHub or GitLab source exposes
remote read tools against the configured public repositories. Stdio and hosted
sessions resolve each notebook against the repository whose own manifest declares it. Path-only
tools accept an optional `notebookId` to disambiguate identical paths in different
repositories; an unqualified path must lie in exactly one configured notebook.
A path outside every notebook is rejected. `cp` and `mv` cannot cross repositories.
Workspace-wide listings merge available repositories and report unavailable ones.

Hosted `/mcp` uses stateless Streamable HTTP. Settings → Access control creates
named read-only or write grants and shows a complete `/mcp/<token>` connector URL
once. ChatGPT uses that URL with No Authentication. Bearer headers at `/mcp`
remain supported. The URL is a credential scoped to the person who made it, the
deployment's site (`site`, `siteIdentity`) and the canonical audience. `/mcp`
verifies the grant before it resolves a workspace, then asks the configuration
source for the settings of the grant's person (`WorkspaceRequest.person`, with the
browser cookie removed, so a cookie never chooses the person), and every call sees
that person's visible repositories at the time of the call. A grant made before
grants bound to a person carries `source` instead: it is still accepted until its
owner revokes it, reaches only that repository while it is a visible member, and
lists nothing once the repository is hidden or removed. A community deployment where
each visitor chooses a repository keeps that choice in a browser cookie, so a grant
there lists nothing (before this change it answered 503). New grants have no
application TTL and survive logout, session expiry and deployments; owners revoke
individual grants in Settings.
GitLab access tokens, and short-lived GitHub OAuth app tokens issued with a refresh token, refresh through the shared server credential. Revoked provider authorization requires signing in again.
Rejected requests log a secret-free reason (`[mcp] unauthorized: …`, `[auth] credential rejected: …`, or a record sealed with another `SESSION_SECRET`).
A rejected request on an existing grant also keeps its reason and time for seven days as `lastRejection` on the Settings grant list (`GET /api/auth/agent-tokens`).
Legacy session-bound grants retain their original expiry.

An edition's `IdentityService` may also accept a bearer this server did not issue (`bearerGrant`, see [identity service](../../specs/2026-10-19-identity-service/spec.md#outside-bearers)), such as an OIDC access token a trusted service obtained on a person's behalf. A bearer shaped like a stored grant always resolves through the record store. Any other bearer in the `Authorization` header is handed to the identity, which verifies it and names the person, whether the call may write, the site and optionally the author of the call's commits; the call then runs as that person's grant would, with the credential the identity gives its grants. The bearer is not kept, logged or sent to a provider, and a refusal answers the same 401 as a missing grant. The community edition's identity accepts no such bearer.

Hosted tools include `ls`, `glob`, `read`, `find`, `write`, `append`, `edit`,
`mkdir`, `cp`, `mv`, and `rm`, plus the existing remote note and folder tools. Shell reads
and line edits include frontmatter; lines are one-based. `find` performs literal
text search over glob-selected notes. Hosted `search_notes` ranks notes for topic
lookups: space-separated words match independently across title, path,
frontmatter and body, Chinese phrases also match through bigrams, and
`notebookId`, `status`, `tags` and `pattern` filter before ranking (filters alone
list notes). Each match carries status, tags, matched terms and a snippet;
`limit` defaults to 20. Hosted `list_notes` pages note summaries with `offset`
and `limit` (default 100, maximum 500) and returns `total` and `nextOffset`; each
entry carries the frontmatter `description`, or the opening body line, capped at
240 characters, in place of the Markdown body. Hosted reads return an opaque
`revision` for the repositories they cover: `v1.` followed by unpadded base64url
of a UTF-8 JSON object mapping repository identity to 40- or 64-hex commit SHA.
Writes decode this token, require the target repository's entry and check only
that entry; a stale target names its repository. Receipts advance the target
entry while retaining entries received for other repositories. A bare 40- or
64-hex SHA is accepted only when the workspace contains exactly one repository.
Optional revisions default to the target repository's current head. Required
writes need the revision, push permission and the `main` branch. Each
successful mutation creates one program-named commit and updates the remote
branch without force. Multi-file changes share one commit; GitLab uses batch actions with per-file version checks. Stale
revisions reject the operation. Mutations allow at most 200 files and 5 MiB of
new text. Directory operations require recursive consent; protected files and
asset-containing directories reject the complete operation. Moves preserve file
text, including relative links.

### Notes being edited live (編輯中)

A deployment whose edition attaches a live editor (`AppServices.liveNotes`; see
[Live editor](../architecture/index.md#live-editor)) serves a checked-out note
from the editor until it is checked in. For a grant whose person the request
names, `read`, `read_note`, `find`, `list_notes`, `search_notes` and
`get_statuses` see the live text, a pending live note is listed at its virtual
path `<notebook root>/.live/<id>.md`, and `read`, `read_note`,
`get_note_metadata`, `list_notes` entries and `search_notes` matches carry
`live: { since, activeEditors, pending?, editorUrl }`. `editorUrl` is the
editor's page of the note: a framed editor's own page, or for the built-in
editor the note's page in the app, the `APP_URL` origin plus its note route
(`liveNotePageUrl`; a pending note's route names its virtual path), which opens
the note where people type in it. The schema is the same for both kinds of
editor. A read of a checked-out
note returns a `v2.` revision: unpadded base64url of
`{"r": {<repository>: <sha>}, "l": [[repository, path, id, liveRevision, contentHash], …]}`
(at most 32 live entries, the oldest dropped, and 8192 characters). Without a
live entry the token stays `v1.` byte for byte. `write`, `edit`, `save_note` and
`update_note_metadata` on a note still checked out under the entry's link land in
the live editor on that read's revision, which the editor rebases over typing
since; the receipt says `committed: false, pushed: false, live: true` with the
new `liveRevision`, and `revision` stays the branch head. A Git-only revision on
a checked-out note is refused with `code: "checked-out"` and its `paths`: read
it again. `edit` also needs the text it read to be the current one, or it is
refused as changed in the live editor. `append` always lands live.
`update_note_metadata` and `save_note` without `content` read the note fresh and
write on that revision. `mv`, `cp`, `rm`, `delete_note`, `replace_notes` and any
other commit that would touch a checked-out note (a move rewriting its links
included) are refused with `code: "checked-out"` and the paths, committing
nothing. Read-only grants read live text and write nothing; a note no longer
checked out ignores its live entry and checks the commit.

`check_in_note { path, notebookId? }` (「立即簽回」, write grants only, so a
read-only grant does not list it) checks a note in now: its live text is
committed with every editor named, Git's changes since the checkout merged in or,
on a conflict, overwritten with a `Live-Overwrote` trailer, and the live note
closed. It answers `{ path, committed, commit?, released, reason?,
activeEditors?, filedPath?, revision }`; `path` is where the note now is, and
`filedPath` is present when a pending note was filed. `reason` says why the note
stayed open: `active` (people are still editing; the commit was made, and
the note is closed once they have left, by the idle check-in on a long-running
server, or tonight), `unfiled` (its path rule needs a value the note
lacks), `leased` (a check-in runs elsewhere), `changed`, `not-synced`, or, where
the editor discards drafts, `uncommittable` (no credential of the note's editors
or of the grant's person may write to the repository: nothing was committed, and
the text stays live). After a
check-in that committed, the branch moved: read again before writing. A note
that is not checked out is refused. Where the live editor can discard drafts
(the built-in editor, or an adapter with `discard`), a pending note that is an
empty draft, its text holding nothing beyond the text it was created with but
whitespace, punctuation or Markdown marks, is discarded instead of filed: the
answer carries `discarded: true`, `released: true`, `committed: false` and
`reason: "empty"`, nothing is committed and the note is gone.

A request with no live editor view (no `liveNotes`, nobody signed in, or no
member the editor covers) lists the tools exactly as before live notes: no
`check_in_note`, no 編輯中 sentences, no `live` fields, and receipts with
`committed: true, pushed: true`; calling `check_in_note` there answers as any
unknown tool does.
Note writes (`write`, `append`, `edit`, `save_note`, `update_note_metadata`)
also return the note `path` and, when `APP_URL` is configured, the note's web page `url`.
A caller that wants the person to land in live co-editing links to that `url`
with `?edit` (or `?zoom&edit`), which checks the note out on arrival as 編輯
does, for a writer where the repository has a live editor (see the live editor
web app section of the architecture document).

Hosted agent-system tools read what governs a notebook or note. A target is a
`notebookId` or a note or folder `path` inside a notebook; a note path works
before the note exists. `get_system_prompt` returns every `AGENTS.md` from the
repository root down to the target, root first, and their joined `content`.
`list_skills` returns the `.agents/skills/<name>/SKILL.md` skills of each
directory from the target up to its own repository root, the nearest winning a
shared name, or every available repository's skills without a target. `invoke_skill` returns a skill's
`SKILL.md` body, description and readable supporting files. Skills may live in
the repository root, notebook roots and their ancestors, and folders inside
notebooks; their Markdown and text files and `agents/openai.yaml` are readable.
`read`, `write`, `append`, `edit` and `rm` accept those skill files, so writing
`SKILL.md` creates a skill and a recursive `rm` of its directory deletes it.
Skill mutations commit as `docs(skills): …`, return no web `url`, and cannot
share an `rm` call with notes. `read`, `write`, `append` and `edit` also accept
the `AGENTS.md` files `get_system_prompt` reads; their edits commit as
`docs(agents): …`. `read` and `read_note` on a note return a `hint`
to read the agent system before creating or editing notes when the note has
one.

## Web agent tools

The hosted `/mcp` above is for connectors (ChatGPT, Claude, Codex) and commits every write. The agent in the web panel of a remote workspace edits notes differently: an edition's `PiAgent` created with `createPiAgent({ webTools: true })` starts Pi with `pi-web-tools-extension.mjs`, which registers `mygitnotes_read_note`, `mygitnotes_write_note`, `mygitnotes_edit_note`, `mygitnotes_delete_note`, `mygitnotes_list_changes`, `mygitnotes_list_templates` and the two agent-system tools described below. `mygitnotes_list_templates` lists a notebook's templates as the person sees them (a template that is still a working change included), and `mygitnotes_write_note` takes `template` and `values` as `save_note` does, staging the new note as a working change with the person's local date and time. Each call goes to `POST /api/pi/web-tools` with the session's bearer token (passed to Pi as `MYGITNOTES_WEB_TOOLS_TOKEN`), and the bridge relays it as a `web_tool_request` to the page that attached to the session last, which answers with `web_tool_response` within 30 seconds.

The page applies the call to its working changes, as its editor does: reads see the person's working change before the committed note (`source: working | committed`), writes and edits stage a working change against the committed note, and a delete stages a deletion that waits in the Changes tool's uncommitted trash until the person commits or restores it (a note that exists only as a working change is dropped instead). Nothing commits. A note whose editor holds typing that is not yet a working change is refused, an open editor shows the agent's change at once, and without an attached page every call fails with a message to open MyGitNotes. Local workspaces do not get these tools: their Pi edits the working tree, which also commits nothing on its own.

A remote Pi starts in an empty directory, so it cannot find the `AGENTS.md` chain and `.agents/skills` that Pi loads on its own in a checkout; two read-only tools bring them from the repository. `mygitnotes_agent_system { path?, notebookId? }` answers what governs a note or folder: the `AGENTS.md` of every agent folder from the repository root down to it (root first, with contents) and the skills of those folders (`name`, `description` from the `SKILL.md` frontmatter, `path`, `directory`), the nearest folder winning a shared skill name, as `callAgentSystem` and Pi's own loading do. `path` is a repository-relative note or folder path inside a notebook (`notebookId` tells notebooks of two repositories apart, and alone names that notebook's root); with neither, it answers for the agent workspace the session runs in. `mygitnotes_read_agent_file { path, notebookId? }` returns the text of an `AGENTS.md` or a skill file (`SKILL.md`, a reference, a script); any other path is refused, and the server's `/api/agent-resources/read` enforces the same allowlist (`agentWorkspaceFile`). Both are answered by the page from `/api/agent-resources` and `/api/agent-resources/read`, so they read the committed repository, not working changes, and need no server route of their own. `PiSession` starts Pi with `MYGITNOTES_AGENT_REPOSITORY` and `MYGITNOTES_AGENT_FOLDER` (the session's `location`; a location change restarts Pi), and the extension adds that workspace to each agent-system call. On `before_agent_start` the extension also asks for the session workspace's agent system and appends it to the system prompt (`event.systemPrompt` plus the `AGENTS.md` files and the skill list, with the instruction to load a skill through `mygitnotes_read_agent_file`); it keeps the text for the Pi process, so `/reload` or a new session reads it again, and when the page is not attached or the call fails the run goes on without it and asks again at the next run. `WEB_TOOLS_PROMPT` tells Pi to call `mygitnotes_agent_system` with the note's path before it creates or edits a note outside its own workspace.

## Agent edits and versions

Every MCP edit of one file — `write`, `append` and `edit` on a note, `AGENTS.md`
or skill file, `save_note` and `update_note_metadata` — is committed as an agent edit: the commit
subject ends with `(Agent, YYYY-MM-DD)` and the message carries an
`Agent-Edit: YYYY-MM-DD` trailer, both with the UTC day, whatever commit message
the caller supplies. The app's history panel shows these commits as agent
edits. Named versions live in version files under `.mygitnotes/versions`, which
MCP tools never edit directly; a version file moves and is deleted together with
its note.

A hosted commit is authored by the account of the credential the grant uses. Where
an edition's identity gives every person one shared credential, the grant names
the person (`author`, a name and an email) and the commit is authored by them; a
name or email that cannot be written into a commit refuses the write. Co-authors
a caller of `commitChanges` names become `Co-authored-by: Name <email>` trailers
after the `Agent-Edit` trailer, in the same trailer block. No tool names
co-authors yet.

Every hosted tool declares input and output schemas, structured content and
readOnly/destructive/idempotent/openWorld annotations. Read-only grants omit all
mutation tools. Automatic MCP OAuth discovery is not provided. See the
[usage guide](../../../README.md) for setup.

The [hosted acceptance sequence](uat.md) covers connector discovery, revisions,
remote commit receipts, shell operations, note visibility and grant revocation.
