import { describe, expect, it } from 'vitest';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import { initialCompilationStatus } from './compilation-status.js';
import type { NotebookConfig } from './types.js';

const notebook = (statuses?: string[]) => ({ id: 'life', title: 'Life', root: 'notes/life', ...(statuses ? { statuses } : {}) }) as NotebookConfig;
const facets = (statuses: Record<string, number>) => ({ life: { statuses } as unknown as NotebookFacets });

describe('initialCompilationStatus', () => {
  it('is the first status of the notebook, as for a new note', () => {
    expect(initialCompilationStatus([notebook(['inbox', 'done'])], 'life', facets({ done: 2 }))).toBe('inbox');
  });

  it('is the first default status when the notebook configures none, whatever its notes use', () => {
    expect(initialCompilationStatus([notebook()], 'life', facets({ draft: 1 }))).toBe(initialCompilationStatus([notebook()], 'life', undefined));
    expect(initialCompilationStatus([notebook()], 'life', facets({ draft: 1 }))).toBeTruthy();
  });
});
