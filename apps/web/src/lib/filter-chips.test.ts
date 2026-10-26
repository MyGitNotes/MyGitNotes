import { expect, it } from 'vitest';
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
