import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { parseNoteContent, patchNoteFrontmatter, replaceNoteStatus, replaceNoteTags } from '../src/frontmatter.js';
import { FRONTMATTER_REGEX, patchFrontmatterField } from '../src/frontmatter-patch.js';
import { serializeNoteFile } from '../src/note-file.js';
import { renderNoteTemplate } from '../src/note-template.js';

const now = new Date('2026-11-24T10:00:00Z');
const save = (metadata: Record<string, unknown>, existingRaw?: string) => serializeNoteFile('a.md', metadata, 'Body\n', existingRaw === undefined, now, existingRaw);

function readFrontmatter(raw: string, version: '1.1' | '1.2' = '1.1'): Record<string, unknown> {
  const yaml = FRONTMATTER_REGEX.exec(raw)?.[1];
  expect(yaml).toBeDefined();
  return YAML.parse(yaml!, { version });
}

describe('portable YAML frontmatter', () => {
  it('writes the date and time filled by a note template as strings', () => {
    const { metadata, content } = renderNoteTemplate({ metadata: { title: 't', date: '{{date}}', time: '{{time}}' }, content: 'x' }, { title: 'A', date: '2026-11-24', time: '10:00' });
    const raw = serializeNoteFile('a.md', metadata, content, true, now);
    expect(raw).toMatch(/^date: ["']2026-11-24["']$/m);
    expect(readFrontmatter(raw)).toMatchObject({ date: '2026-11-24', time: '10:00', created: now.toISOString(), updated: now.toISOString() });
  });

  it.each(['2026-11-24', '2026-11-24T10:00:00Z', '2026-1-4 10:00:00', '10:00', '1:02:03.5', 'yes', 'no', 'on', 'off', 'Y', 'n', 'true', 'false', '~', 'null', '0x1F', '1e3', '.inf', '.NaN', '012', '1_000', '0b101', '0o17'])('round-trips %s as a string in YAML 1.1 and 1.2', value => {
    const raw = save({ value });
    for (const version of ['1.1', '1.2'] as const) expect(readFrontmatter(raw, version).value).toBe(value);
  });

  it.each(['+0o17', '-0o17', '2026-11-24T10:00:00.Z', '2026-11-24T10:00:00+30'])('also quotes %s, which js-yaml resolves but yaml does not', value => {
    const raw = save({ value });
    expect(raw).toContain(`value: "${value}"\n`);
    expect(readFrontmatter(raw).value).toBe(value);
  });

  it('retains types inside collections and keeps ordinary text plain', () => {
    const options = [{ status: 'on', count: 12, done: true, fallback: null }, '2026-11-24'];
    const raw = save({ title: 'Ordinary text', options });
    expect(raw).toContain('title: Ordinary text\n');
    expect(readFrontmatter(raw).options).toEqual(options);
    expect(readFrontmatter(raw, '1.2').options).toEqual(options);
  });

  it('quotes changed fields and updated while leaving untouched frontmatter and body bytes alone on save', () => {
    const raw = '---\r\ncreated: "2000-01-01T00:00:00.000Z"\r\nlegacy: 2025-01-01 # untouched\r\ndate: old # keep\r\n---\r\n\r\nBody\n';
    const result = save({ ...parseNoteContent(raw).metadata, date: '2026-11-24' }, raw);
    expect(result).toBe(raw.replace('date: old # keep', 'date: "2026-11-24" # keep\r\nupdated: "2026-11-24T10:00:00.000Z"'));
  });

  it('uses the same quoting when Live creates a block or patches an existing one', () => {
    const after = { date: '2026-11-24' };
    expect(readFrontmatter(patchNoteFrontmatter('Body\n', {}, after))).toEqual(after);
    expect(patchNoteFrontmatter("---\ndate: 'old'\nlegacy: on # untouched\n---\nBody\n", { date: 'old' }, after)).toBe("---\ndate: '2026-11-24'\nlegacy: on # untouched\n---\nBody\n");
  });

  it.each(['', '# comment\n', 'title: Note\n', '{title: Note}\n', 'entry: [old] # keep\n', 'entry: old\n'])('quotes scalars nested in inserted and changed fields after %j', yaml => {
    const next = ['yes', { opened: '2026-11-24' }];
    const raw = patchFrontmatterField(`---\n${yaml}---\nBody\n`, 'entry', next);
    expect(readFrontmatter(raw).entry).toEqual(next);
    expect(raw.endsWith('---\nBody\n')).toBe(true);
  });

  it.each(['Body\n', '---\n---\nBody\n', '---\ntitle: Note\n---\nBody\n', '---\nstatus: old # keep\n---\nBody\n'])('keeps status text when writing to %j', raw => {
    expect(readFrontmatter(replaceNoteStatus(raw, 'on')).status).toBe('on');
  });

  it.each(['[old]', '\n  - old'])('keeps tag text and collection style when replacing %j', style => {
    const raw = `---\ntags:${style.startsWith('[') ? ' ' : ''}${style}\nlegacy: yes\n---\nBody\n`;
    const next = replaceNoteTags(raw, ['on', '2026-11-24']);
    expect(readFrontmatter(next).tags).toEqual(['on', '2026-11-24']);
    expect(next).toContain(style.startsWith('[') ? 'tags: [' : 'tags:\n  - ');
    expect(next.endsWith('legacy: yes\n---\nBody\n')).toBe(true);
  });
});
