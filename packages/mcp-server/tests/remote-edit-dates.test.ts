import { afterEach, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { openRemoteRepository } from '@mygitnotes/core';
import { callRemoteTool } from '../src/remote-tools.js';
import { createMCPServer } from '../src/server.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const site = 'https://gitlab.example.test/gitlab';

/** A GitLab project whose GraphQL dates every note by one commit, `edit`, at 2026-11-20T09:00:00+08:00. */
function gitlab(publicProject = false) {
  const f = gitlabFixture(site);
  if (publicProject) f.public();
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
  return request;
}
function dated() {
  return openRemoteRepository({ type: 'gitlab', url: site, repository: 'group/subgroup/project', branch: 'main' }, 'token', gitlab()).reader;
}

it('lists and reads hosted notes with their Git edit date', async () => {
  const listed = await callRemoteTool(dated(), 'list_notes', {}, false) as { notes: Record<string, unknown>[]; };
  expect(listed.notes.map(note => [note.path, note.lastCommitAt, note.updated])).toEqual([['notes/ex/a.md', '2026-11-20T01:00:00.000Z', '2026-11-20T01:00:00.000Z'], ['notes/ex/folder/b.md', '2026-11-20T01:00:00.000Z', '2026-11-20T01:00:00.000Z']]);
  const read = await callRemoteTool(dated(), 'read_note', { path: 'notes/ex/a.md' }, false) as { note: Record<string, unknown>; };
  expect(read.note).toMatchObject({ lastCommitAt: '2026-11-20T01:00:00.000Z', updated: '2026-11-20T01:00:00.000Z', content: '# Alpha\n' });
  for (const [name, args] of [['read_note', { path: 'notes/ex/a.md', metadataOnly: true }], ['get_note_metadata', { path: 'notes/ex/a.md' }]] as const) {
    expect(await callRemoteTool(dated(), name, args, false)).toMatchObject({ lastCommitAt: '2026-11-20T01:00:00.000Z', updated: '2026-11-20T01:00:00.000Z' });
  }
});

it('answers the dates within the output schemas of the tools, which an MCP client checks', async () => {
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'gitlab');
  vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'group/subgroup/project');
  vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
  vi.stubEnv('GITLAB_URL', site);
  vi.spyOn(globalThis, 'fetch').mockImplementation(gitlab(true));
  const server = createMCPServer('/tmp');
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await client.listTools();
    for (const [name, args] of [['list_notes', {}], ['read_note', { path: 'notes/ex/a.md' }], ['get_note_metadata', { path: 'notes/ex/a.md' }]] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
      expect(JSON.stringify(result.structuredContent)).toContain('"lastCommitAt":"2026-11-20T01:00:00.000Z"');
    }
  } finally {
    await client.close();
    await server.close();
  }
});
