import { describe, expect, it, vi } from 'vitest';
import { parseCompilation } from '@mygitnotes/core/compilation';
import type { CompilationRow } from '@mygitnotes/core/compilation';

vi.mock('./notes-api.js', () => ({ lookupNotes: async () => ({ notes: [] }) }));
vi.mock('./compilation-lookup.js', () => ({ listCompilations: async () => [] }));
const { planCompilationCopy } = await import('./compilation-copy.js');

const row: CompilationRow = { id: 'c1', path: 'notes/life/reading.compilation.yml', notebookId: 'life', name: 'Reading', view: 'small', kind: 'custom', items: [] };

describe('planCompilationCopy', () => {
  it('keeps the status of its source', async () => {
    const plan = await planCompilationCopy({ ...row, status: 'doing' }, 'inbox');
    expect(plan.metadata).toMatchObject({ status: 'doing' });
    expect(parseCompilation(plan.content, 'notes/life').status).toBe('doing');
  });

  it('gives a source without a status the initial one', async () => {
    const plan = await planCompilationCopy(row, 'inbox');
    expect(plan.metadata).toMatchObject({ status: 'inbox' });
    expect(parseCompilation(plan.content, 'notes/life').status).toBe('inbox');
  });

  it('stays without a status when the notebook has none', async () => {
    const plan = await planCompilationCopy(row);
    expect(plan.metadata).not.toHaveProperty('status');
    expect(parseCompilation(plan.content, 'notes/life').status).toBeUndefined();
  });
});
