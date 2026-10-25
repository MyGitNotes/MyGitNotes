// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { adoptGraphDrafts, dismissConflictDraftNotice, getDismissedConflictDraftNoticeAt, getLocalDraft, listLocalDrafts, moveLocalDraft, saveLocalDraft } from './storage.js';

beforeEach(() => localStorage.clear());

const record = (path: string, content: string) => JSON.stringify({ base: { path }, draft: { path, content, metadata: { title: 'Alpha' } } });

it('moves graph drafts into the editor drafts of the same scope and drops the old records', () => {
  localStorage.setItem('graph-draft:src:main:notes/a.md', record('notes/a.md', 'edited'));
  localStorage.setItem('graph-draft:src:main:notes/moved.md', record('notes/other.md', 'stale'));
  localStorage.setItem('graph-draft:src:dev:notes/a.md', record('notes/a.md', 'other scope'));
  adoptGraphDrafts('src:main');
  expect(getLocalDraft('src:main', 'notes/a.md')).toMatchObject({ path: 'notes/a.md', content: 'edited', metadata: { title: 'Alpha' } });
  expect(getLocalDraft('src:main', 'notes/moved.md')).toBeNull();
  expect(localStorage.getItem('graph-draft:src:main:notes/a.md')).toBeNull();
  expect(localStorage.getItem('graph-draft:src:main:notes/moved.md')).toBeNull();
  expect(localStorage.getItem('graph-draft:src:dev:notes/a.md')).not.toBeNull();
});

it('lists the editor drafts of a scope without the conflict copies kept beside them', () => {
  saveLocalDraft('src:main', 'notes/a.md', 'unsaved', {});
  saveLocalDraft('src:main:conflict', 'notes/b.md', 'kept after a conflict', {});
  expect(listLocalDrafts('src:main').map(draft => draft.path)).toEqual(['notes/a.md']);
  expect(listLocalDrafts('src:main:conflict').map(draft => draft.path)).toEqual(['notes/b.md']);
});

it('keeps an editor draft that already exists', () => {
  saveLocalDraft('src:main', 'notes/a.md', 'editor draft', {});
  localStorage.setItem('graph-draft:src:main:notes/a.md', record('notes/a.md', 'graph draft'));
  adoptGraphDrafts('src:main');
  expect(getLocalDraft('src:main', 'notes/a.md')?.content).toBe('editor draft');
  expect(localStorage.getItem('graph-draft:src:main:notes/a.md')).toBeNull();
});

it('moves a draft to another note path, keeping its text and the dismissed notice of a conflict copy', () => {
  saveLocalDraft('src:main:conflict', 'notes/a.md', 'kept after a conflict', { title: 'A' });
  const saved = getLocalDraft('src:main:conflict', 'notes/a.md')!;
  dismissConflictDraftNotice('src:main:conflict', 'notes/a.md', saved.savedAt);
  moveLocalDraft('src:main:conflict', 'notes/a.md', 'notes/b.md');
  expect(getLocalDraft('src:main:conflict', 'notes/a.md')).toBeNull();
  expect(getLocalDraft('src:main:conflict', 'notes/b.md')).toEqual({ ...saved, path: 'notes/b.md' });
  expect(getDismissedConflictDraftNoticeAt('src:main:conflict', 'notes/a.md')).toBeNull();
  expect(getDismissedConflictDraftNoticeAt('src:main:conflict', 'notes/b.md')).toBe(saved.savedAt);
});

it('moves nothing when there is no draft at the old path', () => {
  saveLocalDraft('src:main', 'notes/b.md', 'already here', {});
  moveLocalDraft('src:main', 'notes/a.md', 'notes/b.md');
  expect(getLocalDraft('src:main', 'notes/b.md')?.content).toBe('already here');
});
