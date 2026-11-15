import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { NotebookConfig } from '../lib/types.js';
import { readFilterQuery } from '../lib/filter-query.js';
import { focusNoteState } from '../lib/routes.js';
import { getNotebookSort, getStoredGlobalSort, metadataSortKey, resolveNoteSort, saveNotebookSort, type SortConfig, type SortField, type SortOrder } from '../lib/note-sort.js';

/**
 * The notes sort of the notebook with key `notebookKey`: a sort in the URL, else what the person chose for that
 * notebook, else the notebook's `default_sort`, else the browser-wide sort saved before notebooks had their own,
 * else the default order. A choice is saved for its notebook and written to the URL.
 */
export function useNoteSort(notebookKey: string, notebook?: Pick<NotebookConfig, 'default_sort'>) {
  const location = useLocation(), navigate = useNavigate();
  const route = readFilterQuery(location.search);
  const [chosen, setChosen] = useState<Record<string, SortConfig>>({});
  const [saved] = useState(getStoredGlobalSort);
  const explicit = useMemo(() => chosen[notebookKey] ?? getNotebookSort(notebookKey), [chosen, notebookKey]);
  const resolved = resolveNoteSort({ explicit, defaultSort: notebook?.default_sort, saved });
  const sortField = route.sortField ?? resolved.field, sortOrder = route.sortOrder ?? resolved.order;
  // The frontmatter fields the sort menu offers: the notebook's default and any other one in force.
  const metadataSortFields = [notebook?.default_sort?.field, sortField].filter((field, index, all): field is SortField => field !== undefined && metadataSortKey(field) !== undefined && all.indexOf(field) === index);

  const handleSortChange = (field: SortField, order?: SortOrder) => {
    let newOrder: SortOrder;
    if (order) {
      newOrder = order;
    } else if (field === sortField) {
      newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      newOrder = field === 'title' || field === 'status' ? 'asc' : 'desc';
    }
    setChosen(previous => ({ ...previous, [notebookKey]: { field, order: newOrder } }));
    saveNotebookSort(notebookKey, field, newOrder);
    const query = new URLSearchParams(location.search);
    query.set('sortField', field);
    query.set('sortOrder', newOrder);
    navigate({ pathname: location.pathname, search: query.toString() }, { state: focusNoteState(location.state) });
  };

  return { sortField, sortOrder, handleSortChange, metadataSortFields };
}
