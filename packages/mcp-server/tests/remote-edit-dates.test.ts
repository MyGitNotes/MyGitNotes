import { expect, it } from 'vitest';
import { openRemoteRepository } from '@mygitnotes/core';
import { callRemoteTool } from '../src/remote-tools.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

const site = 'https://gitlab.example.test/gitlab';

/** A GitLab project whose GraphQL dates every note by one commit, `edit`, at 2026-11-20T09:00:00+08:00. */
function dated() {
  const f = gitlabFixture(site);
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== `${site}/api/graphql`) {
      const url = String(input);
      if (url.includes(`/repository/commits/${'e'.repeat(40)}`)) return new Response(JSON.stringify(url.includes('/diff') ? [] : { id: 'e'.repeat(40), parent_ids: [] }), { headers: { 'x-next-page': '' } });
      return f.request(input, init);
    }
    const { variables } = JSON.parse(String(init!.body));
    const repository = Object.fromEntries(Object.keys(variables).filter(key => /^p\d+$/.test(key)).map(key => [`f${key.slice(1)}`, { lastCommit: { sha: 'e'.repeat(40), authoredDate: '2026-11-20T09:00:00+08:00' } }]));
    return new Response(JSON.stringify({ data: { project: { repository } } }));
  }) as typeof fetch;
  return openRemoteRepository({ type: 'gitlab', url: site, repository: 'group/subgroup/project', branch: 'main' }, 'token', request).reader;
}

it('lists and reads hosted notes with their Git edit date', async () => {
  const listed = await callRemoteTool(dated(), 'list_notes', {}, false) as { notes: Record<string, unknown>[]; };
  expect(listed.notes.map(note => [note.path, note.lastCommitAt, note.updated])).toEqual([['notes/ex/a.md', '2026-11-20T01:00:00.000Z', '2026-11-20T01:00:00.000Z'], ['notes/ex/folder/b.md', '2026-11-20T01:00:00.000Z', '2026-11-20T01:00:00.000Z']]);
  const read = await callRemoteTool(dated(), 'read_note', { path: 'notes/ex/a.md' }, false) as { note: Record<string, unknown>; };
  expect(read.note).toMatchObject({ lastCommitAt: '2026-11-20T01:00:00.000Z', updated: '2026-11-20T01:00:00.000Z', content: '# Alpha\n' });
  expect(await callRemoteTool(dated(), 'read_note', { path: 'notes/ex/a.md', metadataOnly: true }, false)).toMatchObject({ lastCommitAt: '2026-11-20T01:00:00.000Z', updated: '2026-11-20T01:00:00.000Z' });
});
