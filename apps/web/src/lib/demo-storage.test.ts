// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDemoScope, DEMO_TTL_MS, demoHooks, demoRemainingMs, demoWasUpdated, dismissDemoUpdated, expireDemoData, noteDemoWrite, noteDemoWriteIn, readDemoRecord, registerDemoRepositories, resetDemo } from './demo-storage.js';
import { documentDraftKey } from './use-workspace-document.js';
import { stashText } from './history-stash.js';
import { updateWorkingNote } from './working-notes.js';
import { saveLocalDraft } from './storage.js';
import { focusViewStorageKey } from './focus-view.js';
import { appendLocalCommit, localCommitsKey, readLocalCommits } from './local-commits.js';
import { draftScope } from './workspace-repositories.js';
import type { NoteItem } from './types.js';

const REPO = 'edition:demo:scenarios@main', ALIAS = 'demo', NOTEBOOK = 'demo~trpg-en';
const repository = (revision = 'head1') => ({ id: REPO, branch: 'main', alias: ALIAS, demo: true as const, revision, notebooks: [NOTEBOOK] });
const SCOPE = draftScope(repository());
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
    clearDemoScope({ firstWrite: 0, base: 'head1', repository: `demo:${REPO}` }, SCOPE);
    expect(keysOf()).toEqual([]);
  });
});

const commitInput = (message: string) => ({ message, author: 'x', notes: { 'notes/a.md': { notebookId: 'trpg-en', server: null, raw: '# a\n' } }, documents: {} });

describe('a write after the 24 hours', () => {
  const afterExpiry = () => {
    vi.spyOn(demoHooks, 'reload').mockImplementation(() => {});
    updateWorkingNote({ scope: SCOPE, alias: ALIAS }, 'notes/old.md', { note: { ...note, path: 'notes/old.md' }, base: null });
    saveLocalDraft(SCOPE, 'notes/old.md', 'old', {});
    vi.setSystemTime(1000 + DEMO_TTL_MS + 1);
  };

  it('writes no working change and does not bring the expired ones back or restart the clock', () => {
    afterExpiry();
    const entries = updateWorkingNote({ scope: SCOPE, alias: ALIAS }, 'notes/new.md', { note: { ...note, path: 'notes/new.md' }, base: null });
    expect(entries).toEqual({});
    expect(localStorage.getItem(`gh_notes_working:${SCOPE}`)).toBeNull();
    expect(readDemoRecord(SCOPE)).toBeUndefined();
  });

  it('writes no editor draft', () => {
    afterExpiry();
    saveLocalDraft(SCOPE, 'notes/new.md', 'new', {});
    expect(keysOf()).toEqual([]);
  });

  it('commits nothing and says why, leaving no log and no clock', async () => {
    afterExpiry();
    await appendLocalCommit(SCOPE, 'head1', commitInput('old')).catch(() => undefined);
    expect(readLocalCommits(SCOPE)).toBeNull();
    expect(keysOf()).toEqual([]);
  });

  it('keeps no history text', () => {
    afterExpiry();
    stashText({ notebookId: NOTEBOOK, path: 'notes/a.md' }, 'new');
    expect(keysOf()).toEqual([]);
  });

  it('does not bring back the commits of an expired log', async () => {
    vi.spyOn(demoHooks, 'reload').mockImplementation(() => {});
    await appendLocalCommit(SCOPE, 'head1', commitInput('old'));
    vi.setSystemTime(1000 + DEMO_TTL_MS + 1);
    await expect(appendLocalCommit(SCOPE, 'head1', commitInput('new'))).rejects.toThrow();
    expect(readLocalCommits(SCOPE)).toBeNull();
    expect(readDemoRecord(SCOPE)).toBeUndefined();
  });
});

describe('what belongs to a signed-in person', () => {
  const own = (id: string) => ({ id, branch: 'main', alias: ALIAS, revision: 'r', notebooks: [NOTEBOOK] });
  const ownNote = { ...note, path: 'notes/own.md' };

  /** The person's writes in a workspace of their own repository; the keys and values they left. */
  const ownWrites = (id: string) => {
    const repo = own(id);
    registerDemoRepositories([repo]);
    updateWorkingNote({ scope: draftScope(repo), alias: ALIAS }, ownNote.path, { note: ownNote, base: null });
    saveLocalDraft(draftScope(repo), 'notes/own.md', 'own text', {});
    stashText({ notebookId: NOTEBOOK, path: 'notes/own.md' }, 'own stash');
    localStorage.setItem(focusViewStorageKey(id, NOTEBOOK), '{"own":true}');
    localStorage.setItem(documentDraftKey(client, id), '{"own":true}');
    return Object.fromEntries(keysOf().map(key => [key, localStorage.getItem(key)]));
  };
  const demoWrites = () => {
    registerDemoRepositories([repository()]);
    updateWorkingNote({ scope: SCOPE, alias: ALIAS }, note.path, { note, base: null });
    saveLocalDraft(SCOPE, 'notes/b.md', 'text', {});
    stashText({ notebookId: NOTEBOOK, path: 'notes/a.md' }, 'demo stash');
    localStorage.setItem(focusViewStorageKey(REPO, NOTEBOOK), '{"demo":true}');
    localStorage.setItem(documentDraftKey(client, REPO), '{"demo":true}');
  };
  const survives = (kept: Record<string, string | null>) => {
    for (const [key, value] of Object.entries(kept)) expect(localStorage.getItem(key), key).toBe(value);
  };

  for (const [name, id] of [["their repository has the demo's notebook alias", 'github:alice/demo'], ["their repository has the demo's own id", REPO]] as const) {
    it(`survive the 24-hour sweep when ${name}`, () => {
      const kept = ownWrites(id);
      demoWrites();
      registerDemoRepositories([own(id)]);
      expect(expireDemoData(1000 + DEMO_TTL_MS)).toEqual([SCOPE]);
      survives(kept);
      expect(keysOf().filter(key => !(key in kept))).toEqual([]);
    });

    it(`survive Reset demo when ${name}`, () => {
      const kept = ownWrites(id);
      demoWrites();
      resetDemo();
      survives(kept);
      expect(keysOf().filter(key => !(key in kept))).toEqual([]);
    });
  }
});
