// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { useLanePaths } from './compilation-queries.js';
import { setNoteQueryScope } from './use-note-queries.js';

const REVISION = 'a'.repeat(40);
let client: QueryClient;

const base = { name: 'Lane', notebookId: 'life', path: 'notes/life/lane.compilation.yml', view: 'graph' as const };
const custom: Extract<CompilationRow, { kind: 'custom'; }> = { ...base, id: 'pinned', kind: 'custom', items: [{ id: 'a', kind: 'note', notebookId: 'life', path: 'notes/life/a.md' }, { id: 'b', kind: 'note', notebookId: 'life', path: 'notes/life/b.md' }] };
const dynamic: CompilationRow = { ...base, id: 'tagged', kind: 'dynamic', source: { kind: 'tag', tag: 'idea', notebookId: 'life' } };

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, notes: [{ id: 'notes/life/c.md', path: 'notes/life/c.md', notebookId: 'life', title: 'C', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the lanes' paths as one value while their members are unchanged, so a graph that keys on it is not rebuilt by every render", async () => {
  // The graph rebuilds its nodes whenever this map changes identity, and a node rebuild in a zoomed compilation re-renders its note cards without pause.
  const { result, rerender } = renderHook(({ rows }) => useLanePaths(rows), { wrapper, initialProps: { rows: [custom, dynamic] } });
  await waitFor(() => expect(result.current.paths.get('tagged')).toEqual(['notes/life/c.md']));
  const settled = result.current.paths;
  rerender({ rows: [{ ...custom }, { ...dynamic }] });
  rerender({ rows: [custom, dynamic] });
  expect(result.current.paths).toBe(settled);
  expect(result.current.paths.get('pinned')).toEqual(['notes/life/a.md', 'notes/life/b.md']);
});

it('gives new paths once a lane gains a member', async () => {
  const { result, rerender } = renderHook(({ rows }) => useLanePaths(rows), { wrapper, initialProps: { rows: [custom] } });
  const before = result.current.paths;
  rerender({ rows: [{ ...custom, items: [...custom.items, { id: 'c', kind: 'note', notebookId: 'life', path: 'notes/life/c.md' }] }] });
  expect(result.current.paths).not.toBe(before);
  expect(result.current.paths.get('pinned')).toEqual(['notes/life/a.md', 'notes/life/b.md', 'notes/life/c.md']);
});
