// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en, type TranslationKey } from '../../lib/i18n/en.js';
import { InfographicEditor } from './InfographicEditor.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
  let text: string = en[key] ?? key;
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
};

const KEY_NUMBERS = ':::key-numbers{title="At a glance" source="MOT"}\n- **213 ha**｜Airport area｜41% civil\n- 5.6 million｜Passengers\n:::\n';
const BARS = '::::bars{unit="萬人次"}\n:::scenario{label="2025"}\n- Taoyuan｜4,780\n:::\n:::scenario{label="2045"}\n- **Taoyuan forecast**｜8,380｜Without Songshan\n- Capacity｜6,000–7,000\n:::\n::::\n';
const MAP = ':::map{base="taiwan"}\n- Songshan｜25.069, 121.552\n- Kinmen｜24.43, 118.37\n- Songshan → Kinmen｜Domestic\n:::\n';
const LINE = '::::line{unit="%"}\n:::series{title="Actual" highlight}\n- 2019｜4,869\n:::\n::::\n';

function mount(source: string, props: { autoFocus?: boolean; } = {}) {
  const onSave = vi.fn<(source: string) => void>();
  const onClose = vi.fn<() => void>();
  const renderFigure = vi.fn((figure: string) => `<pre class="fig">${figure.replaceAll('<', '&lt;')}</pre>`);
  const view = render(createElement(InfographicEditor, { source, t, renderFigure, onSave, onClose, ...props }));
  const input = view.container.querySelector<HTMLInputElement>('.ig-cell-input')!;
  const cell = (row: number, col: number) => view.container.querySelector<HTMLElement>(`[data-cell][data-row="${row}"][data-col="${col}"]`)!;
  const active = () => {
    const element = view.container.querySelector<HTMLElement>('[data-cell][data-active]')!;
    return [Number(element.dataset.row), Number(element.dataset.col)];
  };
  const press = (key: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input, { key, ...init });
  /** The writer's first key plus the character it types into the shared input. */
  const type = (text: string) => {
    press(text[0]);
    fireEvent.change(input, { target: { value: text } });
  };
  const text = (row: number, col: number) => cell(row, col).textContent;
  return { ...view, onSave, onClose, renderFigure, input, cell, active, press, type, text };
}

