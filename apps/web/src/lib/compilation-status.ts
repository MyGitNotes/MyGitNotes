import { type NotebookFacets, noteQueryStatuses } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from './types.js';

/** The status a new compilation of `notebookId` starts with: the one a new note there gets, the notebook's first status; none when it has no statuses. */
export function initialCompilationStatus(notebooks: NotebookConfig[], notebookId: string, facets: Record<string, NotebookFacets> | undefined): string | undefined {
  return noteQueryStatuses(notebooks, notebookId, Object.keys(facets?.[notebookId]?.statuses || {}))[0] || undefined;
}
