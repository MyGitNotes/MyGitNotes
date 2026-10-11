// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { setNoteQueryScope } from '../../lib/use-note-queries.js';
import { useGraphController } from './useGraphController.js';

// The controller reads the note-editing context only for flushing editors; no card is mounted here, so a fixed value stands in for it.
vi.mock('../../lib/note-editing.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/note-editing.js')>();
  const editing = { flushEditors: async () => true, hosts: new actual.NoteHosts(), zoom: null };
  return { ...actual, useNoteEditing: () => editing };
});

const REVISION = 'a'.repeat(40);
const notebooks = [{ id: 'life', title: 'Life', root: 'notes/life' }];
const notes = ['a', 'b'].map(id => ({ id: `life:notes/life/${id}.md`, path: `notes/life/${id}.md`, notebookId: 'life', title: id.toUpperCase(), tags: [], metadata: {}, inDegree: 0, outDegree: 0, val: 1 }));
const lane: Extract<CompilationRow, { kind: 'custom'; }> = { id: 'graphed', name: 'Graphed', kind: 'custom', notebookId: 'life', path: 'notes/life/graphed.compilation.yml', view: 'graph', items: notes.map(note => ({ id: `pin-${note.title}`, kind: 'note' as const, notebookId: 'life', path: note.path })), graph: { nodes: notes.map((note, index) => ({ path: note.path, x: index * 400, y: 0, expanded: true, width: 360, height: 300 })) } };
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, children));
const settle = (ms = 700) => act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes('/notes/graph') ? { revision: REVISION, nodes: notes, links: [] } : { revision: REVISION, total: notes.length, notes };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('does not render again when the lane geometry is measured again and nothing moved, so its note cards keep a quiet moment to autosave', async () => {
  let renders = 0;
  const { rerender } = renderHook(({ row }) => {
    renders += 1;
    return useGraphController({ notebooks, lane: row });
  }, { wrapper, initialProps: { row: lane } });
  await settle();
  // The first measurement can run before the graph has loaded; the second one measures the loaded graph, so the third has nothing new to find.
  rerender({ row: { ...lane } });
  await settle();
  const settled = renders;
  // A new row object of the same lane restarts the measurement timer; the measurement finds the same geometry.
  rerender({ row: { ...lane } });
  await settle();
  // Only the re-render the new props caused; a measurement that stored a new object would add one per timer run.
  expect(renders - settled).toBe(1);
});
