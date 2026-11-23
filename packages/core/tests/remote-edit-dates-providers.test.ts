import { expect, it } from 'vitest';
import { openRemoteRepository } from '../src/remote-factory.js';
import { gitlabFixture } from './fixtures/gitlab.js';
import { githubFixture } from './fixtures/github.js';
import type { RemoteSource } from '../src/remote-source.js';

const site = 'https://gitlab.example.test/gitlab';
const prefix = `${site}/api/v4/projects/group%2Fsubgroup%2Fproject`;
const edit = 'e'.repeat(40), move = 'd'.repeat(40), start = 'c'.repeat(40);

/**
 * The GitLab fixture with history: `start` added both notes (b.md as old-b.md), `edit` changed a.md, `move` moved
 * old-b.md to folder/b.md unchanged. GraphQL answers last commits unless `graphql` is false.
 */
function gitlabHistory(graphql = true) {
  const f = gitlabFixture();
  const calls: string[] = [];
  const last = (ref: string, path: string) => ref === f.head ? path === 'notes/ex/a.md' ? { sha: edit, date: '2026-03-01T08:00:00+08:00' } : path === 'notes/ex/folder/b.md' ? { sha: move, date: '2026-04-01T00:00:00Z' } : null : ref === start && path === 'notes/ex/old-b.md' ? { sha: start, date: '2026-01-01T00:00:00Z' } : null;
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'x-next-page': '' } });
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${site}/api/graphql`) {
      const { query, variables } = JSON.parse(String(init!.body));
      calls.push(`graphql ${variables.ref.slice(0, 1)} ${Object.keys(variables).filter(key => /^p\d+$/.test(key)).map(key => variables[key]).join(',')}`);
      if (!graphql) return json({ data: { project: null } });
      expect(variables.project).toBe('group/subgroup/project');
      expect(query).toContain('lastCommit { sha authoredDate }');
      const repository = Object.fromEntries(Object.keys(variables).filter(key => /^p\d+$/.test(key)).map(key => {
        const commit = last(variables.ref, variables[key]);
        return [`f${key.slice(1)}`, { lastCommit: commit && { sha: commit.sha, authoredDate: commit.date } }];
      }));
      return json({ data: { project: { repository } } });
    }
    const endpoint = url.slice(prefix.length), query = new URL(url).searchParams;
    if (endpoint.startsWith('/repository/commits?')) {
      calls.push(`rest ${query.get('path')}`);
      const commit = last(query.get('ref_name')!, query.get('path')!);
      return json(commit ? [{ id: commit.sha, parent_ids: [], authored_date: commit.date, author_name: 'Tester', message: 'm' }] : []);
    }
    if (endpoint === `/repository/commits/${move}`) return json({ id: move, parent_ids: [start] });
    if (endpoint === `/repository/commits/${edit}`) return json({ id: edit, parent_ids: [start] });
    if (endpoint.startsWith(`/repository/commits/${move}/diff`)) return json([{ old_path: 'notes/ex/old-b.md', new_path: 'notes/ex/folder/b.md', renamed_file: true, diff: '' }]);
    if (endpoint.startsWith(`/repository/commits/${edit}/diff`)) return json([{ old_path: 'notes/ex/a.md', new_path: 'notes/ex/a.md', diff: '@@ -1 +1 @@\n-x\n+y\n' }]);
    return f.request(input, init);
  }) as typeof fetch;
  const reader = () => openRemoteRepository({ type: 'gitlab', url: site, repository: 'group/subgroup/project', branch: 'main' }, 'token', request).reader;
  return { f, calls, reader };
}

const datesOf = async (reader: RemoteSource, paths: string[]) => Object.fromEntries((await reader.dated(await Promise.all(paths.map(path => reader.note(path))))).map(note => [note.path, [note.lastCommitAt, note.updated]]));

it('dates GitLab notes by GraphQL last commits, following a commit that only moved a note', async () => {
  const { calls, reader } = gitlabHistory();
  expect(await datesOf(reader(), ['notes/ex/a.md', 'notes/ex/folder/b.md'])).toEqual({ 'notes/ex/a.md': ['2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'], 'notes/ex/folder/b.md': ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'] });
  expect(calls.filter(call => call.startsWith('graphql'))).toEqual([expect.stringMatching(/^graphql [0-9a-f] notes\/ex\/a\.md,notes\/ex\/folder\/b\.md$/), 'graphql c notes/ex/old-b.md']);
  expect(calls.some(call => call.startsWith('rest'))).toBe(false);
  // The catalog dates what a query lists.
  const [dated] = await reader().catalog().dates!([{ id: 'a', path: 'notes/ex/a.md', notebookId: 'ex', title: 'A', tags: [], metadata: {} }]).then(facts => [...facts]);
  expect(dated).toEqual(['notes/ex/a.md', { lastCommitAt: '2026-03-01T00:00:00.000Z' }]);
});

it('asks GitLab per path over REST where GraphQL does not answer', async () => {
  const { calls, reader } = gitlabHistory(false);
  expect(await datesOf(reader(), ['notes/ex/a.md', 'notes/ex/folder/b.md'])).toEqual({ 'notes/ex/a.md': ['2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'], 'notes/ex/folder/b.md': ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'] });
  expect(calls.filter(call => call.startsWith('rest')).sort()).toEqual(['rest notes/ex/a.md', 'rest notes/ex/folder/b.md', 'rest notes/ex/old-b.md']);
});

it('dates GitHub notes in a GraphQL batch, follows a move that kept the text, and falls back to REST', async () => {
  const f = githubFixture({}, { hexIds: true });
  const setup = f.reader();
  const snapshot = await setup.getSnapshot();
  const blob = snapshot.entries.find(entry => entry.path === 'notes/ex/work/b.md')!.sha;
  await setup.commitChanges([{ path: 'notes/ex/a.md', content: '# Alpha\nedited\n' }], snapshot.sha, 'save');
  const edited = f.head();
  const moving = f.reader();
  await moving.commitChanges([{ path: 'notes/ex/moved.md', sha: blob }, { path: 'notes/ex/work/b.md', sha: null }], (await moving.getSnapshot()).sha, 'move');
  const startDate = '2026-01-01T00:00:00.000Z';
  // GraphQL answers from the fixture's REST history, so the batch is checked against the same commits.
  let batches = 0;
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).endsWith('/graphql')) return f.request(input, init);
    batches++;
    const { variables } = JSON.parse(String(init!.body));
    const object: Record<string, unknown> = {};
    for (const key of Object.keys(variables).filter(name => /^p\d+$/.test(name))) {
      const listed = await (await f.request(`https://api.github.com/repos/owner/repo/commits?sha=${variables.head}&path=${encodeURIComponent(variables[key])}&per_page=1&page=1`)).json() as { sha: string; commit: { author: { date: string; }; }; }[];
      object[`f${key.slice(1)}`] = { nodes: listed.map(commit => ({ oid: commit.sha, authoredDate: commit.commit.author.date })) };
    }
    return new Response(JSON.stringify({ data: { repository: { object } } }));
  }) as typeof fetch;
  const reader = openRemoteRepository({ type: 'github', repository: 'owner/repo', branch: 'main' }, 'test-token', request).reader;
  const dates = await datesOf(reader, ['notes/ex/a.md', 'notes/ex/moved.md']);
  expect(dates['notes/ex/moved.md'][0]).toBe(startDate);
  expect(dates['notes/ex/a.md'][0]).not.toBe(startDate);
  expect(dates['notes/ex/a.md'][0]).toBe((await (await f.request(`https://api.github.com/repos/owner/repo/commits/${edited}`)).json()).commit.author.date);
  expect(batches).toBe(2);
  // The fixture's own GraphQL fails: each path is asked over REST, with the same dates.
  expect(await datesOf(f.reader(), ['notes/ex/a.md', 'notes/ex/moved.md'])).toEqual(dates);
});
