// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { BrowseSplit } from './BrowseSplit.js';

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
});
afterEach(cleanup);

function split({ size = 55, collapsed = false, onSizeChange = vi.fn(), onCollapsedChange = vi.fn(), filters = <p>folder tree</p> }: { size?: number; collapsed?: boolean; onSizeChange?: (size: number) => void; onCollapsedChange?: (collapsed: boolean) => void; filters?: ReactNode; } = {}) {
  const view = (props: { size: number; collapsed: boolean; }) => (
    <I18nProvider>
      <BrowseSplit label='Folders' actions={<button type='button'>Clear all</button>} tools={<input type='search' aria-label='Search notes' />} filters={filters} path={<span>Projects / Thesis</span>} size={props.size} onSizeChange={onSizeChange} collapsed={props.collapsed} onCollapsedChange={onCollapsedChange}>
        <ul aria-label='Notes'>
          <li>First note</li>
        </ul>
      </BrowseSplit>
    </I18nProvider>
  );
  const result = render(view({ size, collapsed }));
  return { ...result, onSizeChange, onCollapsedChange, rerenderWith: (props: { size: number; collapsed: boolean; }) => result.rerender(view(props)) };
}

it('shows the list tools, the path line and the list, then a divider and the folders and filters below them', () => {
  const { container } = split();
  const filters = screen.getByRole('region', { name: 'Folders' });
  expect(filters).toHaveTextContent('folder tree');
  expect(filters).toHaveStyle({ flexBasis: '55%' });
  const divider = screen.getByRole('separator', { name: 'Resize folders and list' });
  expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
  expect(divider).toHaveAttribute('aria-valuenow', '55');
  expect(divider).toHaveAttribute('aria-valuemin', '15');
  expect(divider).toHaveAttribute('aria-valuemax', '85');
  expect(document.getElementById(divider.getAttribute('aria-controls')!)).toHaveTextContent('folder tree');
  expect(divider).toHaveAttribute('tabindex', '0');
  expect(screen.getByText('Projects / Thesis')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Notes' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Clear all' })).toBeVisible();
  // Top to bottom: the search, the path line, the list, the divider, the folders.
  const order = [screen.getByRole('searchbox', { name: 'Search notes' }), screen.getByText('Projects / Thesis'), screen.getByRole('list', { name: 'Notes' }), divider, filters];
  for (let index = 1; index < order.length; index++) expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector('.browse-split')!.firstElementChild).toContainElement(order[0]);
});

it('moves the divider with the arrow keys, Home and End, within its bounds: up gives the folders below it more room', () => {
  const { onSizeChange, rerenderWith } = split();
  const divider = screen.getByRole('separator');
  fireEvent.keyDown(divider, { key: 'ArrowUp' });
  expect(onSizeChange).toHaveBeenLastCalledWith(60);
  fireEvent.keyDown(divider, { key: 'ArrowDown' });
  expect(onSizeChange).toHaveBeenLastCalledWith(50);
  fireEvent.keyDown(divider, { key: 'Home' });
  expect(onSizeChange).toHaveBeenLastCalledWith(15);
  fireEvent.keyDown(divider, { key: 'End' });
  expect(onSizeChange).toHaveBeenLastCalledWith(85);
  rerenderWith({ size: 83, collapsed: false });
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp' });
  expect(onSizeChange).toHaveBeenLastCalledWith(85);
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '83');
});

it("follows a drag of the divider and keeps the size it was dropped at, measured from the column's foot", () => {
  const { container, onSizeChange } = split();
  const root = container.querySelector<HTMLElement>('.browse-split')!;
  root.getBoundingClientRect = () => ({ top: 100, height: 400, bottom: 500, left: 0, right: 288, width: 288, x: 0, y: 100, toJSON: () => ({}) });
  const divider = screen.getByRole('separator');
  fireEvent.pointerDown(divider, { clientY: 280, pointerId: 1, button: 0 });
  fireEvent.pointerMove(divider, { clientY: 340, pointerId: 1 });
  // While dragging the parts follow the pointer; the size is kept only once the drag ends.
  expect(divider).toHaveAttribute('aria-valuenow', '40');
  expect(screen.getByRole('region', { name: 'Folders' })).toHaveStyle({ flexBasis: '40%' });
  expect(onSizeChange).not.toHaveBeenCalled();
  fireEvent.pointerMove(divider, { clientY: 490, pointerId: 1 });
  expect(divider).toHaveAttribute('aria-valuenow', '15');
  fireEvent.pointerUp(divider, { clientY: 490, pointerId: 1 });
  expect(onSizeChange).toHaveBeenCalledTimes(1);
  expect(onSizeChange).toHaveBeenLastCalledWith(15);
});

it('folds the folders and filters to their heading at the foot and opens them again, keeping them mounted', () => {
  const { onCollapsedChange, rerenderWith } = split();
  const tree = screen.getByText('folder tree');
  const collapse = screen.getByRole('button', { name: 'Collapse folders' });
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(collapse);
  expect(onCollapsedChange).toHaveBeenLastCalledWith(true);

  rerenderWith({ size: 55, collapsed: true });
  const folded = screen.getByRole('region', { name: 'Folders' });
  expect(folded).toHaveTextContent('Folders');
  expect(tree).not.toBeVisible();
  expect(folded).not.toHaveStyle({ flexBasis: '55%' });
  expect(screen.queryByRole('separator')).toBeNull();
  expect(screen.getByText('Projects / Thesis')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Notes' })).toBeVisible();
  const expand = screen.getByRole('button', { name: 'Expand folders' });
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  expect(folded).toContainElement(expand);
  // The folded part is still in the page, so the tree keeps which folders were open.
  expect(screen.getByText('folder tree')).toBe(tree);
  expect(document.getElementById(expand.getAttribute('aria-controls')!)).toContainElement(tree);
  fireEvent.click(expand);
  expect(onCollapsedChange).toHaveBeenLastCalledWith(false);

  rerenderWith({ size: 55, collapsed: false });
  expect(tree).toBeVisible();
  expect(screen.getByRole('region', { name: 'Folders' })).toContainElement(tree);
});

it("ends the path line with the dock's own toggle, leaving the tools row to the search", () => {
  const { container } = render(
    <I18nProvider>
      <BrowseSplit label='Folders' tools={<input type='search' aria-label='Search notes' />} filters={<p>folder tree</p>} path={<span>Projects / Thesis</span>} dockToggle={<button type='button'>Collapse browse panel</button>} size={40} onSizeChange={vi.fn()} collapsed={false} onCollapsedChange={vi.fn()}>
        <ul aria-label='Notes' />
      </BrowseSplit>
    </I18nProvider>,
  );
  const toggle = screen.getByRole('button', { name: 'Collapse browse panel' });
  expect(toggle.parentElement).toHaveClass('browse-split-path');
  expect(toggle.parentElement?.lastElementChild).toBe(toggle);
  expect(container.querySelector('.browse-split-tools')).not.toContainElement(toggle);
});
