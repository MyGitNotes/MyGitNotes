// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearOpenedScopes, listKeptDrafts, offlineDrafts, OPENED_SCOPES_KEY, recordOpenedScopes } from './kept-drafts.js';

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

describe('offlineDrafts', () => {
  const keep = () => {
    localStorage.setItem('gh_notes_working:repo-1:main', JSON.stringify({ 'notes/mine.md': { note: { title: 'Mine' }, base: null } }));
    localStorage.setItem('gh_notes_draft:repo-2:main:notes/theirs.md', JSON.stringify({ path: 'notes/theirs.md', content: 'x', metadata: { title: 'Theirs' }, savedAt: 1 }));
  };

  it('lists only the drafts of the scopes the session opened, and counts all of them', () => {
    keep();
    recordOpenedScopes(localStorage, ['repo-1:main']);
    const { listed, total } = offlineDrafts(localStorage);
    expect(listed.map(draft => draft.title)).toEqual(['Mine']);
    expect(total).toBe(2);
  });

  it('lists no title when no session is on record, only the count', () => {
    keep();
    expect(offlineDrafts(localStorage)).toEqual({ listed: [], total: 2 });
  });

  it('lists no title once the record is cleared by sign-out', () => {
    keep();
    recordOpenedScopes(localStorage, ['repo-1:main', 'repo-2:main']);
    expect(offlineDrafts(localStorage).listed).toHaveLength(2);
    clearOpenedScopes();
    expect(localStorage.getItem(OPENED_SCOPES_KEY)).toBeNull();
    expect(offlineDrafts(localStorage)).toEqual({ listed: [], total: 2 });
  });

  it('treats an unreadable record as none', () => {
    keep();
    localStorage.setItem(OPENED_SCOPES_KEY, '{"a":1}');
    expect(offlineDrafts(localStorage).listed).toEqual([]);
    localStorage.setItem(OPENED_SCOPES_KEY, '[]');
    expect(offlineDrafts(localStorage).listed).toEqual([]);
  });

  describe('with a demo in this browser', () => {
    const keepDemo = () => {
      keep();
      localStorage.setItem('gh_notes_working:demo:edition:demo:scenarios@main:main', JSON.stringify({ 'notes/demo.md': { note: { title: 'Demo edit' }, base: null } }));
      localStorage.setItem('gh_notes_draft:demo:edition:demo:scenarios@main:main:notes/demo-two.md', JSON.stringify({ path: 'notes/demo-two.md', content: 'x', metadata: { title: 'Demo two' }, savedAt: 1 }));
    };

    it('does not count the demo’s drafts in a tab that is not the demo', () => {
      keepDemo();
      recordOpenedScopes(localStorage, ['repo-1:main']);
      const { listed, total } = offlineDrafts(localStorage);
      expect(total).toBe(2);
      expect(listed.map(draft => draft.title)).toEqual(['Mine']);
    });

    it('counts only the demo’s own drafts in the demo and lists none, so the demo shows no title of the person’s notes', () => {
      keepDemo();
      recordOpenedScopes(localStorage, ['repo-1:main', 'repo-2:main']);
      expect(offlineDrafts(localStorage, { demo: true })).toEqual({ listed: [], total: 2 });
    });

    it('lists none in the demo even if a record of opened scopes names a demo scope', () => {
      keepDemo();
      recordOpenedScopes(localStorage, ['demo:edition:demo:scenarios@main:main', 'repo-1:main']);
      expect(offlineDrafts(localStorage, { demo: true }).listed).toEqual([]);
    });

    it('counts none in the demo when the demo kept nothing', () => {
      keep();
      recordOpenedScopes(localStorage, ['repo-1:main']);
      expect(offlineDrafts(localStorage, { demo: true })).toEqual({ listed: [], total: 0 });
    });
  });
});
