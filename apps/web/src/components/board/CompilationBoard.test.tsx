// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { parseCompilation } from '@mygitnotes/core/compilation';
import type { NoteRef } from '@mygitnotes/core/note-query';
import { CompilationActionsProvider } from '../../lib/compilation-actions.js';
import { BOARD_NOTE_LINKS_STORAGE_KEY } from '../../lib/board/storage.js';
import { PanelProvider } from '../../lib/panel-context.js';
import { setNoteQueryScope } from '../../lib/use-note-queries.js';
import { CompilationView } from '../CompilationView.js';

vi.mock('../../lib/note-editing.js', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/note-editing.js')>(), useEditorRegistry: () => () => () => {}, useNoteEditing: () => editing }));

const editing = { flushEditors: async () => true, refreshNotes: async () => {}, editorProps: () => ({ readOnly: false }), addToFocus: () => () => {}, renameNote: () => () => {}, moveNote: () => () => {} };
const notebooks = [{ id: 'thesis', title: 'Thesis', root: 'notes/thesis' }, { id: 'reading', title: 'Reading', root: 'notes/reading', icon: 'book', color: 'teal' as const }];
const note = (notebookId: string, path: string, title: string, content: string, status?: string) => ({ id: path, path, notebookId, title, content, metadata: {}, tags: [] as string[], ...(status ? { status } : {}) });
const save = vi.fn<(ref: NoteRef, text: string) => Promise<void>>();
const onOpenNote = vi.fn();
const create = vi.fn();

// The spec's example file, with an item from another notebook of the repository and one whose note is gone.
const example = `version: 1
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
    - { id: t8k2m, x: 960, y: 240, w: 200, text: "口試前要定案：\\n德性是否必要？", color: teal }
  arrows:
    - { id: a3f9q, from: { item: n1 }, to: { item: n2 }, label: 提出 }
    - { id: b7c1z, from: { item: n2 }, to: { item: n3 }, label: 需要 }
`;
const thesisNotes = [note('thesis', 'notes/thesis/第三章導論.md', '第三章導論', '本章回答：理據怎樣才算「被用上」？', 'draft'), note('thesis', 'notes/thesis/依據關係的因果條件.md', '依據關係的因果條件', '理據不只要在場，還得實際促成這個信念。'), note('thesis', 'notes/thesis/德性與能力的區分.md', '德性與能力的區分', '能力是傾向，德性是可靠的能力加上歸屬。'), note('reading', 'notes/reading/sosa-2007.md', 'Sosa 2007 第三講', '動物知識與反思知識的兩層區分。')];

let requests: ReturnType<typeof vi.fn>;
function open({ path, notebookId, raw, notes, members = [], links = [] }: { path: string; notebookId: string; raw: string; notes: ReturnType<typeof note>[]; members?: NoteRef[]; links?: { source: string; target: string; }[]; }) {
  const stored = { id: path, path, notebookId, title: 'Board', content: raw, metadata: {}, tags: [] };
  requests = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/notes/lookup') {
      const refs = JSON.parse(String(init?.body)).notes as NoteRef[];
      return Response.json({ notes: [stored, ...notes].filter(result => refs.some(ref => ref.path === result.path && ref.notebookId === result.notebookId)) });
    }
    if (url.pathname === '/api/notes/query') return Response.json(url.searchParams.get('select') === 'paths' ? { notes: members } : { notes: [], total: 0, nextCursor: null });
    if (url.pathname === '/api/notes/graph') return Response.json({ nodes: [], links, revisions: {} });
    return Response.json(url.pathname === '/api/assets' ? { assets: [] } : {});
  });
  vi.stubGlobal('fetch', requests);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const actions = { save, canWrite: () => true, remove: vi.fn(), create, repository: () => undefined };
  const wrapper = ({ children }: { children: ReactNode; }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PanelProvider>
          <CompilationActionsProvider value={actions}>{children}</CompilationActionsProvider>
        </PanelProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  render(createElement(CompilationView, { path, notebookId, notebooks, folders: [], frame: 'pane', onOpenNote }), { wrapper });
}
const openExample = (links: { source: string; target: string; }[] = []) => open({ path: 'notes/thesis/chapter-3.compilation.yml', notebookId: 'thesis', raw: example, notes: thesisNotes, links });
const cardButtons = (root: HTMLElement = document.body) => [...root.querySelectorAll<HTMLElement>('.board-card')];
const titles = (root?: HTMLElement) => cardButtons(root).map(button => button.querySelector('.board-card-title')!.textContent);
const description = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-describedby')!)?.textContent ?? '';

