import { afterEach, expect, it, vi } from 'vitest';
import { applyTagEntries, PartialTagChangeError, skippedTagNotice, wasSkipped } from './tag-changes.js';
import type { WorkspaceRepository } from './workspace-repositories.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';

const home: WorkspaceRepository = { id: 'github:me/notes@main', alias: 'notes', type: 'github', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life'], title: 'notes', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const other: WorkspaceRepository = { id: 'github:me/campaign@main', alias: 'campaign', type: 'github', branch: 'main', revision: 'b'.repeat(40), write: true, notebooks: ['campaign~trpg'], title: 'campaign', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const entries = [{ path: 'notes/life/a.md', notebookId: 'notes~life', tags: ['x'] }, { path: 'trpg/b.md', notebookId: 'campaign~trpg', tags: ['x'] }];

afterEach(() => vi.unstubAllGlobals());

function stubTags(failFor?: string) {
  const bodies: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (body.repository === failFor) return new Response(JSON.stringify({ error: 'The repository changed.', staleRepositories: [failFor] }), { status: 409 });
      return new Response(JSON.stringify({ success: true, changedPaths: body.entries.map((entry: any) => entry.path), revision: `${body.repository}-next` }));
    }),
  );
  return bodies;
}

it('commits each repository on its own revision and reports each new revision', async () => {
  const bodies = stubTags();
  const committed = vi.fn();
  await applyTagEntries([home, other], entries, 'rename', committed);
  expect(bodies.map(body => [body.repository, body.revision, body.entries.map((entry: any) => entry.path)])).toEqual([[home.id, home.revision, ['notes/life/a.md']], [other.id, other.revision, ['trpg/b.md']]]);
  expect(committed.mock.calls.map(([repository, revision]) => [repository.id, revision])).toEqual([[home.id, `${home.id}-next`], [other.id, `${other.id}-next`]]);
});

it('stops at the first failing repository and names the repositories already committed', async () => {
  stubTags(other.id);
  const error = await applyTagEntries([home, other], entries, 'rename', () => {}).catch(caught => caught);
  expect(error).toBeInstanceOf(PartialTagChangeError);
  expect(error.committed).toEqual([home.id]);
});

it('passes a failure of the first repository through unchanged', async () => {
  stubTags(home.id);
  const error = await applyTagEntries([home, other], entries, 'rename', () => {}).catch(caught => caught);
  expect(error).not.toBeInstanceOf(PartialTagChangeError);
  expect(error.staleRepositories).toEqual([home.id]);
});

it('answers the compilations each repository skipped, with their notebook, and keeps them on a later failure', async () => {
  const skipped = { path: 'trpg/b.md', reason: 'Tags not written: the compilation would not open (arrangement: Required)' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.repository === home.id) return new Response(JSON.stringify({ success: true, changedPaths: [], skipped: [{ ...skipped, path: 'notes/life/a.md' }], revision: 'next' }));
      return new Response(JSON.stringify({ success: true, changedPaths: [], skipped: [skipped], revision: 'next' }));
    }),
  );
  expect(await applyTagEntries([home, other], entries, 'rename', () => {})).toEqual([{ ...skipped, path: 'notes/life/a.md', notebookId: 'notes~life' }, { ...skipped, notebookId: 'campaign~trpg' }]);
  expect(wasSkipped([{ ...skipped, notebookId: 'campaign~trpg' }], entries[1])).toBe(true);
  expect(wasSkipped([{ ...skipped, notebookId: 'campaign~trpg' }], { ...entries[1], notebookId: 'notes~life' })).toBe(false);
  const t = (key: string, params?: Record<string, string | number>) => `${key} ${JSON.stringify(params)}`;
  expect(skippedTagNotice(t as never, [{ ...skipped, notebookId: 'campaign~trpg' }])).toBe(`sidebar.tagSkippedCompilations ${JSON.stringify({ count: 1, files: `trpg/b.md (${skipped.reason})` })}`);
  expect(skippedTagNotice(t as never, [])).toBe('');

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.repository === home.id) return new Response(JSON.stringify({ success: true, changedPaths: [], skipped: [{ ...skipped, path: 'notes/life/a.md' }], revision: 'next' }));
      return new Response(JSON.stringify({ error: 'The repository changed.' }), { status: 409 });
    }),
  );
  const error = await applyTagEntries([home, other], entries, 'rename', () => {}).catch(caught => caught);
  expect(error).toBeInstanceOf(PartialTagChangeError);
  expect(error.skipped).toEqual([{ ...skipped, path: 'notes/life/a.md', notebookId: 'notes~life' }]);
});
