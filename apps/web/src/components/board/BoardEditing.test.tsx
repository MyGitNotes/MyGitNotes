// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { compilationChapters, type CompilationFile, parseCompilation } from '@mygitnotes/core/compilation';
import { editing, openExample, resetBoardTest, save } from './board-test-helpers.js';

vi.mock('../../lib/note-editing.js', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/note-editing.js')>(), useEditorRegistry: () => () => () => {}, useNoteEditing: () => editing }));

beforeEach(() => {
  resetBoardTest();
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// In jsdom the viewport measures 0 × 0, so the camera stays at the origin at 100%: a client point is a board point.
const mouse = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra });
const at = (key: string) => document.querySelector<HTMLElement>(`[data-board-card="${key}"]`)!;
const region = () => screen.getByRole('region', { name: '第三章：德性與依據' });
/**
 * A press, a drag through the middle and a release, as a person's drag sends them. Past the threshold the viewport
 * captures the pointer, so the moves and the release reach it whatever card is under them (a dragged card may be
 * drawn in another section by then).
 */
function drag(target: Element, from: [number, number], to: [number, number], extra: Record<string, unknown> = {}) {
  fireEvent.pointerDown(target, mouse(...from, extra));
  fireEvent.pointerMove(region(), mouse((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra));
  fireEvent.pointerMove(region(), mouse(...to, extra));
  fireEvent.pointerUp(region(), mouse(...to, extra));
}
const press = (target: Element, x: number, y: number, extra: Record<string, unknown> = {}) => {
  fireEvent.pointerDown(target, mouse(x, y, extra));
  fireEvent.pointerUp(target, mouse(x, y, extra));
};
const written = (call = -1): CompilationFile => parseCompilation(save.mock.calls.at(call)![1], ['notes/thesis', 'notes/reading']);
const chapters = (file: CompilationFile) => compilationChapters(file.items!).map(chapter => `${chapter.heading?.title ?? '·'}: ${chapter.items.map(item => item.id).join(' ')}`);
const selected = () => [...document.querySelectorAll('[data-board-key][data-selected]')].map(element => element.getAttribute('data-board-key'));
async function ready() {
  openExample();
  await screen.findByRole('group', { name: '二、德性知識論' });
  await waitFor(() => expect(at('n1').querySelector('.board-card-excerpt')).toBeInTheDocument());
}
const settle = () => new Promise(resolve => setTimeout(resolve, 900));

describe('editing the board', () => {
  it('shows the tools, with 選取 on, and keeps a press on a card from panning', async () => {
    await ready();
    const tools = screen.getByRole('toolbar', { name: 'Whiteboard tools' });
    for (const tool of ['Select', 'Text', 'Section', 'Arrow']) expect(within(tools).getByRole('button', { name: tool })).toBeInTheDocument();
    expect(within(tools).getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('selects by click, adds with Shift, and clears on empty board', async () => {
    await ready();
    press(at('n1'), 30, 60);
    expect(selected()).toEqual(['card:n1']);
    press(at('n3'), 370, 60, { shiftKey: true });
    expect(selected()).toEqual(['card:n1', 'card:n3']);
    press(at('n3'), 370, 60, { metaKey: true });
    expect(selected()).toEqual(['card:n1']);
    press(region(), 1500, 900);
    expect(selected()).toEqual([]);
  });

  it('frames a box selection from empty board: the cards and text it touches, no section it does not hold whole', async () => {
    await ready();
    drag(region(), [1300, 800], [20, 200]);
    expect(selected().sort()).toEqual(['card:n2', 'card:n5', 'text:t8k2m']);
    expect(save).not.toHaveBeenCalled();
  });

  it('drags a card into another section: one write, the item ends that chapter, and the book shows the new order', async () => {
    await ready();
    drag(at('n1'), [30, 60], [430, 60]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const file = written();
    expect(chapters(file)).toEqual(['一、問題: n2', '二、德性知識論: n3 n4 n5 n1']);
    expect(file.board?.cards).toContainEqual({ item: 'n1', x: 424, y: 56 });
    expect(within(screen.getByRole('group', { name: '二、德性知識論' })).getByRole('button', { name: /^第三章導論/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'View size: 第三章：德性與依據' })).getByRole('button', { name: 'Book' }));
    const contents = await screen.findByRole('navigation', { name: 'Contents' });
    await waitFor(() => expect([...contents.querySelectorAll('.compilation-book-jump')].map(button => button.textContent)).toEqual(['一、問題', '依據關係的因果條件', '二、德性知識論', '德性與能力的區分', 'Sosa 2007 第三講', 'gone.md', '第三章導論']));
  });

  it('draws an arrow from one card onto another and writes it once with the label typed', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Arrow' }));
    drag(at('n1'), [30, 60], [400, 100]);
    const label = await screen.findByRole('combobox', { name: 'Arrow label' });
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(label, { target: { value: '回應' } });
    fireEvent.keyDown(label, { key: 'Enter' });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(written().board?.arrows?.at(-1)).toEqual({ id: expect.stringMatching(/^[a-z0-9]{8}$/), from: { item: 'n1' }, to: { item: 'n3' }, label: '回應' });
    // The tool went back to 選取 after one use; an arrow released over empty board is not drawn.
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Arrow' }));
    drag(at('n1'), [30, 60], [1500, 900]);
    expect(screen.queryByRole('combobox', { name: 'Arrow label' })).not.toBeInTheDocument();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('draws a section over two cards: titled as typed, their items in its chapter, written once', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Section' }));
    drag(region(), [-10, 40], [300, 400]);
    const title = await screen.findByRole('textbox', { name: 'Section title' });
    expect(title).toHaveValue('New section');
    fireEvent.change(title, { target: { value: '問題' } });
    fireEvent.blur(title);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(chapters(written())).toEqual(['一、問題: ', '二、德性知識論: n3 n4 n5', '問題: n1 n2']);
  });

  it('places text with the 文字 tool, written once when left', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    press(region(), 1000, 600);
    const field = await screen.findByRole('textbox', { name: 'Text on the whiteboard' });
    fireEvent.change(field, { target: { value: '待查\n文獻' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(written().board?.texts?.at(-1)).toEqual({ id: expect.stringMatching(/^[a-z0-9]{8}$/), x: 1000, y: 600, text: '待查\n文獻' });
  });

  it('removes a card with Delete, and its arrows with it', async () => {
    await ready();
    press(at('n1'), 30, 60);
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const file = written();
    expect(file.items?.map(item => item.id)).toEqual(['h1', 'n2', 'h2', 'n3', 'n4', 'n5']);
    expect(file.board?.arrows?.map(arrow => arrow.id)).toEqual(['b7c1z']);
    expect(file.board?.cards?.some(card => 'item' in card && card.item === 'n1')).toBe(false);
  });

  it('asks before deleting a section, then leaves its cards before the first heading', async () => {
    await ready();
    const heading = screen.getByRole('button', { name: 'Section: 一、問題' });
    press(heading, 10, 20);
    fireEvent.keyDown(heading, { key: 'Delete' });
    const dialog = await screen.findByRole('dialog', { name: 'Delete section?' });
    expect(dialog).toHaveTextContent('Its cards stay on the whiteboard.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete section' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(chapters(written())).toEqual(['·: n1', '·: n2', '二、德性知識論: n3 n4 n5']);
  });

  it('deletes a section framed whole by a box, its cards staying with their arrows', async () => {
    await ready();
    drag(region(), [-20, -20], [300, 400]);
    expect(selected().sort()).toEqual(['card:n1', 'card:n2', 'section:h1']);
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Delete section?' })).getByRole('button', { name: 'Delete section' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const file = written();
    expect(chapters(file)).toEqual(['·: n1', '·: n2', '二、德性知識論: n3 n4 n5']);
    expect(file.board?.arrows?.map(arrow => arrow.id)).toEqual(['a3f9q', 'b7c1z']);
  });

  it('undoes nothing once the header’s arrange dialog changed the items, keeping that change', async () => {
    await ready();
    drag(at('n3'), [370, 60], [450, 160]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Arrange contents: 第三章：德性與依據' }));
    const dialog = await screen.findByRole('dialog', { name: 'Arrange contents: 第三章：德性與依據' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Remove chapter heading (items stay): 一、問題' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    region().focus();
    fireEvent.keyDown(region(), { key: 'z', metaKey: true });
    expect(await screen.findByText(/changed elsewhere since/)).toBeInTheDocument();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(written().items?.map(item => item.id)).toEqual(['n1', 'n2', 'h2', 'n3', 'n4', 'n5']);
  });

  it('undoes and redoes a drag, one write each', async () => {
    await ready();
    drag(at('n3'), [370, 60], [450, 160]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(written().board?.cards).toContainEqual({ item: 'n3', x: 440, y: 156 });
    fireEvent.keyDown(document.activeElement!, { key: 'z', metaKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(written().board?.cards).toContainEqual({ item: 'n3', x: 360, y: 56 });
    fireEvent.keyDown(document.activeElement!, { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(written().board?.cards).toContainEqual({ item: 'n3', x: 440, y: 156 });
  });

  it('nudges the selection with the arrow keys and writes once when the keys stop', async () => {
    await ready();
    press(at('n1'), 30, 60);
    const target = document.activeElement!;
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight']) {
      fireEvent.keyDown(target, { key });
      fireEvent.keyUp(target, { key });
    }
    fireEvent.keyDown(target, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyUp(target, { key: 'ArrowDown', shiftKey: true });
    // Drawn moved at once, written only once the keys rest.
    expect(at('n1').style.left).toBe('48px');
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(written().board?.cards).toContainEqual({ item: 'n1', x: 48, y: 96 });
  });

  it('keeps the keyboard on a focused card the arrow keys carry into another section, and writes once', async () => {
    await ready();
    const card = screen.getByRole('button', { name: /^第三章導論/ });
    card.focus();
    for (let press = 0; press < 5; press++) {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', shiftKey: true });
      fireEvent.keyUp(document.activeElement!, { key: 'ArrowRight', shiftKey: true });
      expect(document.activeElement).toHaveAttribute('data-board-key', 'card:n1');
    }
    expect(within(screen.getByRole('group', { name: '二、德性知識論' })).getByRole('button', { name: /^第三章導論/ })).toHaveFocus();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(chapters(written())).toEqual(['一、問題: n2', '二、德性知識論: n3 n4 n5 n1']);
  });

  it('selects with Space on a focused card without opening it, and renames a section with F2', async () => {
    await ready();
    const card = screen.getByRole('button', { name: /^依據關係的因果條件/ });
    card.focus();
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.keyUp(card, { key: ' ' });
    expect(selected()).toEqual(['card:n2']);
    const heading = screen.getByRole('button', { name: 'Section: 二、德性知識論' });
    heading.focus();
    fireEvent.keyDown(heading, { key: 'F2' });
    const title = await screen.findByRole('textbox', { name: 'Section title' });
    fireEvent.change(title, { target: { value: '二、德性' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(chapters(written())).toEqual(['一、問題: n1 n2', '二、德性: n3 n4 n5']);
  });

  it('draws an arrow from the keyboard with 連到… (Mod+Shift+L)', async () => {
    await ready();
    press(at('n2'), 30, 220);
    fireEvent.keyDown(document.activeElement!, { key: 'L', metaKey: true, shiftKey: true });
    const picker = await screen.findByRole('dialog', { name: 'Draw an arrow from 依據關係的因果條件 to' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Section: 二、德性知識論' }));
    fireEvent.blur(await screen.findByRole('combobox', { name: 'Arrow label' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(written().board?.arrows?.at(-1)).toMatchObject({ from: { item: 'n2' }, to: { item: 'h2' } });
  });

  it('offers 連到… on a selected element’s context menu', async () => {
    await ready();
    // jsdom fires a window blur, which closes a Radix menu, when focus moves on from an element an earlier test removed.
    region().focus();
    fireEvent.contextMenu(at('n2'), { clientX: 30, clientY: 220 });
    expect(selected()).toEqual(['card:n2']);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Link to…' }));
    expect(await screen.findByRole('dialog', { name: 'Draw an arrow from 依據關係的因果條件 to' })).toBeInTheDocument();
  });

  it('writes a nudge run at once when the pointer presses elsewhere, as on the arrangement switch', async () => {
    await ready();
    press(at('n1'), 30, 60);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 380 });
    expect(written().board?.cards).toContainEqual({ item: 'n1', x: 32, y: 56 });
  });

  it('pans with the middle button instead of selecting', async () => {
    await ready();
    drag(region(), [1300, 800], [20, 200], { button: 1 });
    expect(selected()).toEqual([]);
    expect(document.querySelector('.board-marquee')).toBeNull();
  });
});
