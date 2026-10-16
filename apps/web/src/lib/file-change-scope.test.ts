import { expect, it } from 'vitest';
import { fileCommandScope, folderCommandScope, strandedDrafts } from './file-change-scope.js';

const focus = (paths: string[]) => ({ version: 1, focuses: [{ id: 'f', notebookId: 'nb', name: 'Focus', division: 'single', panes: [{ tabs: paths.map(path => ({ kind: 'note', path })) }] }] });

it('scopes a file command to the paths it writes, moves or removes', () => {
  expect(fileCommandScope({ kind: 'move', notebookId: 'nb', path: 'notes/a.md', destination: 'notes/work/a.md' })).toEqual({ notebookId: 'nb', paths: ['notes/a.md', 'notes/work/a.md'] });
  expect(fileCommandScope({ kind: 'remove-directory', notebookId: 'nb', path: 'notes/old', destination: 'notes' })).toEqual({ notebookId: 'nb', paths: ['notes/old'] });
  expect(fileCommandScope({ kind: 'metadata', notebookId: 'nb', path: 'notes/work', title: 'Work', description: '', order: 1 })).toEqual({ notebookId: 'nb', paths: ['notes/work/_dir.yml'] });
});

it('scopes a folder command to the folder it moves away or deletes, and nothing for a reorder or a new folder', () => {
  expect(folderCommandScope({ kind: 'move', notebookId: 'nb', path: 'work/old', parent: '' }, 'notes/')).toEqual({ notebookId: 'nb', paths: ['notes/work/old', 'notes/old'] });
  expect(folderCommandScope({ kind: 'move', notebookId: 'nb', path: 'old', parent: 'work' }, 'notes')).toEqual({ notebookId: 'nb', paths: ['notes/old', 'notes/work/old'] });
  expect(folderCommandScope({ kind: 'move', notebookId: 'nb', path: 'work/old', parent: 'work', before: 'work/a' }, 'notes')).toEqual({ notebookId: 'nb', paths: [] });
  expect(folderCommandScope({ kind: 'delete', notebookId: 'nb', path: 'work', destination: '' }, 'notes')).toEqual({ notebookId: 'nb', paths: ['notes/work'] });
  expect(folderCommandScope({ kind: 'create', notebookId: 'nb', parent: '', name: 'new' }, 'notes')).toEqual({ notebookId: 'nb', paths: [] });
});

it('strands only the drafts under the changed paths, apart from the carried ones', () => {
  const drafts = ['notes/work/a.md', 'notes/work-log.md', 'notes/b.md', 'notes/work/deep/c.md'];
  expect(strandedDrafts({ notebookId: 'nb', paths: ['notes/work'] }, drafts, [])).toEqual(['notes/work/a.md', 'notes/work/deep/c.md']);
  expect(strandedDrafts({ notebookId: 'nb', paths: ['notes/b.md', 'notes/x/b.md'], carried: ['notes/b.md'] }, drafts, [])).toEqual([]);
  expect(strandedDrafts({ notebookId: 'nb', paths: [] }, drafts, [])).toEqual([]);
});

it('strands a pending Focus only when it names a changed path of the same notebook', () => {
  const documents = [{ file: '.mygitnotes/focus.yml', page: focus(['notes/work/a.md']) }];
  expect(strandedDrafts({ notebookId: 'nb', paths: ['notes/work'] }, [], documents)).toEqual(['.mygitnotes/focus.yml']);
  expect(strandedDrafts({ notebookId: 'nb', paths: ['notes/other'] }, [], documents)).toEqual([]);
  expect(strandedDrafts({ notebookId: 'other', paths: ['notes/work'] }, [], documents)).toEqual([]);
  expect(documents[0].page.focuses[0].panes[0].tabs[0].path).toBe('notes/work/a.md');
});
