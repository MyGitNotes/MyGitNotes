import { expect, it } from 'vitest';
import { dropPosition, folderDropCommand } from './folder-drag.js';
const folders = ['a', 'a/child', 'b', 'c'].map((path, order) => ({ notebookId: 'n', path, title: path, order }));
it('inserts after a sibling without confusing its descendants, and blocks cycles', () => {
  expect(folderDropCommand('n', 'c', 'a', 'after', folders)).toMatchObject({ parent: '', before: 'b' });
  expect(folderDropCommand('n', 'a', 'a/child', 'inside', folders)).toBeNull();
  expect(folderDropCommand('n', 'a', 'b', 'inside', folders)).toMatchObject({ parent: 'b' });
  expect(folderDropCommand('n', 'a/child', '', 'inside', folders)).toMatchObject({ parent: '' });
});
it('drops beside a row in its upper or lower quarter and inside it between them', () => {
  expect(dropPosition(102, 100, 28)).toBe('before');
  expect(dropPosition(114, 100, 28)).toBe('inside');
  expect(dropPosition(126, 100, 28)).toBe('after');
  expect(dropPosition(100, 100, 0)).toBe('inside');
});