describe('grid keyboard', () => {
  it('moves the active cell with the arrows and stays inside the grid', () => {
    const editor = mount(KEY_NUMBERS);
    expect(editor.active()).toEqual([0, 0]);
    editor.press('ArrowUp');
    editor.press('ArrowLeft');
    expect(editor.active()).toEqual([0, 0]);
    editor.press('ArrowDown');
    editor.press('ArrowRight');
    expect(editor.active()).toEqual([1, 1]);
    editor.press('ArrowDown');
    editor.press('ArrowRight');
    editor.press('ArrowRight');
    expect(editor.active()).toEqual([1, 2]);
    editor.press('Home');
    expect(editor.active()).toEqual([1, 0]);
    editor.press('ArrowUp', { ctrlKey: true });
    editor.press('End');
    expect(editor.active()).toEqual([0, 2]);
  });

  it('puts the first cell under the input and focuses it', () => {
    const editor = mount(KEY_NUMBERS);
    expect(document.activeElement).toBe(editor.input);
    expect(editor.input.dataset.editing).toBeUndefined();
  });

  it('typing replaces the cell, and Enter commits and moves down', () => {
    const editor = mount(KEY_NUMBERS);
    editor.type('x');
    expect(editor.input.dataset.editing).toBe('true');
    fireEvent.change(editor.input, { target: { value: 'xy' } });
    editor.press('Enter');
    expect(editor.text(0, 0)).toBe('xy');
    expect(editor.active()).toEqual([1, 0]);
    expect(editor.input.dataset.editing).toBeUndefined();
    expect(editor.input.value).toBe('');
  });

  it('Enter and F2 edit in place with the cell text, and arrows then move the caret instead of the cell', () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('ArrowRight');
    editor.press('F2');
    expect(editor.input.dataset.editing).toBe('true');
    expect(editor.input.value).toBe('Airport area');
    editor.press('ArrowDown');
    expect(editor.active()).toEqual([0, 1]);
    expect(editor.input.dataset.editing).toBe('true');
    fireEvent.change(editor.input, { target: { value: 'Airport size' } });
    editor.press('Enter', { shiftKey: true });
    expect(editor.text(0, 1)).toBe('Airport size');
    expect(editor.active()).toEqual([0, 1]);
  });

  it('after typing over a cell the arrows commit and move', () => {
    const editor = mount(KEY_NUMBERS);
    editor.type('z');
    editor.press('ArrowRight');
    expect(editor.text(0, 0)).toBe('z');
    expect(editor.active()).toEqual([0, 1]);
  });

  it('Esc cancels the cell edit and a second Esc closes the editor without saving', () => {
    const editor = mount(KEY_NUMBERS);
    editor.type('lost');
    editor.press('Escape');
    expect(editor.text(0, 0)).toBe('**213 ha**');
    expect(editor.input.dataset.editing).toBeUndefined();
    expect(editor.onClose).not.toHaveBeenCalled();
    editor.press('Escape');
    expect(editor.onClose).toHaveBeenCalledTimes(1);
    expect(editor.onSave).not.toHaveBeenCalled();
  });

  it('Enter on the last row adds a row, as one undo step with the edit', () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('ArrowDown');
    editor.press('Enter');
    fireEvent.change(editor.input, { target: { value: '5.7 million' } });
    editor.press('Enter');
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(3);
    expect(editor.active()).toEqual([2, 0]);
    expect(editor.text(1, 0)).toBe('5.7 million');
    editor.press('z', { ctrlKey: true });
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(2);
    expect(editor.text(1, 0)).toBe('5.6 million');
  });

  it('Tab and Shift+Tab move across the row and wrap to the next and previous rows, then around the grid', () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('Tab');
    editor.press('Tab');
    expect(editor.active()).toEqual([0, 2]);
    editor.press('Tab');
    expect(editor.active()).toEqual([1, 0]);
    editor.press('Tab', { shiftKey: true });
    expect(editor.active()).toEqual([0, 2]);
    editor.press('Home');
    editor.press('Tab', { shiftKey: true });
    expect(editor.active()).toEqual([1, 2]);
    editor.press('Tab');
    expect(editor.active()).toEqual([0, 0]);
  });

  it('Tab while editing commits the cell and moves right', () => {
    const editor = mount(KEY_NUMBERS);
    editor.type('a');
    editor.press('Tab');
    expect(editor.text(0, 0)).toBe('a');
    expect(editor.active()).toEqual([0, 1]);
  });

  it('Delete clears the selected cells', () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('ArrowRight', { shiftKey: true });
    editor.press('ArrowDown', { shiftKey: true });
    editor.press('Delete');
    expect([editor.text(0, 0), editor.text(0, 1), editor.text(1, 0), editor.text(1, 1), editor.text(0, 2)]).toEqual(['', '', '', '', '41% civil']);
  });

  it('does not treat a key during IME composition as a command', () => {
    const editor = mount(KEY_NUMBERS);
    fireEvent.compositionStart(editor.input);
    expect(editor.input.dataset.editing).toBe('true');
    fireEvent.keyDown(editor.input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(editor.input.dataset.editing).toBe('true');
    fireEvent.change(editor.input, { target: { value: '資料' } });
    editor.press('Enter');
    expect(editor.text(0, 0)).toBe('資料');
  });
});

