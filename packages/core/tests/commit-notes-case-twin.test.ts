import { describe, expect, it } from 'vitest';
import { CASE_COLLISION_ERROR } from '../src/case-collision.js';
import { type RemoteSnapshot, RemoteSource } from '../src/remote-source.js';
import { RemoteManifest } from '../src/remote-manifest.js';

// A case-insensitive file system (macOS, Windows) makes two names that differ only in letter case or Unicode form one entry,
// so a creation must not take such a name, whether the other entry is committed or created in the same batch.
const manifest = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
const files: Record<string, string> = { 'notes/.github-notes.yaml': manifest, 'notes/ex/Plan.md': '---\ntitle: Plan\n---\n\nBody.\n', 'notes/ex/café.md': '---\ntitle: Cafe\n---\n\nBody.\n' };
const entries = Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644', sha: `sha-${path}` }));

class FakeSource extends RemoteSource {
  get id() {
    return 'github:owner/repo@main';
  }
  protected async loadSnapshot(): Promise<RemoteSnapshot> {
    return { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40), entries, info: { private: false, permissions: { push: true }, default_branch: 'main' } };
  }
  protected async readBlob(sha: string): Promise<Buffer> {
    return Buffer.from(files[entries.find(e => e.sha === sha)!.path], 'utf8');
  }
  protected async publishChanges(): Promise<string> {
    return 'c'.repeat(40);
  }
}
const create = (path: string) => ({ path, content: 'Body.', metadata: { title: 'New' }, createOnly: true });
const commit = (...notes: ReturnType<typeof create>[] | { path: string; delete: true; }[]) => {
  const source = new FakeSource('owner/repo', 'main', 'token', undefined, async () => (await store.load()).config);
  const store = new RemoteManifest(source);
  return source.commitNotes(notes as never, 'a'.repeat(40), 'docs: add');
};

describe('RemoteSource.commitNotes creation and letter case', () => {
  it('refuses a creation that differs from a committed note only in letter case or Unicode form', async () => {
    await expect(commit(create('notes/ex/plan.md'))).rejects.toMatchObject({ message: CASE_COLLISION_ERROR, status: 409 });
    await expect(commit(create('notes/ex/café.md'))).rejects.toMatchObject({ message: CASE_COLLISION_ERROR, status: 409 });
  });

  it('refuses two creations of one batch whose names fold equal', async () => {
    await expect(commit(create('notes/ex/new.md'), create('notes/ex/New.md'))).rejects.toMatchObject({ message: CASE_COLLISION_ERROR, status: 409 });
  });

  it('allows a creation under a name that folds to a note the same batch deletes, and an unrelated one', async () => {
    await expect(commit(create('notes/ex/other.md'))).resolves.toBeDefined();
    await expect(commit({ path: 'notes/ex/Plan.md', delete: true }, create('notes/ex/plan.md'))).resolves.toBeDefined();
  });
});
