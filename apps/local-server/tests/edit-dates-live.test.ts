import { expect, it } from 'vitest';
import { type EditionSourceConfig, gitBlobId, type LiveContext, liveRepository, parseWorkspaceConfig, sourceIdentity } from '@mygitnotes/core';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, type MemoryFiles } from '../src/memory-edition-source.js';
import { memoryLiveNotes } from '../src/memory-live-notes.js';

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main' };
const repository = sourceIdentity(edition);
const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
const scope = async () => parseWorkspaceConfig(manifest);
const future = '2099-01-01T00:00:00.000Z';

it('dates a checked-out note by its Git file, its typing by the later frontmatter date, and a pending note by its frontmatter', async () => {
  const files: MemoryFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', `---\nupdated: "${future}"\n---\n# A\n`], ['notes/life/b.md', '# B\n']]);
  const liveNotes = memoryLiveNotes({ editor: { origin: 'https://live.example.test', messageType: 'live-status' }, repositories: [{ source: edition, files }] });
  const open = () => {
    const source = new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, scope);
    source.useLive(liveRepository({ liveNotes, context: pat, repository, alias: 'notes', notebooks: async () => (await scope()).notebooks })!);
    return source;
  };
  const writer = open();
  await writer.commitChanges([{ path: 'notes/life/a.md', content: `---\nupdated: "${future}"\n---\n# A\nCommitted.\n` }, { path: 'notes/life/b.md', content: '# B\nCommitted.\n' }], (await writer.getSnapshot()).sha, 'save');
  const committed = new Date(memoryCommits(files).at(-1)!.date).toISOString();
  const checkout = async (file: string) => {
    const content = files.get(file)!;
    return (await liveNotes.person(pat).checkout(repository, { notebook: 'notes~life', path: file, base: { commit: 'a'.repeat(40), blob: gitBlobId(Buffer.from(content), 40), content } })).checkout.id;
  };
  // Checked out, untouched: Git's date, whatever the frontmatter says.
  const a = await checkout('notes/life/a.md');
  expect((await open().editFacts(['notes/life/a.md'])).get('notes/life/a.md')).toEqual({ lastCommitAt: committed });
  // Typed in: the later of the commit and the live frontmatter.
  liveNotes.type(repository, a, `---\nupdated: "${future}"\n---\n# A\nTyping.\n`, pat);
  const [typed] = await open().dated([await open().note('notes/life/a.md')]);
  expect(typed).toMatchObject({ lastCommitAt: committed, updated: future });
  const pending = await liveNotes.person(pat).createPending(repository, { notebook: 'notes~life', pathRule: '{{title}}.md', content: '---\nupdated: "2026-11-01T00:00:00Z"\n---\n# Meeting\n' });
  const virtual = `notes/life/.live/${pending.id}.md`;
  const [draft] = await open().dated([await open().note(virtual)]);
  expect(draft.lastCommitAt).toBeUndefined();
  expect(draft.updated).toBe('2026-11-01T00:00:00.000Z');
  const [plain] = await open().dated([await open().note('notes/life/b.md')]);
  expect(plain).toMatchObject({ lastCommitAt: committed, updated: committed });
});
