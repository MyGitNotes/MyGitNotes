import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LIVE_FRONTMATTER_ORIGIN, readLiveFrontmatter, writeLiveFrontmatter, writeLiveYaml } from './live-frontmatter.js';

const NOTE = '---\n# kept\ntitle: Plan\ntags: [a]\nstatus: draft\n---\n\nBody\n';

/** Two documents that exchange every update, as two tabs on one live note. */
function pair(seed: string) {
  const one = new Y.Doc(), two = new Y.Doc();
  one.getText('content').insert(0, seed);
  Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
  return { one, two, a: one.getText('content'), b: two.getText('content'), sync: () => {
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one, Y.encodeStateVector(two)));
    Y.applyUpdate(one, Y.encodeStateAsUpdate(two, Y.encodeStateVector(one)));
  } };
}

describe('readLiveFrontmatter', () => {
  it('reads metadata, yaml and the body start', () => {
    const read = readLiveFrontmatter(NOTE);
    expect(read).toMatchObject({ valid: true, yaml: '# kept\ntitle: Plan\ntags: [a]\nstatus: draft', metadata: { title: 'Plan', tags: ['a'], status: 'draft' } });
    expect(NOTE.slice(read.bodyStart)).toBe('Body\n');
    expect(read.lineOffset).toBe(7);
  });

  it('a note without frontmatter is valid and empty', () => {
    expect(readLiveFrontmatter('Body')).toMatchObject({ valid: true, metadata: {}, yaml: '', bodyStart: 0, lineOffset: 0 });
  });

  it('an unparsable block is invalid, shown from 0', () => {
    expect(readLiveFrontmatter('---\nx: [\n---\nBody')).toMatchObject({ valid: false, yaml: 'x: [', bodyStart: 0, metadata: {} });
  });
});

describe('writeLiveFrontmatter', () => {
  it('changes only the key that changed, as a minimal edit', () => {
    const { a } = pair(NOTE);
    const shown = readLiveFrontmatter(a.toString()).metadata;
    expect(writeLiveFrontmatter(a, shown, { ...shown, status: 'done' })).toBe(true);
    expect(a.toString()).toBe(NOTE.replace('status: draft', 'status: done'));
  });

  it('two tabs adding different tags keep both', () => {
    const { a, b, sync } = pair('---\ntags:\n  - a\n---\n\nBody\n');
    writeLiveFrontmatter(a, { tags: ['a'] }, { tags: ['a', 'x'] });
    writeLiveFrontmatter(b, { tags: ['a'] }, { tags: ['a', 'y'] });
    sync();
    expect(a.toString()).toBe(b.toString());
    expect(readLiveFrontmatter(a.toString()).metadata.tags).toEqual(expect.arrayContaining(['a', 'x', 'y']));
  });

  it('two tabs changing different keys keep both', () => {
    const { a, b, sync } = pair(NOTE);
    const shown = readLiveFrontmatter(NOTE).metadata;
    writeLiveFrontmatter(a, shown, { ...shown, status: 'done' });
    writeLiveFrontmatter(b, shown, { ...shown, title: 'Other' });
    sync();
    expect(readLiveFrontmatter(a.toString()).metadata).toMatchObject({ status: 'done', title: 'Other' });
    expect(a.toString()).toContain('# kept');
  });

  it('the same scalar raced concatenates (the known limit), still valid YAML', () => {
    const { a, b, sync } = pair(NOTE);
    const shown = readLiveFrontmatter(NOTE).metadata;
    writeLiveFrontmatter(a, shown, { ...shown, status: 'done' });
    writeLiveFrontmatter(b, shown, { ...shown, status: 'review' });
    sync();
    const read = readLiveFrontmatter(a.toString());
    expect(read.valid).toBe(true);
    expect(typeof read.metadata.status).toBe('string');
    expect(read.metadata.status).not.toBe('draft');
    expect(b.toString()).toBe(a.toString());
  });

  it('creates a block on a note without one', () => {
    const { a } = pair('Body\n');
    writeLiveFrontmatter(a, {}, { tags: ['x'] });
    expect(a.toString()).toBe('---\ntags:\n  - x\n---\n\nBody\n');
  });

  it('writes nothing while the block is invalid', () => {
    const bad = '---\nx: [\n---\nBody';
    const { a } = pair(bad);
    expect(writeLiveFrontmatter(a, {}, { status: 'x' })).toBe(false);
    expect(a.toString()).toBe(bad);
  });

  it('is not undone by the editor undo manager', () => {
    const shown = readLiveFrontmatter(NOTE).metadata;
    const fresh = new Y.Doc();
    const ft = fresh.getText('content');
    ft.insert(0, NOTE);
    const tracked = new Y.UndoManager(ft);
    tracked.stopCapturing();
    writeLiveFrontmatter(ft, shown, { ...shown, status: 'done' });
    tracked.undo();
    expect(ft.toString()).toContain('status: done');
  });

  it('marks its transaction with its own origin', () => {
    const { one, a } = pair(NOTE);
    const origins: unknown[] = [];
    one.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    writeLiveFrontmatter(a, {}, { status: 'x' });
    expect(origins).toEqual([LIVE_FRONTMATTER_ORIGIN]);
  });
});

describe('writeLiveYaml', () => {
  it('replaces the YAML when it parses to a map, keeping the body', () => {
    const { a } = pair(NOTE);
    expect(writeLiveYaml(a, '# new\nstatus: done')).toEqual({ ok: true });
    expect(a.toString()).toBe('---\n# new\nstatus: done\n---\n\nBody\n');
  });

  it('refuses YAML that does not parse to a map', () => {
    const { a } = pair(NOTE);
    expect(writeLiveYaml(a, 'x: [')).toMatchObject({ ok: false });
    expect(writeLiveYaml(a, '- a')).toMatchObject({ ok: false });
    expect(a.toString()).toBe(NOTE);
  });

  it('adds a block to a note without one, and fixes an invalid block', () => {
    const { a } = pair('Body');
    writeLiveYaml(a, 'status: x');
    expect(a.toString()).toBe('---\nstatus: x\n---\n\nBody');
    const { a: bad } = pair('---\nx: [\n---\nBody');
    writeLiveYaml(bad, 'x: [1]');
    expect(bad.toString()).toBe('---\nx: [1]\n---\nBody');
  });
});
