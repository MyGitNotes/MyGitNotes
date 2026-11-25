import { createElement, type ReactNode, useLayoutEffect } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, type Location, MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router-dom';
import { PopGuardSync } from '../../lib/pop-guard.js';
import { vi } from 'vitest';
import { BOARD_TEXT_COLORS } from '@mygitnotes/core/compilation';
import type { NoteRef } from '@mygitnotes/core/note-query';
import { CompilationActionsProvider } from '../../lib/compilation-actions.js';
import { PanelProvider } from '../../lib/panel-context.js';
import { setNoteQueryScope } from '../../lib/use-note-queries.js';
import { CompilationView, type CompilationViewProps } from '../CompilationView.js';

/** The note editing the board tests stub: saving editors always succeeds. */
export const editing = { flushEditors: async () => true, refreshNotes: async () => {}, editorProps: () => ({ readOnly: false }), addToFocus: () => () => {}, renameNote: () => () => {}, moveNote: () => () => {} };
export const notebooks = [{ id: 'thesis', title: 'Thesis', root: 'notes/thesis' }, { id: 'reading', title: 'Reading', root: 'notes/reading', icon: 'book' }];
export const note = (notebookId: string, path: string, title: string, content: string, status?: string) => ({ id: path, path, notebookId, title, content, metadata: {}, tags: [] as string[], ...(status ? { status } : {}) });

/** The example text's colour, one of the palette's. */
export const TEXT_TONE = BOARD_TEXT_COLORS[5];
// The spec's example file, with an item from another notebook of the repository and one whose note is gone.
export const example = `version: 1
id: chapter-3
title: 第三章：德性與依據
arrangement: board
items:
  - id: h1
    kind: heading
    title: 一、問題
  - id: n1
    kind: note
    path: notes/thesis/第三章導論.md
  - id: n2
    kind: note
    path: notes/thesis/依據關係的因果條件.md
  - id: h2
    kind: heading
    title: 二、德性知識論
  - id: n3
    kind: note
    path: notes/thesis/德性與能力的區分.md
  - id: n4
    kind: note
    path: notes/reading/sosa-2007.md
  - id: n5
    kind: note
    path: notes/thesis/gone.md
board:
  sections:
    - { item: h1, x: 0, y: 0, w: 288, h: 384 }
    - { item: h2, x: 336, y: 0, w: 560, h: 384 }
  cards:
    - { item: n1, x: 24, y: 56 }
    - { item: n2, x: 24, y: 216 }
    - { item: n3, x: 360, y: 56 }
  texts:
    - { id: t8k2m, x: 960, y: 240, w: 200, text: "口試前要定案：\\n德性是否必要？", color: ${TEXT_TONE} }
  arrows:
    - { id: a3f9q, from: { item: n1 }, to: { item: n2 }, label: 提出 }
    - { id: b7c1z, from: { item: n2 }, to: { item: n3 }, label: 需要 }
`;
export const thesisNotes = [note('thesis', 'notes/thesis/第三章導論.md', '第三章導論', '本章回答：理據怎樣才算「被用上」？', 'draft'), note('thesis', 'notes/thesis/依據關係的因果條件.md', '依據關係的因果條件', '理據不只要在場，還得實際促成這個信念。'), note('thesis', 'notes/thesis/德性與能力的區分.md', '德性與能力的區分', '能力是傾向，德性是可靠的能力加上歸屬。'), note('reading', 'notes/reading/sosa-2007.md', 'Sosa 2007 第三講', '動物知識與反思知識的兩層區分。')];

export const save = vi.fn<(ref: NoteRef, text: string) => Promise<void>>();
export const onOpenNote = vi.fn();
export const create = vi.fn();
export const fetches: { requests: ReturnType<typeof vi.fn>; } = { requests: vi.fn() };