beforeEach(() => {
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the board, drawn', () => {
  it('draws the example in book order: a region of the title, a group per section, then text and the arrows in words', async () => {
    openExample();
    const region = await screen.findByRole('region', { name: '第三章：德性與依據' });
    await waitFor(() => expect(titles(region)).toEqual(['第三章導論', '依據關係的因果條件', '德性與能力的區分', 'Sosa 2007 第三講', 'gone']));
    const first = screen.getByRole('group', { name: '一、問題' }), second = screen.getByRole('group', { name: '二、德性知識論' });
    expect(titles(first)).toEqual(['第三章導論', '依據關係的因果條件']);
    expect(titles(second)).toEqual(['德性與能力的區分', 'Sosa 2007 第三講', 'gone']);
    // Every card is a button named by its title, after its section in the DOM; free text and the arrows follow the cards.
    expect(within(first).getByRole('button', { name: /第三章導論/ })).toBeInTheDocument();
    const text = region.querySelector('[data-board-text="t8k2m"]')!;
    expect(text.textContent).toBe('口試前要定案：\n德性是否必要？');
    expect(text).toHaveAttribute('data-color', 'teal');
    expect(second.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const arrows = within(region).getByRole('list', { name: 'Arrows' });
    expect(within(arrows).getAllByRole('listitem').map(item => item.textContent)).toEqual(['第三章導論 提出 → 依據關係的因果條件', '依據關係的因果條件 需要 → 德性與能力的區分']);
    expect(text.compareDocumentPosition(arrows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...region.querySelectorAll('.board-arrow-label')].map(label => label.textContent)).toEqual(['提出', '需要']);
    expect(region.querySelectorAll('[data-board-arrow]')).toHaveLength(2);
  });

  it('places stored cards where the file says, auto-places the rest inside their section, and writes nothing', async () => {
    openExample();
    await screen.findByRole('group', { name: '二、德性知識論' });
    const at = (key: string) => document.querySelector<HTMLElement>(`[data-board-card="${key}"]`)!;
    expect([at('n1').style.left, at('n1').style.top]).toEqual(['24px', '56px']);
    // n3 is stored at (360, 56) inside the section at (336, 0); n4 and n5 fill the free slots beside and under it.
    expect([at('n3').style.left, at('n3').style.top]).toEqual(['24px', '56px']);
    expect(at('n3')).toHaveAttribute('data-placed');
    expect(at('n4')).not.toHaveAttribute('data-placed');
    expect([at('n4').style.left, at('n4').style.top]).toEqual(['288px', '48px']);
    expect([at('n5').style.left, at('n5').style.top]).toEqual(['24px', '200px']);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(save).not.toHaveBeenCalled();
  });

  it('marks a card of another notebook and shows a missing note as not found', async () => {
    openExample();
    await waitFor(() => expect(document.querySelector('[data-board-card="n4"] .board-card-excerpt')).toHaveTextContent('動物知識'));
    const other = document.querySelector<HTMLElement>('[data-board-card="n4"]')!;
    expect(other).toHaveAttribute('data-other-notebook', 'Reading');
    expect(other.querySelector('.board-card-notebook .notebook-mark')).toBeInTheDocument();
    expect(description(other)).toContain('Notebook: Reading');
    expect(document.querySelector('[data-board-card="n1"]')).not.toHaveAttribute('data-other-notebook');
    const missing = document.querySelector<HTMLElement>('[data-board-card="n5"]')!;
    expect(missing).toHaveAttribute('data-missing');
    expect(missing).toHaveTextContent('Not found');
  });

  it('shows title and first lines, and describes each card: status, section and arrows in words', async () => {
    openExample();
    const card = await screen.findByRole('button', { name: /^第三章導論/ });
    await waitFor(() => expect(card.querySelector('.board-card-excerpt')).toHaveTextContent('本章回答：理據怎樣才算「被用上」？'));
    expect(card.querySelector('.status-dot')).toBeInTheDocument();
    expect(description(card)).toBe('draft; Section: 一、問題; 提出 → 依據關係的因果條件');
    expect(description(screen.getByRole('button', { name: /^依據關係的因果條件/ }))).toBe('Section: 一、問題; 第三章導論 提出 →; 需要 → 德性與能力的區分');
  });

  it('opens a card where the compilation opens notes', async () => {
    openExample();
    const card = await screen.findByRole('button', { name: /^依據關係的因果條件/ });
    await waitFor(() => expect(card.querySelector('.board-card-excerpt')).toBeInTheDocument());
    fireEvent.click(card);
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/thesis/依據關係的因果條件.md' }), undefined);
  });

  it('draws one dashed line per pair of linked notes and hides them with the toggle, remembered on this device', async () => {
    const key = (path: string) => `thesis:notes/thesis/${path}`;
    openExample([{ source: key('第三章導論.md'), target: key('德性與能力的區分.md') }, { source: key('德性與能力的區分.md'), target: key('第三章導論.md') }]);
    await waitFor(() => expect(document.querySelectorAll('[data-board-note-link]')).toHaveLength(1));
    expect(description(screen.getByRole('button', { name: /^第三章導論/ }))).toContain('Linked inside notes: 德性與能力的區分');
    const toggle = screen.getByRole('button', { name: 'Show links inside notes' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(document.querySelectorAll('[data-board-note-link]')).toHaveLength(0);
    expect(localStorage.getItem(BOARD_NOTE_LINKS_STORAGE_KEY)).toBe('off');
  });

  it('marks 白板 in the arrangement switch, and switching to the book keeps the board in the file', async () => {
    openExample();
    const tabs = within(await screen.findByRole('group', { name: 'View size: 第三章：德性與依據' }));
    expect(tabs.getByRole('button', { name: 'Whiteboard' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Filters and sort/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arrange contents: 第三章：德性與依據' })).toBeInTheDocument();
    // On a wider screen the compilation keeps its own actions: rename, add, arrange and the menu.
    expect(screen.getByRole('button', { name: '第三章：德性與依據' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add item: 第三章：德性與依據' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More compilation actions: 第三章：德性與依據' })).toBeInTheDocument();
    fireEvent.click(tabs.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const written = parseCompilation(save.mock.calls[0][1], ['notes/thesis', 'notes/reading']);
    expect(written.arrangement).toBe('book');
    expect(written.board?.arrows).toHaveLength(2);
  });

  it('draws the legacy graph example without overlapping cards, and opening it writes nothing', async () => {
    const raw = readFileSync(resolve(__dirname, '../../../../../examples/demo-workspace/notes/example/graph-playground.compilation.yml'), 'utf8');
    const paths = ['graph-playground', 'river-reading', 'evening-ideas', 'music-resources', 'todo-demo', 'extra-member'].map(name => `notes/example/${name}.md`);
    const members = paths.map(path => ({ ...note('example', path, path.split('/').pop()!, `Body of ${path}`), tags: ['graph-demo'] }));
    const example = [{ id: 'example', title: 'Example', root: 'notes/example' }];
    notebooks.push(...example);
    try {
      open({ path: 'notes/example/graph-playground.compilation.yml', notebookId: 'example', raw, notes: members, members: paths.map(path => ({ notebookId: 'example', path })) });
      await screen.findByRole('region', { name: 'Graph Playground' });
      await waitFor(() => expect(cardButtons()).toHaveLength(paths.length));
      const rects = cardButtons().map(button => ({ x: Number.parseFloat(button.style.left), y: Number.parseFloat(button.style.top) }));
      for (let a = 0; a < rects.length; a++) {
        for (let b = a + 1; b < rects.length; b++) {
          const apart = Math.abs(rects[a].x - rects[b].x) >= 240 || Math.abs(rects[a].y - rects[b].y) >= 128;
          expect(apart, `${cardButtons()[a].dataset.boardCard} overlaps ${cardButtons()[b].dataset.boardCard}`).toBe(true);
        }
      }
      // The legacy layout's notes are placed; the member it does not name is auto-placed.
      expect(cardButtons().filter(button => button.hasAttribute('data-placed'))).toHaveLength(5);
      expect(within(screen.getByRole('group', { name: 'View size: Graph Playground' })).getByRole('button', { name: 'Whiteboard' })).toHaveAttribute('aria-pressed', 'true');
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(save).not.toHaveBeenCalled();
    } finally {
      notebooks.splice(-example.length);
    }
  });

  it('shows every member of a dynamic board, whatever status filter the other arrangements keep', async () => {
    const raw = 'version: 1\nid: dyn\ntitle: Dyn\narrangement: board\nsource: { kind: tag, tag: t }\nstudy: { filter: all, dueFirst: false, status: done }\n';
    const member = { ...note('thesis', 'notes/thesis/draft.md', 'Draft note', 'Body', 'draft'), tags: ['t'] };
    open({ path: 'notes/thesis/dyn.compilation.yml', notebookId: 'thesis', raw, notes: [member], members: [{ notebookId: 'thesis', path: member.path }] });
    await screen.findByRole('button', { name: /^Draft note/ });
    const queries = requests.mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter(url => url.pathname === '/api/notes/query');
    expect(queries.length).toBeGreaterThan(0);
    for (const url of queries) expect(url.searchParams.get('status')).toBeNull();
  });

  it('draws a legacy graph of more notes than a whiteboard keeps, and neither saves nor copies it', async () => {
    const paths = Array.from({ length: 2001 }, (_, index) => `notes/thesis/${index}.md`);
    const raw = `version: 1\nid: wide\ntitle: Wide\narrangement: graph\nsource: { kind: tag, tag: t }\ngraph:\n  nodes:\n${paths.map((path, index) => `    - { path: ${path}, x: ${index * 300}, y: 0 }`).join('\n')}\n`;
    open({ path: 'notes/thesis/wide.compilation.yml', notebookId: 'thesis', raw, notes: [], members: [] });
    const tabs = within(await screen.findByRole('group', { name: 'View size: Wide' }));
    fireEvent.click(tabs.getByRole('button', { name: 'Book' }));
    expect(await screen.findByText(/Wide: not saved, its legacy graph layout places 2001 notes/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'More compilation actions: Wide' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate compilation' }));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(tabs.getByRole('button', { name: 'Whiteboard' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('on a phone: no arrangement switch, no minimap, and a tap opens the note', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 767px'), media: query, addEventListener() {}, removeEventListener() {} }));
    openExample();
    const card = await screen.findByRole('button', { name: /^第三章導論/ });
    await waitFor(() => expect(card.querySelector('.board-card-excerpt')).toBeInTheDocument());
    expect(screen.queryByRole('group', { name: /View size/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /View size/ })).not.toBeInTheDocument();
    expect(document.querySelector('.board-minimap')).toBeNull();
    for (const tool of ['Select', 'Card', 'Text', 'Section', 'Arrow']) expect(screen.queryByRole('button', { name: tool })).not.toBeInTheDocument();
    // Nothing that changes the file, the outline or the compilation's place: no add, arrange, rename, settings, copy, move or delete.
    for (const action of [/^Add item/, /^Arrange contents/, /^Filters and sorting/, /^Create note in compilation/, /^Add to outline/, /^More compilation actions/, /^Start studying/]) expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '第三章：德性與依據' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.click(card);
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/thesis/第三章導論.md' }), undefined);
  });

  it('pans on a drag instead of opening the card it started on', async () => {
    openExample();
    const card = await screen.findByRole('button', { name: /^第三章導論/ });
    fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 40 });
    fireEvent.pointerUp(card, { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 40 });
    fireEvent.click(card);
    expect(onOpenNote).not.toHaveBeenCalled();
  });
});
