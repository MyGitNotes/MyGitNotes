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
    expect(parseCompilation(plan.content, ['notes/life']).status).toBe('doing');
  });

  it('gives a source without a status the initial one', async () => {
    const plan = await planCompilationCopy(row, 'inbox');
    expect(plan.metadata).toMatchObject({ status: 'inbox' });
    expect(parseCompilation(plan.content, ['notes/life']).status).toBe('inbox');
  });

  it('copies a board as a board, with its board on the fresh item ids', async () => {
    const board: CompilationRow = { ...row, view: 'board', items: [{ id: 'n1', kind: 'note', notebookId: 'life', path: 'notes/life/a.md' }], board: { cards: [{ item: 'n1', x: 4, y: 8 }], texts: [{ id: 't1', x: 0, y: 0, text: 'T' }] } };
    const plan = await planCompilationCopy(board);
    const copy = parseCompilation(plan.content, ['notes/life']);
    expect(copy.arrangement).toBe('board');
    expect(copy.board).toEqual({ cards: [{ item: copy.items![0].id, x: 4, y: 8 }], texts: [{ id: 't1', x: 0, y: 0, text: 'T' }] });
    expect(copy.items![0].id).not.toBe('n1');
  });

  it('stays without a status when the notebook has none', async () => {
    const plan = await planCompilationCopy(row);
    expect(plan.metadata).not.toHaveProperty('status');
    expect(parseCompilation(plan.content, ['notes/life']).status).toBeUndefined();
  });
});