/** The address the last board opened shows, and its router's navigate (Back is `router.navigate(-1)`). */
export const router: { location?: Location; navigate?: NavigateFunction; } = {};
/** Another page at `/elsewhere`, where the board is not mounted. */
function ElsewhereGate({ children }: { children: ReactNode; }) {
  return useLocation().pathname === '/elsewhere' ? <p>Elsewhere</p> : children;
}

function RouterProbe() {
  const location = useLocation(), navigate = useNavigate();
  useLayoutEffect(() => {
    router.location = location;
    router.navigate = navigate;
  }, [location, navigate]);
  return null;
}

/**
 * Opens a compilation file in a Focus pane's CompilationView (or `view.frame`, with `view.sidePanel`, at `view.url`), its notes, member paths and note links answered by a
 * stubbed fetch, and every write going to `save`. The file's stored copy stays as given, so writes stay pending.
 */
export function openBoard({ path, notebookId, raw, notes, members = [], links = [], compilations = [], view = {} }: { path: string; notebookId: string; raw: string; notes: ReturnType<typeof note>[]; members?: NoteRef[]; links?: { source: string; target: string; }[]; /** What a listing of the notebook's compilations answers. */ compilations?: ReturnType<typeof note>[]; view?: Partial<Pick<CompilationViewProps, 'frame' | 'sidePanel'>> & { url?: string; /** The browser's own history (window.history) instead of a memory one, with the Back and Forward guard told of it; `/elsewhere` is another page. */ browser?: boolean; }; }) {
  const stored = { id: path, path, notebookId, title: 'Board', content: raw, metadata: {}, tags: [] };
  fetches.requests = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/notes/lookup') {
      const refs = JSON.parse(String(init?.body)).notes as NoteRef[];
      return Response.json({ notes: [stored, ...notes].filter(result => refs.some(ref => ref.path === result.path && ref.notebookId === result.notebookId)) });
    }
    if (url.pathname === '/api/notes/query') return Response.json(url.searchParams.get('select') === 'paths' ? { notes: members } : url.searchParams.get('kind') === 'compilation' ? { notes: compilations.filter(entry => url.searchParams.get('notebookId') === 'all' || entry.notebookId === url.searchParams.get('notebookId')), total: compilations.length, nextCursor: null } : { notes: [], total: 0, nextCursor: null });
    if (url.pathname === '/api/notes/graph') return Response.json({ nodes: [], links, revisions: {} });
    return Response.json(url.pathname === '/api/assets' ? { assets: [] } : {});
  });
  vi.stubGlobal('fetch', fetches.requests);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const actions = { save, canWrite: () => true, remove: vi.fn(), create, repository: () => undefined };
  const content = (children: ReactNode) => (
    <>
      <RouterProbe />
      <QueryClientProvider client={client}>
        <PanelProvider>
          <CompilationActionsProvider value={actions}>{children}</CompilationActionsProvider>
        </PanelProvider>
      </QueryClientProvider>
    </>
  );
  if (view.browser) window.history.replaceState(null, '', view.url ?? '/');
  const wrapper = ({ children }: { children: ReactNode; }) =>
    view.browser
      ? (
        <BrowserRouter>
          <PopGuardSync />
          {content(<ElsewhereGate>{children}</ElsewhereGate>)}
        </BrowserRouter>
      )
      : <MemoryRouter initialEntries={[view.url ?? '/']}>{content(children)}</MemoryRouter>;
  return render(createElement(CompilationView, { path, notebookId, notebooks, folders: [], frame: view.frame ?? 'pane', sidePanel: view.sidePanel, onOpenNote }), { wrapper });
}
export const openExample = (links: { source: string; target: string; }[] = []) => openBoard({ path: 'notes/thesis/chapter-3.compilation.yml', notebookId: 'thesis', raw: example, notes: thesisNotes, links });

/** Resets the stubs and stores between tests. */
export function resetBoardTest() {
  save.mockReset().mockResolvedValue();
  onOpenNote.mockReset();
  create.mockReset();
  localStorage.clear();
  setNoteQueryScope({ sourceId: 'test', revisions: {}, repositories: {}, drafts: {} });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}
