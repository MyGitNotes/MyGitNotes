// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cardView } from './card-view.js';

function preview(title: string, content: string) {
  const item = { id: 'n', kind: 'note' as const, path: 'study/card-span.md', notebookId: 'study' };
  return cardView({ key: 'n', item, placed: false, ref: { item: 'n' }, rect: { x: 0, y: 0, w: 100, h: 100 } }, { noteAt: () => ({ id: item.id, notebookId: item.notebookId, path: item.path, title, content, metadata: {}, tags: [] }), assets: [], notebooks: [], folders: [], notebookId: 'study', loading: false, assetsLoading: false, dotClass: () => '' });
}

it('reads the study board’s formulas and Markdown as text', () => {
  const view = preview(
    '生成空間',
    String.raw`# 生成空間

$\operatorname{span}\{\mathbf{v}_1, \dots, \mathbf{v}_k\}$ 是什麼意思？

---

**圖像：**
$$
A\mathbf{v} = \lambda\mathbf{v}
$$`,
  );
  expect(view.excerpt).toBe('span{v₁, …, vₖ} 是什麼意思？ 圖像： Av = λv');
});

it('reads math in titles and substitutes a compact marker for invalid TeX', () => {
  const view = preview(String.raw`$A\mathbf{v} = \lambda\mathbf{v}$`, String.raw`$\badcommand{x}$`);
  expect(view.title).toBe('Av = λv');
  expect(view.excerpt).toBe('ƒ');
});
