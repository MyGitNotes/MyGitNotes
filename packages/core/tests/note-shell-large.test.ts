import { expect, it, vi } from 'vitest';
import { callNoteShell } from '../src/note-shell.js';
import { githubFixture } from './fixtures/github.js';

// A workspace whose notes total more than 32 MiB: an MCP move rewrites only the notes that link to what moved.
vi.setConfig({ testTimeout: 15000 }); // Each case takes about a second under load.
const filler = (i: number) => `# Filler ${i}\n\n` + `lorem ipsum dolor sit amet ${i}\n`.repeat(Math.floor(1024 * 1024 / 30));

it('moves a note with mv in a workspace whose notes total more than 32 MiB', async () => {
  const extra: Record<string, string> = { 'notes/ex/target.md': '# Target\n', 'notes/ex/linker.md': '[T](target.md)\n', 'notes/ex/mention.md': '[O](other/path.md)\n' };
  for (let i = 0; i < 36; i++) extra[`notes/ex/bulk/filler-${i}.md`] = filler(i);
  const f = githubFixture(extra);
  await callNoteShell(f.reader(), 'mv', { source: 'notes/ex/target.md', destination: 'notes/ex/moved.md', revision: f.head() }, true);
  expect(f.text('notes/ex/moved.md')).toBe('# Target\n');
  expect(f.files()).not.toContain('notes/ex/target.md');
  expect(f.text('notes/ex/linker.md')).toBe('[T](moved.md)\n');
  expect(f.text('notes/ex/mention.md')).toBe('[O](other/path.md)\n');
});

it('refuses mv when the notes it rewrites total more than 32 MiB, naming the cause', async () => {
  const extra: Record<string, string> = { 'notes/ex/target.md': '# Target\n' };
  for (let i = 0; i < 8; i++) extra[`notes/ex/bulk/linker-${i}.md`] = '[T](../target.md)\n' + filler(i) + filler(i + 100) + filler(i + 200) + filler(i + 300);
  const f = githubFixture(extra);
  await expect(callNoteShell(f.reader(), 'mv', { source: 'notes/ex/target.md', destination: 'notes/ex/moved.md', revision: f.head() }, true)).rejects.toMatchObject({ status: 413, message: expect.stringMatching(/more than 32 MiB of files that may link to the moved path/) });
  expect(f.files()).toContain('notes/ex/target.md');
});
