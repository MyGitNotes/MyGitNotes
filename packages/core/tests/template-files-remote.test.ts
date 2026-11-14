import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gitlabFixture } from './fixtures/gitlab.js';
import { openRemoteRepository } from '../src/remote-factory.js';
import { lookupNotes, workspaceCatalog } from '../src/note-catalog.js';
import { callNoteShell } from '../src/note-shell.js';
import { classifyResource } from '../src/classifier.js';
import { parseNoteContent } from '../src/frontmatter.js';
import { historyFile } from '../src/note-history.js';
import { MemoryRemoteCache } from '../src/remote-cache.js';

const READING = '---\ntemplate:\n  name: Reading\n  path: reading/{{book}}.md\n  placeholders:\n    book: The book\ntags: [reading]\n---\n# {{title}}\n\n> {{takeaway}}\n';
const MANIFEST = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n    templates:\n      - id: registered\n        title: Registered\n        file: kept/registered.md\n';
const fixture = () => gitlabFixture(undefined, { 'notes/.github-notes.yaml': MANIFEST, 'notes/ex/.templates/reading.md': READING, 'notes/ex/.templates/nested/deep.md': '# Deep\n', 'notes/ex/.other/secret.md': '# Secret\n', 'notes/ex/kept/registered.md': '# {{title}}\n' });
const open = (f: ReturnType<typeof gitlabFixture>) => openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'token', f.request).reader;

