# Project tasks: assignees, milestones and priority (community)

Three additions that let a notebook run as a small project: who owns a task, which dates mark a milestone, and how urgent a task is. All three are plain text in the note (a task line token or one frontmatter key); a note that uses none of them is unchanged, and no edit rewrites a token it did not touch (`setTaskChecked` only adds or removes `✅`).

## Syntax

### Assignee: `@name`

On a task line (`- [ ]` / `- [x]`), after the checkbox:

- `@` at the start of the text or after whitespace, then a name of Unicode letters, numbers and `_`, with `.` or `-` allowed between name characters: `@alice`, `@小林`, `@j.doe`, `@mary-ann`.
- Several are allowed; the order of appearance is kept and a repeated name counts once.
- Not an assignee: an `@` glued to a word (`a@b.com`), after a URL character (`https://x.com/@user`, `?to=@bob`) or in a scoped package (`@types/node`, a name followed by `/` or `@`). Trailing sentence punctuation is not part of the name (`ask @alice.` is `alice`).
- Names are case-sensitive and compared as written.

Core: `getTaskAssignees(line)`; `TodoTask.assignees: string[]` (empty when none). `stripTaskTokens` removes the tokens (the Todo tool shows them as a chip instead).

### Priority: Obsidian Tasks emojis

`🔺` highest, `⏫` high, `🔼` medium, `🔽` low, `⏬` lowest, anywhere on the task line, optionally followed by the emoji variation selector (U+FE0F). No emoji is the normal priority. The first emoji on the line wins. Core: `TaskPriority`, `getTaskPriority(line)`; `TodoTask.priority?: TaskPriority`. `stripTaskTokens` removes the emoji.

Order, highest first: highest, high, medium, normal, low, lowest (as in Obsidian Tasks).

### Milestone: `milestone: YYYY-MM-DD` frontmatter

A note whose frontmatter has `milestone` set to a real calendar date in `YYYY-MM-DD` form is a milestone on that day. No code reads a frontmatter `due` or `milestone` on a note today. `due` already means a task's `📅` date and the study scheduler's review time, so a milestone gets its own key rather than overloading either. Any other value (a number, another format, `2026-02-30`) is not a milestone.

Core: `getNoteMilestone(metadata)`; `NoteAgenda.milestones: NoteListItem[]` (visible notes with a milestone, each carrying its repository's revision like `dated`). Hidden and compilation notes are left out like they are for tasks.

The agenda part kept in a remote cache is now stored under the kind `agenda:v2:<hidden>`: an entry written before tasks carried `assignees` and the agenda carried `milestones` is not read back without them.

## Where it shows

### Todo tool

- Row chip: assignee names (person icon) and priority (level icon and label) next to the date chips.
- Filter row, shown when the scope holds any task: **People** (All people, each assignee in the current scope sorted by name, Unassigned), **Priority** (Any, the five levels, Normal), **Sort** (List order, Priority). Filters apply to the date, note and Gantt views and to Completed. A People or Priority value that no longer exists in the scope falls back to "all". Sorting by priority orders by the sequence above, then by due date, then by list order; it applies to the list views (the Gantt stays in timeline order).
- Milestones are not tasks: the People and Priority filters do not hide them, and they appear only on the Gantt (and the calendar). A scope with milestones but no tasks still opens the Gantt.

### Gantt

- Task bar: tinted by priority (highest and high warm, medium accent, low and lowest muted); the bar title names priority and assignees.
- Milestone: a diamond on its date in its own row, labelled with the note title, placed with the tasks by date; clicking the label or diamond opens the note. Milestone dates widen the visible range like task dates, and a milestone is never "completed".

### Calendar

A milestone note appears on its day as a diamond (its own marker beside the notes and due dots), and in the day detail under **Milestones** with the title and path, above Notes and Tasks. With no day selected the list covers the month. It does not depend on the Created / Updated switch; a milestone note still also shows under Notes on its created or updated day.

## Not in scope

No editor chips or completion for `@name` or priority (the existing `@` completion list keeps its words; a name typed after `@` simply stays text), no setters for priority or assignees, no milestone editing UI (edit the frontmatter), no per-person calendar.

## Where it is tested

`packages/core/tests/task-tokens.test.ts`, `note-agenda.test.ts`, `note-catalog.test.ts`; `apps/web/src/lib/todo-filter.test.ts`, `todo-gantt.test.ts`, `note-day-index.test.ts`, `draft-overlay` agenda cases.
