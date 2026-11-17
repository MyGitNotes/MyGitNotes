import { expect, it } from 'vitest';
import { renamedSource } from './memory-edition-source.js';

// FHT-F004: two notes made from one template share its frontmatter and blank lines, which said nothing of their text.
it('takes a removed note as renamed only when the body, not its frontmatter or blank lines, keeps half its lines', () => {
  const template = (body: string) => `---\nstatus: inbox\ntags: []\n---\n\n${body}\n`;
  expect(renamedSource(template('# Groceries\n\nmilk'), [['notes/a/todo.md', template('# Call Ann\n\nabout Friday')]])).toBeNull();
  expect(renamedSource(template('# Groceries\n\nmilk\neggs'), [['notes/a/todo.md', template('# Call Ann\n\nabout Friday')], ['notes/a/shop.md', '---\nstatus: done\n---\n# Groceries\nmilk\neggs\nbread\n']])).toBe('notes/a/shop.md');
  expect(renamedSource('\n\n\n', [['notes/a/blank.md', '\n\n']])).toBeNull();
  expect(renamedSource('same\n', [['notes/a/x.md', 'same\n']])).toBe('notes/a/x.md');
});