describe('ranges and clipboard', () => {
  it('selects a range with Shift+arrows and copies it as tab-separated text', () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('ArrowRight', { shiftKey: true });
    editor.press('ArrowDown', { shiftKey: true });
    expect(editor.container.querySelectorAll('[data-cell][data-selected]')).toHaveLength(4);
    const setData = vi.fn();
    fireEvent.copy(editor.input, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', '**213 ha**\tAirport area\n5.6 million\tPassengers');
  });

  it('selects a range by dragging over cells', () => {
    const editor = mount(KEY_NUMBERS);
    fireEvent.pointerDown(editor.cell(0, 1), { button: 0 });
    fireEvent.pointerOver(editor.cell(1, 2));
    fireEvent.pointerUp(window);
    expect(editor.container.querySelectorAll('[data-cell][data-selected]')).toHaveLength(4);
    fireEvent.pointerOver(editor.cell(0, 0));
    expect(editor.container.querySelectorAll('[data-cell][data-selected]')).toHaveLength(4);
  });

  it('copies quoted when a cell holds a tab or quote, and cuts', () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('ArrowRight');
    editor.press('F2');
    fireEvent.change(editor.input, { target: { value: 'say "hi"' } });
    editor.press('Enter', { shiftKey: true });
    const setData = vi.fn();
    fireEvent.cut(editor.input, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', '"say ""hi"""');
    expect(editor.text(0, 1)).toBe('');
  });

  it('pastes tab-separated rows from the active cell and adds rows as needed', () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('ArrowDown');
    editor.press('ArrowRight');
    fireEvent.paste(editor.input, { clipboardData: { getData: () => 'a\tb\nc\td\ne\tf\n' } });
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(4);
    expect([editor.text(1, 0), editor.text(1, 1), editor.text(1, 2)]).toEqual(['5.6 million', 'a', 'b']);
    expect([editor.text(2, 0), editor.text(2, 1), editor.text(2, 2)]).toEqual(['', 'c', 'd']);
    expect([editor.text(3, 1), editor.text(3, 2)]).toEqual(['e', 'f']);
    expect(editor.container.querySelectorAll('[data-cell][data-selected]')).toHaveLength(6);
  });

  it('pastes cells quoted the way spreadsheets write them', () => {
    const editor = mount(KEY_NUMBERS);
    fireEvent.paste(editor.input, { clipboardData: { getData: () => '"multi\nline"\t"say ""hi"""\t"a\tb"' } });
    expect([editor.text(0, 0), editor.text(0, 1), editor.text(0, 2)]).toEqual(['multi line', 'say "hi"', 'a\tb']);
  });

  it('leaves a paste to the input while a cell is being edited', () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('F2');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { getData: () => 'a\tb' } });
    editor.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(2);
  });
});

