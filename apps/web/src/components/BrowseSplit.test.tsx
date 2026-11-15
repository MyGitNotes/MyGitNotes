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

function split({ size = 55, collapsed = false, onSizeChange = vi.fn(), onCollapsedChange = vi.fn(), top = <p>folder tree</p> }: { size?: number; collapsed?: boolean; onSizeChange?: (size: number) => void; onCollapsedChange?: (collapsed: boolean) => void; top?: ReactNode; } = {}) {
  const view = (props: { size: number; collapsed: boolean; }) => (
    <I18nProvider>
      <BrowseSplit label='Folders' actions={<button type='button'>Clear all</button>} top={top} path={<span>Projects / Thesis</span>} size={props.size} onSizeChange={onSizeChange} collapsed={props.collapsed} onCollapsedChange={onCollapsedChange}>
        <ul aria-label='Notes'>
          <li>First note</li>
        </ul>
      </BrowseSplit>
    </I18nProvider>
  );
  const result = render(view({ size, collapsed }));
  return { ...result, onSizeChange, onCollapsedChange, rerenderWith: (props: { size: number; collapsed: boolean; }) => result.rerender(view(props)) };
}

it('shows the folders and filters, a divider, the path line and the list together', () => {
  split();
  const top = screen.getByRole('region', { name: 'Folders' });
  expect(top).toHaveTextContent('folder tree');
  expect(top).toHaveStyle({ flexBasis: '55%' });
  const divider = screen.getByRole('separator', { name: 'Resize folders and list' });
  expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
  expect(divider).toHaveAttribute('aria-valuenow', '55');
  expect(divider).toHaveAttribute('aria-valuemin', '15');
  expect(divider).toHaveAttribute('aria-valuemax', '85');
  expect(divider).toHaveAttribute('aria-controls', top.id);
  expect(divider).toHaveAttribute('tabindex', '0');
  expect(screen.getByText('Projects / Thesis')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Notes' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Clear all' })).toBeVisible();
});

it('moves the divider with the arrow keys, Home and End, within its bounds', () => {
  const { onSizeChange, rerenderWith } = split();
  const divider = screen.getByRole('separator');
  fireEvent.keyDown(divider, { key: 'ArrowDown' });
  expect(onSizeChange).toHaveBeenLastCalledWith(60);
  fireEvent.keyDown(divider, { key: 'ArrowUp' });
  expect(onSizeChange).toHaveBeenLastCalledWith(50);
  fireEvent.keyDown(divider, { key: 'Home' });
  expect(onSizeChange).toHaveBeenLastCalledWith(15);
  fireEvent.keyDown(divider, { key: 'End' });
  expect(onSizeChange).toHaveBeenLastCalledWith(85);
  rerenderWith({ size: 83, collapsed: false });
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' });
  expect(onSizeChange).toHaveBeenLastCalledWith(85);
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '83');
});

it('follows a drag of the divider and keeps the size it was dropped at', () => {
  const { container, onSizeChange } = split();
  const root = container.querySelector<HTMLElement>('.browse-split')!;
  root.getBoundingClientRect = () => ({ top: 100, height: 400, bottom: 500, left: 0, right: 288, width: 288, x: 0, y: 100, toJSON: () => ({}) });
  const divider = screen.getByRole('separator');
  fireEvent.pointerDown(divider, { clientY: 320, pointerId: 1, button: 0 });
  fireEvent.pointerMove(divider, { clientY: 260, pointerId: 1 });
  // While dragging the parts follow the pointer; the size is kept only once the drag ends.
  expect(divider).toHaveAttribute('aria-valuenow', '40');
  expect(screen.getByRole('region', { name: 'Folders' })).toHaveStyle({ flexBasis: '40%' });
  expect(onSizeChange).not.toHaveBeenCalled();
  fireEvent.pointerMove(divider, { clientY: 20, pointerId: 1 });
  expect(divider).toHaveAttribute('aria-valuenow', '15');
  fireEvent.pointerUp(divider, { clientY: 20, pointerId: 1 });
  expect(onSizeChange).toHaveBeenCalledTimes(1);
  expect(onSizeChange).toHaveBeenLastCalledWith(15);
});

it('folds the folders and filters to the path line and opens them again, keeping them mounted', () => {
  const { onCollapsedChange, rerenderWith } = split();
  const tree = screen.getByText('folder tree');
  const collapse = screen.getByRole('button', { name: 'Collapse folders' });
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(collapse);
  expect(onCollapsedChange).toHaveBeenLastCalledWith(true);

  rerenderWith({ size: 55, collapsed: true });
  expect(screen.queryByRole('region', { name: 'Folders' })).toBeNull();
  expect(screen.queryByRole('separator')).toBeNull();
  expect(screen.getByText('Projects / Thesis')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Notes' })).toBeVisible();
  const expand = screen.getByRole('button', { name: 'Expand folders' });
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  // The folded part is still in the page, so the tree keeps which folders were open.
  expect(screen.getByText('folder tree')).toBe(tree);
  expect(document.getElementById(expand.getAttribute('aria-controls')!)).toContainElement(tree);
  fireEvent.click(expand);
  expect(onCollapsedChange).toHaveBeenLastCalledWith(false);

  rerenderWith({ size: 55, collapsed: false });
  expect(screen.getByRole('region', { name: 'Folders' })).toContainElement(tree);
});
