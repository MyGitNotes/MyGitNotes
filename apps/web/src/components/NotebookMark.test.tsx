// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { loadLucideIcons } from '../lib/icons/lucide-registry.js';
import { hasNotebookMark, iconFileName, notebookInitial, NotebookMark } from './NotebookMark.js';

afterEach(cleanup);

const mark = (container: HTMLElement) => container.querySelector<HTMLElement>('.notebook-mark');

it('draws nothing for a notebook without an icon or a colour, so the caller keeps its current look', () => {
  const { container } = render(<NotebookMark notebook={{ title: 'CoC 7' }} size='row' />);
  expect(mark(container)).toBeNull();
  expect(hasNotebookMark({ title: 'CoC 7' })).toBe(false);
  expect(hasNotebookMark({ title: 'CoC 7', color: 'red' })).toBe(true);
  expect(hasNotebookMark({ title: 'CoC 7', icon: 'dice-5' })).toBe(true);
});

it('draws the initial in the colour where only a colour is set', () => {
  const { container } = render(<NotebookMark notebook={{ title: 'campaign', color: 'red' }} size='rail' />);
  expect(mark(container)).toHaveAttribute('data-color', 'red');
  expect(mark(container)).toHaveAttribute('data-size', 'rail');
  expect(mark(container)).toHaveAttribute('aria-hidden', 'true');
  expect(mark(container)).toHaveTextContent('C');
  expect(mark(container)!.querySelector('svg')).toBeNull();
});

it('keeps the tile empty while the icons load, then draws the Lucide glyph in the colour', async () => {
  const { container } = render(<NotebookMark notebook={{ title: 'SOS-02', icon: 'dice-5', color: 'red' }} size='row' />);
  await loadLucideIcons();
  await waitFor(() => expect(mark(container)).toHaveAttribute('data-state', 'icon'));
  expect(mark(container)!.querySelector('svg')!.children.length).toBeGreaterThan(0);
  expect(mark(container)).not.toHaveTextContent('S');
});

it('draws an icon without a colour on a muted tile', async () => {
  await loadLucideIcons();
  const { container } = render(<NotebookMark notebook={{ title: 'Library', icon: 'Library' }} size='row' />);
  expect(mark(container)).toHaveAttribute('data-state', 'icon');
  expect(mark(container)).not.toHaveAttribute('data-color');
});

it('falls back to the initial for an icon name Lucide does not have', async () => {
  await loadLucideIcons();
  const { container } = render(<NotebookMark notebook={{ title: 'life', icon: 'no-such-icon', color: 'green' }} size='row' />);
  expect(mark(container)).toHaveAttribute('data-state', 'initial');
  expect(mark(container)).toHaveTextContent('L');
});

it('marks the open notebook as selected', () => {
  const { container } = render(<NotebookMark notebook={{ title: 'life', color: 'green' }} size='rail' selected />);
  expect(mark(container)).toHaveAttribute('data-selected', '');
});

it('takes the first character, upper-cased, as the initial', () => {
  expect(notebookInitial(' coc 7')).toBe('C');
  expect(notebookInitial('生活筆記')).toBe('生');
  expect(notebookInitial('')).toBe('?');
});

it('stores an icon under its kebab-case Lucide name', () => {
  expect(iconFileName('Dice5')).toBe('dice-5');
  expect(iconFileName('BookOpen')).toBe('book-open');
  expect(iconFileName('ArrowUpAZ')).toBe('arrow-up-a-z');
  expect(iconFileName('Grid2x2')).toBe('grid-2x2');
});
