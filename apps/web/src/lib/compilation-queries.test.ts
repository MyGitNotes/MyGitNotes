import { expect, it } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { laneNoteQuery } from './compilation-queries.js';

const base = { name: 'Lane', notebookId: 'life', path: 'notes/life/lane.compilation.yml', view: 'board' as const };
const dynamic: CompilationRow = { ...base, id: 'tagged', kind: 'dynamic', source: { kind: 'tag', tag: 'idea', notebookId: 'life' } };

it("queries a dynamic folder source in the source's notebook, which may be another notebook of the repository", () => {
  const row: CompilationRow = { ...base, id: 'folder', kind: 'dynamic', source: { kind: 'folder', path: 'notes/work/sec', recursive: true, notebookId: 'work' } };
  expect(laneNoteQuery(row)).toMatchObject({ notebookId: 'work', folders: ['notes/work/sec'] });
  expect(laneNoteQuery(dynamic)).toMatchObject({ notebookId: 'life', tags: ['idea'] });
});

it('asks the server for folder-grouped pages when a dynamic compilation has chapters by folder, for the paged list and the all-paths load', () => {
  const row: CompilationRow = { ...base, id: 'grouped', kind: 'dynamic', source: { kind: 'tag', tag: 'idea', notebookId: 'life' }, group: 'folder' };
  expect(laneNoteQuery(row)).toMatchObject({ group: 'folder' });
  expect(laneNoteQuery({ ...row, sort: { field: 'manual', order: 'asc' } })).toMatchObject({ group: 'folder' });
  expect(laneNoteQuery(dynamic)).not.toHaveProperty('group');
});