describe('a remote notebook’s template files', () => {
  it('are no notes, folders or glob matches, and list as templates with their placeholders', async () => {
    const f = fixture(), reader = open(f);
    expect((await reader.notes()).map(note => note.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/folder/b.md']);
    expect((await reader.folders()).map(folder => folder.path)).toEqual(['folder', 'kept']);
    expect((await callNoteShell(reader, 'glob', { pattern: 'notes/ex/**/*.md' }, false)).paths).toEqual(['notes/ex/a.md', 'notes/ex/folder/b.md', 'notes/ex/kept/registered.md']);
    const templates = await reader.templates('ex');
    expect(templates.map(template => [template.id, template.source, template.name, template.file])).toEqual([['registered', 'manifest', 'Registered', 'notes/ex/kept/registered.md'], ['reading', 'file', 'Reading', 'notes/ex/.templates/reading.md']]);
    expect(templates[1]).toMatchObject({ path: 'reading/{{book}}.md', placeholders: expect.arrayContaining([{ name: 'book', description: 'The book', declared: true }, { name: 'takeaway', declared: false }]) });
    await expect(reader.templates('missing')).rejects.toMatchObject({ status: 404 });
  });

  it('render with values, the clock and literal leftovers, and refuse a value that names no placeholder', async () => {
    const reader = open(fixture());
    const rendered = await reader.renderTemplate('ex', 'reading', 'Dune', { date: '2026-11-14', time: '09:30', values: { book: 'Dune' } });
    expect(rendered).toEqual({ metadata: { tags: ['reading'], title: 'Dune' }, content: '# Dune\n\n> {{takeaway}}\n', unfilled: ['takeaway'] });
    await expect(reader.renderTemplate('ex', 'reading', 'Dune', { values: { nope: 'x' } })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("no placeholder 'nope'") });
    await expect(reader.renderTemplate('ex', 'deep', 'Dune')).rejects.toMatchObject({ status: 404 });
    expect((await reader.renderTemplate('ex', 'registered', 'Dune')).content).toBe('# Dune\n');
  });

  it('read and save like a note in .templates/ only, never in another dot folder or a subfolder', async () => {
    const f = fixture(), reader = open(f);
    expect(await reader.note('notes/ex/.templates/reading.md')).toMatchObject({ notebookId: 'ex', title: '{{title}}', metadata: { template: { name: 'Reading' } } });
    await expect(reader.note('notes/ex/.other/secret.md')).rejects.toMatchObject({ status: 403 });
    await expect(reader.note('notes/ex/.templates/nested/deep.md')).rejects.toMatchObject({ status: 403 });

    await reader.save('notes/ex/.templates/meeting.md', '# {{title}}\n', { template: { name: 'Meeting' } }, f.head, true);
    expect(parseNoteContent(f.files.get('notes/ex/.templates/meeting.md')!).metadata).toMatchObject({ template: { name: 'Meeting' } });
    await expect(open(f).save('notes/ex/.other/new.md', '# x\n', {}, f.head, true)).rejects.toMatchObject({ status: 403 });
    await expect(open(f).save('notes/ex/.templates/nested/new.md', '# x\n', {}, f.head, true)).rejects.toMatchObject({ status: 403 });
    await expect(open(f).save('notes/ex/.templates/new.txt', 'x\n', undefined, f.head, true)).rejects.toMatchObject({ status: 403 });
  });

  it('commit and delete with the working changes of a note commit, and stay out of every other commit scope', async () => {
    const f = fixture();
    await open(f).commitNotes([{ path: 'notes/ex/.templates/reading.md', content: '# {{title}}\n\nChanged.\n', metadata: { template: { name: 'Reading' } } }, { path: 'notes/ex/.templates/weekly.md', content: '# {{title}}\n', metadata: {}, createOnly: true }], f.head, 'docs: templates');
    expect(f.files.get('notes/ex/.templates/reading.md')).toContain('Changed.');
    expect(f.files.has('notes/ex/.templates/weekly.md')).toBe(true);
    await open(f).commitNotes([{ path: 'notes/ex/.templates/weekly.md', delete: true }], f.head, 'docs: remove template');
    expect(f.files.has('notes/ex/.templates/weekly.md')).toBe(false);

    await expect(open(f).commitNotes([{ path: 'notes/ex/.other/secret.md', content: '# x\n', metadata: {} }], f.head, 'docs: no')).rejects.toMatchObject({ status: 403 });
    await expect(open(f).commitNotes([{ path: 'notes/ex/.templates/nested/deep.md', content: '# x\n', metadata: {} }], f.head, 'docs: no')).rejects.toMatchObject({ status: 403 });
    // The file manager renames and deletes a template file as it does any file of the notebook.
    await open(f).commitChanges([{ path: 'notes/ex/.templates/renamed.md', content: '# {{title}}\n' }], f.head, 'move', 'files');
    await open(f).commitChanges([{ path: 'notes/ex/.templates/renamed.md', sha: null }], f.head, 'delete', 'files');
    expect(f.files.has('notes/ex/.templates/renamed.md')).toBe(false);
    for (const scope of ['assets', 'skills', 'agents', 'config', 'study', 'versions'] as const) await expect(open(f).commitChanges([{ path: 'notes/ex/.templates/reading.md', content: 'x' }], f.head, 'write', scope)).rejects.toMatchObject({ status: 403 });
    expect(f.files.get('notes/ex/.other/secret.md')).toBe('# Secret\n');
  });

  it('answer a lookup by path with their body, though no index or query lists them', async () => {
    const reader = open(fixture());
    const config = await reader.config();
    const catalog = await workspaceCatalog(config, [{ id: reader.id, alias: 'qa', notebooks: config.notebooks, catalog: reader.catalog() }]);
    const notebookId = (await catalog.config()).notebooks[0].id;
    expect((await catalog.index((await catalog.config()).notebooks[0])).map(note => note.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/folder/b.md']);
    const found = await lookupNotes(catalog, [{ notebookId, path: 'notes/ex/a.md' }, { notebookId, path: 'notes/ex/.templates/reading.md' }, { notebookId, path: 'notes/ex/kept/registered.md' }, { notebookId, path: 'notes/ex/.other/secret.md' }, { notebookId, path: 'notes/ex/.templates/nested/deep.md' }, { notebookId, path: 'notes/ex/.templates/absent.md' }], true);
    expect(found.notes.map(note => [note.path, note.notebookId])).toEqual([['notes/ex/a.md', notebookId], ['notes/ex/.templates/reading.md', notebookId], ['notes/ex/kept/registered.md', notebookId]]);
    expect(found.notes[1]).toMatchObject({ content: '# {{title}}\n\n> {{takeaway}}\n', revision: expect.any(String) });
    expect((await lookupNotes(catalog, [{ notebookId, path: 'notes/ex/.templates/reading.md' }], false)).notes[0]).not.toHaveProperty('content');
  });

  it('are read, written, edited and removed by the shell tools by exact path, and nothing else in a dot folder is', async () => {
    const f = fixture();
    const file = 'notes/ex/.templates/reading.md';
    expect((await callNoteShell(open(f), 'read', { path: file }, false)).content).toBe(READING);
    await callNoteShell(open(f), 'write', { path: 'notes/ex/.templates/meeting.md', content: '# {{title}}\n', revision: f.head, createOnly: true }, true);
    await callNoteShell(open(f), 'append', { path: 'notes/ex/.templates/meeting.md', content: 'With {{who}}.\n', revision: f.head }, true);
    await callNoteShell(open(f), 'edit', { path: 'notes/ex/.templates/meeting.md', startLine: 1, endLine: 1, content: '# Meeting: {{title}}', revision: f.head }, true);
    expect(f.files.get('notes/ex/.templates/meeting.md')).toBe('# Meeting: {{title}}\nWith {{who}}.\n');
    await callNoteShell(open(f), 'rm', { paths: ['notes/ex/.templates/meeting.md'], revision: f.head }, true);
    expect(f.files.has('notes/ex/.templates/meeting.md')).toBe(false);

    await expect(callNoteShell(open(f), 'read', { path: 'notes/ex/.other/secret.md' }, false)).rejects.toMatchObject({ status: 404 });
    await expect(callNoteShell(open(f), 'read', { path: 'notes/ex/.templates/nested/deep.md' }, false)).rejects.toMatchObject({ status: 404 });
    await expect(callNoteShell(open(f), 'write', { path: 'notes/ex/.other/new.md', content: 'x', revision: f.head }, true)).rejects.toMatchObject({ status: 403 });
    await expect(callNoteShell(open(f), 'write', { path: 'notes/ex/.templates/nested/new.md', content: 'x', revision: f.head }, true)).rejects.toMatchObject({ status: 403 });
    await expect(callNoteShell(open(f), 'rm', { paths: ['notes/ex/.other/secret.md'], revision: f.head }, true)).rejects.toMatchObject({ status: 403 });
    await expect(callNoteShell(open(f), 'rm', { paths: ['notes/ex/.templates'], recursive: true, revision: f.head }, true)).rejects.toMatchObject({ status: 403 });
    expect(f.files.get(file)).toBe(READING);
  });
});

describe('a remote notebook’s template list', () => {
  const source = { type: 'gitlab' as const, url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' };
  const stamped = (created: string) => `---\ntemplate: reading\ncreated: "${created}"\n---\n# Read\n`;
  const files = { 'notes/.github-notes.yaml': MANIFEST, 'notes/ex/.templates/reading.md': READING, 'notes/ex/.templates/meeting.md': '# {{title}}\n\nWith {{who}}.\n', 'notes/ex/kept/registered.md': '# {{title}}\n', 'notes/ex/dune.md': stamped('2026-11-01T08:00:00.000Z'), 'notes/ex/emma.md': stamped('2026-11-10T08:00:00.000Z') };
  /** How many times the files matching `which` were read; the fixture names a blob by the SHA-1 of its text. */
  const blobReads = (f: ReturnType<typeof gitlabFixture>, which = /\.templates\/|registered\.md$/) => {
    const ids = new Set([...f.files].filter(([file]) => which.test(file)).map(([, text]) => createHash('sha1').update(text).digest('hex')));
    return f.calls.filter(call => call.url.includes('/repository/blobs/') && ids.has(decodeURIComponent(call.url.split('/repository/blobs/')[1].split(/[/?]/)[0]))).length;
  };

  it('is cached by the content of the template files: a second reader reads none of them, a note edit keeps it, and an edited template is seen at once', async () => {
    const cache = new MemoryRemoteCache();
    const f = gitlabFixture(undefined, files, { contentTrees: true });
    const reader = () => openRemoteRepository(source, 'token', f.request, cache).reader;
    const first = await reader().templates('ex');
    expect(first.map(template => [template.id, template.name])).toEqual([['registered', 'Registered'], ['meeting', 'meeting'], ['reading', 'Reading']]);
    const cold = blobReads(f);
    expect(cold).toBe(3);

    expect(await reader().templates('ex')).toEqual(first);
    expect(blobReads(f)).toBe(cold);
    // Another commit of the notebook's notes leaves the template files, and so the cached list, as they were.
    f.files.set('notes/ex/a.md', '# Alpha, edited\n');
    f.setHead('c'.repeat(40));
    expect(await reader().templates('ex')).toEqual(first);
    expect(blobReads(f)).toBe(cold);

    f.files.set('notes/ex/.templates/reading.md', '---\ntemplate:\n  name: Changed\n---\n# {{title}}\n');
    f.setHead('d'.repeat(40));
    expect((await reader().templates('ex')).map(template => template.name)).toEqual(['Registered', 'meeting', 'Changed']);
    expect(blobReads(f, /reading\.md$/)).toBe(1);
    // A manifest-registered template lies outside .templates/: its own file's content keys it.
    f.files.set('notes/ex/kept/registered.md', '---\ntemplate:\n  description: Now described\n---\n# {{title}}\n');
    f.setHead('e'.repeat(40));
    expect((await reader().templates('ex'))[0]).toMatchObject({ id: 'registered', description: 'Now described' });
  });

  it('keeps no list in the cache when a template file failed to read, so the next call reads it again', async () => {
    const cache = new MemoryRemoteCache();
    const f = gitlabFixture(undefined, files, { contentTrees: true });
    const reading = createHash('sha1').update(READING).digest('hex');
    let fail = true;
    const request = (async (input: string | URL | Request, init?: RequestInit) => {
      if (fail && String(input).includes(`/repository/blobs/${reading}`)) return new Response('unavailable', { status: 500 });
      return f.request(input, init);
    }) as typeof fetch;
    const failing = await openRemoteRepository(source, 'token', request, cache).reader.templates('ex');
    expect(failing.find(template => template.id === 'reading')?.name).toBe('reading');
    fail = false;
    expect((await openRemoteRepository(source, 'token', request, cache).reader.templates('ex')).find(template => template.id === 'reading')).toMatchObject({ name: 'Reading', path: 'reading/{{book}}.md' });
  });

  it('carries each template’s last use from the notes index, reading no note body for it once the index is cached', async () => {
    const cache = new MemoryRemoteCache();
    const f = gitlabFixture(undefined, files, { contentTrees: true });
    const reader = () => openRemoteRepository(source, 'token', f.request, cache).reader;
    expect((await reader().listedTemplates('ex')).map(template => [template.id, template.lastUsed])).toEqual([['registered', null], ['meeting', null], ['reading', '2026-11-10T08:00:00.000Z']]);
    const notes = /^notes\/ex\/[^.]/;
    const cold = blobReads(f, notes);
    expect(cold).toBeGreaterThan(0);
    expect((await reader().listedTemplates('ex')).map(template => template.lastUsed)).toEqual([null, null, '2026-11-10T08:00:00.000Z']);
    expect(blobReads(f, notes)).toBe(cold);
    // A note created from a template since then moves its last use.
    f.files.set('notes/ex/frankenstein.md', stamped('2026-11-12T08:00:00.000Z'));
    f.setHead('c'.repeat(40));
    expect((await reader().listedTemplates('ex')).find(template => template.id === 'reading')?.lastUsed).toBe('2026-11-12T08:00:00.000Z');
    expect((await reader().template('ex', 'reading')).raw).toBe(READING);
  });
});

it('gives a template file a history as a note has, and no other dot path one', () => {
  const notebooks = [{ id: 'ex', title: 'Example', root: 'notes/ex' }];
  expect(historyFile('notes/ex/.templates/reading.md', notebooks)).toBe(true);
  expect(historyFile('notes/ex/a.md', notebooks)).toBe(true);
  expect(historyFile('notes/ex/.templates/nested/deep.md', notebooks)).toBe(false);
  expect(historyFile('notes/ex/.other/secret.md', notebooks)).toBe(false);
});

it('classifies a notebook’s .templates/*.md as a template and every other dot path as hidden', () => {
  const config = { notebooks: [{ id: 'ex', title: 'Example', root: 'notes/ex' }] } as Parameters<typeof classifyResource>[1];
  expect(classifyResource('notes/ex/.templates/reading.md', config)).toEqual({ path: 'notes/ex/.templates/reading.md', type: 'template', notebookId: 'ex' });
  expect(classifyResource('notes/ex/.templates/nested/deep.md', config).type).toBe('hidden');
  expect(classifyResource('notes/ex/.other/secret.md', config).type).toBe('hidden');
  expect(classifyResource('notes/.templates/x.md', config).type).toBe('hidden');
  expect(classifyResource('notes/ex/.templates/x.png', config).type).toBe('hidden');
});
