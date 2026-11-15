import { useQueryStates } from 'nuqs';
import { filterParsers } from '../lib/filter-query.js';
import { pageOf } from '../lib/routes.js';
import { useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

export function useFilterSidebar() {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const location = useLocation();
  const [queryState, setFilterQuery] = useQueryStates(filterParsers, { history: 'push', shallow: false });
  // Moving between the notes of the Focus stays on the notebook's page, so the filters stay open.
  const page = pageOf(location.pathname, location.search);
  const [previousPage, setPreviousPage] = useState(page);
  if (previousPage !== page) {
    setPreviousPage(page);
    setFiltersOpen(false);
  }
  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [filtersOpen]);

  return { filtersOpen, setFiltersOpen, location, queryState, setFilterQuery };
}