describe('rows', () => {
  const openMenu = (editor: ReturnType<typeof mount>, row: number) => fireEvent.click(editor.getByRole('button', { name: `Row ${row} menu` }));
  const pick = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }));
  const firstColumn = (editor: ReturnType<typeof mount>) => [...editor.container.querySelectorAll('[data-cell][data-col="0"]')].map(cell => cell.textContent);

  it('inserts above and below, duplicates and deletes from the row menu', () => {
    const editor = mount(KEY_NUMBERS);
    openMenu(editor, 1);
    pick('Insert row below');
    expect(firstColumn(editor)).toEqual(['**213 ha**', '', '5.6 million']);
    openMenu(editor, 1);
    pick('Insert row above');
    expect(firstColumn(editor)).toEqual(['', '**213 ha**', '', '5.6 million']);
    openMenu(editor, 2);
    pick('Duplicate row');
    expect(firstColumn(editor)).toEqual(['', '**213 ha**', '**213 ha**', '', '5.6 million']);
    openMenu(editor, 1);
    pick('Delete row');
    expect(firstColumn(editor)).toEqual(['**213 ha**', '**213 ha**', '', '5.6 million']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(editor.input);
  });

  it('moves a row up or down from the menu and offers neither past the ends', () => {
    const editor = mount(KEY_NUMBERS);
    openMenu(editor, 1);
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
    pick('Move down');
    expect(firstColumn(editor)).toEqual(['5.6 million', '**213 ha**']);
    openMenu(editor, 2);
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
  });

  it('walks the row menu with the arrows and closes it with Esc, leaving the editor open', () => {
    const editor = mount(KEY_NUMBERS);
    openMenu(editor, 1);
    expect(screen.getByRole('menuitem', { name: 'Insert row above' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Insert row below' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Delete row' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(editor.onClose).not.toHaveBeenCalled();
  });

  it('toggles the highlight with the star, which bolds the first field', () => {
    const editor = mount(KEY_NUMBERS);
    const star = editor.getByRole('button', { name: 'Highlight row 2' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    expect(editor.text(1, 0)).toBe('**5.6 million**');
    expect(editor.getByRole('button', { name: 'Highlight row 2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(editor.getByRole('button', { name: 'Highlight row 1' }));
    expect(editor.text(0, 0)).toBe('213 ha');
  });

  it('adds a row from the button', () => {
    const editor = mount(KEY_NUMBERS);
    fireEvent.click(editor.getByRole('button', { name: 'Add row' }));
    expect(firstColumn(editor)).toHaveLength(3);
  });

  it('drags a row to a new place with its handle', () => {
    const editor = mount(KEY_NUMBERS);
    editor.container.querySelectorAll<HTMLElement>('[data-grid-row]').forEach((row, index) => {
      row.getBoundingClientRect = () => ({ top: index * 30, bottom: index * 30 + 30, left: 0, right: 100, width: 100, height: 30, x: 0, y: index * 30, toJSON: () => ({}) });
    });
    const handle = editor.getByRole('button', { name: 'Drag to reorder row 1' });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 5 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 40 });
    expect(editor.container.querySelector('[data-drop-target]')?.getAttribute('data-row-index')).toBe('1');
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 40 });
    expect(firstColumn(editor)).toEqual(['5.6 million', '**213 ha**']);
  });

  it('shows an empty grid with an add button when the last row goes', () => {
    const editor = mount(':::parts\n- a｜1\n:::\n');
    openMenu(editor, 1);
    pick('Delete row');
    expect(editor.getByText('No rows yet.')).toBeInTheDocument();
    expect(editor.input).toBeDisabled();
    fireEvent.click(editor.getByRole('button', { name: 'Add row' }));
    expect(firstColumn(editor)).toEqual(['']);
  });
});

describe('child tabs', () => {
  const tabs = (editor: ReturnType<typeof mount>) => within(editor.getByRole('tablist')).getAllByRole('tab').map(tab => tab.textContent);

  it('shows a tab per child and the rows of the selected one', () => {
    const editor = mount(BARS);
    expect(tabs(editor)).toEqual(['2025', '2045']);
    expect(editor.getByRole('tab', { name: '2025' })).toHaveAttribute('aria-selected', 'true');
    expect(editor.text(0, 0)).toBe('Taoyuan');
    fireEvent.click(editor.getByRole('tab', { name: '2045' }));
    expect(editor.text(0, 0)).toBe('**Taoyuan forecast**');
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(2);
  });

  it('adds a child, renames by double-click, reorders and removes', () => {
    const editor = mount(BARS);
    fireEvent.click(editor.getByRole('button', { name: 'Add scenario' }));
    expect(tabs(editor)).toEqual(['2025', '2045', 'scenario 3']);
    expect(editor.getByRole('tab', { name: 'scenario 3' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.doubleClick(editor.getByRole('tab', { name: 'scenario 3' }));
    const rename = editor.getByRole('textbox', { name: 'Rename scenario' });
    fireEvent.change(rename, { target: { value: '2060' } });
    fireEvent.keyDown(rename, { key: 'Enter' });
    fireEvent.blur(rename);
    expect(tabs(editor)).toEqual(['2025', '2045', '2060']);

    fireEvent.click(editor.getByRole('button', { name: 'Move scenario left' }));
    expect(tabs(editor)).toEqual(['2025', '2060', '2045']);
    expect(editor.getByRole('tab', { name: '2060' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(editor.getByRole('button', { name: 'Remove scenario' }));
    expect(tabs(editor)).toEqual(['2025', '2045']);
    expect(editor.getByRole('tab', { name: '2045' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the old name when a rename is cancelled', () => {
    const editor = mount(BARS);
    fireEvent.click(editor.getByRole('button', { name: 'Rename scenario' }));
    const rename = editor.getByRole('textbox', { name: 'Rename scenario' });
    fireEvent.change(rename, { target: { value: 'nope' } });
    fireEvent.keyDown(rename, { key: 'Escape' });
    expect(tabs(editor)).toEqual(['2025', '2045']);
    expect(editor.onClose).not.toHaveBeenCalled();
  });

  it('stops adding scenarios at six', () => {
    const editor = mount(BARS);
    for (let i = 0; i < 4; i++) fireEvent.click(editor.getByRole('button', { name: 'Add scenario' }));
    expect(tabs(editor)).toHaveLength(6);
    expect(editor.getByRole('button', { name: 'Add scenario' })).toBeDisabled();
  });

  it("edits the selected child's own attributes and flags", () => {
    const editor = mount(LINE);
    const group = editor.getByRole('group', { name: 'Actual attributes' });
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Highlight' }));
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Dashed' }));
    fireEvent.change(within(group).getByRole('textbox', { name: 'Title' }), { target: { value: 'Measured' } });
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    expect(editor.onSave).toHaveBeenCalledWith('::::line{unit="%"}\n:::series{title="Measured" dashed}\n- 2019｜4,869\n:::\n::::\n');
  });

  it('explains a kind that needs a child when the last one is removed, and does not crash', () => {
    const editor = mount(LINE);
    fireEvent.click(editor.getByRole('button', { name: 'Remove series' }));
    expect(editor.getByText('This figure needs at least one series to draw. Add one above.')).toBeInTheDocument();
    expect(editor.container.querySelector('.ig-grid')).toBeNull();
    fireEvent.click(editor.getByRole('button', { name: 'Add series' }));
    expect(editor.container.querySelector('.ig-grid')).not.toBeNull();
  });

  it('hands the rows back when the last scenario of bars goes', () => {
    const editor = mount('::::bars\n:::scenario{label="Only"}\n- a｜1\n:::\n::::\n');
    fireEvent.click(editor.getByRole('button', { name: 'Remove scenario' }));
    expect(editor.text(0, 0)).toBe('a');
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    expect(editor.onSave).toHaveBeenCalledWith('::::bars\n- a｜1\n::::\n');
  });
});

describe('attributes', () => {
  it('lists the common and per-kind attributes', () => {
    const editor = mount(BARS);
    const attributes = editor.getByRole('group', { name: 'Attributes' });
    expect(within(attributes).getAllByRole<HTMLInputElement>('textbox').map(box => box.labels?.[0].textContent)).toEqual(['Title', 'Subtitle', 'Note', 'Source', 'Unit', 'Reference line', 'Reference label', 'Maximum']);
    expect(within(attributes).getByRole('combobox', { name: 'Palette' })).toHaveValue('');
  });

  it("writes edits in the attributes' own order, selects from the fixed values, and drops emptied ones", () => {
    const editor = mount(KEY_NUMBERS);
    fireEvent.change(editor.getByRole('combobox', { name: 'Palette' }), { target: { value: 'sequential' } });
    fireEvent.change(editor.getByRole('textbox', { name: 'Title' }), { target: { value: 'Basics' } });
    fireEvent.change(editor.getByRole('textbox', { name: 'Source' }), { target: { value: '' } });
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    expect(editor.onSave).toHaveBeenCalledWith(':::key-numbers{title="Basics" palette="sequential"}\n- **213 ha**｜Airport area｜41% civil\n- 5.6 million｜Passengers\n:::\n');
  });

  it('keeps a palette the editor does not list', () => {
    const editor = mount(':::parts{palette="mine"}\n- a｜1\n:::\n');
    expect(editor.getByRole('combobox', { name: 'Palette' })).toHaveValue('mine');
  });

  it("offers the map's base maps", () => {
    const editor = mount(MAP);
    expect(within(editor.getByRole('combobox', { name: 'Base map' })).getAllByRole('option').map(option => option.textContent)).toEqual(['Default', 'Taiwan', 'Taipei']);
  });

  it('undoes a run of typing in one field as one step', () => {
    const editor = mount(KEY_NUMBERS);
    const title = editor.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'A' } });
    fireEvent.change(title, { target: { value: 'AB' } });
    fireEvent.change(title, { target: { value: 'ABC' } });
    editor.input.focus();
    editor.press('z', { metaKey: true });
    expect(title).toHaveValue('At a glance');
  });
});

describe('cell checks', () => {
  it('marks an invalid cell and lists it under the grid, and a click on the entry selects the cell', () => {
    const editor = mount('::::bars\n:::scenario{label="2025"}\n- ok｜5\n- bad｜六千\n:::\n::::\n');
    expect(editor.cell(1, 1)).toHaveAttribute('data-invalid', 'true');
    expect(editor.cell(0, 1)).not.toHaveAttribute('data-invalid');
    const issues = editor.getByRole('group', { name: 'Cells to check' });
    const entry = within(issues).getByRole('button', { name: '2025: Row 2, Value or range: expected one number.' });
    fireEvent.click(entry);
    expect(editor.active()).toEqual([1, 1]);
    expect(document.activeElement).toBe(editor.input);
  });

  it('clears the mark once the cell is fixed', () => {
    const editor = mount(':::parts\n- bad｜x\n:::\n');
    expect(editor.cell(0, 1)).toHaveAttribute('data-invalid', 'true');
    editor.press('ArrowRight');
    editor.type('7');
    editor.press('Enter');
    expect(editor.cell(0, 1)).not.toHaveAttribute('data-invalid');
    expect(editor.queryByRole('group', { name: 'Cells to check' })).toBeNull();
  });

  it("keeps a map route's position cell out of reach and names the unknown end", () => {
    const editor = mount(':::map\n- A｜25, 121\n- A → B｜note\n:::\n');
    expect(editor.cell(1, 1)).toHaveAttribute('data-disabled', 'true');
    editor.press('ArrowDown');
    editor.press('ArrowRight');
    editor.type('x');
    expect(editor.input.dataset.editing).toBeUndefined();
    expect(editor.input.value).toBe('');
    expect(editor.getByRole('button', { name: 'Row 2, Place or route: a route end is not listed as a place.' })).toBeInTheDocument();
  });
});

describe('save and cancel', () => {
  it("Mod+Enter saves once with the whole block in the blog's syntax, folding in the cell being typed", () => {
    const editor = mount(KEY_NUMBERS);
    editor.press('ArrowDown');
    editor.press('ArrowRight');
    editor.type('Visitors');
    editor.press('Enter', { metaKey: true });
    expect(editor.onSave).toHaveBeenCalledTimes(1);
    expect(editor.onSave).toHaveBeenCalledWith(':::key-numbers{title="At a glance" source="MOT"}\n- **213 ha**｜Airport area｜41% civil\n- 5.6 million｜Visitors\n:::\n');
    expect(editor.onClose).not.toHaveBeenCalled();
  });

  it('saves from the Save button, and Ctrl+Enter from an attribute field', () => {
    const editor = mount(KEY_NUMBERS);
    editor.type('q');
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    expect(editor.onSave).toHaveBeenLastCalledWith(expect.stringContaining('- q｜Airport area'));
    fireEvent.keyDown(editor.getByRole('textbox', { name: 'Title' }), { key: 'Enter', ctrlKey: true });
    expect(editor.onSave).toHaveBeenCalledTimes(2);
  });

  it('Cancel and Esc from an attribute field close without saving', () => {
    const editor = mount(KEY_NUMBERS);
    editor.type('lost');
    fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(editor.getByRole('textbox', { name: 'Title' }), { key: 'Escape' });
    expect(editor.onClose).toHaveBeenCalledTimes(2);
    expect(editor.onSave).not.toHaveBeenCalled();
  });

  it('commits the cell being edited when something else is clicked, before that click acts', () => {
    const editor = mount(KEY_NUMBERS);
    editor.type('kept');
    fireEvent.pointerDown(editor.getByRole('button', { name: 'Highlight row 2' }));
    fireEvent.click(editor.getByRole('button', { name: 'Highlight row 2' }));
    expect(editor.text(0, 0)).toBe('kept');
    expect(editor.text(1, 0)).toBe('**5.6 million**');
  });

  it('refuses a block the grid cannot hold', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mount(':::parts\nStray text\n- a｜1\n:::\n')).toThrow(/grid can hold/);
    spy.mockRestore();
  });
});

describe('blank rows', () => {
  it('are placeholders: not flagged, not previewed and not saved', () => {
    vi.useFakeTimers();
    const editor = mount(':::parts\n- a｜1\n:::\n');
    fireEvent.click(editor.getByRole('button', { name: 'Add row' }));
    act(() => vi.advanceTimersByTime(150));
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(2);
    expect(editor.queryByRole('group', { name: 'Cells to check' })).toBeNull();
    expect(editor.renderFigure).toHaveBeenLastCalledWith(':::parts\n- a｜1\n:::\n');
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    expect(editor.onSave).toHaveBeenCalledWith(':::parts\n- a｜1\n:::\n');
  });
});

describe('undo', () => {
  it('undoes and redoes cell edits and row operations with the keyboard', () => {
    const editor = mount(KEY_NUMBERS);
    editor.type('one');
    editor.press('Enter');
    fireEvent.click(editor.getByRole('button', { name: 'Add row' }));
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(3);
    editor.input.focus();
    editor.press('z', { ctrlKey: true });
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(2);
    editor.press('z', { ctrlKey: true });
    expect(editor.text(0, 0)).toBe('**213 ha**');
    editor.press('Z', { ctrlKey: true, shiftKey: true });
    expect(editor.text(0, 0)).toBe('one');
    editor.press('y', { ctrlKey: true });
    expect(editor.container.querySelectorAll('[data-grid-row]')).toHaveLength(3);
  });
});

describe('preview', () => {
  it('redraws the one figure 150 ms after the last change, folding in what is being typed', () => {
    vi.useFakeTimers();
    const editor = mount(KEY_NUMBERS);
    expect(editor.renderFigure).toHaveBeenCalledTimes(1);
    editor.type('a');
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(editor.input, { target: { value: 'ab' } });
    act(() => vi.advanceTimersByTime(100));
    expect(editor.renderFigure).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60));
    expect(editor.renderFigure).toHaveBeenCalledTimes(2);
    expect(editor.renderFigure).toHaveBeenLastCalledWith(expect.stringContaining('- ab｜Airport area'));
    expect(editor.container.querySelector('.ig-preview .fig')?.textContent).toContain('- ab｜Airport area');
    // Nothing was committed by drawing it.
    expect(editor.input.dataset.editing).toBe('true');
  });

  it('draws the figure of the current draft after a committed change too', () => {
    vi.useFakeTimers();
    const editor = mount(KEY_NUMBERS);
    fireEvent.change(editor.getByRole('textbox', { name: 'Title' }), { target: { value: 'New title' } });
    act(() => vi.advanceTimersByTime(150));
    expect(editor.renderFigure).toHaveBeenLastCalledWith(expect.stringContaining('title="New title"'));
  });
});

describe('typing does not rebuild the grid', () => {
  it('keeps the same cell elements and the focused input across keystrokes', () => {
    const editor = mount(KEY_NUMBERS);
    const before = [...editor.container.querySelectorAll('[data-cell]')];
    editor.type('a');
    for (const value of ['ab', 'abc', 'abcd']) fireEvent.change(editor.input, { target: { value } });
    expect([...editor.container.querySelectorAll('[data-cell]')]).toEqual(before);
    expect(document.activeElement).toBe(editor.input);
    expect(editor.input.value).toBe('abcd');
    expect(editor.text(0, 0)).toBe('**213 ha**');
  });
});
