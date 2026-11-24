import { expect, it, vi } from 'vitest';
import { isAgentEdit, openRemoteRepository } from '@mygitnotes/core';
import { callRemoteTool } from '../src/remote-tools.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

const reader = (f: ReturnType<typeof gitlabFixture>) => openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'fixture-token', f.request).reader;

// Every remote tool that commits note text marks its commit as an agent edit, so history shows who changed the note.
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

it('aborts replacement when reading source style fails', async () => {
  const f = gitlabFixture();
  const repo = reader(f);
  const head = f.head;
  const notes = await repo.notes();
  vi.spyOn(repo, 'notes').mockResolvedValue(notes);
  vi.spyOn(repo, 'readFile').mockRejectedValue(new Error('transport failed'));
  await expect(callRemoteTool(repo, 'replace_notes', { search: 'Beta', replace: 'Gamma', revision: head }, true)).rejects.toThrow('transport failed');
  await expect(repo.commitNotes([{ path: 'notes/ex/a.md', content: 'New body', metadata: {} }], head, 'Edit note')).rejects.toThrow('transport failed');
  expect(f.head).toBe(head);
});

// A post of an Astro blog reads `pubDatetime` with `z.date()`: a replace in its body leaves its bare date bare.
it('keeps the frontmatter style the stored note wrote when replace_notes rewrites its body', async () => {
  const post = '---\npubDatetime: 2026-11-24T09:00:00+08:00\ndate: 2025-01-01\ndraft: no\n---\n\nOld words.\n';
  const f = gitlabFixture(undefined, { 'notes/ex/post.md': post });
  await callRemoteTool(reader(f), 'replace_notes', { search: 'Old', replace: 'New', revision: f.head }, true);
  const written = f.files.get('notes/ex/post.md')!;
  expect(written).toContain('New words.');
  expect(written.split('\n')).toEqual(expect.arrayContaining(['pubDatetime: 2026-11-24T09:00:00+08:00', 'date: 2025-01-01', 'draft: no']));
});
