import { expect, it, vi } from 'vitest';
import { filterChips } from './filter-chips.js';
import type { FilterControls } from './filter-controls.js';

const filters = (status: string | null) => ({ value: { notebookId: 'a', folders: [], tags: [], q: '', status, kind: 'note' }, notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }], allNotebooks: false, onChange: () => {}, onAllNotebooksChange: () => {} }) as unknown as FilterControls;
const t = (key: string) => key;

it('shows a status chip by its label and keeps the stored name in its id', () => {
  const [, chip] = filterChips(filters('working'), t, status => status === 'working' ? '進行中' : status);
  expect(chip).toMatchObject({ id: 'status:working', label: '進行中', section: 'status' });
});

it('shows the stored name when no label is given', () => {
  expect(filterChips(filters('working'), t).find(chip => chip.id === 'status:working')?.label).toBe('working');
});

const liveFilters = (value: Record<string, unknown>, onChange = vi.fn()) => ({ value: { notebookId: 'a', folders: [], tags: [], q: '', status: null, kind: 'note', live: [], ...value }, notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }], allNotebooks: false, onChange, onAllNotebooksChange: () => {} }) as unknown as FilterControls;

it('shows each chosen live state as a removable status chip', () => {
  const onChange = vi.fn();
  const chips = filterChips(liveFilters({ live: ['editing', 'pending'] }, onChange), t);
  expect(chips.filter(chip => chip.id.startsWith('live:')).map(({ id, label, section }) => ({ id, label, section }))).toEqual([{ id: 'live:editing', label: 'filters.liveEditing', section: 'status' }, { id: 'live:pending', label: 'filters.livePending', section: 'status' }]);
  chips.find(chip => chip.id === 'live:editing')!.remove!();
  expect(onChange).toHaveBeenCalledWith({ live: ['pending'] });
});

it('shows is:live and is:pending search tokens as their own chips, apart from the search text', () => {
  const onChange = vi.fn();
  const chips = filterChips(liveFilters({ q: 'alpha is:live is:pending' }, onChange), t);
  expect(chips.filter(chip => chip.id.startsWith('search')).map(({ id, label }) => ({ id, label }))).toEqual([{ id: 'search:is:live', label: 'filters.live' }, { id: 'search:is:pending', label: 'filters.livePending' }, { id: 'search', label: '“alpha”' }]);
  chips.find(chip => chip.id === 'search:is:live')!.remove!();
  expect(onChange).toHaveBeenLastCalledWith({ q: 'alpha is:pending' });
  chips.find(chip => chip.id === 'search')!.remove!();
  expect(onChange).toHaveBeenLastCalledWith({ q: 'is:live is:pending' });
});

it('shows no search chip for a search of tokens only', () => {
  expect(filterChips(liveFilters({ q: 'is:live' }), t).map(chip => chip.id)).toEqual(['notebook:a', 'search:is:live']);
});
