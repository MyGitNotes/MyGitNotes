import { expect, it } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { laneGraphMembers } from './useGraphData.js';

const base = { name: 'Manual', notebookId: 'r~a', path: 'notes/a/manual.compilation.yml', view: 'graph' as const };

it("draws only the members of the compilation's own notebook and counts the items in other notebooks", () => {
  const row: CompilationRow = { ...base, id: 'm', kind: 'custom', items: [{ id: '1', kind: 'note', notebookId: 'r~a', path: 'notes/a/one.md' }, { id: '2', kind: 'note', notebookId: 'r~b', path: 'notes/b/two.md' }, { id: '3', kind: 'folder', notebookId: 'r~c', path: 'notes/c' }, { id: '4', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0 }] };
  expect(laneGraphMembers(row, ['notes/a/one.md', 'notes/b/two.md'])).toEqual({ ids: ['r~a:notes/a/one.md'], outside: 2 });
});

it('counts every member of a dynamic folder source in another notebook as outside', () => {
  const row: CompilationRow = { ...base, id: 'd', kind: 'dynamic', source: { kind: 'folder', path: 'notes/b', recursive: true, notebookId: 'r~b' } };
  expect(laneGraphMembers(row, ['notes/b/x.md', 'notes/b/y.md'])).toEqual({ ids: [], outside: 2 });
  expect(laneGraphMembers({ ...row, source: { ...row.source, notebookId: 'r~a', path: 'notes/a' } as never }, ['notes/a/x.md'])).toEqual({ ids: ['r~a:notes/a/x.md'], outside: 0 });
});

it('words the notice in English and Traditional Chinese', async () => {
  const { en } = await import('../../lib/i18n/en.js');
  const { zhTW } = await import('../../lib/i18n/zh-TW.js');
  expect(en['graph.outsideNotebook' as keyof typeof en]).toBe('{count} items in other notebooks are not shown in the graph');
  expect(zhTW['graph.outsideNotebook' as keyof typeof zhTW]).toBe('另有 {count} 個項目在其他筆記本，關聯圖不顯示');
});
