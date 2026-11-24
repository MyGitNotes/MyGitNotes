import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import YAML from 'yaml';
import { compilationFields, compilationFile, compilationRow, copyCompilation, moveCompilationItem, parseCompilation, relocateCompilation, serializeCompilation } from '../src/compilation.js';
import { replaceFileTags, serializeNoteFile } from '../src/note-file.js';

const raw = readFileSync(new URL('./fixtures/causal-lessons.compilation.yml', import.meta.url), 'utf8');
const owner = { notebookId: 'blog', path: 'blog/src/content/posts/causal/lessons/causal-lessons.compilation.yml' };
const description = '從機率與背景條件講起，一課一個概念，每課附可操作的因果模型。';
const translation = 'translationKey: causal-lessons\n';
const reordered = raw.replace(translation, '') + translation;
const extensions = 'publisher: { editions: [zh, en], available: true }\npriority: 10\n2: null\n1: [draft, published]\n';

it('reads the unchanged blog compilation and exposes its description', () => {
  const file = parseCompilation(raw);
  expect(file.description).toBe(description);
  expect(file.items).toHaveLength(13);
  expect(compilationRow(file, owner)).toMatchObject({ description });
  const summary = compilationFields(raw, owner.path);
  expect(summary.invalid).toBeUndefined();
  expect(summary.metadata).toMatchObject({ description });
  expect(summary.metadata).not.toHaveProperty('translationKey');
});

it('keeps the exact description and translationKey lines on save, with the extension after known fields', () => {
  expect(serializeCompilation(compilationFile(compilationRow(parseCompilation(raw), owner)))).toBe(reordered);
});

it('keeps unknown scalar, sequence and mapping values in source order, including numeric keys', () => {
  const saved = serializeCompilation(parseCompilation(raw.replace(translation, translation + extensions)));
  const entries = [...YAML.parse(saved, { mapAsMap: true }).entries()];
  expect(entries.slice(-5)).toEqual([['translationKey', 'causal-lessons'], ['publisher', new Map<string, unknown>([['editions', ['zh', 'en']], ['available', true]])], ['priority', 10], [2, null], [1, ['draft', 'published']]]);
  expect(entries.at(-6)?.[0]).toBe('items');
});

it('keeps the blog fields through rename, arrangement, reorder, add and remove', () => {
  const row = compilationRow(parseCompilation(raw), owner);
  if (row.kind !== 'custom') throw new Error('Expected the blog compilation to have pinned items');
  const items = row.items;
  const [reorderedRow] = moveCompilationItem({ rows: [row] }, items[0].id, row.id, 1).rows;
  const changes = [[{ ...row, name: '新版講義' }, { title: '新版講義' }], [{ ...row, view: 'graph' as const }, { arrangement: 'graph' }], [reorderedRow, { items: [expect.objectContaining({ id: items[1].id }), expect.objectContaining({ id: items[0].id }), ...items.slice(2).map(item => expect.objectContaining({ id: item.id }))] }], [{ ...row, items: [...items, { id: 'appendix', kind: 'heading' as const, title: '附錄' }] }, { items: expect.arrayContaining([{ id: 'appendix', kind: 'heading', title: '附錄' }]) }], [{ ...row, items: items.slice(1) }, { items: expect.not.arrayContaining([expect.objectContaining({ id: items[0].id })]) }]] as const;
  for (const [next, expected] of changes) {
    const saved = serializeCompilation(compilationFile(next));
    expect(saved).toContain(`description: ${description}\n`);
    expect(saved.endsWith(translation)).toBe(true);
    expect(parseCompilation(saved)).toMatchObject(expected);
  }
});

it('puts extensions last on backend metadata, tag and relocation writes without changing their values', () => {
  const saved = serializeNoteFile(owner.path, { status: 'review' }, raw, false, new Date(), raw);
  const tagged = replaceFileTags(raw, owner.path, ['causal']);
  const relocated = relocateCompilation(raw, path => path.replace('/lessons/', '/chapters/'))!;
  for (const text of [saved, tagged, relocated]) {
    expect(text).toContain(`description: ${description}\n`);
    expect(text.endsWith(translation)).toBe(true);
  }
  expect(parseCompilation(saved).status).toBe('review');
  expect(parseCompilation(tagged).tags).toEqual(['causal']);
  expect(parseCompilation(relocated).items).toEqual(expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('/chapters/') })]));
});

it('round-trips YAML directives and typed external values such as timestamps and binary data', () => {
  const typed = `%YAML 1.1\n---\n${raw}release: !!timestamp 2026-11-24\nblob: !!binary YQ==\nready: yes\n`;
  const text = serializeCompilation(parseCompilation(typed));
  expect(YAML.parse(text, { mapAsMap: true })).toEqual(YAML.parse(typed, { mapAsMap: true }));
  expect(text).toContain('release: !!timestamp 2026-11-24\n');
  expect(text).toContain('blob: !!binary YQ==\n');
});

it('preserves external values that share anchors with fields MGN changes', () => {
  const anchored = raw.replace('title: 因果模型講義', 'title: &title 因果模型講義').replace('status: draft', 'archiveStatus: &archive draft\nstatus: *archive').replace(translation, 'originalTitle: *title\n');
  const file = parseCompilation(anchored);
  const copy = serializeCompilation(copyCompilation(file, []));
  const saved = serializeNoteFile(owner.path, { status: 'review' }, anchored, false, new Date(), anchored);
  for (const text of [copy, saved]) {
    const entries = [...YAML.parse(text, { mapAsMap: true }).entries()];
    expect(entries.slice(-2)).toEqual([['archiveStatus', 'draft'], ['originalTitle', '因果模型講義']]);
  }
  expect(parseCompilation(copy).title).toBe('因果模型講義 copy');
  expect(parseCompilation(saved).status).toBe('review');
});

it('trims descriptions and omits blank ones, still requiring a bounded string', () => {
  const withDescription = (line: string) => reordered.replace(`description: ${description}`, `description: ${line}`);
  expect(parseCompilation(withDescription('"  First chapter  "')).description).toBe('First chapter');
  const blank = parseCompilation(withDescription('"  "'));
  expect(blank.description).toBeUndefined();
  expect(serializeCompilation(blank)).not.toContain('description:');
  expect(() => parseCompilation(withDescription('[not, a, string]'))).toThrow('description:');
  expect(() => parseCompilation(withDescription('a'.repeat(501)))).toThrow('description:');
});

it('still rejects unknown keys inside a pinned item', () => {
  expect(() => parseCompilation(raw.replace('    kind: note\n', '    kind: note\n    extra: true\n'))).toThrow(/items\.0: Unrecognized key\(s\) in object: 'extra'/);
});
