// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { listKeptDrafts } from './kept-drafts.js';

beforeEach(() => localStorage.clear());

describe('listKeptDrafts', () => {
  it('lists working changes and editor drafts without knowing their repository', () => {
    localStorage.setItem('gh_notes_working:repo-1:main', JSON.stringify({ 'notes/ideas/plan.md': { note: { title: 'Launch plan', path: 'notes/ideas/plan.md' }, base: null }, 'notes/gone.md': { note: { title: 'Gone' }, base: null, deleted: true } }));
    localStorage.setItem('gh_notes_draft:repo-1:main:notes/todo.md', JSON.stringify({ path: 'notes/todo.md', content: 'x', metadata: { title: 'Todo' }, savedAt: 1 }));
    localStorage.setItem('gh_notes_draft:repo-1:main:notes/untitled.md', JSON.stringify({ path: 'notes/untitled.md', content: 'x', metadata: {}, savedAt: 1 }));
    expect(listKeptDrafts(localStorage).map(draft => draft.title)).toEqual(['Launch plan', 'Todo', 'untitled.md']);
  });

  it('lists a note once when it is both a working change and an editor draft', () => {
    localStorage.setItem('gh_notes_working:repo-1:main', JSON.stringify({ 'notes/a.md': { note: { title: 'A' }, base: null } }));
    localStorage.setItem('gh_notes_draft:repo-1:main:notes/a.md', JSON.stringify({ path: 'notes/a.md', content: 'x', metadata: {}, savedAt: 1 }));
    expect(listKeptDrafts(localStorage)).toHaveLength(1);
  });

  it('skips conflict copies, other keys, and values it cannot read', () => {
    localStorage.setItem('gh_notes_draft:repo-1:main:conflict:notes/a.md', JSON.stringify({ path: 'notes/a.md', content: 'x', metadata: {}, savedAt: 1 }));
    localStorage.setItem('gh_notes_working:repo-1:main', 'not json');
    localStorage.setItem('gh_notes_draft:repo-1:main:notes/b.md', '{"path":3}');
    localStorage.setItem('github_notes_theme', 'flexoki');
    expect(listKeptDrafts(localStorage)).toEqual([]);
  });
});
