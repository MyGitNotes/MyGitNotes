import { expect, it, vi } from 'vitest';
import { openRemoteRepository } from '../src/remote-factory.js';
import { githubFixture } from './fixtures/github.js';

const skill = 'notes/ex/.agents/skills/demo/SKILL.md';
const renamed = skill.replace('/demo/', '/renamed/');
function setup(extras: Record<string, string> = {}) {
  const f = githubFixture({ [skill]: '# Demo\n', ...extras });
  const { reader } = openRemoteRepository({ type: 'github', repository: 'owner/repo', branch: 'main' }, 'token', f.request);
  return { reader, f, rename: (content = '# Demo\n') => reader.renameAgentSkill(skill, 'renamed', content, f.head()) };
}

it('notifies the reader of both sides of a committed skill rename', async () => {
  const { reader, rename } = setup();
  const heard = vi.fn();
  reader.onCommit(heard);
  const receipt = await rename();
  expect(heard).toHaveBeenCalledExactlyOnceWith([{ path: skill, sha: null }, { path: renamed, content: expect.any(String) }], { revision: receipt.revision });
});

it('moves an opaque companion with its directory without making it independently writable', async () => {
  const image = skill.replace('SKILL.md', 'assets/icon.svg');
  const { reader, rename, f } = setup({ [image]: '<svg/>' });
  await expect(reader.commitChanges([{ path: image, sha: null }], f.head(), 'rename', 'agents')).rejects.toMatchObject({ status: 403 });
  await rename();
  expect(f.files()).toContain(image.replace('/demo/', '/renamed/'));
  expect(f.files()).not.toContain(image);
});

it('preserves an unparsable _dir.yml when renaming a skill', async () => {
  const file = skill.replace('SKILL.md', '_dir.yml');
  const { reader, rename, f } = setup({ [file]: 'title: [unclosed' });
  await rename();
  expect(f.files()).not.toContain(file);
  expect((await reader.readFile(file.replace('/demo/', '/renamed/'))).toString()).toBe('title: [unclosed');
});

it('refuses to rename a skill checked out to Live', async () => {
  const { reader, f, rename } = setup();
  reader.useLive({ links: async () => [{ path: skill, checkout: { path: skill } }] } as Parameters<typeof reader.useLive>[0]);
  const before = f.head();
  await expect(rename()).rejects.toMatchObject({ status: 409, paths: [skill] });
  expect(f.head()).toBe(before);
});

it('applies the mutation byte limit to skill renames', async () => {
  const { rename } = setup();
  await expect(rename('a'.repeat(5 * 1024 * 1024))).rejects.toMatchObject({ status: 413 });
});

it('rejects a non-array mutation with a client error', async () => {
  const { reader, f } = setup();
  await expect(reader.commitChanges(null as never, f.head(), 'write')).rejects.toMatchObject({ status: 400 });
});
