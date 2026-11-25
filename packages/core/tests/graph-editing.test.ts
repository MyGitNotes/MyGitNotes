import { describe, expect, it } from 'vitest';
import { compilationNotePaths } from '../src/compilation.js';
import { ScreenPageSchema } from '../src/screen-page.js';
import type { NoteItem } from '../src/types.js';

describe('graph editing contracts', () => {
  it('round trips graph lanes and layout while preserving old lanes', () => {
    const page = { version: 2, rows: [{ id: 'old', name: 'Old', view: 'small', notebookId: 'n', kind: 'custom', items: [] }, { id: 'graph', name: 'Graph', view: 'graph', notebookId: 'n', kind: 'custom', items: [], graph: { nodes: [{ path: 'notes/a.md', x: 12, y: 20, width: 360, height: 300, expanded: true, pinned: true }] } }] };
    expect(ScreenPageSchema.parse(page)).toEqual(page);
    expect(ScreenPageSchema.safeParse({ ...page, rows: [{ ...page.rows[1], graph: { nodes: [{ path: '../bad', x: Infinity, y: 0 }] } }] }).success).toBe(false);
  });
  it('resolves lane notes consistently without expanding folder shortcuts or including assets', () => {
    const notes = [{ path: 'notes/a.md', notebookId: 'n', tags: ['x'], metadata: {}, status: 'draft' }, { path: 'notes/sub/b.md', notebookId: 'n', tags: [], metadata: {} }, { path: 'other/c.md', notebookId: 'm', tags: ['x'], metadata: {} }] as NoteItem[];
    expect(compilationNotePaths({ id: 'r', name: 'R', view: 'graph', notebookId: 'n', kind: 'custom', items: [{ id: 'a', kind: 'note', path: 'notes/a.md', notebookId: 'n' }, { id: 'f', kind: 'folder', path: 'notes/sub', notebookId: 'n' }] }, notes)).toEqual(['notes/a.md']);
    expect(compilationNotePaths({ id: 'd', name: 'D', view: 'graph', notebookId: 'n', kind: 'dynamic', source: { kind: 'folder', notebookId: 'n', path: 'notes', recursive: true } }, notes)).toEqual(['notes/a.md', 'notes/sub/b.md']);
    expect(compilationNotePaths({ id: 't', name: 'T', view: 'graph', notebookId: 'n', kind: 'dynamic', source: { kind: 'tag', tag: 'x', notebookId: 'n' } }, notes)).toEqual(['notes/a.md']);
  });
});
