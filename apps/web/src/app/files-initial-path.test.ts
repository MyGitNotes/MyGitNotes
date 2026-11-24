import { expect, it } from 'vitest';
import { filesInitialPath } from './files-initial-path.js';

it('resolves directory links only once the notebook root exists', () => {
  expect(filesInitialPath('?directory=icons')).toBeUndefined();
  expect(filesInitialPath('?directory=icons', 'notes/a', 'media')).toBe('notes/a/media/icons');
  expect(filesInitialPath('?directory=', 'notes/a')).toBe('notes/a/assets');
  expect(filesInitialPath('?directory=icons&asset=notes/a/logo.png')).toBe('notes/a/logo.png');
});
