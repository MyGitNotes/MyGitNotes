// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { compilationChapters, type CompilationFile, parseCompilation } from '@mygitnotes/core/compilation';
import { BOARD_NOTE_TYPE, draggedNote } from '../../lib/board/drawer.js';
import { boardsRoute } from '../../lib/routes.js';
import { editing, example, note, openBoard, resetBoardTest, save, thesisNotes } from './board-test-helpers.js';

vi.mock('../../lib/note-editing.js', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/note-editing.js')>(), useEditorRegistry: () => () => () => {}, useNoteEditing: () => editing }));
/** The hosted editor, standing in with its title button, which opens the title for renaming. */
const renaming = vi.fn<(path: string) => void>();
vi.mock('../NoteEditorHost.js', async () => {
  const { createElement } = await import('react');
  return { HostedNoteEditor: (props: { path: string; }) => createElement('div', null, createElement('button', { type: 'button', className: 'title-rename', onClick: () => renaming(props.path) }, 'Untitled'), createElement('textarea', { 'aria-label': `Editor ${props.path}` })) };
});

const BOARD = 'notes/thesis/chapter-3.compilation.yml';
const INTRO = 'notes/thesis/第三章導論.md', CAUSAL = 'notes/thesis/依據關係的因果條件.md';
const GRECO = 'notes/thesis/greco-2010.md', TERMS = 'notes/thesis/名詞對照表.md';
// Two notes of the notebook not on the board, and the board's own: the drawer's search finds them all.
const library = [note('thesis', GRECO, '待讀：Greco 2010', '第五章的成就觀'), note('thesis', TERMS, '名詞對照表', '術語'), ...thesisNotes.filter(entry => entry.notebookId === 'thesis')];
const key = (path: string) => `thesis:${path}`;
// The causal note links to Greco and is linked from the terms; the introduction links to it too (both on the board).
const links = [{ source: key(CAUSAL), target: key(GRECO) }, { source: key(TERMS), target: key(CAUSAL) }, { source: key(INTRO), target: key(CAUSAL) }];
const sidePanel = { focusNotebook: 'thesis', openInFocus: vi.fn(), fullscreen: vi.fn() };
const SLOW = { timeout: 5000 };

/** Notes a test adds to the notebook's search beyond the library. */
let extra: (ReturnType<typeof note> & { live?: { pending: boolean; since: string; activeEditors: number; }; })[] = [];
/** The Notes page's search over the notebook: a page of notes (as many as asked, from the cursor), or every match's path. */
function search(url: URL) {
  if (url.pathname !== '/api/notes/query' || ['kind', 'folder', 'tag'].some(name => url.searchParams.has(name))) return undefined;
  const q = url.searchParams.get('q') ?? '';
  const found = [...library, ...extra].filter(entry => entry.notebookId === url.searchParams.get('notebookId') && (entry.title.includes(q) || entry.content.includes(q)));
  if (url.searchParams.get('select') === 'paths') return Response.json({ notes: found.map(({ notebookId, path }) => ({ notebookId, path })), total: found.length });
  const limit = Number(url.searchParams.get('limit') ?? 50), start = Number(url.searchParams.get('cursor') ?? 0);
  return Response.json({ notes: found.slice(start, start + limit), total: found.length, nextCursor: start + limit < found.length ? String(start + limit) : null });
}
const fullBoard = `version: 1\nid: full\ntitle: 第三章：德性與依據\narrangement: board\nitems:\n${Array.from({ length: 100 }, (_, index) => `  - id: i${index}\n    kind: note\n    path: notes/thesis/i${index}.md`).join('\n')}\n`;
const open = ({ raw = example, actions = {} }: { raw?: string; actions?: Parameters<typeof openBoard>[0]['actions']; } = {}) => openBoard({ path: BOARD, notebookId: 'thesis', raw, notes: [...thesisNotes, ...library.slice(0, 2)], links, actions, respond: search, view: { frame: 'page', sidePanel, url: boardsRoute('thesis', BOARD) } });
const drawer = () => screen.getByRole('complementary', { name: 'Note library' });
const rows = () => within(drawer()).queryAllByRole('listitem').map(row => row.querySelector('.board-drawer-title')!.textContent);
const region = () => screen.getByRole('region', { name: '第三章：德性與依據' });
const at = (item: string) => document.querySelector<HTMLElement>(`[data-board-card="${item}"]`)!;
const mouse = (x: number, y: number) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
const press = (target: Element, x: number, y: number) => {
  fireEvent.pointerDown(target, mouse(x, y));
  fireEvent.pointerUp(target, mouse(x, y));
};
const scope = ['notes/thesis', 'notes/reading'];
const written = (): CompilationFile => parseCompilation(save.mock.calls.at(-1)![1], scope);
const chapters = (file: CompilationFile) => compilationChapters(file.items!).map(chapter => `${chapter.heading?.title ?? '·'}: ${chapter.items.map(item => 'path' in item ? item.path.split('/').pop() : item.id).join(' ')}`);
const idOf = (file: CompilationFile, path: string) => file.items!.find(item => 'path' in item && item.path === path)!.id;
async function ready(options?: Parameters<typeof open>[0]) {
  open(options);
  await screen.findByRole('group', { name: '二、德性知識論' }, SLOW);
  await waitFor(() => expect(at('n1').querySelector('.board-card-excerpt')).toBeInTheDocument(), SLOW);
}

beforeEach(() => {
  resetBoardTest();
  renaming.mockReset();
  extra = [];
  // jsdom has no drag events: a mouse event carries the drop's point.
  vi.stubGlobal('DragEvent', class DragEvent extends MouseEvent {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the 筆記庫 drawer', () => {
  it('lists the notebook’s notes not on the board, with 「不在這塊白板」 on; turned off, a note on the board offers 「在白板上找」', async () => {
    await ready();
    await waitFor(() => expect(rows()).toEqual(['待讀：Greco 2010', '名詞對照表']), SLOW);
    expect(within(drawer()).getByRole('button', { name: 'Add to the whiteboard: 名詞對照表' })).toBeInTheDocument();
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Not on this whiteboard' }));
    await waitFor(() => expect(rows()).toContain('依據關係的因果條件'));
    expect(within(drawer()).getByRole('button', { name: 'Find on the whiteboard: 依據關係的因果條件' })).toBeInTheDocument();
  });

  it('adds a note dropped on the board in the section it lands in, at that point', async () => {
    await ready();
    await waitFor(() => expect(rows()).toContain('名詞對照表'), SLOW);
    const row = within(drawer()).getAllByRole('listitem').find(item => item.textContent?.includes('名詞對照表'))!;
    const setData = vi.fn();
    fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: 'all' } });
    expect(setData).toHaveBeenCalledWith(BOARD_NOTE_TYPE, draggedNote({ notebookId: 'thesis', path: TERMS }));
    const dataTransfer = { types: [BOARD_NOTE_TYPE], getData: (type: string) => type === BOARD_NOTE_TYPE ? setData.mock.calls[0][1] : '', dropEffect: 'none' };
    fireEvent.dragOver(region(), { dataTransfer, clientX: 800, clientY: 300 });
    fireEvent.drop(region(), { dataTransfer, clientX: 800, clientY: 300 });
    await waitFor(() => expect(save).toHaveBeenCalled(), SLOW);
    const file = written();
    expect(chapters(file)).toEqual(['一、問題: 第三章導論.md 依據關係的因果條件.md', '二、德性知識論: 德性與能力的區分.md sosa-2007.md gone.md 名詞對照表.md']);
    expect(file.board!.cards).toContainEqual({ item: idOf(file, TERMS), x: 680, y: 236 });
  });

  it('places 「加到白板」 in the selected section, and finds a note already on the board instead of adding it again', async () => {
    await ready();
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Not on this whiteboard' }));
    await waitFor(() => expect(rows()).toContain('第三章導論'), SLOW);
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Find on the whiteboard: 第三章導論' }));
    expect(at('n1')).toHaveAttribute('data-selected');
    press(screen.getByRole('button', { name: 'Section: 一、問題' }), 20, 20);
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Add to the whiteboard: 待讀：Greco 2010' }));
    await waitFor(() => expect(save).toHaveBeenCalled(), SLOW);
    const file = written();
    expect(chapters(file)).toEqual(['一、問題: 第三章導論.md 依據關係的因果條件.md greco-2010.md', '二、德性知識論: 德性與能力的區分.md sosa-2007.md gone.md']);
    // At the viewport's centre (the origin here), moved down clear of the cards there.
    expect(file.board!.cards).toContainEqual({ item: idOf(file, GRECO), x: -120, y: 392 });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('refuses a note past the item limit of 100 with the limit’s message', async () => {
    open({ raw: fullBoard });
    await waitFor(() => expect(rows()).toContain('名詞對照表'), SLOW);
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Add to the whiteboard: 名詞對照表' }));
    expect(await screen.findByText('A compilation holds at most 100 pinned items.')).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps a pending live note off the board: no drag, and 「加到白板」 says to check it in first', async () => {
    extra = [{ ...note('thesis', 'notes/thesis/.live/abc123.md', '未歸檔草稿', '剛寫的'), live: { pending: true, since: '2026-11-25T00:00:00.000Z', activeEditors: 1 } }];
    await ready();
    await waitFor(() => expect(rows()).toContain('未歸檔草稿'), SLOW);
    const row = within(drawer()).getAllByRole('listitem').find(item => item.textContent?.includes('未歸檔草稿'))!;
    expect(row).toHaveAttribute('draggable', 'false');
    const add = within(row).getByRole('button', { name: 'Add to the whiteboard: 未歸檔草稿' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(add);
    expect(await screen.findByText(/no lasting path until it is checked in/)).toBeInTheDocument();
    // Dropped anyway (its path names it), the board refuses it the same way.
    const dataTransfer = { types: [BOARD_NOTE_TYPE], getData: () => draggedNote({ notebookId: 'thesis', path: 'notes/thesis/.live/abc123.md' }), dropEffect: 'none' };
    fireEvent.drop(region(), { dataTransfer, clientX: 800, clientY: 300 });
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(save).not.toHaveBeenCalled();
  });

  it('reads the next page of the search on 「載入更多」', async () => {
    extra = Array.from({ length: 60 }, (_, index) => note('thesis', `notes/thesis/more-${index}.md`, `More ${index}`, 'more'));
    await ready();
    // The first page holds 50 notes, three of them on the board.
    await waitFor(() => expect(rows()).toHaveLength(47), SLOW);
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Load more notes' }));
    await waitFor(() => expect(rows()).toHaveLength(62), SLOW);
    expect(within(drawer()).queryByRole('button', { name: 'Load more notes' })).toBeNull();
  });

  it('on a dynamic board only finds: no drag, no 「加到白板」, and its foot says where the cards come from', async () => {
    openBoard({ path: BOARD, notebookId: 'thesis', raw: 'version: 1\nid: tagged\ntitle: 第三章：德性與依據\narrangement: board\nsource: { kind: tag, tag: 論文 }\n', notes: library, respond: search, view: { frame: 'page', sidePanel, url: boardsRoute('thesis', BOARD) } });
    await waitFor(() => expect(rows()).toContain('名詞對照表'), SLOW);
    expect(within(drawer()).queryByRole('button', { name: /Add to the whiteboard/ })).toBeNull();
    expect(within(drawer()).getAllByRole('listitem').every(row => row.getAttribute('draggable') === 'false')).toBe(true);
    expect(within(drawer()).getByText('This whiteboard’s cards come from the tag 論文; to add a note, tag it.')).toBeInTheDocument();
  });

  it('「連到選取的卡片」 keeps the notes linked to or from the selected cards', async () => {
    await ready();
    await waitFor(() => expect(rows()).toHaveLength(2), SLOW);
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Linked to the selected cards' }));
    expect(within(drawer()).getByText('Select cards on the whiteboard to list the notes linked with them.')).toBeInTheDocument();
    press(at('n2'), 30, 220);
    await waitFor(() => expect(rows()).toEqual(['待讀：Greco 2010', '名詞對照表']), SLOW);
    press(at('n1'), 30, 60);
    // The introduction links only to the causal note, which the board shows.
    await waitFor(() => expect(rows()).toEqual([]), SLOW);
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Not on this whiteboard' }));
    await waitFor(() => expect(rows()).toEqual(['依據關係的因果條件']), SLOW);
  });
});

describe('「＋N 相連」', () => {
  it('counts the linked notes off the board and adds the checked ones beside the card, in its chapter', async () => {
    await ready();
    press(at('n2'), 30, 220);
    const badge = await screen.findByRole('button', { name: '2 linked notes are not on this whiteboard' }, SLOW);
    expect(badge).toHaveTextContent('+2 linked');
    fireEvent.pointerDown(badge, { button: 0, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: '名詞對照表' }));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add (1)' }));
    await waitFor(() => expect(save).toHaveBeenCalled(), SLOW);
    const file = written();
    expect(chapters(file)[0]).toBe('一、問題: 第三章導論.md 依據關係的因果條件.md greco-2010.md');
    // The section 二 stands right beside the card's own, so the column goes below the card at (24, 216).
    expect(file.board!.cards).toContainEqual({ item: idOf(file, GRECO), x: 24, y: 368 });
  });

  it('offers the notes again once the addition is undone', async () => {
    await ready();
    press(at('n2'), 30, 220);
    fireEvent.pointerDown(await screen.findByRole('button', { name: '2 linked notes are not on this whiteboard' }, SLOW), { button: 0, pointerType: 'mouse' });
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Add (2)' }));
    await waitFor(() => expect(document.querySelectorAll('.board-card')).toHaveLength(7), SLOW);
    fireEvent.keyDown(region(), { key: 'z', metaKey: true });
    await waitFor(() => expect(document.querySelectorAll('.board-card')).toHaveLength(5), SLOW);
    // The cards the undo took away stay selected in name only: Space adds the card to a selection of one drawn card.
    fireEvent.keyDown(at('n2'), { key: ' ' });
    expect(await screen.findByRole('button', { name: '2 linked notes are not on this whiteboard' }, SLOW)).toBeInTheDocument();
  });

  it('shows no badge on a dynamic board', async () => {
    openBoard({ path: BOARD, notebookId: 'thesis', raw: 'version: 1\nid: tagged\ntitle: 第三章：德性與依據\narrangement: board\nsource: { kind: tag, tag: t }\n', notes: [{ ...thesisNotes[1], tags: ['t'] }, ...library.slice(0, 2)], members: [{ notebookId: 'thesis', path: CAUSAL }], links, respond: search, view: { frame: 'page', sidePanel, url: boardsRoute('thesis', BOARD) } });
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.board-card');
      expect(found).not.toBeNull();
      return found!;
    }, SLOW);
    press(card, 10, 10);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(screen.queryByRole('button', { name: /linked notes are not on this whiteboard/ })).toBeNull();
  });
});

describe('the 卡片 tool', () => {
  it('creates a note where the board is clicked, places it in that section, and opens it in the side panel with its title selected', async () => {
    const created = { ...note('thesis', 'notes/thesis/untitled.md', 'Untitled', '# Untitled'), status: 'draft' };
    const createBoardNote = vi.fn(async () => created);
    await ready({ actions: { createBoardNote, newNotesLive: () => false } });
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    press(region(), 800, 300);
    await waitFor(() => expect(createBoardNote).toHaveBeenCalledWith({ notebookId: 'thesis', folder: '' }));
    await waitFor(() => expect(save).toHaveBeenCalled(), SLOW);
    const file = written();
    expect(chapters(file)[1]).toBe('二、德性知識論: 德性與能力的區分.md sosa-2007.md gone.md untitled.md');
    expect(file.board!.cards).toContainEqual({ item: idOf(file, created.path), x: 680, y: 236 });
    const panel = await screen.findByRole('complementary', { name: 'Note beside the whiteboard' }, SLOW);
    expect(panel).toHaveAttribute('data-board-panel', created.path);
    // Its title opens for typing, once.
    await waitFor(() => expect(renaming).toHaveBeenCalledWith(created.path));
    expect(renaming).toHaveBeenCalledTimes(1);
    // The tool returns to 選取 after one use.
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('creates nothing on a board at its item limit, and says why', async () => {
    const createBoardNote = vi.fn();
    open({ raw: fullBoard, actions: { createBoardNote, newNotesLive: () => false } });
    fireEvent.click(await screen.findByRole('button', { name: 'Card' }, SLOW));
    press(region(), 800, 300);
    expect(await screen.findByText('A compilation holds at most 100 pinned items.')).toBeInTheDocument();
    expect(createBoardNote).not.toHaveBeenCalled();
  });

  it('deletes the new note again and opens nothing when the board cannot be written', async () => {
    const created = note('thesis', 'notes/thesis/untitled.md', 'Untitled', '# Untitled');
    const discard = vi.fn(async () => {});
    await ready({ actions: { createBoardNote: vi.fn(async () => created), newNotesLive: () => false, remove: discard } });
    save.mockRejectedValue(new Error('The disk is full.'));
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    press(region(), 800, 300);
    await waitFor(() => expect(discard).toHaveBeenCalledWith(created), SLOW);
    expect(screen.queryByRole('complementary', { name: 'Note beside the whiteboard' })).toBeNull();
    expect(renaming).not.toHaveBeenCalled();
  });

  it('deletes the new note again when the board went away while it was created', async () => {
    const created = note('thesis', 'notes/thesis/untitled.md', 'Untitled', '# Untitled');
    let finish!: (value: typeof created) => void;
    const createBoardNote = vi.fn(() => new Promise<typeof created>(resolve => finish = resolve));
    const discard = vi.fn(async () => {});
    const view = open({ actions: { createBoardNote, newNotesLive: () => false, remove: discard } });
    await screen.findByRole('group', { name: '二、德性知識論' }, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    press(region(), 800, 300);
    await waitFor(() => expect(createBoardNote).toHaveBeenCalled());
    view.unmount();
    finish(created);
    await waitFor(() => expect(discard).toHaveBeenCalledWith(created));
    expect(save).not.toHaveBeenCalled();
  });

  it('is off in a repository whose new notes start live, and says why', async () => {
    const createBoardNote = vi.fn();
    await ready({ actions: { createBoardNote, newNotesLive: () => true } });
    const tool = screen.getByRole('button', { name: 'Card' });
    expect(tool).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(tool);
    expect(await screen.findByText(/a new note has no path until it is checked in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
    press(region(), 800, 300);
    expect(createBoardNote).not.toHaveBeenCalled();
  });
});
