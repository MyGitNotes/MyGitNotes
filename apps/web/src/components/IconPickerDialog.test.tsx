// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ICON_GRID_LIMIT, IconPickerDialog } from './IconPickerDialog.js';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

async function open() {
  const onPick = vi.fn(), onClose = vi.fn();
  render(createElement(IconPickerDialog, { onPick, onClose }));
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
  return { onPick, onClose, search: screen.getByRole('searchbox', { name: 'Search icons' }) };
}
const names = () => screen.getAllByRole('option').map(option => option.textContent);

it('lists the first icons with a count, and draws each as an SVG', async () => {
  await open();
  expect(screen.getAllByRole('option')).toHaveLength(ICON_GRID_LIMIT);
  expect(screen.getAllByRole('option')[0].querySelector('svg')!.children.length).toBeGreaterThan(0);
  expect(screen.getByText(/Showing 120 of \d+ icons/)).toBeInTheDocument();
});

it('narrows the grid as you type, in kebab-case or Pascal case, exact name first', async () => {
  const { search } = await open();
  fireEvent.change(search, { target: { value: 'file-text' } });
  expect(names()[0]).toBe('FileText');
  fireEvent.change(search, { target: { value: 'USER' } });
  expect(names().slice(0, 2)).toEqual(['User', 'User2']);
  fireEvent.change(search, { target: { value: 'zzzzqq' } });
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByText('No icon matches "zzzzqq".')).toBeInTheDocument();
});

it('inserts the clicked icon with no size by default', async () => {
  const { onPick, search } = await open();
  fireEvent.change(search, { target: { value: 'user' } });
  fireEvent.click(screen.getAllByRole('option')[0]);
  expect(onPick).toHaveBeenCalledWith(':icon{name="User"}');
});

it('inserts the icon at the size picked', async () => {
  const { onPick, search } = await open();
  fireEvent.change(search, { target: { value: 'file text' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Size' })).getByRole('radio', { name: '20 px' }));
  fireEvent.click(screen.getAllByRole('option')[0]);
  expect(onPick).toHaveBeenCalledWith(':icon{name="FileText" size="20"}');
});

it('is reachable and pickable from the keyboard alone', async () => {
  const { onPick, search } = await open();
  search.focus();
  fireEvent.change(search, { target: { value: 'user' } });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const options = screen.getAllByRole('option');
  expect(options[0]).toHaveFocus();
  expect(options[0]).toHaveAttribute('aria-selected', 'true');
  expect(options[0]).toHaveAttribute('tabindex', '0');
  expect(options[1]).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(options[0], { key: 'ArrowRight' });
  expect(options[1]).toHaveFocus();
  expect(options[1]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(options[1], { key: 'End' });
  expect(options.at(-1)).toHaveFocus();
  fireEvent.keyDown(options.at(-1)!, { key: 'Home' });
  expect(options[0]).toHaveFocus();
  // Enter and Space are a button's own click.
  fireEvent.click(options[0]);
  expect(onPick).toHaveBeenCalledWith(':icon{name="User"}');
});

it('moves by rows with Up and Down, and Up from the first row goes back to the search box', async () => {
  const { search } = await open();
  fireEvent.change(search, { target: { value: 'arrow' } });
  // jsdom lays nothing out; give the grid four columns.
  const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function(this: HTMLElement) {
    return Math.floor([...this.parentElement!.children].indexOf(this) / 4) * 40;
  });
  const options = screen.getAllByRole('option');
  options[1].focus();
  fireEvent.keyDown(options[1], { key: 'ArrowDown' });
  expect(options[5]).toHaveFocus();
  fireEvent.keyDown(options[5], { key: 'ArrowUp' });
  expect(options[1]).toHaveFocus();
  fireEvent.keyDown(options[1], { key: 'ArrowUp' });
  expect(search).toHaveFocus();
  top.mockRestore();
});

it('closes from its Close button', async () => {
  const { onClose } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalled();
});
