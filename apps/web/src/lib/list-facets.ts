import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from './filter-controls.js';
import { mergeNotebookFacets, queryNotebookIds } from './note-facets.js';

/** The counts the status and tag filters show: of the list's scope and kind, with every tag in force listed even when no note has it. */
export interface ListFacets {
  /** Null while the facets are still being answered. */
  total: number | null;
  statuses: Record<string, number>;
  tags: Record<string, number>;
}

/** An outline or compilation list counts its own documents, the same as the list shows. */
const kindFacets = (facet: NotebookFacets, kind: FilterControls['value']['kind']): NotebookFacets => {
  const counts = kind === 'outline' ? facet.outlines : kind === 'compilation' ? facet.compilations : null;
  return counts ? { ...facet, total: counts.total, hidden: 0, statuses: counts.statuses, tags: counts.tags, directories: {} } : facet;
};

export function listFacets(filters: FilterControls, facets: Record<string, NotebookFacets> | undefined): ListFacets {
  const { value } = filters;
  const merged = mergeNotebookFacets(queryNotebookIds(filters.notebooks, value.notebookId, value.folders).flatMap(id => facets?.[id] ? [kindFacets(facets[id], value.kind)] : []));
  const tags: Record<string, number> = { ...merged.tags };
  for (const tag of value.tags) tags[tag] ??= 0;
  return { total: facets ? merged.total : null, statuses: merged.statuses, tags };
}
