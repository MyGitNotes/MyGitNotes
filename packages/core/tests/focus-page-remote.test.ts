import { expect, it } from 'vitest';
import { githubFixture } from './fixtures/github.js';
import { FOCUS_DOCUMENT, FOCUS_PAGE_FILE } from '../src/focus-page.js';

it('a hosted save against a Focus file from a newer MyGitNotes names the newer version instead of calling the YAML invalid', async () => {
  const raw = 'version: 3\nfocuses: []\n', f = githubFixture({ [FOCUS_PAGE_FILE]: raw });
  await expect(f.reader().saveWorkspaceDocument(FOCUS_DOCUMENT, 'version: 1\nfocuses: []\n', f.head())).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/saved by a newer MyGitNotes/) });
  expect(f.text(FOCUS_PAGE_FILE)).toBe(raw);
});
