// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDemoScope, DEMO_TTL_MS, demoHooks, demoRemainingMs, demoWasUpdated, dismissDemoUpdated, expireDemoData, noteDemoWrite, noteDemoWriteIn, readDemoRecord, registerDemoRepositories, resetDemo } from './demo-storage.js';
import { documentDraftKey } from './use-workspace-document.js';
import { stashText } from './history-stash.js';
import { updateWorkingNote } from './working-notes.js';
import { saveLocalDraft } from './storage.js';
import { focusViewStorageKey } from './focus-view.js';
import { localCommitsKey } from './local-commits.js';
import type { NoteItem } from './types.js';

const REPO = 'edition:demo:scenarios@main', SCOPE = `${REPO}:main`, ALIAS = 'demo', NOTEBOOK = 'demo~trpg-en';
const repository = (revision = 'head1') => ({ id: REPO, branch: 'main', alias: ALIAS, demo: true as const, revision, notebooks: [NOTEBOOK] });
const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'trpg-en', title: 'A', content: '# A\n', metadata: {}, tags: [] };
const OTHER = { working: 'gh_notes_working:github:o/r:main', plain: 'unrelated', stash: `github-notes:history-stash:${JSON.stringify(['kb~life', 'github:o/r', 'a.md'])}`, document: 'github-notes:focus:github:o/r' };
const client = { draftKey: 'focus-draft' };

/** Writes a change through every writer the demo clock covers. */
const writeEverywhere = () => {
  updateWorkingNote({ scope: SCOPE, alias: ALIAS }, note.path, { note, base: null });
  saveLocalDraft(SCOPE, 'notes/b.md', 'text', {});
  localStorage.setItem(documentDraftKey(client, REPO), '{}');
  localStorage.setItem(focusViewStorageKey(REPO, NOTEBOOK), '{}');
  stashText({ notebookId: NOTEBOOK, repository: REPO, path: 'notes/a.md' }, 'old');
  localStorage.setItem(localCommitsKey(SCOPE), '{}');
  localStorage.setItem(`gh_notes_conflict_dismissed:${SCOPE}:notes/a.md`, '1');
};
const keysOf = () => Object.keys(localStorage).sort();
const seedOthers = () => {
  localStorage.setItem(OTHER.working, '{}');
  localStorage.setItem(OTHER.plain, '1');
  localStorage.setItem(OTHER.stash, '[]');
  localStorage.setItem(OTHER.document, '{}');
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1000);
  localStorage.clear();
  registerDemoRepositories([repository()]);
  dismissDemoUpdated();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the 24-hour clock', () => {
  it('starts with the first change and does not move with later ones', () => {
    expect(readDemoRecord(SCOPE)).toBeUndefined();
    noteDemoWrite(SCOPE, 1000);
    noteDemoWrite(SCOPE, 5000);
    expect(readDemoRecord(SCOPE)).toMatchObject({ firstWrite: 1000, base: 'head1' });
    expect(demoRemainingMs(SCOPE, 2000)).toBe(DEMO_TTL_MS - 1000);
  });

  it('starts at the first change of every writer', () => {
    const writers: [string, () => void][] = [['working change', () => updateWorkingNote({ scope: SCOPE, alias: ALIAS }, note.path, { note, base: null })], ['editor draft', () => saveLocalDraft(SCOPE, 'notes/b.md', 'text', {})], ['stash', () => stashText({ notebookId: NOTEBOOK, repository: REPO, path: 'notes/a.md' }, 'old')]];
    for (const [name, write] of writers) {
      localStorage.clear();
      write();
      expect(readDemoRecord(SCOPE)?.firstWrite, name).toBe(1000);
    }
    localStorage.clear();
    noteDemoWriteIn(REPO, 7);
    expect(readDemoRecord(SCOPE)?.firstWrite).toBe(7);
  });

  it('does nothing for a scope that is not a demo scope, touching no storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    noteDemoWrite('github:o/r:main');
    expect(spy).not.toHaveBeenCalled();
  });

  it('removes every key of the scope after 24 hours and leaves other scopes and ordinary keys', () => {
    seedOthers();
    const before = keysOf();
    writeEverywhere();
    expect(readDemoRecord(SCOPE)?.firstWrite).toBe(1000);
    expect(keysOf().length).toBeGreaterThan(before.length + 5);
    expect(expireDemoData(1000 + DEMO_TTL_MS - 1)).toEqual([]);
    expect(expireDemoData(1000 + DEMO_TTL_MS)).toEqual([SCOPE]);
    expect(keysOf()).toEqual(before);
  });

  it('expires at boot without the workspace loaded', () => {
    writeEverywhere();
    registerDemoRepositories([]);
    expect(expireDemoData(1000 + DEMO_TTL_MS + 5)).toEqual([SCOPE]);
    expect(keysOf()).toEqual([]);
  });

  it('clears and reloads when a write finds its scope expired, then starts a new clock', () => {
    const reload = vi.spyOn(demoHooks, 'reload').mockImplementation(() => {});
    writeEverywhere();
    noteDemoWrite(SCOPE, 1000 + DEMO_TTL_MS + 1);
    expect(reload).toHaveBeenCalledOnce();
    expect(keysOf()).toEqual([]);
    noteDemoWrite(SCOPE, 1000 + DEMO_TTL_MS + 2);
    expect(readDemoRecord(SCOPE)?.firstWrite).toBe(1000 + DEMO_TTL_MS + 2);
  });
});

describe('a deploy that moved the demo head', () => {
  it('clears the scope and says so when the workspace loads on another head', () => {
    writeEverywhere();
    registerDemoRepositories([repository('head2')]);
    expect(keysOf()).toEqual([]);
    expect(demoWasUpdated()).toBe(true);
    dismissDemoUpdated();
    expect(demoWasUpdated()).toBe(false);
  });

  it('keeps the data on the same head', () => {
    writeEverywhere();
    const before = keysOf();
    registerDemoRepositories([repository('head1')]);
    expect(keysOf()).toEqual(before);
    expect(demoWasUpdated()).toBe(false);
  });
});

describe('Reset demo', () => {
  it('clears the scope at once, whatever its age', () => {
    seedOthers();
    const before = keysOf();
    writeEverywhere();
    resetDemo();
    expect(keysOf()).toEqual(before);
  });

  it('clearDemoScope takes the record it is given', () => {
    writeEverywhere();
    clearDemoScope({ firstWrite: 0, base: 'head1', repository: REPO, alias: ALIAS }, SCOPE);
    expect(keysOf()).toEqual([]);
  });
});
