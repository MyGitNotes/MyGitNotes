// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { compilationFields, parseCompilation } from '@mygitnotes/core/compilation';
import { isListedBoard } from '../../lib/board/listing.js';
import { cameraAt } from '../../lib/board/zoom.js';
import { installPopGuard } from '../../lib/pop-guard.js';
import { boardsQuery, boardsRoute } from '../../lib/routes.js';
import { editing, example, note, openBoard, resetBoardTest, router, save, thesisNotes } from './board-test-helpers.js';

vi.mock('../../lib/note-editing.js', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/note-editing.js')>(), useEditorRegistry: () => () => () => {}, useNoteEditing: () => editing }));
/** The hosted editor a Focus pane uses, standing in for the whole editor: what it was asked to edit, and a field to type in. */
const hosted = vi.fn<(props: { notebookId: string; path: string; frame: string; active: boolean; }) => void>();
vi.mock('../NoteEditorHost.js', async () => {
  const { createElement } = await import('react');
  return {
    HostedNoteEditor: (props: { notebookId: string; path: string; frame: string; active: boolean; }) => {
      hosted(props);
      return createElement('textarea', { 'aria-label': `Editor ${props.path}`, 'defaultValue': 'body' });
    },
  };
});

const BOARD = 'notes/thesis/chapter-3.compilation.yml';
const OTHER = 'notes/thesis/other.compilation.yml';
const INTRO = 'notes/thesis/第三章導論.md', CAUSAL = 'notes/thesis/依據關係的因果條件.md';
// Another board of the notebook holding the second note, under the item id `c1`.
const other = `version: 1\nid: other\ntitle: Other board\narrangement: board\nitems:\n  - id: c1\n    kind: note\n    path: ${CAUSAL}\n`;
// A board of the reading notebook holding its note, which the example pins from there.
const SOSA = 'notes/reading/sosa-2007.md';
const reading = `version: 1\nid: reading-board\ntitle: Reading board\narrangement: board\nitems:\n  - id: s1\n    kind: note\n    path: ${SOSA}\n`;
const compilations = [note('thesis', BOARD, '第三章：德性與依據', example), note('thesis', OTHER, 'Other board', other), note('reading', 'notes/reading/board.compilation.yml', 'Reading board', reading)].map(entry => ({ ...entry, kind: 'compilation' as const }));
const sidePanel = { focusNotebook: 'thesis', openInFocus: vi.fn(), fullscreen: vi.fn() };
const flush = vi.spyOn(editing, 'flushEditors');

const open = (url = boardsRoute('thesis', BOARD)) => openBoard({ path: BOARD, notebookId: 'thesis', raw: example, notes: thesisNotes, compilations, view: { frame: 'page', sidePanel, url } });
// The first board of a run reads its modules cold, so it may take longer than a waitFor's default second.
const SLOW = { timeout: 5000 };
/** The notes of the example's cards: a card opens its note once the note was read, which its excerpt shows. */
const cardNotes: Record<string, string> = { n1: INTRO, n2: CAUSAL, n3: 'notes/thesis/德性與能力的區分.md', n4: SOSA };
const card = (key: string) =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[data-board-card="${key}"]`);
    const content = thesisNotes.find(entry => entry.path === cardNotes[key])!.content;
    expect(found?.querySelector('.board-card-excerpt')?.textContent).toBe(content);
    return found!;
  }, SLOW);
const panel = () => screen.queryByRole('complementary', { name: 'Note beside the whiteboard' });
const findPanel = () =>
  waitFor(() => {
    expect(panel()).not.toBeNull();
    return panel()!;
  }, SLOW);
const shown = () => boardsQuery(router.location!.search);

beforeEach(() => {
  resetBoardTest();
  hosted.mockReset();
  flush.mockReset().mockResolvedValue(true);
  sidePanel.openInFocus.mockReset();
  sidePanel.fullscreen.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the side panel of a board', () => {
  it('opens a note card in the hosted editor of a Focus pane, edited in place, in a new history entry that Back closes', async () => {
    open();
    fireEvent.click(await card('n1'));
    const aside = await findPanel();
    expect(within(aside).getByText(INTRO)).toBeInTheDocument();
    expect(hosted).toHaveBeenLastCalledWith(expect.objectContaining({ notebookId: 'thesis', path: INTRO, frame: 'pane', active: true }));
    const field = within(aside).getByRole('textbox', { name: `Editor ${INTRO}` });
    fireEvent.change(field, { target: { value: 'edited here' } });
    expect(field).toHaveValue('edited here');
    expect(shown()).toMatchObject({ board: BOARD, note: INTRO });
    act(() => void router.navigate!(-1));
    await waitFor(() => expect(panel()).toBeNull());
    expect(shown()).toEqual({ board: BOARD, note: null, card: null });
  });

  it('opens a note card of a board in zoom in the panel inside the zoom, keeping the zoom address', async () => {
    const zoom = '/notebooks/thesis/notes/chapter-3.compilation.yml?returnTo=%2Fnotebooks%2Fthesis';
    openBoard({ path: BOARD, notebookId: 'thesis', raw: example, notes: thesisNotes, compilations, view: { frame: 'zoom', sidePanel, url: zoom } });
    fireEvent.click(await card('n2'));
    await findPanel();
    expect(router.location!.pathname).toBe('/notebooks/thesis/notes/chapter-3.compilation.yml');
    expect(new URLSearchParams(router.location!.search).get('returnTo')).toBe('/notebooks/thesis');
    expect(shown().note).toBe(CAUSAL);
  });

  it('saves the shown editor before switching cards, keeps the card on a failed save, and replaces the entry', async () => {
    open();
    fireEvent.click(await card('n1'));
    await waitFor(() => expect(shown().note).toBe(INTRO));
    flush.mockResolvedValueOnce(false);
    fireEvent.click(await card('n2'));
    await waitFor(() => expect(flush).toHaveBeenCalledWith([`thesis:${INTRO}`]));
    expect(shown().note).toBe(INTRO);
    fireEvent.click(await card('n2'));
    await waitFor(() => expect(shown().note).toBe(CAUSAL));
    expect(flush).toHaveBeenLastCalledWith([`thesis:${INTRO}`]);
    expect(hosted).toHaveBeenLastCalledWith(expect.objectContaining({ path: CAUSAL }));
    // The switch replaced the entry the first card pushed, so one Back closes the panel.
    act(() => void router.navigate!(-1));
    await waitFor(() => expect(panel()).toBeNull());
  });

  it('includes a board outside the current board and note notebook', async () => {
    const sibling = { ...note('reading', 'notes/reading/sibling.compilation.yml', 'Sibling', other.replace('Other board', 'Sibling')), kind: 'compilation' as const };
    openBoard({ path: BOARD, notebookId: 'thesis', raw: example, notes: thesisNotes, compilations: [...compilations, sibling], view: { frame: 'page', sidePanel, url: boardsRoute('thesis', BOARD, { note: CAUSAL }) } });
    expect(await within(await findPanel()).findByText(/On 3 whiteboards/)).toHaveTextContent('Sibling');
  });

  it('lists the boards holding the note and jumps to one with its card named, saving first', async () => {
    open(boardsRoute('thesis', BOARD, { note: CAUSAL }));
    const aside = await findPanel();
    const boards = await within(aside).findByText(/On 2 whiteboards/);
    expect(within(boards).getAllByRole('button').map(button => button.textContent)).toEqual(['第三章：德性與依據', 'Other board']);
    fireEvent.click(within(boards).getByRole('button', { name: 'Open the whiteboard Other board at this card' }));
    await waitFor(() => expect(router.location!.search).toBe(boardsRoute('thesis', OTHER, { note: CAUSAL, card: 'c1' }).slice('/boards'.length)));
    expect(flush).toHaveBeenCalledWith([`thesis:${CAUSAL}`]);
  });

  it('centres and selects the card the address names, and puts the keyboard on it', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    // The viewport fills 1000 × 600 and a focused card is measured where the camera centred it, as a browser lays them out.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
      return (this.classList.contains('board-viewport') ? new DOMRect(0, 0, 1000, 600) : new DOMRect(380, 236, 240, 128));
    });
    open(boardsRoute('thesis', BOARD, { note: CAUSAL, card: 'n3' }));
    const target = await card('n3');
    await waitFor(() => expect(target).toHaveAttribute('data-selected'));
    const layer = document.querySelector<HTMLElement>('.board-layer')!;
    const [, x, y, zoom] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(layer.style.transform)!.map(Number);
    // n3 is stored at (360, 56): its centre is the viewport's.
    const expected = cameraAt({ x: 360 + 120, y: 56 + 64 }, zoom, { width: 1000, height: 600 });
    expect(x).toBeCloseTo(expected.x);
    expect(y).toBeCloseTo(expected.y);
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(document.querySelectorAll('[data-board-card][data-selected]')).toHaveLength(1);
    [width, height, rect].forEach(spy => spy.mockRestore());
  });

  it('opens a note of this notebook in Focus or full screen, and disables Focus for a card of another notebook', async () => {
    open();
    fireEvent.click(await card('n1'));
    let aside = await findPanel();
    const focus = within(aside).getByRole('button', { name: 'Open in Focus' });
    await waitFor(() => expect(focus).toBeEnabled());
    fireEvent.click(focus);
    expect(sidePanel.openInFocus).toHaveBeenCalledWith(expect.objectContaining({ notebookId: 'thesis', path: INTRO }));
    fireEvent.click(await card('n4'));
    await waitFor(() => expect(hosted).toHaveBeenLastCalledWith(expect.objectContaining({ notebookId: 'reading', path: 'notes/reading/sosa-2007.md' })));
    aside = panel()!;
    const blocked = within(aside).getByRole('button', { name: 'Open in Focus' });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleDescription('Only notes of this notebook open in its Focus');
    const full = within(aside).getByRole('button', { name: 'Full screen' });
    await waitFor(() => expect(full).toBeEnabled());
    fireEvent.click(full);
    expect(sidePanel.fullscreen).toHaveBeenCalledWith(expect.objectContaining({ notebookId: 'reading', path: 'notes/reading/sosa-2007.md' }));
    fireEvent.click(within(aside).getByRole('button', { name: 'Close the note' }));
    await waitFor(() => expect(panel()).toBeNull());
  });
});

describe('leaving a side panel', () => {
  it("saves the panel's note before a folder, asset or missing card opens elsewhere", async () => {
    open(boardsRoute('thesis', BOARD, { note: INTRO }));
    await findPanel();
    flush.mockResolvedValueOnce(false);
    fireEvent.click(document.querySelector<HTMLElement>('[data-board-card="n5"]')!);
    await waitFor(() => expect(flush).toHaveBeenCalledWith([`thesis:${INTRO}`]));
    // A refused save opens nothing: the missing note's notice stays away.
    expect(screen.queryByText(/may have moved or been deleted/)).toBeNull();
  });
});

describe('the 白板 page draws every compilation it lists as a board', () => {
  it('draws a book holding board data as its board, with the panel', async () => {
    openBoard({ path: BOARD, notebookId: 'thesis', raw: example.replace('arrangement: board', 'arrangement: book'), notes: thesisNotes, compilations, view: { frame: 'page', sidePanel, url: boardsRoute('thesis', BOARD) } });
    await screen.findByRole('group', { name: '二、德性知識論' });
    expect(document.querySelector('.compilation-view')).toHaveAttribute('data-arrangement', 'board');
    expect(document.querySelector('.book-view, .compilation-book')).toBeNull();
    fireEvent.click(await card('n1'));
    await findPanel();
  });

  it('writes the book chosen there with a board section, so the compilation stays listed, and opens it in zoom', async () => {
    const fresh = 'version: 1\nid: fresh\ntitle: 未命名白板\narrangement: board\nitems: []\n';
    openBoard({ path: 'notes/thesis/untitled.compilation.yml', notebookId: 'thesis', raw: fresh, notes: [], view: { frame: 'page', sidePanel, url: boardsRoute('thesis', 'notes/thesis/untitled.compilation.yml') } });
    fireEvent.click(await screen.findByRole('button', { name: 'Book' }));
    await waitFor(() => expect(router.location!.pathname).toBe('/notebooks/thesis/notes/untitled.compilation.yml'));
    expect(new URLSearchParams(router.location!.search).get('returnTo')).toBe(boardsRoute('thesis'));
    const written = save.mock.lastCall![1];
    expect(parseCompilation(written)).toMatchObject({ arrangement: 'book', board: {} });
    expect(isListedBoard(compilationFields(written, 'notes/thesis/untitled.compilation.yml').metadata)).toBe(true);
  });
});

describe('around the side panel', () => {
  it('keeps the board in place when the panel opens, so its selection, undo and camera stay', async () => {
    open();
    const target = await card('n1');
    const board = document.querySelector('.board-arrangement');
    fireEvent.click(target);
    await findPanel();
    expect(document.querySelector('.board-arrangement')).toBe(board);
    expect(document.querySelector('[data-board-card="n1"]')).toBe(target);
  });

  it("lists the boards of a cross-notebook card's own notebook as well", async () => {
    open(boardsRoute('thesis', BOARD, { note: SOSA }));
    const aside = await findPanel();
    const boards = await within(aside).findByText(/On 2 whiteboards/);
    expect(within(boards).getAllByRole('button').map(button => button.textContent)).toEqual(['第三章：德性與依據', 'Reading board']);
    fireEvent.click(within(boards).getByRole('button', { name: 'Open the whiteboard Reading board at this card' }));
    await waitFor(() => expect(router.location!.search).toBe(boardsRoute('reading', 'notes/reading/board.compilation.yml', { note: SOSA, card: 's1' }).slice('/boards'.length)));
  });

  it("saves the panel's note before a zoomed board changes arrangement, and changes nothing when it cannot", async () => {
    openBoard({ path: BOARD, notebookId: 'thesis', raw: example, notes: thesisNotes, compilations, view: { frame: 'zoom', sidePanel, url: '/notebooks/thesis/notes/chapter-3.compilation.yml?returnTo=%2Fnotebooks%2Fthesis' } });
    fireEvent.click(await card('n1'));
    await findPanel();
    flush.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(flush).toHaveBeenLastCalledWith([`thesis:${INTRO}`]));
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(document.querySelector('.compilation-view')).toHaveAttribute('data-arrangement', 'board');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(document.querySelector('.compilation-view')).toHaveAttribute('data-arrangement', 'book'));
  });

  it('stays on the 白板 page with the error when the book chosen there cannot be written', async () => {
    save.mockRejectedValueOnce(new Error('disk full'));
    open();
    await card('n1');
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    await screen.findByText('disk full');
    expect(router.location!.pathname).toBe('/boards');
  });
});

describe("Back and Forward with the side panel open, in the browser's history", () => {
  let uninstall: () => void;
  beforeAll(() => void (uninstall = installPopGuard(window)));
  afterAll(() => uninstall());
  const browse = () => openBoard({ path: BOARD, notebookId: 'thesis', raw: example, notes: thesisNotes, compilations, view: { frame: 'page', sidePanel, url: boardsRoute('thesis', BOARD), browser: true } });
  const address = () => boardsQuery(window.location.search);
  const deferred = () => {
    let finish!: (saved: boolean) => void;
    flush.mockReturnValueOnce(new Promise<boolean>(resolve => void (finish = resolve)));
    return (saved: boolean) => finish(saved);
  };

  it('waits for the note to be saved before Back closes the panel, which takes no input meanwhile; Forward opens it again', async () => {
    browse();
    fireEvent.click(await card('n1'));
    await findPanel();
    const finish = deferred();
    act(() => window.history.back());
    await waitFor(() => expect(flush).toHaveBeenLastCalledWith([`thesis:${INTRO}`]));
    // The address is back on the panel's entry while its note is saved, and the editor stays, taking no input.
    await waitFor(() => expect(address().note).toBe(INTRO));
    expect(panel()).toHaveAttribute('inert');
    expect(within(panel()!).getByRole('textbox', { name: `Editor ${INTRO}` })).toBeInTheDocument();
    finish(true);
    await waitFor(() => expect(panel()).toBeNull());
    expect(address()).toEqual({ board: BOARD, note: null, card: null });
    const saves = flush.mock.calls.length;
    act(() => window.history.forward());
    await findPanel();
    expect(address().note).toBe(INTRO);
    // Nothing was shown to save on the way.
    expect(flush).toHaveBeenCalledTimes(saves);
    expect(panel()).not.toHaveAttribute('inert');
  });

  it("keeps the panel, its entry and the history when Back cannot save, and ✕ then closes to the board's own entry", async () => {
    browse();
    fireEvent.click(await card('n1'));
    await findPanel();
    const length = window.history.length;
    flush.mockResolvedValueOnce(false);
    act(() => window.history.back());
    await waitFor(() => expect(flush).toHaveBeenLastCalledWith([`thesis:${INTRO}`]));
    // The address returns to the panel's entry; nothing else moves.
    await waitFor(() => expect(address().note).toBe(INTRO));
    await waitFor(() => expect(panel()).not.toHaveAttribute('inert'));
    expect(panel()).not.toBeNull();
    expect(window.history.length).toBe(length);
    fireEvent.click(within(panel()!).getByRole('button', { name: 'Close the note' }));
    await waitFor(() => expect(panel()).toBeNull());
    expect(window.location.pathname).toBe('/boards');
    expect(address()).toEqual({ board: BOARD, note: null, card: null });
  });

  it('waits for the note to be saved before Forward leaves the page, and stays when it cannot be', async () => {
    browse();
    fireEvent.click(await card('n1'));
    await findPanel();
    // Another page, as 開進 Focus or 全螢幕 go to (each saves first), then Back to the board with its panel.
    act(() => void router.navigate!('/elsewhere'));
    await screen.findByText('Elsewhere');
    act(() => window.history.back());
    await findPanel();
    flush.mockResolvedValueOnce(false);
    act(() => window.history.forward());
    await waitFor(() => expect(flush).toHaveBeenLastCalledWith([`thesis:${INTRO}`]));
    await waitFor(() => expect(window.location.pathname).toBe('/boards'));
    await waitFor(() => expect(panel()).not.toHaveAttribute('inert'));
    expect(screen.queryByText('Elsewhere')).toBeNull();
    const finish = deferred();
    act(() => window.history.forward());
    await waitFor(() => expect(panel()).toHaveAttribute('inert'));
    await waitFor(() => expect(window.location.pathname).toBe('/boards'));
    finish(true);
    await screen.findByText('Elsewhere');
    expect(panel()).toBeNull();
    expect(window.location.pathname).toBe('/elsewhere');
  });

  it('drops the Forward it held once the app went elsewhere while the note was saved, and guards the next Back', async () => {
    browse();
    fireEvent.click(await card('n1'));
    await findPanel();
    act(() => void router.navigate!('/elsewhere'));
    await screen.findByText('Elsewhere');
    act(() => window.history.back());
    await findPanel();
    const finish = deferred();
    act(() => window.history.forward());
    await waitFor(() => expect(panel()).toHaveAttribute('inert'));
    await waitFor(() => expect(window.location.pathname).toBe('/boards'));
    // The app opens another note on its own while the first is saved, which cuts the history's forward entries.
    act(() => void router.navigate!(boardsRoute('thesis', BOARD, { note: CAUSAL })));
    await waitFor(() => expect(hosted).toHaveBeenLastCalledWith(expect.objectContaining({ path: CAUSAL })));
    finish(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(address().note).toBe(CAUSAL);
    // The next Back is the person's, held for the note shown now.
    const again = deferred();
    act(() => window.history.back());
    await waitFor(() => expect(flush).toHaveBeenLastCalledWith([`thesis:${CAUSAL}`]));
    await waitFor(() => expect(panel()).toHaveAttribute('inert'));
    expect(hosted).toHaveBeenLastCalledWith(expect.objectContaining({ path: CAUSAL }));
    again(true);
    await waitFor(() => expect(address().note).toBe(INTRO));
  });
});
