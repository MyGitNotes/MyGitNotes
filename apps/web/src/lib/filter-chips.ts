import type { FilterControls } from './filter-controls.js';
import type { RailSectionId } from '../components/SidebarRail.js';

export interface FilterChip {
  id: string;
  label: string;
  /** The sidebar section that sets this filter. */
  section: RailSectionId;
  /** Clears just this filter; a chip with none is context (the notebook being listed), not a filter to remove. */
  remove?: () => void;
}

type Translate = (key: 'focusList.allNotebooks' | 'outline.list' | 'sidebar.compilations' | 'sidebar.allStatuses', params?: Record<string, string | number>) => string;

/** The filters that narrow the list, as chips: the notebook or folders, a note kind, a status, each tag, and the search text. */
export function filterChips(filters: FilterControls, t: Translate, statusLabel: (status: string) => string = status => status): FilterChip[] {
  const { value } = filters;
  const chips: FilterChip[] = [];
  const notebook = filters.notebooks.find(item => item.id === value.notebookId);
  if (filters.allNotebooks) chips.push({ id: 'notebook:all', label: t('focusList.allNotebooks'), section: 'notebooks', remove: () => filters.onAllNotebooksChange(false) });
  else if (notebook) chips.push({ id: `notebook:${notebook.id}`, label: notebook.title, section: 'notebooks' });
  const root = notebook?.root.replace(/\/$/, '');
  for (const folder of value.folders) {
    chips.push({ id: `folder:${folder}`, label: root && folder.startsWith(`${root}/`) ? folder.slice(root.length + 1) : folder, section: 'notebooks', remove: () => filters.onChange({ folders: value.folders.filter(item => item !== folder) }) });
  }
  if (value.kind === 'outline' || value.kind === 'compilation') chips.push({ id: `kind:${value.kind}`, label: t(value.kind === 'outline' ? 'outline.list' : 'sidebar.compilations'), section: 'notebooks', remove: () => filters.onChange({ kind: 'note' }) });
  if (value.status !== null) chips.push({ id: `status:${value.status}`, label: statusLabel(value.status), section: 'status', remove: () => filters.onChange({ status: null }) });
  for (const tag of value.tags) chips.push({ id: `tag:${tag}`, label: `#${tag}`, section: 'tags', remove: () => filters.onChange({ tags: value.tags.filter(item => item !== tag) }) });
  if (value.q.trim()) chips.push({ id: 'search', label: `“${value.q.trim()}”`, section: 'notebooks', remove: () => filters.onChange({ q: '' }) });
  return chips;
}
