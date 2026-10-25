import { expect, it } from 'vitest';
import { CASE_COLLISION_ERROR } from '../src/case-collision.js';
import { githubFixture } from './fixtures/github.js';

// GitHub tells Plans.md and plans.md apart, but a checkout on macOS or Windows cannot hold both.
it('refuses a new note whose name an existing note has in different letter case', async () => {
  const f = githubFixture({ 'notes/ex/Plans.md': '# Plans\n' });
  await expect(f.reader().save('notes/ex/plans.md', '# plans\n', {}, f.head(), true)).rejects.toMatchObject({ status: 409, message: CASE_COLLISION_ERROR });
  expect(f.text('notes/ex/Plans.md')).toBe('# Plans\n');
});
