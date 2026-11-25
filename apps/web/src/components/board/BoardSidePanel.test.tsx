// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cameraAt } from '../../lib/board/zoom.js';
import { boardsQuery, boardsRoute } from '../../lib/routes.js';
import { editing, example, note, openBoard, resetBoardTest, router, thesisNotes } from './board-test-helpers.js';

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
const compilations = [note('thesis', BOARD, '第三章：德性與依據', example), note('thesis', OTHER, 'Other board', other)].map(entry => ({ ...entry, kind: 'compilation' as const }));
const sidePanel = { focusNotebook: 'thesis', openInFocus: vi.fn(), fullscreen: vi.fn() };
const flush = vi.spyOn(editing, 'flushEditors');

const open = (url = boardsRoute('thesis', BOARD)) => openBoard({ path: BOARD, notebookId: 'thesis', raw: example, notes: thesisNotes, compilations, view: { frame: 'page', sidePanel, url } });
// The first board of a run reads its modules cold, so it may take longer than a waitFor's default second.
const SLOW = { timeout: 5000 };
/** The notes of the example's cards: a card opens its note once the note was read, which its excerpt shows. */
const cardNotes: Record<string, string> = { n1: INTRO, n2: CAUSAL, n3: 'notes/thesis/德性與能力的區分.md', n4: 'notes/reading/sosa-2007.md' };
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
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    // The viewport fills 1000 × 600 and a focused card is measured where the camera centred it, as a browser lays them out.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
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
    vi.restoreAllMocks();
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
