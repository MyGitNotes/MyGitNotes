import { expect, it } from 'vitest';
import { isAgentEdit, openRemoteRepository } from '@mygitnotes/core';
import { callRemoteTool } from '../src/remote-tools.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

const reader = (f: ReturnType<typeof gitlabFixture>) => openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'fixture-token', f.request).reader;

// The app's commit routes push a note to its Gist without asking only when the newest commit of the note is not an
// agent's, so every remote tool that commits note text marks its commit as an agent edit.
it('marks the commits of cp, mv and replace_notes as agent edits', async () => {
  const f = gitlabFixture();
  const copied = await callRemoteTool(reader(f), 'cp', { source: 'notes/ex/a.md', destination: 'notes/ex/copy.md', revision: f.head }, true);
  expect(copied.commit.message).toMatch(/^docs\(notes\): cp copy\.md \(Agent, \d{4}-\d{2}-\d{2}\)/);
  expect(isAgentEdit(copied.commit.message)).toBe(true);
  const moved = await callRemoteTool(reader(f), 'mv', { source: 'notes/ex/copy.md', destination: 'notes/ex/moved.md', revision: f.head }, true);
  expect(moved.commit.message).toMatch(/^docs\(folders\): mv /);
  expect(isAgentEdit(moved.commit.message)).toBe(true);
  const replaced = await callRemoteTool(reader(f), 'replace_notes', { search: 'Beta', replace: 'Gamma', revision: f.head }, true);
  expect(replaced.commit.message).toMatch(/^docs\(notes\): replace "Beta" across 1 notes \(Agent, /);
  expect(isAgentEdit(replaced.commit.message)).toBe(true);
});
