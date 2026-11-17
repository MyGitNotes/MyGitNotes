import { expect, it } from 'vitest';
import { openRemoteRepository } from '@mygitnotes/core';
import { callRemoteTool } from '../src/remote-tools.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

const broken = 'notes/ex/broken.md';
const raw = '---\nnot: [yaml\n---\n# Broken Beta\n';
const reader = (f: ReturnType<typeof gitlabFixture>) => openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'fixture-token', f.request).reader;

// An agent's text replacement in a note whose frontmatter cannot be read writes that note's text as it is, with no block
// put in front of the broken one; a metadata write to it is refused, and the note is left alone.
it('replaces text in a note whose frontmatter cannot be read without adding a block, and refuses its metadata', async () => {
  const f = gitlabFixture(undefined, { [broken]: raw });
  await callRemoteTool(reader(f), 'replace_notes', { search: 'Beta', replace: 'Gamma', revision: f.head }, true);
  expect(f.files.get(broken)).toBe('---\nnot: [yaml\n---\n# Broken Gamma\n');
  expect(f.files.get('notes/ex/folder/b.md')).toMatch(/^---\nupdated: ".+"\n---\n\n# Gamma\n$/);
  const before = f.writes;
  await expect(callRemoteTool(reader(f), 'update_note_metadata', { path: broken, status: 'done', revision: f.head }, true)).rejects.toThrow('The frontmatter cannot be read');
  expect(f.writes).toBe(before);
  expect(f.files.get(broken)).toBe('---\nnot: [yaml\n---\n# Broken Gamma\n');
});

// FM-F001: a new note whose own text opens a block that cannot be read gets no block put in front of it: written as it
// is without metadata, refused with it, and nothing written.
it('creates a note whose text opens an unreadable block as it is, and refuses one that adds metadata to it', async () => {
  const f = gitlabFixture();
  const before = f.writes;
  await expect(callRemoteTool(reader(f), 'save_note', { path: 'notes/ex/new.md', content: raw, status: 'done', revision: f.head }, true)).rejects.toThrow('The frontmatter cannot be read');
  expect(f.writes).toBe(before);
  expect(f.files.has('notes/ex/new.md')).toBe(false);
  await callRemoteTool(reader(f), 'save_note', { path: 'notes/ex/new.md', content: raw, metadata: {}, revision: f.head }, true);
  expect(f.files.get('notes/ex/new.md')).toBe(raw);
});
