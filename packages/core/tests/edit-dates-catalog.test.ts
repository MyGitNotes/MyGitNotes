import { expect, it } from 'vitest';
import type { NotebookConfig, WorkspaceConfig } from '../src/types.js';
import { DEFAULT_NOTE_QUERY, type NoteListItem } from '../src/note-query.js';
import { type CatalogRepository, lookupNotes, queryNotePaths, queryNotes, workspaceCatalog } from '../src/note-catalog.js';
import type { NoteEditFact } from '../src/edit-dates.js';

const config: WorkspaceConfig = { schema_version: 1, workspace: { title: 'Test', default_notebook: 'work' }, notebooks: [{ id: 'work', title: 'Work', root: 'notes/work' }, { id: 'life', title: 'Life', root: 'notes/life' }] as NotebookConfig[] };
const item = (path: string, notebookId: string, updated: string): NoteListItem => ({ id: path, path, notebookId, title: path.split('/').pop()!, tags: [], metadata: { updated } });
const work = [item('notes/work/old-commit.md', 'work', '2026-11-30'), item('notes/work/new-commit.md', 'work', '2026-01-01'), item('notes/work/untracked.md', 'work', '2026-06-01')];
const life = [item('notes/life/plain.md', 'life', '2026-07-01')];
/** Git facts of `work`; `life` is served by a catalog that knows no history. */
const facts: Record<string, NoteEditFact> = { 'notes/work/old-commit.md': { lastCommitAt: '2026-02-01T00:00:00Z' }, 'notes/work/new-commit.md': { lastCommitAt: '2026-10-01T00:00:00+08:00' } };

async function catalog(asked: string[][] = []) {
  const repository = (id: string, alias: string, notebook: string, notes: NoteListItem[], dated: boolean): CatalogRepository => ({
    id,
    alias,
    notebooks: config.notebooks.filter(candidate => candidate.id === notebook),
    catalog: {
      revision: async () => '',
      index: async () => notes,
      contents: async () => new Map(),
      memo: (_kind, _notebooks, compute) => compute(),
      folders: async () => [],
      ...(dated ? { dates: async (listed: NoteListItem[]) => (asked.push(listed.map(note => note.path)), new Map(listed.flatMap(note => facts[note.path] ? [[note.path, facts[note.path]]] : []))) } : {}),
    },
  });
  return workspaceCatalog(config, [repository('github:o/work@main', 'w', 'work', work, true), repository('github:o/life@main', 'l', 'life', life, false)]);
}

it('sorts a query by the Git edit date and lists both dates, falling back to the frontmatter where Git has none', async () => {
  const asked: string[][] = [];
  const page = await queryNotes(await catalog(asked), { ...DEFAULT_NOTE_QUERY, notebookId: 'all', sort: 'updated', order: 'desc' }, { limit: 10, content: false });
  expect(page.notes.map(note => [note.path, note.lastCommitAt, note.updated])).toEqual([
    ['notes/work/new-commit.md', '2026-09-30T16:00:00.000Z', '2026-09-30T16:00:00.000Z'],
    ['notes/life/plain.md', undefined, '2026-07-01T00:00:00.000Z'],
    ['notes/work/untracked.md', undefined, '2026-06-01T00:00:00.000Z'],
    ['notes/work/old-commit.md', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
  ]);
  // The repository is asked once for every note the query matched, under its own notebook ids.
  expect(asked).toEqual([work.map(note => note.path)]);
  const paths = await queryNotePaths(await catalog(), { ...DEFAULT_NOTE_QUERY, notebookId: 'w~work', sort: 'updated', order: 'asc' });
  expect(paths.notes.map(note => note.path)).toEqual(['notes/work/old-commit.md', 'notes/work/untracked.md', 'notes/work/new-commit.md']);
});

it('dates the notes a lookup returns', async () => {
  const found = await lookupNotes(await catalog(), [{ notebookId: 'w~work', path: 'notes/work/new-commit.md' }, { notebookId: 'l~life', path: 'notes/life/plain.md' }], false);
  expect(found.notes.map(note => [note.notebookId, note.lastCommitAt, note.updated])).toEqual([['w~work', '2026-09-30T16:00:00.000Z', '2026-09-30T16:00:00.000Z'], ['l~life', undefined, '2026-07-01T00:00:00.000Z']]);
});
