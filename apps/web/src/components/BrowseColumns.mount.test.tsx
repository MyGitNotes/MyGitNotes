// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { BrowseColumnsLayout } from '../lib/browse-columns.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { zhTW } from '../lib/i18n/zh-TW.js';
import { BrowseColumns, LIST_COLUMN_ID, NOTEBOOK_COLUMN_ID } from './BrowseColumns.js';

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
});
afterEach(cleanup);

/** Counts its mounts, as a Focus's editors would notice a remount. */
function Note({ mounts, unmounts }: { mounts: () => void; unmounts: () => void; }) {
  useEffect(() => {
    mounts();
    return unmounts;
  }, [mounts, unmounts]);
  return <div data-testid='note'>note</div>;
}

const page = (layout: BrowseColumnsLayout, merged: boolean, note: JSX.Element) => (
  <I18nProvider>
    <BrowseColumns layout={layout} merged={merged} notebooks={<p>notebooks</p>} list={<p>list</p>} note={note} restore={<button type='button'>Show note list</button>} />
  </I18nProvider>
);

it('keeps the note mounted, not remounted, while the columns beside it fold, open, and the table spreads over it', () => {
  const mounts = vi.fn();
  const unmounts = vi.fn();
  const note = <Note mounts={mounts} unmounts={unmounts} />;
  const { rerender } = render(page({ notebooks: 'open', list: true }, false, note));
  const shown = screen.getByTestId('note');
  const steps: Array<[BrowseColumnsLayout, boolean]> = [[{ notebooks: 'rail', list: true }, false], [{ notebooks: 'open', list: true }, true], [{ notebooks: 'rail', list: false }, false], [{ notebooks: 'open', list: true }, false]];
  for (const [layout, merged] of steps) {
    rerender(page(layout, merged, note));
    expect(screen.getByTestId('note')).toBe(shown);
  }
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(unmounts).not.toHaveBeenCalled();
});

it('hides a folded column in place, keeping its element, and leaves the note in reach', () => {
  const note = <p>note</p>;
  const { rerender } = render(page({ notebooks: 'open', list: true }, false, note));
  const notebooks = document.getElementById(NOTEBOOK_COLUMN_ID)!;
  const list = document.getElementById(LIST_COLUMN_ID)!;
  expect(notebooks).not.toHaveAttribute('hidden');
  expect(list).not.toHaveAttribute('hidden');
  expect(document.querySelector('[inert]')).toBeNull();

  rerender(page({ notebooks: 'rail', list: false }, false, note));
  expect(document.getElementById(NOTEBOOK_COLUMN_ID)).toBe(notebooks);
  expect(document.getElementById(LIST_COLUMN_ID)).toBe(list);
  // The notebooks column only narrows to its rail; the list hides.
  expect(notebooks).not.toHaveAttribute('hidden');
  expect(list).toHaveAttribute('hidden');
  expect(screen.getByText('note').closest('[hidden]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Show note list' }).closest('[hidden]')).toBeNull();
});

it('folds at once, with no animation flag to wait out', () => {
  const { rerender } = render(page({ notebooks: 'open', list: true }, false, <p>note</p>));
  rerender(page({ notebooks: 'rail', list: false }, false, <p>note</p>));
  const root = document.querySelector('.browse-columns')!;
  expect(root).not.toHaveAttribute('data-animating');
  expect(root).toHaveAttribute('data-notebooks', 'rail');
  expect(root).toHaveAttribute('data-list', 'closed');
});

it('names the notebooks and the list columns as landmarks, in English and Traditional Chinese', () => {
  render(page({ notebooks: 'open', list: true }, false, <p>note</p>));
  expect(screen.getByRole('complementary', { name: 'Notebooks' })).toHaveAttribute('id', NOTEBOOK_COLUMN_ID);
  expect(screen.getByRole('region', { name: 'Note list' })).toHaveAttribute('id', LIST_COLUMN_ID);
  expect([zhTW['sidebar.notebooks'], zhTW['browse.listColumn']]).toEqual(['筆記本', '筆記清單']);
});

it('hands its element to measure once, not again on every render, so measuring cannot render the page without end', () => {
  const measure = vi.fn();
  const view = (layout: BrowseColumnsLayout, merged: boolean) => (
    <I18nProvider>
      <BrowseColumns layout={layout} measure={measure} merged={merged} notebooks={<p>notebooks</p>} list={<p>list</p>} note={<p>note</p>} />
    </I18nProvider>
  );
  const { rerender } = render(view({ notebooks: 'open', list: true }, false));
  rerender(view({ notebooks: 'open', list: true }, true));
  rerender(view({ notebooks: 'rail', list: true }, false));
  expect(measure).toHaveBeenCalledOnce();
  expect(measure).toHaveBeenCalledWith(document.querySelector('.browse-columns'));
});
